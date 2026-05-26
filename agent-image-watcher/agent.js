import 'dotenv/config'
import chokidar from 'chokidar'
import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import FormData from 'form-data'
import mime from 'mime-types'
import fse from 'fs-extra'

const {
  WATCH_FOLDER,
  PROCESSED_FOLDER,
  FAILED_FOLDER,
  API_BASE_URL,
  TENANT_DOMAIN,
  ADMIN_TOKEN,
  AGENT_API_KEY,
  ANALYSIS_ENDPOINT,
  AGENT_DEFAULT_SEND_AT,
  AGENT_DEFAULT_DELAY_MINUTES,
  AUTO_CREATE_PRODUCT = 'false',
  AUTO_SAVE_PRODUCT = 'false',
  AUTO_PUBLISH_PRODUCT = 'false',
  PROMOTION_NOTIFIER_ENABLED = 'false',
  PROMOTION_NOTIFIER_ENDPOINT = '/product-analysis/wishlist-promotions/run',
  PROMOTION_NOTIFIER_INTERVAL_MINUTES = '60',
  PROMOTION_NOTIFIER_DRY_RUN = 'false',
} = process.env

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
])

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const status = {
  startedAt: null,
  lastEventAt: null,
  watchFolder: WATCH_FOLDER,
  tenantDomain: TENANT_DOMAIN,
  apiBaseUrl: API_BASE_URL,
  counters: {
    detected: 0,
    uploaded: 0,
    scheduled: 0,
    duplicated: 0,
    failed: 0,
    promotionNotificationsSent: 0,
    promotionNotificationsSkipped: 0,
    promotionNotificationsFailed: 0,
  },
  recent: [],
}

const requiredEnv = {
  WATCH_FOLDER,
  PROCESSED_FOLDER,
  FAILED_FOLDER,
  API_BASE_URL,
  TENANT_DOMAIN,
  ANALYSIS_ENDPOINT,
}

const validateConfig = () => {
  const missing = Object.entries(requiredEnv)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (!AGENT_API_KEY && !ADMIN_TOKEN) {
    missing.push('AGENT_API_KEY o ADMIN_TOKEN')
  }

  if (missing.length) {
    throw new Error(`Configuración incompleta: ${missing.join(', ')}`)
  }
}

const ensureFolders = async () => {
  await fse.ensureDir(WATCH_FOLDER)
  await fse.ensureDir(PROCESSED_FOLDER)
  await fse.ensureDir(FAILED_FOLDER)
}

const getStatusPath = () => path.join(WATCH_FOLDER, 'agent-status.json')

const writeStatus = async () => {
  status.lastEventAt = new Date().toISOString()

  await fs.writeFile(
    getStatusPath(),
    JSON.stringify(status, null, 2),
    'utf8',
  )
}

const pushRecent = async event => {
  status.recent = [
    {
      at: new Date().toISOString(),
      ...event,
    },
    ...status.recent,
  ].slice(0, 20)

  await writeStatus()
}

const printBanner = () => {
  console.log('')
  console.log('==============================================')
  console.log(' HENKO PRODUCT IMAGE AGENT')
  console.log('==============================================')
  console.log(` Carpeta entrada : ${WATCH_FOLDER}`)
  console.log(` Procesadas      : ${PROCESSED_FOLDER}`)
  console.log(` Fallidas        : ${FAILED_FOLDER}`)
  console.log(` Tenant          : ${TENANT_DOMAIN}`)
  console.log(` Endpoint        : ${API_BASE_URL}${ANALYSIS_ENDPOINT}`)
  console.log(` AutoSave        : ${parseBoolean(AUTO_SAVE_PRODUCT) ? 'SI' : 'NO'}`)
  console.log(` AutoPublish     : ${parseBoolean(AUTO_PUBLISH_PRODUCT) ? 'SI' : 'NO'}`)
  console.log(` Programacion    : ${AGENT_DEFAULT_SEND_AT || `${AGENT_DEFAULT_DELAY_MINUTES || 0} min`}`)
  console.log(` Wishlist promo  : ${parseBoolean(PROMOTION_NOTIFIER_ENABLED) ? `cada ${PROMOTION_NOTIFIER_INTERVAL_MINUTES} min` : 'NO'}`)
  console.log(' Estado JSON     : agent-status.json')
  console.log('==============================================')
  console.log('')
}

const printSummary = () => {
  const { counters } = status
  console.log(
    `[AGENT] Totales | detectadas=${counters.detected} enviadas=${counters.uploaded} programadas=${counters.scheduled} duplicadas=${counters.duplicated} fallidas=${counters.failed} promoEmails=${counters.promotionNotificationsSent}`,
  )
}

const isImageFile = filePath => {
  const ext = path.extname(filePath).toLowerCase()
  return ALLOWED_EXTENSIONS.has(ext)
}

const parseBoolean = value => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return ['true', '1', 'yes', 'si', 'sí'].includes(value.toLowerCase())
}

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
    const raw = await fs.readFile(schedulePath, 'utf8')
    const config = JSON.parse(raw)

    return {
      sendAt: parseDate(config.sendAt || config.scheduledAt),
      autoCreateProduct:
        config.autoCreateProduct === undefined
          ? null
          : parseBoolean(String(config.autoCreateProduct)),
      autoPublishProduct:
        config.autoPublishProduct === undefined
          ? null
          : parseBoolean(String(config.autoPublishProduct)),
      autoSaveProduct:
        config.autoSaveProduct === undefined
          ? null
          : parseBoolean(String(config.autoSaveProduct)),
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        sendAt: null,
        autoCreateProduct: null,
        autoPublishProduct: null,
        autoSaveProduct: null,
      }
    }

    throw new Error(`Schedule inválido para ${path.basename(filePath)}: ${error.message}`)
  }
}

const getDefaultSendAt = () => {
  const explicitDate = parseDate(AGENT_DEFAULT_SEND_AT)
  if (explicitDate) return explicitDate

  const delayMinutes = Number.parseInt(AGENT_DEFAULT_DELAY_MINUTES, 10)
  if (Number.isFinite(delayMinutes) && delayMinutes > 0) {
    return new Date(Date.now() + delayMinutes * 60 * 1000)
  }

  return null
}

const waitUntilFileIsStable = async (filePath, attempts = 5, delay = 1200) => {
  let previousSize = -1

  for (let i = 0; i < attempts; i++) {
    const stat = await fs.stat(filePath)

    if (stat.size === previousSize && stat.size > 0) {
      return true
    }

    previousSize = stat.size
    await sleep(delay)
  }

  return false
}

const getAuthHeaders = () => {
  return AGENT_API_KEY
    ? { 'x-agent-api-key': AGENT_API_KEY }
    : { Authorization: `Bearer ${ADMIN_TOKEN}` }
}

const moveToFolder = async (filePath, targetFolder) => {
  const filename = path.basename(filePath)
  const parsed = path.parse(filename)
  const targetPath = path.join(
    targetFolder,
    `${parsed.name}-${Date.now()}${parsed.ext}`,
  )

  await fse.move(filePath, targetPath, {
    overwrite: true,
  })

  return targetPath
}

const uploadImageForAnalysis = async (filePath, options = {}) => {
  const filename = path.basename(filePath)
  const mimeType = mime.lookup(filePath) || 'application/octet-stream'
  const sku = path.parse(filename).name.split(/[_\-\s]/)[0]
  const autoCreateProduct = options.autoCreateProduct ?? parseBoolean(AUTO_CREATE_PRODUCT)
  const autoSaveProduct = options.autoSaveProduct ?? parseBoolean(AUTO_SAVE_PRODUCT)
  const autoPublishProduct = options.autoPublishProduct ?? parseBoolean(AUTO_PUBLISH_PRODUCT)

  const form = new FormData()

  form.append('image', await fse.createReadStream(filePath), {
    filename,
    contentType: mimeType,
  })

  form.append('source', 'local-folder-agent')
  form.append('originalFilename', filename)
  form.append('sourcePath', filePath)
  form.append('autoAnalyze', 'false')
  form.append('autoCreateProduct', String(autoCreateProduct))
  form.append('autoSaveProduct', String(autoSaveProduct))
  form.append('autoPublishProduct', String(autoPublishProduct))
  if (options.scheduledAt) {
    form.append('scheduledAt', options.scheduledAt.toISOString())
  }
  if (sku) form.append('sku', sku)

  const url = `${API_BASE_URL}${ANALYSIS_ENDPOINT}`

  const response = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      ...getAuthHeaders(),
      'x-tenant-domain': TENANT_DOMAIN,
    },
    validateStatus: status => (status >= 200 && status < 300) || status === 409,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 120000,
  })

  return response.data
}

const runWishlistPromotionNotifier = async () => {
  if (!parseBoolean(PROMOTION_NOTIFIER_ENABLED)) return

  const url = `${API_BASE_URL}${PROMOTION_NOTIFIER_ENDPOINT}`

  try {
    const response = await axios.post(
      url,
      {
        dryRun: parseBoolean(PROMOTION_NOTIFIER_DRY_RUN),
      },
      {
        headers: {
          ...getAuthHeaders(),
          'x-tenant-domain': TENANT_DOMAIN,
        },
        timeout: 120000,
      },
    )

    const result = response.data || {}
    status.counters.promotionNotificationsSent += Number(result.sent || 0)
    status.counters.promotionNotificationsSkipped += Number(result.skipped || 0)
    status.counters.promotionNotificationsFailed += Number(result.failed || 0)

    console.log(
      `[AGENT] Promos wishlist | usuarios=${result.matchedUsers || 0} enviados=${result.sent || 0} omitidos=${result.skipped || 0} fallidos=${result.failed || 0}`,
    )

    await pushRecent({
      filename: null,
      status: 'wishlist-promotions',
      message: `Promociones wishlist procesadas: enviados=${result.sent || 0}, omitidos=${result.skipped || 0}, fallidos=${result.failed || 0}`,
    })
  } catch (error) {
    status.counters.promotionNotificationsFailed += 1

    console.error('[AGENT] Error procesando promociones de wishlist:', error.message)
    await pushRecent({
      filename: null,
      status: 'wishlist-promotions-failed',
      message: error?.response?.data?.message || error.message,
    })
  }
}

const startWishlistPromotionNotifier = () => {
  if (!parseBoolean(PROMOTION_NOTIFIER_ENABLED)) return

  const intervalMinutes = Math.max(
    5,
    Number.parseInt(PROMOTION_NOTIFIER_INTERVAL_MINUTES, 10) || 60,
  )

  runWishlistPromotionNotifier()
  setInterval(runWishlistPromotionNotifier, intervalMinutes * 60 * 1000)
}

const removeSidecarSchedule = async filePath => {
  const schedulePath = getSidecarSchedulePath(filePath)

  if (await fse.pathExists(schedulePath)) {
    await fse.remove(schedulePath)
  }
}

const processFile = async (filePath, options = {}) => {
  const filename = path.basename(filePath)

  try {
    if (!isImageFile(filePath)) {
      return
    }

    status.counters.detected += 1
    console.log(`[AGENT] Nueva imagen detectada: ${filename}`)
    await pushRecent({
      filename,
      status: 'detected',
      message: 'Imagen detectada en carpeta de entrada',
    })

    const isStable = await waitUntilFileIsStable(filePath)

    if (!isStable) {
      throw new Error('El archivo no está estable o sigue copiándose')
    }

    const sidecarOptions = await readSidecarSchedule(filePath)
    const result = await uploadImageForAnalysis(filePath, {
      autoCreateProduct: sidecarOptions.autoCreateProduct ?? options.autoCreateProduct,
      autoSaveProduct: sidecarOptions.autoSaveProduct ?? options.autoSaveProduct,
      autoPublishProduct: sidecarOptions.autoPublishProduct ?? options.autoPublishProduct,
      scheduledAt: sidecarOptions.sendAt || options.scheduledAt || null,
    })

    if (result?.success === false) {
      status.counters.duplicated += 1
      console.warn(`[AGENT] Imagen ya registrada o rechazada por API: ${filename}`)
      console.warn(`[AGENT] Motivo: ${result?.message || 'Sin detalle'}`)
      await pushRecent({
        filename,
        status: 'duplicated',
        message: result?.message || 'Imagen ya registrada o rechazada por API',
        jobId: result?.job?._id || null,
      })
    } else {
      status.counters.uploaded += 1
      if (result?.job?.status === 'scheduled') status.counters.scheduled += 1
      console.log(`[AGENT] Imagen enviada correctamente: ${filename}`)
      console.log(`[AGENT] Estado backend: ${result?.job?.status || 'N/A'}`)
      console.log(`[AGENT] AddProduct: ${result?.job?.metadata?.autoSaveProduct ? 'autosave habilitado' : 'requiere toma manual'}`)
      await pushRecent({
        filename,
        status: result?.job?.status || 'uploaded',
        message: result?.message || 'Imagen enviada correctamente',
        jobId: result?.job?._id || null,
        scheduledAt: result?.job?.scheduledAt || null,
        autoSaveProduct: Boolean(result?.job?.metadata?.autoSaveProduct),
      })
    }

    console.log(`[AGENT] Job ID: ${result?.job?._id || result?.jobId || 'N/A'}`)

    await moveToFolder(filePath, PROCESSED_FOLDER)
    await removeSidecarSchedule(filePath)
    printSummary()
  } catch (error) {
    status.counters.failed += 1
    console.error(`[AGENT] Error procesando ${filename}:`, error.message)
    await pushRecent({
      filename,
      status: 'failed',
      message: error.message,
    })

    try {
      await moveToFolder(filePath, FAILED_FOLDER)
      await removeSidecarSchedule(filePath)
    } catch (moveError) {
      console.error(`[AGENT] No se pudo mover a failed:`, moveError.message)
    }
  }
}

const scheduleQueuedFile = async filePath => {
  if (!isImageFile(filePath)) return

  const filename = path.basename(filePath)
  const sidecar = await readSidecarSchedule(filePath)
  const sendAt = sidecar.sendAt || getDefaultSendAt()

  if (sendAt && sendAt.getTime() > Date.now()) {
    console.log(`[AGENT] Imagen registrada con programación: ${filename}`)
    console.log(`[AGENT] Disponible para AddProduct desde: ${sendAt.toISOString()}`)
  }

  processFile(filePath, {
    scheduledAt: sendAt && sendAt.getTime() > Date.now() ? sendAt : null,
    autoCreateProduct: sidecar.autoCreateProduct,
    autoSaveProduct: sidecar.autoSaveProduct,
    autoPublishProduct: sidecar.autoPublishProduct,
  })
}

const start = async () => {
  validateConfig()
  await ensureFolders()
  status.watchFolder = WATCH_FOLDER
  status.tenantDomain = TENANT_DOMAIN
  status.apiBaseUrl = API_BASE_URL
  status.startedAt = new Date().toISOString()
  await writeStatus()

  printBanner()

  const watcher = chokidar.watch(WATCH_FOLDER, {
    persistent: true,
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
    ignored: [
      '**/processed/**',
      '**/failed/**',
    ],
  })

  watcher.on('add', filePath => {
    scheduleQueuedFile(filePath).catch(error => {
      console.error('[AGENT] Error agregando imagen a cola:', error.message)
    })
  })

  watcher.on('error', error => {
    console.error('[AGENT] Watcher error:', error)
  })

  startWishlistPromotionNotifier()
}

start().catch(error => {
  console.error('[AGENT] Fatal error:', error)
  process.exit(1)
})
