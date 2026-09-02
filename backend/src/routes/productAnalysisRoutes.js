// 📁 src/routes/productAnalysisRoutes.js
import express from 'express'
import multer from 'multer'
import crypto from 'crypto'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import sharp from 'sharp'

import {
  importImageForAnalysis,
  listAnalysisJobs,
  getAnalysisJobById,
  processDueAnalysisJobs,
  downloadAnalysisJobImage,
  markAnalysisJobImportedToAddProduct,
  completeAddProductJob,
  retryAnalysisJob,
  rejectAnalysisJob,
  deleteAnalysisJob,
  runWishlistPromotionNotifications,
  hideAnalysisJob,
  unhideAnalysisJob,
  getAnalysisAgentStatus,
  runAnalysisJobNow,
  rescheduleAnalysisJob,
  reportAgentHeartbeat,
  getAgentHeartbeat,
  getAiUsage,
  bulkImportImagesForAnalysis,
} from '../controller/productAnalysisController.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import {
  requireAdminDomain,
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_IMAGE_SHARP_FORMATS,
  MAX_IMAGE_UPLOAD_BYTES,
} from '../../config/imageUploadPolicy.js'

const router = express.Router()

const timingSafeEqualString = (left = '', right = '') => {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))

  if (leftBuffer.length !== rightBuffer.length) return false

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

const normalizeDomain = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .split('/')[0]
  .split(':')[0]
  .replace(/^www\./, '')

const hashAgentKey = value => crypto
  .createHash('sha256')
  .update(String(value || ''))
  .digest('hex')

const loadAgentKeyHashes = () => {
  const raw = process.env.PRODUCT_ANALYSIS_AGENT_KEYS_JSON
  if (!raw) return new Map()

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('PRODUCT_ANALYSIS_AGENT_KEYS_JSON debe contener JSON válido')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PRODUCT_ANALYSIS_AGENT_KEYS_JSON debe ser un objeto dominio:hash')
  }

  return new Map(
    Object.entries(parsed)
      .map(([domain, keyHash]) => [
        normalizeDomain(domain),
        String(keyHash || '').trim().toLowerCase(),
      ])
      .filter(([domain, keyHash]) => domain && /^[a-f0-9]{64}$/.test(keyHash)),
  )
}

const agentKeyHashes = loadAgentKeyHashes()

const authenticateAdmin = (req, res, next) => {
  return authMiddleware(req, res, error => {
    if (error) return next(error)
    return isAdmin(req, res, roleError => {
      if (roleError) return next(roleError)
      return requireAdminDomain(req, res, next)
    })
  })
}

const authenticateAgent = (req, res, next) => {
  const requestAgentKey = req.get('x-agent-api-key')
  const tenantDomain = normalizeDomain(req.tenantContext?.domain || req.get('x-tenant-domain'))
  const configuredHash = agentKeyHashes.get(tenantDomain)
  const requestHash = requestAgentKey ? hashAgentKey(requestAgentKey) : ''

  let valid = Boolean(
    configuredHash &&
    requestHash &&
    timingSafeEqualString(requestHash, configuredHash),
  )

  // Compatibilidad limitada para desarrollo. Producción exige claves por tenant.
  if (!valid && process.env.NODE_ENV !== 'production') {
    const legacyKey = process.env.PRODUCT_ANALYSIS_AGENT_KEY
    const legacyTenant = normalizeDomain(process.env.PRODUCT_ANALYSIS_AGENT_TENANT_DOMAIN)
    valid = Boolean(
      legacyKey &&
      legacyTenant &&
      legacyTenant === tenantDomain &&
      requestAgentKey &&
      timingSafeEqualString(requestAgentKey, legacyKey),
    )
  }

  if (!valid) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_AGENT_CREDENTIALS',
      message: 'Credenciales del agente inválidas para este comercio.',
    })
  }

  req.user = {
    id: null,
    _id: null,
    role: 'agent',
    tenantId: req.tenantId,
  }
  req.authType = 'product-analysis-agent'
  return next()
}

const agentOrAdminAuth = (req, res, next) => {
  if (req.get('x-agent-api-key')) {
    return authenticateAgent(req, res, next)
  }
  return authenticateAdmin(req, res, next)
}

const analysisWriteLimiter = rateLimit({
  windowMs: Number(
    process.env.PRODUCT_ANALYSIS_RATE_LIMIT_WINDOW_MS ||
      15 * 60 * 1000,
  ),

  max: Number(
    process.env.PRODUCT_ANALYSIS_RATE_LIMIT_MAX || 240,
  ),

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: req => {
    const tenantId = req.tenantId || 'no-tenant'
    const agentKey = req.get('x-agent-api-key')

    // Agente: aislado por tenant + hash de su API key.
    if (agentKey) {
      const agentId = crypto
        .createHash('sha256')
        .update(agentKey)
        .digest('hex')
        .slice(0, 16)

      return `${tenantId}:agent:${agentId}`
    }

    // Usuario autenticado: aislado por tenant + usuario.
    const userId = req.user?._id || req.user?.id

    if (userId) {
      return `${tenantId}:user:${userId}`
    }

    // Fallback para requests sin identidad.
    // ipKeyGenerator normaliza correctamente IPv4/IPv6.
    return `${tenantId}:ip:${ipKeyGenerator(req.ip)}`
  },

  message: {
    success: false,
    message:
      'Demasiadas operaciones de análisis. Intente nuevamente más tarde.',
  },
})

const MAX_BULK_IMAGES = Math.max(
  1,
  Number.parseInt(process.env.PRODUCT_ANALYSIS_BULK_MAX_FILES, 10) || 100,
)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Formato de imagen no permitido'))
    }

    cb(null, true)
  },
})

const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
    files: MAX_BULK_IMAGES,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Formato de imagen no permitido'))
    }

    cb(null, true)
  },
})

const validateUploadedImage = async (req, res, next) => {
  try {
    if (!req.file?.buffer) return next()

    const metadata = await sharp(req.file.buffer, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    }).metadata()
    const allowedFormats = new Set(ALLOWED_IMAGE_SHARP_FORMATS)

    if (!allowedFormats.has(metadata.format)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_IMAGE_CONTENT',
        message: 'El contenido del archivo no corresponde a una imagen permitida.',
      })
    }

    if (!metadata.width || !metadata.height) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_IMAGE_DIMENSIONS',
        message: 'No se pudieron validar las dimensiones de la imagen.',
      })
    }

    return next()
  } catch {
    return res.status(400).json({
      success: false,
      code: 'CORRUPTED_IMAGE',
      message: 'La imagen está dañada o utiliza un formato no compatible.',
    })
  }
}

// Versión plural para bulk-import: un archivo corrupto no debe tirar
// abajo todo el lote — se descarta ese archivo puntual (queda reportado
// en la respuesta) y se sigue con el resto.
const validateUploadedImages = async (req, res, next) => {
  const files = Array.isArray(req.files) ? req.files : []

  if (!files.length) return next()

  const validFiles = []
  const rejectedFiles = []
  const allowedFormats = new Set(ALLOWED_IMAGE_SHARP_FORMATS)

  for (const file of files) {
    try {
      const metadata = await sharp(file.buffer, {
        failOn: 'error',
        limitInputPixels: 40_000_000,
      }).metadata()

      if (!allowedFormats.has(metadata.format) || !metadata.width || !metadata.height) {
        rejectedFiles.push({ filename: file.originalname, reason: 'INVALID_IMAGE_CONTENT' })
        continue
      }

      validFiles.push(file)
    } catch {
      rejectedFiles.push({ filename: file.originalname, reason: 'CORRUPTED_IMAGE' })
    }
  }

  if (!validFiles.length) {
    return res.status(400).json({
      success: false,
      code: 'NO_VALID_IMAGES',
      message: 'Ninguno de los archivos enviados es una imagen válida.',
      rejectedFiles,
    })
  }

  req.files = validFiles
  req.rejectedFiles = rejectedFiles
  return next()
}

router.use(resolveTenantByDomain)
router.use(requireTenant)

router.post(
  '/import',
  agentOrAdminAuth,
  analysisWriteLimiter,
  upload.single('image'),
  validateUploadedImage,
  importImageForAnalysis,
)
router.post(
  '/wishlist-promotions/run',
  agentOrAdminAuth,
  analysisWriteLimiter,
  runWishlistPromotionNotifications,
)
router.post(
  '/agent-heartbeat',
  agentOrAdminAuth,
  analysisWriteLimiter,
  reportAgentHeartbeat,
)

router.use(authenticateAdmin)

router.post(
  '/bulk-import',
  analysisWriteLimiter,
  bulkUpload.array('images', MAX_BULK_IMAGES),
  validateUploadedImages,
  bulkImportImagesForAnalysis,
)

router.post('/process-due', analysisWriteLimiter, processDueAnalysisJobs)

router.get('/agent/status', getAnalysisAgentStatus)
router.get('/agent-heartbeat', getAgentHeartbeat)
router.get('/ai-usage', getAiUsage)

router.patch('/:jobId/hide', hideAnalysisJob)
router.patch('/:jobId/unhide', unhideAnalysisJob)
router.patch('/:jobId/reschedule', analysisWriteLimiter, rescheduleAnalysisJob)

router.get('/', listAnalysisJobs)
router.get('/:jobId/image-file', downloadAnalysisJobImage)
router.get('/:jobId', getAnalysisJobById)

router.post('/:jobId/import-to-add-product', markAnalysisJobImportedToAddProduct)
router.post('/:jobId/complete-add-product', completeAddProductJob)
router.post('/:jobId/retry', retryAnalysisJob)
router.post('/:jobId/run-now', analysisWriteLimiter, runAnalysisJobNow)
router.post('/:jobId/reject', rejectAnalysisJob)

router.delete('/:jobId', deleteAnalysisJob)

export default router
