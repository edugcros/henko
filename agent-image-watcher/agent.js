import 'dotenv/config'
import chokidar from 'chokidar'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import axios from 'axios'
import FormData from 'form-data'
import mime from 'mime-types'
import fse from 'fs-extra'

export const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return ['true', '1', 'yes', 'si', 'sí'].includes(String(value).trim().toLowerCase())
}

const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

const trimTrailingSlash = value => String(value || '').trim().replace(/\/+$/, '')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const config = Object.freeze({
  watchFolder: process.env.WATCH_FOLDER,
  processedFolder: process.env.PROCESSED_FOLDER,
  failedFolder: process.env.FAILED_FOLDER,
  apiBaseUrl: trimTrailingSlash(process.env.API_BASE_URL),
  tenantDomain: String(process.env.TENANT_DOMAIN || '').trim().toLowerCase(),
  agentApiKey: process.env.AGENT_API_KEY,
  adminToken: process.env.ADMIN_TOKEN,
  analysisEndpoint: process.env.ANALYSIS_ENDPOINT || '/product-analysis/import',
  healthEndpoint: process.env.AGENT_HEALTH_ENDPOINT || '',
  autoAnalyze: parseBoolean(process.env.AUTO_ANALYZE, true),
  autoCreateProduct: parseBoolean(process.env.AUTO_CREATE_PRODUCT, false),
  autoSaveProduct: parseBoolean(process.env.AUTO_SAVE_PRODUCT, false),
  autoPublishProduct: parseBoolean(process.env.AUTO_PUBLISH_PRODUCT, false),
  defaultSendAt: process.env.AGENT_DEFAULT_SEND_AT || '',
  defaultDelayMinutes: parsePositiveInt(process.env.AGENT_DEFAULT_DELAY_MINUTES, 0, {
    min: 0,
    max: 525600,
  }),
  concurrency: parsePositiveInt(process.env.AGENT_CONCURRENCY, 2, { min: 1, max: 10 }),
  maxRetries: parsePositiveInt(process.env.AGENT_MAX_RETRIES, 4, { min: 1, max: 10 }),
  retryBaseMs: parsePositiveInt(process.env.AGENT_RETRY_BASE_MS, 1500, {
    min: 250,
    max: 60000,
  }),
  requestTimeoutMs: parsePositiveInt(process.env.AGENT_REQUEST_TIMEOUT_MS, 120000, {
    min: 5000,
    max: 600000,
  }),
  maxFileSizeBytes: parsePositiveInt(
    process.env.AGENT_MAX_FILE_SIZE_BYTES,
    10 * 1024 * 1024,
    { min: 1024, max: 50 * 1024 * 1024 },
  ),
  lockStaleMs: parsePositiveInt(process.env.AGENT_LOCK_STALE_MS, 120000, {
    min: 30000,
    max: 3600000,
  }),
  promotionNotifierEnabled: parseBoolean(process.env.PROMOTION_NOTIFIER_ENABLED, false),
  promotionNotifierEndpoint:
    process.env.PROMOTION_NOTIFIER_ENDPOINT || '/product-analysis/wishlist-promotions/run',
  promotionNotifierIntervalMinutes: parsePositiveInt(
    process.env.PROMOTION_NOTIFIER_INTERVAL_MINUTES,
    60,
    { min: 5, max: 1440 },
  ),
  promotionNotifierDryRun: parseBoolean(process.env.PROMOTION_NOTIFIER_DRY_RUN, false),
})

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'])
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const STATUS_FILENAME = 'agent-status.json'
const LOCK_FILENAME = '.agent-image-watcher.lock'

const status = {
  version: 2,
  pid: process.pid,
  startedAt: null,
  lastEventAt: null,
  heartbeatAt: null,
  state: 'starting',
  watchFolder: config.watchFolder,
  tenantDomain: config.tenantDomain,
  apiBaseUrl: config.apiBaseUrl,
  queue: {
    pending: 0,
    active: 0,
    concurrency: config.concurrency,
  },
  counters: {
    detected: 0,
    uploaded: 0,
    scheduled: 0,
    duplicated: 0,
    failed: 0,
    retried: 0,
    rejected: 0,
    promotionNotificationsSent: 0,
    promotionNotificationsSkipped: 0,
    promotionNotificationsFailed: 0,
  },
  recent: [],
}

let watcher = null
let lockHandle = null
let heartbeatTimer = null
let notifierTimer = null
let notifierRunning = false
let shuttingDown = false
let statusWriteChain = Promise.resolve()

const pendingFiles = []
const queuedFiles = new Set()
const activeFiles = new Set()

const validateConfig = () => {
  const required = {
    WATCH_FOLDER: config.watchFolder,
    PROCESSED_FOLDER: config.processedFolder,
    FAILED_FOLDER: config.failedFolder,
    API_BASE_URL: config.apiBaseUrl,
    TENANT_DOMAIN: config.tenantDomain,
    ANALYSIS_ENDPOINT: config.analysisEndpoint,
  }
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (!config.agentApiKey && !config.adminToken) {
    missing.push('AGENT_API_KEY')
  }
  if (process.env.NODE_ENV === 'production' && !config.agentApiKey) {
    throw new Error('AGENT_API_KEY es obligatoria en producción; ADMIN_TOKEN no está permitido')
  }
  if (process.env.NODE_ENV === 'production' && !config.apiBaseUrl.startsWith('https://')) {
    throw new Error('API_BASE_URL debe usar HTTPS en producción')
  }
  if (missing.length) {
    throw new Error(`Configuración incompleta: ${missing.join(', ')}`)
  }

  const resolved = [
    config.watchFolder,
    config.processedFolder,
    config.failedFolder,
  ].map(folder => path.resolve(folder))
  if (new Set(resolved.map(folder => folder.toLowerCase())).size !== resolved.length) {
    throw new Error('WATCH_FOLDER, PROCESSED_FOLDER y FAILED_FOLDER deben ser diferentes')
  }
}

const ensureFolders = async () => {
  await Promise.all([
    fse.ensureDir(config.watchFolder),
    fse.ensureDir(config.processedFolder),
    fse.ensureDir(config.failedFolder),
  ])
}

const getStatusPath = () => path.join(config.watchFolder, STATUS_FILENAME)
const getLockPath = () => path.join(config.watchFolder, LOCK_FILENAME)

const writeStatus = () => {
  status.lastEventAt = new Date().toISOString()
  status.queue.pending = pendingFiles.length
  status.queue.active = activeFiles.size
  const serialized = JSON.stringify(status, null, 2)
  const targetPath = getStatusPath()
  const temporaryPath = `${targetPath}.${process.pid}.tmp`

  statusWriteChain = statusWriteChain
    .catch(() => undefined)
    .then(async () => {
      await fs.writeFile(temporaryPath, serialized, 'utf8')
      await fse.move(temporaryPath, targetPath, { overwrite: true })
    })

  return statusWriteChain
}

const pushRecent = async event => {
  status.recent = [{ at: new Date().toISOString(), ...event }, ...status.recent].slice(0, 50)
  await writeStatus()
}

const acquireInstanceLock = async () => {
  const lockPath = getLockPath()
  try {
    lockHandle = await fs.open(lockPath, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error

    let stale = false
    try {
      const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'))
      stale = Date.now() - new Date(lock.heartbeatAt || lock.startedAt).getTime() > config.lockStaleMs
    } catch {
      stale = true
    }

    if (!stale) {
      throw new Error(`Ya existe otra instancia activa para ${config.watchFolder}`)
    }

    await fse.remove(lockPath)
    lockHandle = await fs.open(lockPath, 'wx')
  }

  const updateLock = async () => {
    if (!lockHandle) return
    const now = new Date().toISOString()
    status.heartbeatAt = now
    const lockContents = JSON.stringify({
      pid: process.pid,
      startedAt: status.startedAt,
      heartbeatAt: now,
      tenantDomain: config.tenantDomain,
    })
    await lockHandle.truncate(0)
    await lockHandle.write(lockContents, 0, 'utf8')
    await lockHandle.sync()
    await writeStatus()
  }

  await updateLock()
  heartbeatTimer = setInterval(() => {
    updateLock().catch(error => console.error('[AGENT] Error de heartbeat:', error.message))
  }, Math.max(10000, Math.floor(config.lockStaleMs / 3)))
  heartbeatTimer.unref?.()
}

const isImageFile = filePath => ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase())

const parseDate = value => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const getSidecarSchedulePath = filePath => {
  const parsed = path.parse(filePath)
  return path.join(parsed.dir, `${parsed.name}.schedule.json`)
}

const readSidecarSchedule = async filePath => {
  const schedulePath = getSidecarSchedulePath(filePath)
  try {
    const configValue = JSON.parse(await fs.readFile(schedulePath, 'utf8'))
    return {
      sendAt: parseDate(configValue.sendAt || configValue.scheduledAt),
      autoAnalyze:
        configValue.autoAnalyze === undefined
          ? null
          : parseBoolean(configValue.autoAnalyze),
      autoCreateProduct:
        configValue.autoCreateProduct === undefined
          ? null
          : parseBoolean(configValue.autoCreateProduct),
      autoPublishProduct:
        configValue.autoPublishProduct === undefined
          ? null
          : parseBoolean(configValue.autoPublishProduct),
      autoSaveProduct:
        configValue.autoSaveProduct === undefined
          ? null
          : parseBoolean(configValue.autoSaveProduct),
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        sendAt: null,
        autoAnalyze: null,
        autoCreateProduct: null,
        autoPublishProduct: null,
        autoSaveProduct: null,
      }
    }
    throw new Error(`Schedule inválido para ${path.basename(filePath)}: ${error.message}`)
  }
}

const getDefaultSendAt = () => {
  const explicitDate = parseDate(config.defaultSendAt)
  if (explicitDate) return explicitDate
  return config.defaultDelayMinutes > 0
    ? new Date(Date.now() + config.defaultDelayMinutes * 60000)
    : null
}

const waitUntilFileIsStable = async (filePath, attempts = 8, delay = 750) => {
  let previous = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await fs.stat(filePath)
    if (previous && current.size === previous.size && current.mtimeMs === previous.mtimeMs && current.size > 0) {
      return current
    }
    previous = current
    await sleep(delay)
  }
  throw new Error('El archivo no está estable o continúa copiándose')
}

export const detectImageType = buffer => {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  const brand = buffer.subarray(4, 12).toString('ascii').toLowerCase()
  if (brand.includes('ftyp') && /(heic|heix|hevc|hevx|mif1)/.test(buffer.subarray(8, 24).toString('ascii').toLowerCase())) {
    return 'image/heic'
  }
  return null
}

const validateImageFile = async filePath => {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('La ruta detectada no es un archivo regular')
  if (stat.size <= 0) throw new Error('La imagen está vacía')
  if (stat.size > config.maxFileSizeBytes) {
    throw new Error(`La imagen supera el máximo de ${config.maxFileSizeBytes} bytes`)
  }
  const handle = await fs.open(filePath, 'r')
  try {
    const probe = Buffer.alloc(Math.min(32, stat.size))
    await handle.read(probe, 0, probe.length, 0)
    const detectedMime = detectImageType(probe)
    if (!detectedMime) throw new Error('El contenido no corresponde a una imagen permitida')
    return { stat, detectedMime }
  } finally {
    await handle.close()
  }
}

const getAuthHeaders = () => (
  config.agentApiKey
    ? { 'x-agent-api-key': config.agentApiKey }
    : { Authorization: `Bearer ${config.adminToken}` }
)

const createIdempotencyKey = async filePath => {
  const hash = crypto.createHash('sha256')
  const stream = fse.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

const moveToFolder = async (filePath, targetFolder) => {
  const parsed = path.parse(filePath)
  let targetPath
  do {
    targetPath = path.join(
      targetFolder,
      `${parsed.name}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}${parsed.ext.toLowerCase()}`,
    )
  } while (await fse.pathExists(targetPath))
  await fse.move(filePath, targetPath, { overwrite: false })
  return targetPath
}

export const isRetryableError = error => {
  if (!error.response) {
    return [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ECONNABORTED',
      'ERR_NETWORK',
    ].includes(error.code)
  }
  return RETRYABLE_HTTP_STATUS.has(error.response.status)
}

const withRetry = async operation => {
  let lastError
  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (!isRetryableError(error) || attempt === config.maxRetries || shuttingDown) throw error
      status.counters.retried += 1
      const retryAfterSeconds = Number.parseInt(error.response?.headers?.['retry-after'], 10)
      const backoff = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : config.retryBaseMs * (2 ** (attempt - 1)) + Math.floor(Math.random() * 500)
      await sleep(backoff)
    }
  }
  throw lastError
}

const uploadImageForAnalysis = async (filePath, options, detectedMime) => {
  const filename = path.basename(filePath)
  const idempotencyKey = await createIdempotencyKey(filePath)
  return withRetry(async attempt => {
    const form = new FormData()
    form.append('image', fse.createReadStream(filePath), {
      filename,
      contentType: detectedMime || mime.lookup(filePath) || 'application/octet-stream',
    })
    form.append('source', 'local-folder-agent')
    form.append('originalFilename', filename)
    form.append('autoAnalyze', String(options.autoAnalyze))
    form.append('autoCreateProduct', String(options.autoCreateProduct))
    form.append('autoSaveProduct', String(options.autoSaveProduct))
    form.append('autoPublishProduct', String(options.autoPublishProduct))
    if (options.scheduledAt) form.append('scheduledAt', options.scheduledAt.toISOString())

    const response = await axios.post(
      `${config.apiBaseUrl}${config.analysisEndpoint}`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          ...getAuthHeaders(),
          'x-tenant-domain': config.tenantDomain,
          'x-idempotency-key': idempotencyKey,
          'x-agent-attempt': String(attempt),
        },
        timeout: config.requestTimeoutMs,
        maxBodyLength: config.maxFileSizeBytes + 1024 * 1024,
        maxContentLength: config.maxFileSizeBytes + 1024 * 1024,
        validateStatus: () => true,
      },
    )

    if (response.status === 409 && response.data?.code === 'PRODUCT_ANALYSIS_DUPLICATE') {
      return { kind: 'duplicate', data: response.data }
    }
    if (response.status >= 200 && response.status < 300 && response.data?.success !== false) {
      return { kind: 'accepted', data: response.data }
    }

    const error = new Error(
      response.data?.message || `La API rechazó la imagen con HTTP ${response.status}`,
    )
    error.response = response
    throw error
  })
}

const removeSidecarSchedule = async filePath => {
  const schedulePath = getSidecarSchedulePath(filePath)
  if (await fse.pathExists(schedulePath)) await fse.remove(schedulePath)
}

const writeFailureDetails = async (movedPath, error) => {
  const details = {
    failedAt: new Date().toISOString(),
    tenantDomain: config.tenantDomain,
    message: error.response?.data?.message || error.message,
    code: error.response?.data?.code || error.code || null,
    httpStatus: error.response?.status || null,
  }
  await fs.writeFile(`${movedPath}.error.json`, JSON.stringify(details, null, 2), 'utf8')
}

const processFile = async filePath => {
  const filename = path.basename(filePath)
  try {
    await waitUntilFileIsStable(filePath)
    const { detectedMime } = await validateImageFile(filePath)
    const sidecar = await readSidecarSchedule(filePath)
    const scheduledAt = sidecar.sendAt || getDefaultSendAt()
    const options = {
      scheduledAt: scheduledAt && scheduledAt > new Date() ? scheduledAt : null,
      autoAnalyze: sidecar.autoAnalyze ?? config.autoAnalyze,
      autoCreateProduct: sidecar.autoCreateProduct ?? config.autoCreateProduct,
      autoSaveProduct: sidecar.autoSaveProduct ?? config.autoSaveProduct,
      autoPublishProduct: sidecar.autoPublishProduct ?? config.autoPublishProduct,
    }

    if (options.autoPublishProduct && !options.autoCreateProduct) {
      throw new Error('AUTO_PUBLISH_PRODUCT requiere AUTO_CREATE_PRODUCT=true')
    }

    const result = await uploadImageForAnalysis(filePath, options, detectedMime)
    const response = result.data || {}
    if (result.kind === 'duplicate') {
      status.counters.duplicated += 1
    } else {
      status.counters.uploaded += 1
      if (response.job?.status === 'scheduled') status.counters.scheduled += 1
    }

    await moveToFolder(filePath, config.processedFolder)
    await removeSidecarSchedule(filePath)
    await pushRecent({
      filename,
      status: result.kind,
      message: response.message || 'Imagen aceptada',
      jobId: response.job?._id || response.jobId || null,
      backendStatus: response.job?.status || null,
    })
  } catch (error) {
    status.counters.failed += 1
    if (error.response && !isRetryableError(error)) status.counters.rejected += 1
    console.error(`[AGENT] Error procesando ${filename}:`, error.response?.data?.message || error.message)
    try {
      if (await fse.pathExists(filePath)) {
        const movedPath = await moveToFolder(filePath, config.failedFolder)
        await writeFailureDetails(movedPath, error)
      }
      await removeSidecarSchedule(filePath)
    } catch (moveError) {
      console.error('[AGENT] No se pudo preservar el archivo fallido:', moveError.message)
    }
    await pushRecent({
      filename,
      status: 'failed',
      message: error.response?.data?.message || error.message,
      httpStatus: error.response?.status || null,
    })
  }
}

const pumpQueue = () => {
  if (shuttingDown) return
  while (activeFiles.size < config.concurrency && pendingFiles.length > 0) {
    const filePath = pendingFiles.shift()
    queuedFiles.delete(filePath)
    activeFiles.add(filePath)
    writeStatus().catch(() => undefined)
    processFile(filePath)
      .catch(error => console.error('[AGENT] Error inesperado:', error))
      .finally(() => {
        activeFiles.delete(filePath)
        writeStatus().catch(() => undefined)
        pumpQueue()
      })
  }
}

const enqueueFile = async filePath => {
  const normalized = path.resolve(filePath)
  if (!isImageFile(normalized) || queuedFiles.has(normalized) || activeFiles.has(normalized)) return
  if (normalized.startsWith(path.resolve(config.processedFolder)) ||
      normalized.startsWith(path.resolve(config.failedFolder))) return

  status.counters.detected += 1
  queuedFiles.add(normalized)
  pendingFiles.push(normalized)
  await pushRecent({
    filename: path.basename(normalized),
    status: 'queued',
    message: 'Imagen agregada a la cola local',
  })
  pumpQueue()
}

const runWishlistPromotionNotifier = async () => {
  if (!config.promotionNotifierEnabled || notifierRunning || shuttingDown) return
  notifierRunning = true
  try {
    const response = await withRetry(() => axios.post(
      `${config.apiBaseUrl}${config.promotionNotifierEndpoint}`,
      { dryRun: config.promotionNotifierDryRun },
      {
        headers: {
          ...getAuthHeaders(),
          'x-tenant-domain': config.tenantDomain,
        },
        timeout: config.requestTimeoutMs,
      },
    ))
    const result = response.data || {}
    status.counters.promotionNotificationsSent += Number(result.sent || 0)
    status.counters.promotionNotificationsSkipped += Number(result.skipped || 0)
    status.counters.promotionNotificationsFailed += Number(result.failed || 0)
    await pushRecent({
      filename: null,
      status: 'wishlist-promotions',
      message: `Enviados=${result.sent || 0}; omitidos=${result.skipped || 0}; fallidos=${result.failed || 0}`,
    })
  } catch (error) {
    status.counters.promotionNotificationsFailed += 1
    await pushRecent({
      filename: null,
      status: 'wishlist-promotions-failed',
      message: error.response?.data?.message || error.message,
    })
  } finally {
    notifierRunning = false
  }
}

const checkBackendHealth = async () => {
  if (!config.healthEndpoint) return
  await axios.get(`${config.apiBaseUrl}${config.healthEndpoint}`, {
    headers: {
      ...getAuthHeaders(),
      'x-tenant-domain': config.tenantDomain,
    },
    timeout: Math.min(config.requestTimeoutMs, 10000),
  })
}

const shutdown = async signal => {
  if (shuttingDown) return
  shuttingDown = true
  status.state = 'stopping'
  await pushRecent({ status: 'shutdown', message: `Cierre solicitado por ${signal}` })
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (notifierTimer) clearInterval(notifierTimer)
  if (watcher) await watcher.close()

  const deadline = Date.now() + 30000
  while (activeFiles.size > 0 && Date.now() < deadline) await sleep(250)

  status.state = 'stopped'
  await writeStatus()
  if (lockHandle) {
    await lockHandle.close().catch(() => undefined)
    lockHandle = null
  }
  await fse.remove(getLockPath()).catch(() => undefined)
  process.exit(activeFiles.size > 0 ? 1 : 0)
}

const start = async () => {
  validateConfig()
  await ensureFolders()
  status.startedAt = new Date().toISOString()
  await acquireInstanceLock()
  await checkBackendHealth()

  watcher = chokidar.watch(config.watchFolder, {
    persistent: true,
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 400,
    },
    ignored: [
      path.join(config.watchFolder, STATUS_FILENAME),
      path.join(config.watchFolder, LOCK_FILENAME),
      '**/*.schedule.json',
      '**/*.error.json',
      '**/processed/**',
      '**/failed/**',
    ],
  })
  watcher.on('add', filePath => {
    enqueueFile(filePath).catch(error => console.error('[AGENT] Error encolando imagen:', error.message))
  })
  watcher.on('error', error => console.error('[AGENT] Watcher error:', error))

  if (config.promotionNotifierEnabled) {
    runWishlistPromotionNotifier().catch(() => undefined)
    notifierTimer = setInterval(
      () => runWishlistPromotionNotifier().catch(() => undefined),
      config.promotionNotifierIntervalMinutes * 60000,
    )
  }

  status.state = 'running'
  await pushRecent({
    status: 'started',
    message: `Agente iniciado con concurrencia ${config.concurrency}`,
  })
  console.log(
    `[AGENT] Activo | tenant=${config.tenantDomain} concurrency=${config.concurrency} autoAnalyze=${config.autoAnalyze}`,
  )
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  process.once('SIGINT', () => shutdown('SIGINT').catch(console.error))
  process.once('SIGTERM', () => shutdown('SIGTERM').catch(console.error))
  process.once('uncaughtException', error => {
    console.error('[AGENT] Excepción no controlada:', error)
    shutdown('uncaughtException').catch(() => process.exit(1))
  })
  process.once('unhandledRejection', error => {
    console.error('[AGENT] Promesa rechazada no controlada:', error)
    shutdown('unhandledRejection').catch(() => process.exit(1))
  })

  start().catch(error => {
    console.error('[AGENT] Error fatal:', error.message)
    process.exit(1)
  })
}
