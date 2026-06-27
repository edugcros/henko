import 'dotenv/config'
import chokidar from 'chokidar'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import http from 'http'
import os from 'os'
import { fileURLToPath } from 'url'
import axios from 'axios'
import FormData from 'form-data'
import mime from 'mime-types'
import fse from 'fs-extra'

const APP_NAME = 'henko-product-image-folder-agent'
const APP_VERSION = '3.0.0'

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(String(value).trim().toLowerCase())
}

const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

const parseCsv = value => String(value || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)

const trimTrailingSlash = value => String(value || '').trim().replace(/\/+$/, '')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const parseJsonEnv = (value, fallback = {}) => {
  if (!String(value || '').trim()) return fallback
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Variable JSON inválida: ${error.message}`)
  }
}

const normalizePathForCompare = value => path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase()

const normalizeTenantDomain = value => {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''

  const withoutProtocol = raw.replace(/^https?:\/\//, '')
  return withoutProtocol.split('/')[0].replace(/\/+$/, '')
}

const sanitizeTenantFolderName = tenantDomain => {
  const normalized = normalizeTenantDomain(tenantDomain)
  return normalized.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'unknown-tenant'
}

const logger = {
  write(level, message, meta = {}) {
    const record = {
      at: new Date().toISOString(),
      level,
      service: APP_NAME,
      version: APP_VERSION,
      pid: process.pid,
      message,
      ...meta,
    }

    const line = JSON.stringify(record)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  },
  debug(message, meta) {
    if (config.debug) this.write('debug', message, meta)
  },
  info(message, meta) {
    this.write('info', message, meta)
  },
  warn(message, meta) {
    this.write('warn', message, meta)
  },
  error(message, meta) {
    this.write('error', message, meta)
  },
}

const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  debug: parseBoolean(process.env.AGENT_DEBUG, false),

  watchRootFolder: process.env.WATCH_ROOT_FOLDER || process.env.WATCH_FOLDER,
  processedRootFolder: process.env.PROCESSED_ROOT_FOLDER || process.env.PROCESSED_FOLDER,
  failedRootFolder: process.env.FAILED_ROOT_FOLDER || process.env.FAILED_FOLDER,

  tenantResolutionMode: String(process.env.TENANT_RESOLUTION_MODE || 'folder-domain').trim().toLowerCase(),
  tenantDomainFallback: normalizeTenantDomain(process.env.TENANT_DOMAIN_FALLBACK || process.env.TENANT_DOMAIN),
  tenantFolderMap: parseJsonEnv(process.env.AGENT_TENANT_FOLDER_MAP_JSON, {}),
  allowSidecarTenant: parseBoolean(process.env.AGENT_ALLOW_SIDECAR_TENANT, true),
  autoCreateTenantFolders: parseBoolean(process.env.AGENT_AUTO_CREATE_TENANT_FOLDERS, true),
  watchDepth: parsePositiveInt(process.env.AGENT_WATCH_DEPTH, 2, { min: 0, max: 10 }),

  apiBaseUrl: trimTrailingSlash(process.env.API_BASE_URL),
  agentApiKey: process.env.AGENT_API_KEY,
  adminToken: process.env.ADMIN_TOKEN,
  analysisEndpoint: process.env.ANALYSIS_ENDPOINT || '/product-analysis/import',
  healthEndpoint: process.env.AGENT_HEALTH_ENDPOINT || '',
  tenantValidateEndpoint: process.env.AGENT_TENANT_VALIDATE_ENDPOINT || '',
  validateTenant: parseBoolean(process.env.AGENT_VALIDATE_TENANT, false),

  autoAnalyze: parseBoolean(process.env.AUTO_ANALYZE, false),
  autoCreateProduct: parseBoolean(process.env.AUTO_CREATE_PRODUCT, false),
  autoSaveProduct: parseBoolean(process.env.AUTO_SAVE_PRODUCT, false),
  autoPublishProduct: parseBoolean(process.env.AUTO_PUBLISH_PRODUCT, false),
  defaultSendAt: process.env.AGENT_DEFAULT_SEND_AT || '',
  defaultDelayMinutes: parsePositiveInt(process.env.AGENT_DEFAULT_DELAY_MINUTES, 0, { min: 0, max: 525600 }),

  dryRun: parseBoolean(process.env.IMAGE_AGENT_DRY_RUN, false),
  dryRunMoveFiles: parseBoolean(process.env.IMAGE_AGENT_DRY_RUN_MOVE_FILES, false),

  concurrency: parsePositiveInt(process.env.AGENT_CONCURRENCY, 2, { min: 1, max: 10 }),
  maxRetries: parsePositiveInt(process.env.AGENT_MAX_RETRIES, 4, { min: 1, max: 10 }),
  retryBaseMs: parsePositiveInt(process.env.AGENT_RETRY_BASE_MS, 1500, { min: 250, max: 60000 }),
  requestTimeoutMs: parsePositiveInt(process.env.AGENT_REQUEST_TIMEOUT_MS, 120000, { min: 5000, max: 600000 }),
  maxFileSizeBytes: parsePositiveInt(process.env.AGENT_MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024, {
    min: 1024,
    max: 50 * 1024 * 1024,
  }),
  lockStaleMs: parsePositiveInt(process.env.AGENT_LOCK_STALE_MS, 120000, { min: 30000, max: 3600000 }),

  allowedExtensions: parseCsv(process.env.AGENT_ALLOWED_EXTENSIONS || '.jpg,.jpeg,.png,.webp,.heic,.heif')
    .map(ext => ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`),
  statusFilename: process.env.AGENT_STATUS_FILENAME || 'agent-status.json',
  lockFilename: process.env.AGENT_LOCK_FILENAME || '.agent-image-watcher.lock',
  queueFilename: process.env.AGENT_QUEUE_FILENAME || '.agent-image-watcher.queue.json',
  persistQueue: parseBoolean(process.env.AGENT_PERSIST_QUEUE, true),

  statusServerEnabled: parseBoolean(process.env.AGENT_STATUS_SERVER_ENABLED, true),
  statusHost: process.env.AGENT_STATUS_HOST || '127.0.0.1',
  statusPort: parsePositiveInt(process.env.AGENT_STATUS_PORT, 5055, { min: 1024, max: 65535 }),
  exposeConfig: parseBoolean(process.env.AGENT_EXPOSE_CONFIG, false),

  metricsEnabled: parseBoolean(process.env.AGENT_METRICS_ENABLED, false),
  metricsEndpoint: process.env.AGENT_METRICS_ENDPOINT || '/metrics/events',
  metricsTimeoutMs: parsePositiveInt(process.env.AGENT_METRICS_TIMEOUT_MS, 3500, { min: 1000, max: 30000 }),
  metricSessionId: process.env.AGENT_METRIC_SESSION_ID || `${APP_NAME}-${os.hostname()}`,
  source: process.env.AGENT_SOURCE || 'image-import-agent',

  promotionNotifierEnabled: parseBoolean(process.env.PROMOTION_NOTIFIER_ENABLED, false),
  promotionNotifierEndpoint: process.env.PROMOTION_NOTIFIER_ENDPOINT || '/product-analysis/wishlist-promotions/run',
  promotionNotifierIntervalMinutes: parsePositiveInt(process.env.PROMOTION_NOTIFIER_INTERVAL_MINUTES, 60, {
    min: 5,
    max: 1440,
  }),
  promotionNotifierDryRun: parseBoolean(process.env.PROMOTION_NOTIFIER_DRY_RUN, false),
})

const ALLOWED_EXTENSIONS = new Set(config.allowedExtensions)
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

const status = {
  version: APP_VERSION,
  pid: process.pid,
  hostname: os.hostname(),
  startedAt: null,
  lastEventAt: null,
  heartbeatAt: null,
  state: 'starting',
  mode: config.tenantResolutionMode,
  watchRootFolder: config.watchRootFolder,
  processedRootFolder: config.processedRootFolder,
  failedRootFolder: config.failedRootFolder,
  apiBaseUrl: config.apiBaseUrl,
  dryRun: config.dryRun,
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
    restoredFromQueue: 0,
    dryRunValidated: 0,
    tenantResolvedFromSidecar: 0,
    tenantResolvedFromFolderMap: 0,
    tenantResolvedFromFolderDomain: 0,
    tenantResolvedFromFallback: 0,
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
let statusServer = null
let notifierRunning = false
let shuttingDown = false
let statusWriteChain = Promise.resolve()
let queueWriteChain = Promise.resolve()

const pendingFiles = []
const queuedFiles = new Set()
const activeFiles = new Set()
const validatedTenants = new Set()

const getStatusPath = () => path.join(config.watchRootFolder, config.statusFilename)
const getQueuePath = () => path.join(config.watchRootFolder, config.queueFilename)
const getLockPath = () => path.join(config.watchRootFolder, config.lockFilename)

const getPublicConfig = () => ({
  nodeEnv: config.nodeEnv,
  watchRootFolder: config.watchRootFolder,
  processedRootFolder: config.processedRootFolder,
  failedRootFolder: config.failedRootFolder,
  tenantResolutionMode: config.tenantResolutionMode,
  tenantDomainFallback: config.tenantDomainFallback || null,
  apiBaseUrl: config.apiBaseUrl,
  analysisEndpoint: config.analysisEndpoint,
  dryRun: config.dryRun,
  autoAnalyze: config.autoAnalyze,
  autoCreateProduct: config.autoCreateProduct,
  autoSaveProduct: config.autoSaveProduct,
  autoPublishProduct: config.autoPublishProduct,
  concurrency: config.concurrency,
  watchDepth: config.watchDepth,
  metricsEnabled: config.metricsEnabled,
  statusServerEnabled: config.statusServerEnabled,
})

const validateConfig = () => {
  const required = {
    WATCH_ROOT_FOLDER: config.watchRootFolder,
    PROCESSED_ROOT_FOLDER: config.processedRootFolder,
    FAILED_ROOT_FOLDER: config.failedRootFolder,
    API_BASE_URL: config.apiBaseUrl,
    ANALYSIS_ENDPOINT: config.analysisEndpoint,
  }

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (!config.agentApiKey && !config.adminToken) missing.push('AGENT_API_KEY')

  if (config.nodeEnv === 'production') {
    if (!config.agentApiKey) throw new Error('AGENT_API_KEY es obligatoria en producción; ADMIN_TOKEN no está permitido')
    if (!config.apiBaseUrl.startsWith('https://')) throw new Error('API_BASE_URL debe usar HTTPS en producción')
  }

  if (missing.length) throw new Error(`Configuración incompleta: ${missing.join(', ')}`)

  if (!['auto', 'folder-domain', 'folder-map', 'sidecar', 'fixed'].includes(config.tenantResolutionMode)) {
    throw new Error('TENANT_RESOLUTION_MODE debe ser auto, folder-domain, folder-map, sidecar o fixed')
  }

  if (['fixed'].includes(config.tenantResolutionMode) && !config.tenantDomainFallback) {
    throw new Error('TENANT_DOMAIN_FALLBACK o TENANT_DOMAIN es obligatorio con TENANT_RESOLUTION_MODE=fixed')
  }

  const resolved = [config.watchRootFolder, config.processedRootFolder, config.failedRootFolder]
    .map(folder => path.resolve(folder))
  if (new Set(resolved.map(folder => folder.toLowerCase())).size !== resolved.length) {
    throw new Error('WATCH_ROOT_FOLDER, PROCESSED_ROOT_FOLDER y FAILED_ROOT_FOLDER deben ser diferentes')
  }

  if (config.autoPublishProduct && !config.autoCreateProduct && !config.autoSaveProduct) {
    throw new Error('AUTO_PUBLISH_PRODUCT requiere AUTO_CREATE_PRODUCT=true o AUTO_SAVE_PRODUCT=true')
  }
}

const ensureFolders = async () => {
  await Promise.all([
    fse.ensureDir(config.watchRootFolder),
    fse.ensureDir(config.processedRootFolder),
    fse.ensureDir(config.failedRootFolder),
  ])
}

const writeStatus = () => {
  status.lastEventAt = new Date().toISOString()
  status.queue.pending = pendingFiles.length
  status.queue.active = activeFiles.size

  const payload = {
    ...status,
    config: config.exposeConfig ? getPublicConfig() : undefined,
  }

  const serialized = JSON.stringify(payload, null, 2)
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

const saveQueue = () => {
  if (!config.persistQueue) return Promise.resolve()

  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    files: [...queuedFiles, ...pendingFiles, ...activeFiles],
  }

  const targetPath = getQueuePath()
  const temporaryPath = `${targetPath}.${process.pid}.tmp`

  queueWriteChain = queueWriteChain
    .catch(() => undefined)
    .then(async () => {
      await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8')
      await fse.move(temporaryPath, targetPath, { overwrite: true })
    })

  return queueWriteChain
}

const pushRecent = async event => {
  status.recent = [{ at: new Date().toISOString(), ...event }, ...status.recent].slice(0, 50)
  await writeStatus()
}

const getAuthHeaders = () => (
  config.agentApiKey
    ? { 'x-agent-api-key': config.agentApiKey }
    : { Authorization: `Bearer ${config.adminToken}` }
)

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
      tenantDomain: config.allowSidecarTenant ? normalizeTenantDomain(configValue.tenantDomain) : '',
      sendAt: parseDate(configValue.sendAt || configValue.scheduledAt),
      autoAnalyze: configValue.autoAnalyze === undefined ? null : parseBoolean(configValue.autoAnalyze),
      autoCreateProduct: configValue.autoCreateProduct === undefined ? null : parseBoolean(configValue.autoCreateProduct),
      autoPublishProduct: configValue.autoPublishProduct === undefined ? null : parseBoolean(configValue.autoPublishProduct),
      autoSaveProduct: configValue.autoSaveProduct === undefined ? null : parseBoolean(configValue.autoSaveProduct),
      metadata: configValue.metadata && typeof configValue.metadata === 'object' ? configValue.metadata : {},
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        tenantDomain: '',
        sendAt: null,
        autoAnalyze: null,
        autoCreateProduct: null,
        autoPublishProduct: null,
        autoSaveProduct: null,
        metadata: {},
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

const getTenantFolderSegment = filePath => {
  const relative = path.relative(path.resolve(config.watchRootFolder), path.resolve(filePath))
  if (!relative || relative.startsWith('..')) return ''
  const [segment] = relative.split(path.sep).filter(Boolean)
  return normalizeTenantDomain(segment)
}

const resolveTenantFromFolderMap = filePath => {
  const entries = Object.entries(config.tenantFolderMap || {})
    .map(([folder, tenantDomain]) => ({
      folder,
      normalizedFolder: normalizePathForCompare(path.isAbsolute(folder) ? folder : path.join(config.watchRootFolder, folder)),
      tenantDomain: normalizeTenantDomain(tenantDomain),
    }))
    .filter(entry => entry.tenantDomain)
    .sort((a, b) => b.normalizedFolder.length - a.normalizedFolder.length)

  const normalizedFile = normalizePathForCompare(filePath)
  const match = entries.find(entry => normalizedFile.startsWith(`${entry.normalizedFolder}/`) || normalizedFile === entry.normalizedFolder)

  return match?.tenantDomain || ''
}

const resolveTenantForFile = (filePath, sidecar) => {
  if (config.allowSidecarTenant && sidecar.tenantDomain && ['auto', 'sidecar', 'folder-domain', 'folder-map'].includes(config.tenantResolutionMode)) {
    status.counters.tenantResolvedFromSidecar += 1
    return sidecar.tenantDomain
  }

  if (['auto', 'folder-map'].includes(config.tenantResolutionMode)) {
    const mappedTenant = resolveTenantFromFolderMap(filePath)
    if (mappedTenant) {
      status.counters.tenantResolvedFromFolderMap += 1
      return mappedTenant
    }
  }

  if (['auto', 'folder-domain'].includes(config.tenantResolutionMode)) {
    const folderTenant = getTenantFolderSegment(filePath)
    if (folderTenant) {
      status.counters.tenantResolvedFromFolderDomain += 1
      return folderTenant
    }
  }

  if (['auto', 'fixed', 'folder-domain', 'folder-map', 'sidecar'].includes(config.tenantResolutionMode) && config.tenantDomainFallback) {
    status.counters.tenantResolvedFromFallback += 1
    return config.tenantDomainFallback
  }

  throw new Error('No se pudo resolver tenantDomain. Usá subcarpeta por dominio, sidecar tenantDomain o TENANT_DOMAIN_FALLBACK')
}

const waitUntilFileIsStable = async (filePath, attempts = 8, delay = 750) => {
  let previous = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await fs.stat(filePath)
    if (previous && current.size === previous.size && current.mtimeMs === previous.mtimeMs && current.size > 0) return current
    previous = current
    await sleep(delay)
  }
  throw new Error('El archivo no está estable o continúa copiándose')
}

export const detectImageType = buffer => {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  const brand = buffer.subarray(4, 12).toString('ascii').toLowerCase()
  if (brand.includes('ftyp') && /(heic|heix|hevc|hevx|mif1)/.test(buffer.subarray(8, 24).toString('ascii').toLowerCase())) return 'image/heic'
  return null
}

const validateImageFile = async filePath => {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('La ruta detectada no es un archivo regular')
  if (stat.size <= 0) throw new Error('La imagen está vacía')
  if (stat.size > config.maxFileSizeBytes) throw new Error(`La imagen supera el máximo de ${config.maxFileSizeBytes} bytes`)

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

const createIdempotencyKey = async filePath => {
  const hash = crypto.createHash('sha256')
  const stream = fse.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

const getTenantTargetFolder = (targetRootFolder, tenantDomain) => {
  if (!config.autoCreateTenantFolders) return targetRootFolder
  return path.join(targetRootFolder, sanitizeTenantFolderName(tenantDomain))
}

const moveToFolder = async (filePath, targetRootFolder, tenantDomain) => {
  const targetFolder = getTenantTargetFolder(targetRootFolder, tenantDomain)
  await fse.ensureDir(targetFolder)

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

const removeSidecarSchedule = async filePath => {
  const schedulePath = getSidecarSchedulePath(filePath)
  if (await fse.pathExists(schedulePath)) await fse.remove(schedulePath)
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
      logger.warn('Reintentando operación', { attempt, backoff, code: error.code, httpStatus: error.response?.status })
      await sleep(backoff)
    }
  }
  throw lastError
}

const sendAgentMetric = async (tenantDomain, eventType, metadata = {}) => {
  if (!config.metricsEnabled || config.dryRun) return

  try {
    await axios.post(
      `${config.apiBaseUrl}${config.metricsEndpoint}`,
      {
        eventType,
        eventId: `${eventType}-${Date.now()}-${crypto.randomUUID()}`,
        source: config.source,
        sessionId: config.metricSessionId,
        tenantDomain,
        path: `agent://${APP_NAME}`,
        occurredAt: new Date().toISOString(),
        metadata,
      },
      {
        headers: {
          ...getAuthHeaders(),
          'x-tenant-domain': tenantDomain,
        },
        timeout: config.metricsTimeoutMs,
      },
    )
  } catch (error) {
    logger.debug('No se pudo enviar métrica del agente', {
      eventType,
      tenantDomain,
      message: error.response?.data?.message || error.message,
      httpStatus: error.response?.status,
    })
  }
}

const validateTenantWithBackend = async tenantDomain => {
  if (!config.validateTenant || !config.tenantValidateEndpoint || validatedTenants.has(tenantDomain)) return

  const endpoint = config.tenantValidateEndpoint.replace('{tenantDomain}', encodeURIComponent(tenantDomain))
  await withRetry(async () => {
    const response = await axios.get(`${config.apiBaseUrl}${endpoint}`, {
      headers: {
        ...getAuthHeaders(),
        'x-tenant-domain': tenantDomain,
      },
      timeout: Math.min(config.requestTimeoutMs, 10000),
      validateStatus: () => true,
    })

    if (response.status >= 200 && response.status < 300 && response.data?.success !== false) return response.data

    const error = new Error(response.data?.message || `Tenant no válido: ${tenantDomain}`)
    error.response = response
    throw error
  })

  validatedTenants.add(tenantDomain)
}

const uploadImageForAnalysis = async (filePath, tenantDomain, options, detectedMime) => {
  const filename = path.basename(filePath)
  const idempotencyKey = await createIdempotencyKey(filePath)

  if (config.dryRun) {
    logger.info('Dry-run: imagen validada sin subir al backend', { filename, tenantDomain, options })
    return { kind: 'dry-run', data: { success: true, message: 'Dry-run validado', job: null } }
  }

  await validateTenantWithBackend(tenantDomain)

  return withRetry(async attempt => {
    const form = new FormData()
    form.append('image', fse.createReadStream(filePath), {
      filename,
      contentType: detectedMime || mime.lookup(filePath) || 'application/octet-stream',
    })
    form.append('source', config.source)
    form.append('originalFilename', filename)
    form.append('sourcePath', filePath)
    form.append('tenantDomain', tenantDomain)
    form.append('autoAnalyze', String(options.autoAnalyze))
    form.append('autoCreateProduct', String(options.autoCreateProduct))
    form.append('autoSaveProduct', String(options.autoSaveProduct))
    form.append('autoPublishProduct', String(options.autoPublishProduct))
    if (options.scheduledAt) form.append('scheduledAt', options.scheduledAt.toISOString())
    if (options.metadata && Object.keys(options.metadata).length) form.append('metadata', JSON.stringify(options.metadata))

    const response = await axios.post(
      `${config.apiBaseUrl}${config.analysisEndpoint}`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          ...getAuthHeaders(),
          'x-tenant-domain': tenantDomain,
          'x-idempotency-key': idempotencyKey,
          'x-agent-attempt': String(attempt),
          'x-agent-name': APP_NAME,
          'x-agent-version': APP_VERSION,
        },
        timeout: config.requestTimeoutMs,
        maxBodyLength: config.maxFileSizeBytes + 1024 * 1024,
        maxContentLength: config.maxFileSizeBytes + 1024 * 1024,
        validateStatus: () => true,
      },
    )

    if (response.status === 409 && response.data?.code === 'PRODUCT_ANALYSIS_DUPLICATE') return { kind: 'duplicate', data: response.data }
    if (response.status >= 200 && response.status < 300 && response.data?.success !== false) return { kind: 'accepted', data: response.data }

    const error = new Error(response.data?.message || `La API rechazó la imagen con HTTP ${response.status}`)
    error.response = response
    throw error
  })
}

const writeFailureDetails = async (movedPath, error, tenantDomain) => {
  const details = {
    failedAt: new Date().toISOString(),
    tenantDomain,
    message: error.response?.data?.message || error.message,
    code: error.response?.data?.code || error.code || null,
    httpStatus: error.response?.status || null,
  }
  await fs.writeFile(`${movedPath}.error.json`, JSON.stringify(details, null, 2), 'utf8')
}

const processFile = async filePath => {
  const filename = path.basename(filePath)
  let tenantDomain = ''

  try {
    await waitUntilFileIsStable(filePath)
    const { detectedMime } = await validateImageFile(filePath)
    const sidecar = await readSidecarSchedule(filePath)
    tenantDomain = resolveTenantForFile(filePath, sidecar)

    const scheduledAt = sidecar.sendAt || getDefaultSendAt()
    const options = {
      scheduledAt: scheduledAt && scheduledAt > new Date() ? scheduledAt : null,
      autoAnalyze: sidecar.autoAnalyze ?? config.autoAnalyze,
      autoCreateProduct: sidecar.autoCreateProduct ?? config.autoCreateProduct,
      autoSaveProduct: sidecar.autoSaveProduct ?? config.autoSaveProduct,
      autoPublishProduct: sidecar.autoPublishProduct ?? config.autoPublishProduct,
      metadata: sidecar.metadata || {},
    }

    if (options.autoPublishProduct && !options.autoCreateProduct && !options.autoSaveProduct) {
      throw new Error('AUTO_PUBLISH_PRODUCT requiere AUTO_CREATE_PRODUCT=true o AUTO_SAVE_PRODUCT=true')
    }

    const result = await uploadImageForAnalysis(filePath, tenantDomain, options, detectedMime)
    const response = result.data || {}

    if (result.kind === 'duplicate') status.counters.duplicated += 1
    else if (result.kind === 'dry-run') status.counters.dryRunValidated += 1
    else {
      status.counters.uploaded += 1
      if (response.job?.status === 'scheduled') status.counters.scheduled += 1
    }

    if (!config.dryRun || config.dryRunMoveFiles) {
      await moveToFolder(filePath, config.processedRootFolder, tenantDomain)
      await removeSidecarSchedule(filePath)
    }

    await sendAgentMetric(tenantDomain, `agent_image_${result.kind === 'duplicate' ? 'duplicate' : 'uploaded'}`, {
      filename,
      resultKind: result.kind,
      jobId: response.job?._id || response.jobId || null,
      backendStatus: response.job?.status || null,
    })

    await pushRecent({
      filename,
      tenantDomain,
      status: result.kind,
      message: response.message || 'Imagen aceptada',
      jobId: response.job?._id || response.jobId || null,
      backendStatus: response.job?.status || null,
    })
  } catch (error) {
    status.counters.failed += 1
    if (error.response && !isRetryableError(error)) status.counters.rejected += 1

    logger.error('Error procesando imagen', {
      filename,
      tenantDomain: tenantDomain || null,
      message: error.response?.data?.message || error.message,
      httpStatus: error.response?.status,
    })

    try {
      const safeTenant = tenantDomain || config.tenantDomainFallback || 'unresolved-tenant'
      if (await fse.pathExists(filePath)) {
        const movedPath = await moveToFolder(filePath, config.failedRootFolder, safeTenant)
        await writeFailureDetails(movedPath, error, safeTenant)
      }
      await removeSidecarSchedule(filePath)
      await sendAgentMetric(safeTenant, 'agent_image_failed', {
        filename,
        message: error.response?.data?.message || error.message,
        httpStatus: error.response?.status || null,
      })
    } catch (moveError) {
      logger.error('No se pudo preservar archivo fallido', { filename, message: moveError.message })
    }

    await pushRecent({
      filename,
      tenantDomain: tenantDomain || null,
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
    Promise.all([writeStatus(), saveQueue()]).catch(() => undefined)
    processFile(filePath)
      .catch(error => logger.error('Error inesperado procesando archivo', { filePath, message: error.message }))
      .finally(() => {
        activeFiles.delete(filePath)
        Promise.all([writeStatus(), saveQueue()]).catch(() => undefined)
        pumpQueue()
      })
  }
}

const shouldIgnoreFile = filePath => {
  const normalized = normalizePathForCompare(filePath)
  const ignoredRoots = [config.processedRootFolder, config.failedRootFolder]
    .filter(Boolean)
    .map(normalizePathForCompare)

  return ignoredRoots.some(root => normalized.startsWith(`${root}/`) || normalized === root) ||
    normalized.endsWith(`/${config.statusFilename.toLowerCase()}`) ||
    normalized.endsWith(`/${config.lockFilename.toLowerCase()}`) ||
    normalized.endsWith(`/${config.queueFilename.toLowerCase()}`) ||
    normalized.endsWith('.schedule.json') ||
    normalized.endsWith('.error.json')
}

const enqueueFile = async filePath => {
  const normalized = path.resolve(filePath)
  if (shouldIgnoreFile(normalized)) return
  if (!isImageFile(normalized) || queuedFiles.has(normalized) || activeFiles.has(normalized)) return

  status.counters.detected += 1
  queuedFiles.add(normalized)
  pendingFiles.push(normalized)
  await pushRecent({
    filename: path.basename(normalized),
    status: 'queued',
    message: 'Imagen agregada a cola local',
  })
  await saveQueue()
  pumpQueue()
}

const restoreQueue = async () => {
  if (!config.persistQueue) return
  try {
    const payload = JSON.parse(await fs.readFile(getQueuePath(), 'utf8'))
    const files = Array.isArray(payload.files) ? payload.files : []
    for (const filePath of files) {
      if (await fse.pathExists(filePath)) {
        const resolved = path.resolve(filePath)
        if (!queuedFiles.has(resolved) && !activeFiles.has(resolved)) {
          queuedFiles.add(resolved)
          pendingFiles.push(resolved)
          status.counters.restoredFromQueue += 1
        }
      }
    }
    if (pendingFiles.length) await pushRecent({ status: 'queue-restored', message: `${pendingFiles.length} archivos restaurados de cola persistente` })
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('No se pudo restaurar cola persistente', { message: error.message })
  }
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

    if (!stale) throw new Error(`Ya existe otra instancia activa para ${config.watchRootFolder}`)

    await fse.remove(lockPath)
    lockHandle = await fs.open(lockPath, 'wx')
  }

  const updateLock = async () => {
    if (!lockHandle) return
    const now = new Date().toISOString()
    status.heartbeatAt = now
    const lockContents = JSON.stringify({
      service: APP_NAME,
      version: APP_VERSION,
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: status.startedAt,
      heartbeatAt: now,
      watchRootFolder: config.watchRootFolder,
      tenantResolutionMode: config.tenantResolutionMode,
    })
    await lockHandle.truncate(0)
    await lockHandle.write(lockContents, 0, 'utf8')
    await lockHandle.sync()
    await writeStatus()
  }

  await updateLock()
  heartbeatTimer = setInterval(() => {
    updateLock().catch(error => logger.error('Error de heartbeat', { message: error.message }))
  }, Math.max(10000, Math.floor(config.lockStaleMs / 3)))
  heartbeatTimer.unref?.()
}

const runWishlistPromotionNotifier = async () => {
  if (!config.promotionNotifierEnabled || notifierRunning || shuttingDown) return
  const tenantDomain = config.tenantDomainFallback
  if (!tenantDomain) {
    logger.warn('PROMOTION_NOTIFIER_ENABLED requiere TENANT_DOMAIN_FALLBACK para saber a qué tenant notificar')
    return
  }

  notifierRunning = true
  try {
    const response = await withRetry(() => axios.post(
      `${config.apiBaseUrl}${config.promotionNotifierEndpoint}`,
      { dryRun: config.promotionNotifierDryRun },
      {
        headers: {
          ...getAuthHeaders(),
          'x-tenant-domain': tenantDomain,
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
      tenantDomain,
      status: 'wishlist-promotions',
      message: `Enviados=${result.sent || 0}; omitidos=${result.skipped || 0}; fallidos=${result.failed || 0}`,
    })
  } catch (error) {
    status.counters.promotionNotificationsFailed += 1
    await pushRecent({
      filename: null,
      tenantDomain,
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
    headers: getAuthHeaders(),
    timeout: Math.min(config.requestTimeoutMs, 10000),
  })
}

const startStatusServer = async () => {
  if (!config.statusServerEnabled) return

  statusServer = http.createServer((req, res) => {
    const sendJson = (code, payload) => {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(payload, null, 2))
    }

    if (req.url === '/health') {
      sendJson(status.state === 'running' ? 200 : 503, {
        ok: status.state === 'running',
        state: status.state,
        version: APP_VERSION,
        heartbeatAt: status.heartbeatAt,
        pending: pendingFiles.length,
        active: activeFiles.size,
      })
      return
    }

    if (req.url === '/status') {
      sendJson(200, {
        ...status,
        queue: {
          pending: pendingFiles.length,
          active: activeFiles.size,
          concurrency: config.concurrency,
        },
        config: config.exposeConfig ? getPublicConfig() : undefined,
      })
      return
    }

    sendJson(404, { ok: false, message: 'Not found' })
  })

  await new Promise((resolve, reject) => {
    statusServer.once('error', reject)
    statusServer.listen(config.statusPort, config.statusHost, () => {
      statusServer.off('error', reject)
      resolve()
    })
  })

  logger.info('Status server activo', {
    health: `http://${config.statusHost}:${config.statusPort}/health`,
    status: `http://${config.statusHost}:${config.statusPort}/status`,
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

  if (statusServer) {
    await new Promise(resolve => statusServer.close(resolve))
    statusServer = null
  }

  const deadline = Date.now() + 30000
  while (activeFiles.size > 0 && Date.now() < deadline) await sleep(250)

  await saveQueue()
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
  await startStatusServer()
  await restoreQueue()

  watcher = chokidar.watch(config.watchRootFolder, {
    persistent: true,
    ignoreInitial: false,
    depth: config.watchDepth,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 400,
    },
    ignored: filePath => shouldIgnoreFile(filePath),
  })

  watcher.on('add', filePath => {
    enqueueFile(filePath).catch(error => logger.error('Error encolando imagen', { filePath, message: error.message }))
  })
  watcher.on('error', error => logger.error('Watcher error', { message: error.message }))

  if (config.promotionNotifierEnabled) {
    runWishlistPromotionNotifier().catch(() => undefined)
    notifierTimer = setInterval(
      () => runWishlistPromotionNotifier().catch(() => undefined),
      config.promotionNotifierIntervalMinutes * 60000,
    )
    notifierTimer.unref?.()
  }

  status.state = 'running'
  await sendAgentMetric(config.tenantDomainFallback || 'agent', 'agent_started', getPublicConfig())
  await pushRecent({
    status: 'started',
    message: `Agente iniciado con concurrencia ${config.concurrency}; modo tenant=${config.tenantResolutionMode}`,
  })

  logger.info('Agente iniciado', getPublicConfig())
  pumpQueue()
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  process.once('SIGINT', () => shutdown('SIGINT').catch(error => logger.error('Error cerrando', { message: error.message })))
  process.once('SIGTERM', () => shutdown('SIGTERM').catch(error => logger.error('Error cerrando', { message: error.message })))
  process.once('uncaughtException', error => {
    logger.error('Excepción no controlada', { message: error.message, stack: error.stack })
    shutdown('uncaughtException').catch(() => process.exit(1))
  })
  process.once('unhandledRejection', error => {
    logger.error('Promesa rechazada no controlada', { message: error?.message || String(error), stack: error?.stack })
    shutdown('unhandledRejection').catch(() => process.exit(1))
  })

  start().catch(error => {
    logger.error('Error fatal', { message: error.message, stack: error.stack })
    process.exit(1)
  })
}
