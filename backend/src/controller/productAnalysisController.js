// 📁 src/controllers/productAnalysisController.js
import mongoose from 'mongoose'
import asyncHandler from 'express-async-handler'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import ProductAnalysisJob from '../models/productAnalysisJobModel.js'
import Product from '../models/productModel.js'
import { notifyWishlistPromotions } from '../services/wishlistPromotionNotifierService.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
  toObjectId,
} from '../utils/requestContext.js'
import logger from '../../config/logger.js'
import * as aiVisionService from '../services/aiVisionService.js'

// =====================================================
// CONSTANTES
// =====================================================

const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  IMPORTED: 'imported',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
})

const JOB_SOURCE = Object.freeze({
  MANUAL_UPLOAD: 'manual-upload',
  LOCAL_FOLDER_AGENT: 'local-folder-agent',
  API_IMPORT: 'api-import',
})

const ALLOWED_SOURCES = new Set(Object.values(JOB_SOURCE))

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const SAFE_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'status',
  'source',
  'originalFilename',
])

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '../../')

// =====================================================
// HELPERS
// =====================================================

const markJobAsHidden = ({ job, userId = null, reason = '' }) => {
  job.isHidden = true
  job.hiddenAt = new Date()
  job.hiddenBy = userId || null
  job.hideReason = reason || 'Ocultado automáticamente.'
}

const isObjectId = value => isValidObjectId(value)

const createSha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

const ensureDir = async dir => {
  await fs.mkdir(dir, { recursive: true })
}

const getPublicBaseUrl = () => {
  return normalizeString(process.env.PUBLIC_URL) ||
    normalizeString(process.env.API_PUBLIC_URL) ||
    normalizeString(process.env.BACKEND_PUBLIC_URL) ||
    ''
}

const normalizeString = value => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const slugify = value => {
  const slug = normalizeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || `producto-${Date.now()}`
}

const parseBoolean = value => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return ['true', '1', 'yes', 'si', 'sí'].includes(value.toLowerCase())
}

const parseFutureDate = value => {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date
}

const parsePagination = query => {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1)
  const rawLimit = Number.parseInt(query.limit, 10) || DEFAULT_LIMIT
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
  const skip = (page - 1) * limit

  return { page, limit, skip }
}

const parseSort = query => {
  const requestedSort = normalizeString(query.sort) || '-createdAt'

  const direction = requestedSort.startsWith('-') ? -1 : 1
  const field = requestedSort.replace(/^-/, '')

  if (!SAFE_SORT_FIELDS.has(field)) {
    return { createdAt: -1 }
  }

  return { [field]: direction }
}

const getTenantId = req => {
  const tenantId = req.tenantId || req.tenant?._id

  if (!tenantId || !isObjectId(tenantId)) {
    return null
  }

  return toObjectId(tenantId)
}

const getUserId = req => {
  const userId = getUserIdFromRequest(req)

  if (!userId || !isObjectId(userId)) {
    return null
  }

  return toObjectId(userId)
}

const getRequestSource = req => {
  const source = normalizeString(req.body?.source) || JOB_SOURCE.LOCAL_FOLDER_AGENT

  if (!ALLOWED_SOURCES.has(source)) {
    return JOB_SOURCE.API_IMPORT
  }

  return source
}

const sanitizeAnalysis = analysis => {
  if (!analysis || typeof analysis !== 'object') {
    return {
      titulo: '',
      categoria: '',
      subcategoria: '',
      marca: null,
      material: null,
      color: null,
      attributes: {},
      tags: [],
      descripcion: '',
      seoTitle: '',
      seoDescription: '',
      suggestedPrice: null,
      suggestedPriceRange: {
        min: null,
        max: null,
        currency: 'ARS',
      },
      confidence: 0,
      warnings: ['La IA no devolvió un análisis válido.'],
    }
  }

  const suggestedPriceRange =
    analysis.suggestedPriceRange && typeof analysis.suggestedPriceRange === 'object'
      ? {
        min:
            typeof analysis.suggestedPriceRange.min === 'number'
              ? analysis.suggestedPriceRange.min
              : null,
        max:
            typeof analysis.suggestedPriceRange.max === 'number'
              ? analysis.suggestedPriceRange.max
              : null,
        currency: analysis.suggestedPriceRange.currency || 'ARS',
      }
      : {
        min: null,
        max: null,
        currency: 'ARS',
      }

  return {
    titulo: normalizeString(analysis.titulo || analysis.title),
    categoria: normalizeString(analysis.categoria || analysis.category),
    subcategoria: normalizeString(analysis.subcategoria || analysis.subcategory),
    marca: analysis.marca || analysis.brand ? normalizeString(analysis.marca || analysis.brand) : null,
    title: normalizeString(analysis.title || analysis.titulo),
    category: normalizeString(analysis.category || analysis.categoria),
    subcategory: normalizeString(analysis.subcategory || analysis.subcategoria),
    brand: analysis.brand || analysis.marca ? normalizeString(analysis.brand || analysis.marca) : null,
    material: analysis.material ? normalizeString(analysis.material) : null,
    color:
      analysis.color ||
      analysis.mainColor ||
      null,
    attributes:
      analysis.attributes && typeof analysis.attributes === 'object'
        ? analysis.attributes
        : analysis.atributos && typeof analysis.atributos === 'object'
          ? analysis.atributos
          : {},
    tags: Array.isArray(analysis.tags)
      ? analysis.tags.map(tag => normalizeString(tag)).filter(Boolean).slice(0, 30)
      : [],
    descripcion: normalizeString(analysis.descripcion || analysis.description),
    description: normalizeString(analysis.description || analysis.descripcion),
    seoTitle: normalizeString(analysis.seoTitle),
    seoDescription: normalizeString(analysis.seoDescription),
    suggestedPrice:
      typeof analysis.suggestedPrice === 'number'
        ? analysis.suggestedPrice
        : typeof analysis.precio_sugerido === 'number'
          ? analysis.precio_sugerido
          : null,
    suggestedPriceRange,
    confidence:
      typeof analysis.confidence === 'number'
        ? Math.min(Math.max(analysis.confidence, 0), 1)
        : 0,
    warnings: Array.isArray(analysis.warnings)
      ? analysis.warnings.map(warning => normalizeString(warning)).filter(Boolean)
      : [],
  }
}

/**
 * Adapter de storage.
 *
 * En producción, reemplazá esta función por tu servicio real:
 * - Cloudinary
 * - S3
 * - R2
 * - Supabase Storage
 * - storage local controlado
 *
 * La idea es que este controller no dependa de Cloudinary directamente.
 */
const uploadImageToStorage = async ({ file, tenantId }) => {
  if (!file) {
    throw new Error('Archivo requerido para subir imagen')
  }

  if (file.secure_url) return { url: file.secure_url, publicId: file.public_id || '' }
  if (file.url) return { url: file.url, publicId: file.public_id || '' }
  if (file.path && /^https?:\/\//i.test(file.path)) {
    return { url: file.path, publicId: file.public_id || '' }
  }

  if (!file.buffer) {
    throw new Error('No se pudo obtener buffer de imagen')
  }

  const driver = normalizeString(process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase()
  const folder = `product-analysis/${tenantId}`

  if (driver === 'cloudinary') {
    try {
      const { cloudinaryUploadThemeAsset } = await import('../utils/cloudinary.js')
      const uploaded = await cloudinaryUploadThemeAsset(file.buffer, folder)

      return {
        url: uploaded.url,
        publicId: uploaded.public_id,
      }
    } catch (error) {
      logger.warn('[ProductAnalysis] Cloudinary no disponible para análisis. Usando storage local.', {
        tenantId: tenantId?.toString(),
        error: error.message,
      })
    }
  }

  const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg'
  const safeName = `${Date.now()}-${crypto.randomUUID()}${extension}`
  const relativePath = path.posix.join('product-analysis', String(tenantId), safeName)
  const folderAbs = path.join(rootDir, 'uploads', 'product-analysis', String(tenantId))
  const fileAbs = path.join(folderAbs, safeName)

  await ensureDir(folderAbs)
  await fs.writeFile(fileAbs, file.buffer)

  const baseUrl = getPublicBaseUrl()
  if (!baseUrl) {
    throw new Error(
      'PUBLIC_URL, API_PUBLIC_URL o BACKEND_PUBLIC_URL es requerido para publicar imágenes locales.',
    )
  }

  return {
    url: `${baseUrl}/uploads/${relativePath}`.replace(/([^:]\/)\/+/g, '$1'),
    publicId: relativePath,
  }
}

const runVisualAnalysis = async ({ tenantId, file, originalFilename }) => {
  /**
   * Compatibilidad con distintas firmas posibles de tu aiVisionService.
   * Recomendado final:
   *
   * aiVisionService.analyzeProductImage({
   *   tenantId,
   *   imageBuffer,
   *   mimeType,
   *   originalFilename,
   * })
   */
  if (typeof aiVisionService.analyzeProductImage === 'function') {
    if (aiVisionService.analyzeProductImage.length >= 3) {
      return aiVisionService.analyzeProductImage(file.buffer, file.mimetype, tenantId)
    }

    return aiVisionService.analyzeProductImage({
      tenantId,
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
      originalFilename,
    })
  }

  if (typeof aiVisionService.analyzeImage === 'function') {
    if (aiVisionService.analyzeImage.length >= 3) {
      return aiVisionService.analyzeImage(file.buffer, file.mimetype, tenantId)
    }

    return aiVisionService.analyzeImage({
      tenantId,
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
      originalFilename,
    })
  }

  throw new Error(
    'aiVisionService no exporta analyzeProductImage ni analyzeImage',
  )
}

const analyzeAndPersistJob = async ({ jobId, tenantId, file = null, originalFilename = '' }) => {
  const job = await ProductAnalysisJob.findOne({ _id: jobId, tenantId })

  if (!job) {
    throw new Error('Job de análisis no encontrado')
  }

  if (job.deletedAt || job.status === JOB_STATUS.REJECTED) {
    logger.info('[ProductAnalysis] Job omitido porque fue eliminado o rechazado', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      status: job.status,
    })
    return job
  }

  job.status = JOB_STATUS.PROCESSING
  job.startedAt = job.startedAt || new Date()
  job.error = undefined
  await job.save()

  try {
    let rawAnalysis

    if (file?.buffer) {
      rawAnalysis = await runVisualAnalysis({
        tenantId,
        file,
        originalFilename: originalFilename || job.originalFilename,
      })
    } else if (typeof aiVisionService.analyzeProductImageFromUrl === 'function') {
      rawAnalysis = await aiVisionService.analyzeProductImageFromUrl({
        tenantId,
        imageUrl: job.imageUrl,
        originalFilename: originalFilename || job.originalFilename,
      })
    } else {
      throw new Error('No hay buffer disponible y la IA no soporta análisis desde URL')
    }

    const analysis = sanitizeAnalysis(rawAnalysis)

    job.status = JOB_STATUS.COMPLETED
    job.analysis = analysis
    job.processedAt = new Date()
    job.failedAt = undefined
    job.error = undefined

    await job.save()

    if (job.autoCreateProduct && !job.createdProductId) {
      await createProductFromAnalysisJob({
        job,
        userId: job.createdBy || null,
        publish: job.autoPublishProduct,
      })
    }

    logger.info('[ProductAnalysis] Análisis completado', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      confidence: analysis.confidence,
    })

    return job
  } catch (error) {
    job.status = JOB_STATUS.FAILED
    job.error = {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }
    job.failedAt = new Date()

    await job.save()

    logger.error('[ProductAnalysis] Error analizando imagen', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      error: error.message,
    })

    return job
  }
}

const releaseOrAnalyzeScheduledJob = async payload => {
  const job = await ProductAnalysisJob.findOne({
    _id: payload.jobId,
    tenantId: payload.tenantId,
  })

  if (!job) {
    throw new Error('Job programado no encontrado')
  }

  if (job.deletedAt || job.status === JOB_STATUS.REJECTED) {
    logger.info('[ProductAnalysis] Job programado omitido porque fue eliminado o rechazado', {
      tenantId: payload.tenantId?.toString(),
      jobId: payload.jobId?.toString(),
      status: job.status,
    })
    return job
  }

  if (job.metadata?.autoAnalyze === false) {
    job.status = JOB_STATUS.PENDING
    await job.save()

    logger.info('[ProductAnalysis] Imagen programada liberada para AddProduct', {
      tenantId: payload.tenantId?.toString(),
      jobId: payload.jobId?.toString(),
    })

    return job
  }

  return analyzeAndPersistJob(payload)
}

const scheduleAnalysisJob = payload => {
  const delayMs = Math.max(
    0,
    payload.scheduledAt ? new Date(payload.scheduledAt).getTime() - Date.now() : 0,
  )

  const run = () => {
    releaseOrAnalyzeScheduledJob(payload).catch(error => {
      logger.error('[ProductAnalysis] Error fatal en job background', {
        tenantId: payload.tenantId?.toString(),
        jobId: payload.jobId?.toString(),
        error: error.message,
      })
    })
  }

  if (delayMs > 0 && delayMs <= 2147483647) {
    setTimeout(run, delayMs)
    return
  }

  if (delayMs > 2147483647) {
    logger.info('[ProductAnalysis] Job programado a largo plazo; se procesará por scheduler periódico', {
      tenantId: payload.tenantId?.toString(),
      jobId: payload.jobId?.toString(),
      scheduledAt: payload.scheduledAt,
    })
    return
  }

  setImmediate(run)
}

const processDueScheduledJobs = async ({ tenantId = null, limit = 10 } = {}) => {
  const filter = {
    status: JOB_STATUS.SCHEDULED,
    scheduledAt: { $lte: new Date() },
    $or: [
      { deletedAt: { $exists: false } },
      { deletedAt: null },
    ],
  }

  if (tenantId) filter.tenantId = tenantId

  const jobs = await ProductAnalysisJob.find(filter)
    .sort({ scheduledAt: 1 })
    .limit(limit)

  jobs.forEach(job => {
    scheduleAnalysisJob({
      jobId: job._id,
      tenantId: job.tenantId,
      originalFilename: job.originalFilename,
    })
  })

  return jobs.length
}

const readJobImageBuffer = async job => {
  if (job.imagePublicId) {
    const uploadsDir = path.join(rootDir, 'uploads')
    const localPath = path.resolve(uploadsDir, job.imagePublicId)

    if (localPath.startsWith(uploadsDir)) {
      try {
        return await fs.readFile(localPath)
      } catch (error) {
        logger.warn('[ProductAnalysis] Imagen local no encontrada, intentando por URL', {
          jobId: job._id.toString(),
          imagePublicId: job.imagePublicId,
          error: error.message,
        })
      }
    }
  }

  if (!job.imageUrl) {
    throw new Error('El job no tiene imagen asociada')
  }

  const response = await fetch(job.imageUrl)

  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen del job: ${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

const deleteJobImageFromStorage = async job => {
  const publicId = normalizeString(job?.imagePublicId)

  if (!publicId) {
    return { deleted: false, storage: 'none' }
  }

  const uploadsDir = path.resolve(rootDir, 'uploads')
  const localPath = path.resolve(uploadsDir, publicId)
  const imageUrl = normalizeString(job?.imageUrl)
  const isInsideUploads =
    localPath === uploadsDir || localPath.startsWith(`${uploadsDir}${path.sep}`)
  const isLocalAsset =
    isInsideUploads &&
    (
      imageUrl.includes('/uploads/') ||
      Boolean(path.extname(publicId))
    )

  if (isLocalAsset) {
    try {
      await fs.unlink(localPath)
      return { deleted: true, storage: 'local' }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { deleted: false, storage: 'local-missing' }
      }

      throw error
    }
  }

  const { cloudinaryDeleteImg } = await import('../utils/cloudinary.js')
  const result = await cloudinaryDeleteImg(publicId)

  if (!result?.success) {
    throw new Error(`No se pudo eliminar la imagen almacenada: ${result?.result || 'sin detalle'}`)
  }

  return {
    deleted: true,
    storage: 'cloudinary',
    result: result.result,
  }
}

const schedulerEnabled = process.env.PRODUCT_ANALYSIS_SCHEDULER_ENABLED !== 'false'
const schedulerIntervalMs = Math.max(
  Number.parseInt(process.env.PRODUCT_ANALYSIS_SCHEDULER_INTERVAL_MS, 10) || 60000,
  10000,
)

if (schedulerEnabled && process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    processDueScheduledJobs({ limit: 20 }).catch(error => {
      logger.error('[ProductAnalysis] Error procesando cola programada', {
        error: error.message,
      })
    })
  }, schedulerIntervalMs)
}

const buildProductDraftFromJob = ({ job, overrides = {}, userId }) => {
  const analysis = job.analysis || {}

  const titulo =
    normalizeString(overrides.titulo) ||
    normalizeString(analysis.titulo) ||
    normalizeString(job.originalFilename).replace(/\.[^/.]+$/, '') ||
    'Producto sin título'

  const descripcion =
    normalizeString(overrides.descripcion) ||
    normalizeString(analysis.descripcion) ||
    'Descripción pendiente de revisión.'

  const price =
    Number(overrides.price) ||
    Number(analysis.suggestedPrice) ||
    Number(analysis.suggestedPriceRange?.min) ||
    0

  const category = normalizeString(overrides.categoria) || normalizeString(analysis.categoria)
  const subcategory =
    normalizeString(overrides.subcategoria) || normalizeString(analysis.subcategoria)
  const brand = normalizeString(overrides.marca) || normalizeString(analysis.marca) || 'Sin marca'
  const material = normalizeString(overrides.material) || normalizeString(analysis.material)
  const color = normalizeString(overrides.color) || normalizeString(analysis.color)
  const safeJobSuffix = String(job._id || Date.now()).slice(-8)

  /**
   * Este payload debe adaptarse a tu productModel real.
   * Uso campos comunes que vos venís usando:
   * - title
   * - description
   * - price
   * - images
   * - categoria
   * - subcategoria
   * - marca
   * - tags
   * - tenantId
   * - status
   * - visibility
   */
  return {
    tenantId: job.tenantId,

    title: titulo,
    slug: `${slugify(titulo)}-${safeJobSuffix}`,
    description: descripcion,

    price,
    compareAtPrice: price,
    currency: analysis.suggestedPriceRange?.currency || 'ARS',

    images: [
      {
        public_id: job.imagePublicId || `product-analysis/${job.tenantId}/${job.imageHash || job._id}`,
        url: job.imageUrl,
        alt: titulo,
        isMain: true,
        order: 0,
        tenantId: job.tenantId,
      },
    ],

    categoria: category || 'Sin categoría',
    subcategoria: subcategory || 'Sin subcategoría',
    marca: brand,
    sku: normalizeString(overrides.sku) || normalizeString(job.metadata?.sku) || undefined,

    tags: Array.isArray(overrides.tags)
      ? overrides.tags
      : Array.isArray(analysis.tags)
        ? analysis.tags
        : [],

    atributos: {
      ...(analysis.attributes || {}),
      ...(overrides.attributes && typeof overrides.attributes === 'object'
        ? overrides.attributes
        : {}),
      ...(material ? { material } : {}),
      ...(color ? { color } : {}),
    },

    status: 'draft',
    visibility: 'hidden',

    stock: Number(overrides.stock) || 0,

    iaGenerated: true,
    aiOriginalOutput: analysis,
    aiConfidence: analysis.confidence ?? null,
    aiSource: job.source,
    aiImageHash: job.imageHash,
    aiNeedsReview: true,
    createdBy: userId || job.createdBy || null,
  }
}

const createProductFromAnalysisJob = async ({ job, overrides = {}, userId = null, publish = false }) => {
  if (job.createdProductId) return null

  const productPayload = buildProductDraftFromJob({
    job,
    overrides,
    userId,
  })

  if (publish) {
    productPayload.status = 'active'
    productPayload.visibility = 'visible'
    productPayload.aiNeedsReview = false
  }

  const product = await Product.create(productPayload)

  job.status = JOB_STATUS.APPROVED
  job.createdProductId = product._id
  job.approvedAt = new Date()
  job.approvedBy = userId

  markJobAsHidden({
    job,
    userId,
    reason: publish
      ? 'Producto auto-publicado desde análisis IA.'
      : 'Producto auto-creado como borrador desde análisis IA.',
  })

  await job.save()

  return product
}

const ensureJobBelongsToTenant = async ({ jobId, tenantId }) => {
  if (!isObjectId(jobId)) {
    const error = new Error('ID de análisis inválido')
    error.statusCode = 400
    throw error
  }

  const job = await ProductAnalysisJob.findOne({
    _id: jobId,
    tenantId,
  })

  if (!job) {
    const error = new Error('Análisis no encontrado para este comercio')
    error.statusCode = 404
    throw error
  }

  return job
}

// =====================================================
// CONTROLLERS
// =====================================================


/**
 * PATCH /api/product-analysis/:jobId/hide
 *
 * Oculta un análisis de la bandeja principal sin eliminarlo.
 */
export const hideAnalysisJob = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)
  const userId = getUserId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if (job.deletedAt) {
    return res.status(404).json({
      success: false,
      message: 'El análisis fue eliminado.',
    })
  }

  if (job.isHidden) {
    return res.status(200).json({
      success: true,
      message: 'El análisis ya estaba oculto.',
      job,
    })
  }

  markJobAsHidden({
    job,
    userId,
    reason: normalizeString(req.body?.reason) || 'Ocultado manualmente por administrador.',
  })

  await job.save()

  return res.status(200).json({
    success: true,
    message: 'Análisis ocultado correctamente.',
    job,
  })
})


/**
 * PATCH /api/product-analysis/:jobId/unhide
 *
 * Restaura un análisis oculto a la bandeja principal.
 */
export const unhideAnalysisJob = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if (job.deletedAt) {
    return res.status(404).json({
      success: false,
      message: 'El análisis fue eliminado.',
    })
  }

  job.isHidden = false
  job.hiddenAt = null
  job.hiddenBy = null
  job.hideReason = ''

  await job.save()

  return res.status(200).json({
    success: true,
    message: 'Análisis restaurado correctamente.',
    job,
  })
})


/**
 * POST /api/product-analysis/import
 *
 * Recibe una imagen desde:
 * - admin manual
 * - agente local watcher
 * - API externa
 *
 * Requiere:
 * - resolveTenantByDomain antes de este controller
 * - authMiddleware/isAdmin o apiKeyMiddleware antes de este controller
 * - multer.single('image')
 */
export const importImageForAnalysis = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)
  const userId = getUserId(req)
  const file = req.file

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto. Verificá x-tenant-domain o el dominio del request.',
    })
  }

  if (!file) {
    return res.status(400).json({
      success: false,
      message: 'Imagen requerida. Enviar archivo en el campo multipart "image".',
    })
  }

  if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
    return res.status(400).json({
      success: false,
      message: 'El archivo debe llegar en memoria. Revisá configuración de multer.memoryStorage().',
    })
  }

  const originalFilename =
    normalizeString(req.body?.originalFilename) ||
    normalizeString(file.originalname) ||
    `image-${Date.now()}`

  const imageHash = createSha256(file.buffer)
  const source = getRequestSource(req)
  const autoAnalyze = req.body?.autoAnalyze === undefined
    ? true
    : parseBoolean(req.body.autoAnalyze)
  const scheduledAt = parseFutureDate(req.body?.scheduledAt)
  const shouldSchedule = Boolean(scheduledAt && scheduledAt.getTime() > Date.now())
  const autoCreateProduct = parseBoolean(req.body?.autoCreateProduct)
  const autoPublishProduct = parseBoolean(req.body?.autoPublishProduct)
  const autoSaveProduct = parseBoolean(req.body?.autoSaveProduct)

  const existing = await ProductAnalysisJob.findOne({
    tenantId,
    imageHash,
  })

  if (existing) {
    const isDiscardedLegacyJob =
      Boolean(existing.deletedAt) ||
      (
        existing.status === JOB_STATUS.REJECTED &&
        !existing.createdProductId
      )

    if (isDiscardedLegacyJob) {
      await ProductAnalysisJob.deleteOne({
        _id: existing._id,
        tenantId,
      })

      try {
        await deleteJobImageFromStorage(existing)
      } catch (error) {
        logger.warn('[ProductAnalysis] No se pudo limpiar la imagen del duplicado heredado', {
          jobId: String(existing._id),
          tenantId: String(tenantId),
          error: error.message,
        })
      }
    } else {
      return res.status(409).json({
        success: false,
        code: 'PRODUCT_ANALYSIS_DUPLICATE',
        message: 'La imagen ya fue importada para análisis en este comercio.',
        job: existing,
      })
    }
  }

  const storedImage = await uploadImageToStorage({
    file,
    tenantId,
  })

  let job

  try {
    job = await ProductAnalysisJob.create({
      tenantId,
      source,
      originalFilename,
      imageUrl: storedImage.url,
      imagePublicId: storedImage.publicId,
      imageHash,
      status: shouldSchedule
        ? JOB_STATUS.SCHEDULED
        : JOB_STATUS.PENDING,
      scheduledAt,
      autoCreateProduct,
      autoPublishProduct,
      createdBy: userId,
      metadata: {
        mimeType: file.mimetype,
        size: file.size,
        sourcePath: normalizeString(req.body?.sourcePath),
        sku: normalizeString(req.body?.sku),
        autoAnalyze,
        autoSaveProduct,
        addProductAt: shouldSchedule ? scheduledAt : null,
        uploadedFromIp: req.ip,
        userAgent: req.get('user-agent'),
      },
    })
  } catch (error) {
    if (error?.code === 11000) {
      try {
        await deleteJobImageFromStorage({
          imagePublicId: storedImage.publicId,
          imageUrl: storedImage.url,
        })
      } catch (cleanupError) {
        logger.warn('[ProductAnalysis] No se pudo limpiar imagen de importación duplicada', {
          tenantId: String(tenantId),
          error: cleanupError.message,
        })
      }

      return res.status(409).json({
        success: false,
        code: 'PRODUCT_ANALYSIS_DUPLICATE',
        message: 'La imagen ya fue importada para análisis en este comercio.',
      })
    }

    throw error
  }

  logger.info('[ProductAnalysis] Imagen importada', {
    tenantId: tenantId.toString(),
    jobId: job._id.toString(),
    source,
    originalFilename,
    autoAnalyze,
    scheduledAt,
    autoCreateProduct,
  })

  if (shouldSchedule) {
    scheduleAnalysisJob({
      jobId: job._id,
      tenantId,
      scheduledAt,
      originalFilename,
    })

    return res.status(202).json({
      success: true,
      message: autoAnalyze
        ? 'Imagen importada y programada para análisis.'
        : 'Imagen importada y programada para AddProduct.',
      job,
    })
  }

  if (!autoAnalyze) {
    return res.status(201).json({
      success: true,
      message: 'Imagen importada. Análisis pendiente.',
      job,
    })
  }

  const processedJob = await analyzeAndPersistJob({
    jobId: job._id,
    tenantId,
    file: {
      buffer: Buffer.from(file.buffer),
      mimetype: file.mimetype,
    },
    originalFilename,
  })

  const analysisSucceeded = processedJob.status === JOB_STATUS.COMPLETED ||
    processedJob.status === JOB_STATUS.APPROVED

  return res.status(analysisSucceeded ? 201 : 422).json({
    success: analysisSucceeded,
    message: analysisSucceeded
      ? 'Imagen importada y analizada correctamente.'
      : processedJob.error?.message || 'La IA no pudo completar el análisis.',
    job: processedJob,
  })
})

/**
 * GET /api/product-analysis
 */
export const listAnalysisJobs = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const { page, limit, skip } = parsePagination(req.query)
  const sort = parseSort(req.query)

  const status = normalizeString(req.query.status)
  const source = normalizeString(req.query.source)
  const search = normalizeString(req.query.search)
  const showHidden = parseBoolean(req.query.showHidden)
  const onlyHidden = parseBoolean(req.query.onlyHidden)

  const filter = {
    tenantId,
    $and: [
      {
        $or: [
          { deletedAt: { $exists: false } },
          { deletedAt: null },
        ],
      },
    ],
  }

  if (onlyHidden) {
    filter.isHidden = true
  } else if (!showHidden) {
    filter.isHidden = { $ne: true }
  }

  if (status) {
    filter.status = status
  }

  if (source) {
    filter.source = source
  }

  if (search) {
    filter.$and.push({
      $or: [
        { originalFilename: { $regex: search, $options: 'i' } },
        { 'analysis.titulo': { $regex: search, $options: 'i' } },
        { 'analysis.categoria': { $regex: search, $options: 'i' } },
        { 'analysis.marca': { $regex: search, $options: 'i' } },
      ],
    })
  }

  const [items, total] = await Promise.all([
    ProductAnalysisJob.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    ProductAnalysisJob.countDocuments(filter),
  ])

  return res.status(200).json({
    success: true,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    count: items.length,
    items,
    showHidden,
    onlyHidden,
  })
})

/**
 * GET /api/product-analysis/:jobId
 */
export const getAnalysisJobById = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  return res.status(200).json({
    success: true,
    job,
  })
})

/**
 * POST /api/product-analysis/process-due
 */
export const processDueAnalysisJobs = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const count = await processDueScheduledJobs({ tenantId })

  return res.status(202).json({
    success: true,
    message: count
      ? `${count} imagen(es) programada(s) procesadas.`
      : 'No hay imágenes programadas vencidas.',
    count,
  })
})

/**
 * GET /api/product-analysis/:jobId/image-file
 *
 * Devuelve la imagen original para que AddProduct la cargue como File
 * y dispare el análisis IA desde su propio flujo.
 */
export const downloadAnalysisJobImage = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if (job.deletedAt) {
    return res.status(404).json({
      success: false,
      message: 'La imagen fue eliminada.',
    })
  }

  const imageBuffer = await readJobImageBuffer(job)
  const mimeType = job.metadata?.mimeType || 'image/jpeg'

  res.setHeader('Content-Type', mimeType)
  res.setHeader('Content-Length', imageBuffer.length)
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(job.originalFilename || 'agent-image.jpg')}"`,
  )

  return res.status(200).send(imageBuffer)
})

/**
 * POST /api/product-analysis/:jobId/import-to-add-product
 *
 * Marca la imagen como tomada por AddProduct. No ejecuta IA.
 */
export const markAnalysisJobImportedToAddProduct = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)
  const userId = getUserId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if (job.deletedAt) {
    return res.status(404).json({
      success: false,
      message: 'La imagen fue eliminada.',
    })
  }

  if (job.status !== JOB_STATUS.PENDING) {
    return res.status(409).json({
      success: false,
      message: job.status === JOB_STATUS.SCHEDULED
        ? 'La imagen todavía está programada. Va a estar disponible en el horario indicado.'
        : 'La imagen ya fue tomada o procesada.',
      currentStatus: job.status,
    })
  }

  job.status = JOB_STATUS.IMPORTED
  job.importedAt = new Date()
  job.importedBy = userId
  job.rejectionReason = ''

  await job.save()

  return res.status(200).json({
    success: true,
    message: 'Imagen enviada a AddProduct.',
    job,
  })
})

/**
 * POST /api/product-analysis/:jobId/complete-add-product
 *
 * Vincula el job con el producto creado desde AddProduct.
 */
export const completeAddProductJob = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)
  const userId = getUserId(req)
  const productId = normalizeString(req.body?.productId)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  if (!isObjectId(productId)) {
    return res.status(400).json({
      success: false,
      message: 'productId inválido.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if (job.deletedAt) {
    return res.status(404).json({
      success: false,
      message: 'La imagen fue eliminada.',
    })
  }

  if (
    job.status === JOB_STATUS.APPROVED &&
    String(job.createdProductId || '') === productId
  ) {
    return res.status(200).json({
      success: true,
      message: 'El trabajo ya estaba vinculado al producto.',
      job,
    })
  }

  job.status = JOB_STATUS.APPROVED
  job.createdProductId = toObjectId(productId)
  job.approvedAt = new Date()
  job.approvedBy = userId
  job.rejectionReason = ''

  markJobAsHidden({
    job,
    userId,
    reason: 'Producto creado desde AddProduct.',
  })

  await job.save()

  return res.status(200).json({
    success: true,
    message: 'Trabajo completado y vinculado al producto.',
    job,
  })
})

/**
 * POST /api/product-analysis/:jobId/retry
 *
 * Reintenta análisis.
 * Ideal para imágenes que quedaron failed.
 *
 * Nota:
 * Si imageUrl es Cloudinary/S3, tu aiVisionService debería soportar analyzeProductImageFromUrl.
 */
export const retryAnalysisJob = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if ([JOB_STATUS.APPROVED, JOB_STATUS.REJECTED].includes(job.status)) {
    return res.status(409).json({
      success: false,
      message: 'No se puede reanalizar un análisis aprobado o rechazado.',
    })
  }

  if (!job.imageUrl) {
    return res.status(400).json({
      success: false,
      message: 'El análisis no tiene imagen asociada.',
    })
  }

  job.status = JOB_STATUS.PROCESSING
  job.error = undefined
  job.startedAt = new Date()
  await job.save()

  try {
    let rawAnalysis

    if (typeof aiVisionService.analyzeProductImageFromUrl === 'function') {
      rawAnalysis = await aiVisionService.analyzeProductImageFromUrl({
        tenantId,
        imageUrl: job.imageUrl,
        originalFilename: job.originalFilename,
      })
    } else {
      return res.status(501).json({
        success: false,
        message:
          'El servicio IA no implementa analyzeProductImageFromUrl. Para reintentos desde imageUrl, agregá esa función.',
      })
    }

    const analysis = sanitizeAnalysis(rawAnalysis)

    job.status = JOB_STATUS.COMPLETED
    job.analysis = analysis
    job.processedAt = new Date()
    job.failedAt = undefined
    job.error = undefined

    await job.save()

    return res.status(200).json({
      success: true,
      message: 'Análisis reintentado correctamente.',
      job,
    })
  } catch (error) {
    job.status = JOB_STATUS.FAILED
    job.failedAt = new Date()
    job.error = {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }

    await job.save()

    logger.error('[ProductAnalysis] Error reintentando análisis', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      error: error.message,
    })

    return res.status(500).json({
      success: false,
      message: 'Error reintentando análisis IA.',
      job,
    })
  }
})
/**
 * POST /api/product-analysis/:jobId/approve
 *
 * Aprueba un análisis y crea un producto en estado draft/hidden.
 *
 * Body opcional:
 * {
 *   "titulo": "...",
 *   "descripcion": "...",
 *   "price": 10000,
 *   "stock": 5,
 *   "categoria": "...",
 *   "subcategoria": "...",
 *   "marca": "...",
 *   "publish": false
 * }
 */
export const approveAnalysisJob = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)
  const userId = getUserId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if (job.status !== JOB_STATUS.COMPLETED) {
    return res.status(409).json({
      success: false,
      message: 'Solo se puede aprobar un análisis completado.',
      currentStatus: job.status,
    })
  }

  if (job.createdProductId) {
    return res.status(409).json({
      success: false,
      message: 'Este análisis ya tiene un producto creado.',
      productId: job.createdProductId,
    })
  }

  const publish = parseBoolean(req.body?.publish)

  const productPayload = buildProductDraftFromJob({
    job,
    overrides: req.body || {},
    userId,
  })

  if (publish) {
    productPayload.status = 'active'
    productPayload.visibility = 'visible'
    productPayload.aiNeedsReview = false
  }

  const session = await mongoose.startSession()

  let product

  try {
    await session.withTransaction(async () => {
      product = await Product.create([productPayload], { session })
      product = product[0]

      job.status = JOB_STATUS.APPROVED
      job.createdProductId = product._id
      job.approvedAt = new Date()
      job.approvedBy = userId

      markJobAsHidden({
        job,
        userId,
        reason: publish
          ? 'Producto publicado desde análisis IA.'
          : 'Producto creado como borrador desde análisis IA.',
      })

      await job.save({ session })

      await job.save({ session })
    })
  } catch (error) {
    logger.error('[ProductAnalysis] Error aprobando análisis', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      error: error.message,
    })

    return res.status(500).json({
      success: false,
      message: 'Error aprobando análisis y creando producto.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  } finally {
    await session.endSession()
  }

  return res.status(201).json({
    success: true,
    message: publish
      ? 'Análisis aprobado y producto publicado.'
      : 'Análisis aprobado y producto creado como borrador.',
    job,
    product,
  })
})

/**
 * POST /api/product-analysis/:jobId/reject
 */
export const rejectAnalysisJob = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)
  const userId = getUserId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  if (job.status === JOB_STATUS.APPROVED) {
    return res.status(409).json({
      success: false,
      message: 'No se puede rechazar un análisis ya aprobado.',
    })
  }

  job.status = JOB_STATUS.REJECTED
  job.rejectedAt = new Date()
  job.rejectedBy = userId
  job.rejectionReason =
    normalizeString(req.body?.reason) || 'Rechazado por administrador.'

  await job.save()

  return res.status(200).json({
    success: true,
    message: 'Análisis rechazado correctamente.',
    job,
  })
})

/**
 * DELETE /api/product-analysis/:jobId
 *
 * Eliminación permanente del trabajo y su imagen.
 * No elimina un producto creado; sólo remueve su referencia al trabajo.
 */
export const deleteAnalysisJob = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const job = await ensureJobBelongsToTenant({
    jobId: req.params.jobId,
    tenantId,
  })

  const unlinkResult = await Product.updateMany(
    {
      tenantId,
      aiAgentJobId: job._id,
    },
    {
      $unset: {
        aiAgentJobId: 1,
      },
    },
  )

  const deleteResult = await ProductAnalysisJob.deleteOne({
    _id: job._id,
    tenantId,
  })

  if (deleteResult.deletedCount !== 1) {
    return res.status(409).json({
      success: false,
      message: 'El análisis cambió o ya fue eliminado. Actualizá la bandeja.',
    })
  }

  let storageResult = {
    deleted: false,
    storage: 'not-attempted',
  }
  let storageWarning = null

  try {
    storageResult = await deleteJobImageFromStorage(job)
  } catch (error) {
    storageWarning = error.message
    logger.warn('[ProductAnalysis] Trabajo eliminado; imagen pendiente de limpieza', {
      jobId: String(job._id),
      tenantId: String(tenantId),
      error: error.message,
    })
  }

  logger.info('[ProductAnalysis] Trabajo eliminado permanentemente', {
    jobId: String(job._id),
    tenantId: String(tenantId),
    storage: storageResult.storage,
    imageDeleted: storageResult.deleted,
    unlinkedProducts: unlinkResult.modifiedCount || 0,
  })

  return res.status(200).json({
    success: true,
    message: 'Análisis e imagen eliminados permanentemente.',
    data: {
      jobId: String(job._id),
      imageDeleted: storageResult.deleted,
      storage: storageResult.storage,
      storageWarning,
      unlinkedProducts: unlinkResult.modifiedCount || 0,
    },
  })
})

export const runWishlistPromotionNotifications = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenantId
  const dryRun =
    req.body?.dryRun === true ||
    String(req.body?.dryRun || req.query?.dryRun || '').toLowerCase() === 'true'
  const limit = Number(req.body?.limit || req.query?.limit || 100)

  const result = await notifyWishlistPromotions({
    tenantId,
    dryRun,
    limit,
  })

  return res.status(200).json(result)
})

export {
  JOB_STATUS,
  JOB_SOURCE,
}
