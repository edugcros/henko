// 📁 src/routes/themeConfigRoute.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / SHOP DOMAIN / ADMIN DOMAIN / CSRF

import express from 'express'
import rateLimit from 'express-rate-limit'
import multer from 'multer'

import {
  getPublicTheme,
  getPublicThemeById,
  getThemeCSS,
  getThemeForAdmin,
  updateTheme,
  patchTheme,
  createPreview,
  activatePreview,
  resetTheme,
  toggleMaintenance,
  uploadImage,
  exportTheme,
  importTheme,
  getThemeHistory,
  rollbackTheme,
  validateTheme,
} from '../controller/themeConfigCtrl.js'

import { isAdmin, authMiddleware } from '../middlewares/authMiddleware.js'

import {
  requireAdminDomain,
  resolveTenantByDomain,
  requireShopDomain,
  requireTenant,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()
const adminContext = [
  resolveTenantByDomain,
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdmin,
]

// =====================================================
// MULTER
// =====================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/svg+xml',
    ]

    if (allowedMimes.includes(file.mimetype)) {
      return cb(null, true)
    }

    return cb(
      new Error('Formato no soportado. Use: JPG, PNG, WebP, SVG'),
      false,
    )
  },
})

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Archivo excede 5MB máximo',
      })
    }

    return res.status(400).json({
      success: false,
      message: err.message,
    })
  }

  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    })
  }

  return next()
}

// =====================================================
// RATE LIMITERS
// =====================================================

const getAdminRateLimitKey = req => {
  const actorId = req.user?._id || req.user?.id || req.ip || 'anonymous'
  const tenantId = req.tenantId || req.user?.tenantId || 'no-tenant'

  return `${tenantId}:${actorId}`
}

const createRateLimitHandler = message => {
  return (req, res, _next, options) => {
    const retryAfterSeconds = Number(req.rateLimit?.resetTime)
      ? Math.max(
        1,
        Math.ceil((new Date(req.rateLimit.resetTime).getTime() - Date.now()) / 1000),
      )
      : undefined

    if (retryAfterSeconds) {
      res.setHeader('Retry-After', String(retryAfterSeconds))
    }

    return res.status(options.statusCode).json({
      success: false,
      message,
      retryAfter: retryAfterSeconds,
    })
  }
}

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.method === 'GET',
  keyGenerator: getAdminRateLimitKey,
  handler: createRateLimitHandler('Demasiadas modificaciones, espere un momento'),
})

const patchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.method !== 'PATCH',
  keyGenerator: getAdminRateLimitKey,
  handler: createRateLimitHandler(
    'Demasiadas modificaciones automáticas. Espere unos segundos y continúe.',
  ),
})

const previewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAdminRateLimitKey,
  handler: createRateLimitHandler('Demasiadas acciones de preview, espere un momento'),
})

const publicLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.tenantId || req.ip,
  message: {
    success: false,
    message: 'Demasiadas peticiones',
  },
})

const cssLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.tenantId || req.ip,
  message: {
    success: false,
    message: 'Demasiadas peticiones de CSS',
  },
})

// =====================================================
// RUTAS PÚBLICAS - SHOP DOMAIN
// =====================================================

/**
 * CSS público del theme.
 * GET /api/theme-config/theme.css
 *
 * Solo storefront.
 */
router.get(
  '/theme.css',
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
  cssLimiter,
  getThemeCSS,
)

/**
 * Theme público principal.
 * GET /api/theme-config
 *
 * Solo storefront.
 */
router.get(
  '/',
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
  publicLimiter,
  getPublicTheme,
)

/**
 * Alias público recomendado.
 * GET /api/theme-config/public
 *
 * Solo storefront.
 */
router.get(
  '/public',
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
  publicLimiter,
  getPublicTheme,
)

/**
 * Theme público por tenantId para embeds/integraciones explícitas.
 * GET /api/theme-config/public/:tenantId
 *
 * No usa resolveTenantByDomain porque el tenant se recibe por parámetro.
 */
router.get(
  '/public/:tenantId',
  publicLimiter,
  getPublicThemeById,
)

// =====================================================
// RUTAS ADMIN - ADMIN DOMAIN
// =====================================================

/**
 * Obtener theme para panel admin.
 * GET /api/theme-config/admin
 */
router.get(
  '/admin',
  adminContext,
  getThemeForAdmin,
)

/**
 * Historial del theme.
 * GET /api/theme-config/admin/history
 */
router.get(
  '/admin/history',
  adminContext,
  getThemeHistory,
)

/**
 * Exportar configuración del theme.
 * GET /api/theme-config/admin/export
 */
router.get(
  '/admin/export',
  adminContext,
  exportTheme,
)

/**
 * Actualización completa del theme.
 * PUT /api/theme-config/admin
 */
router.put(
  '/admin',
  adminContext,
  strictLimiter,
  updateTheme,
)

/**
 * Actualización parcial del theme.
 * PATCH /api/theme-config/admin
 */
router.patch(
  '/admin',
  adminContext,
  patchLimiter,
  patchTheme,
)

/**
 * Crear preview.
 * POST /api/theme-config/admin/preview
 */
router.post(
  '/admin/preview',
  adminContext,
  previewLimiter,
  createPreview,
)

/**
 * Activar preview.
 * POST /api/theme-config/admin/preview/:previewId/activate
 */
router.post(
  '/admin/preview/:previewId/activate',
  adminContext,
  strictLimiter,
  activatePreview,
)

/**
 * Resetear theme.
 * POST /api/theme-config/admin/reset
 */
router.post(
  '/admin/reset',
  adminContext,
  strictLimiter,
  resetTheme,
)

/**
 * Activar/desactivar mantenimiento.
 * POST /api/theme-config/admin/maintenance
 */
router.post(
  '/admin/maintenance',
  adminContext,
  strictLimiter,
  toggleMaintenance,
)

/**
 * Rollback del theme.
 * POST /api/theme-config/admin/rollback
 */
router.post(
  '/admin/rollback',
  adminContext,
  strictLimiter,
  rollbackTheme,
)

/**
 * Validar configuración del theme.
 * POST /api/theme-config/admin/validate
 */
router.post(
  '/admin/validate',
  adminContext,
  strictLimiter,
  validateTheme,
)

/**
 * Importar configuración del theme.
 * POST /api/theme-config/admin/import
 */
router.post(
  '/admin/import',
  adminContext,
  strictLimiter,
  importTheme,
)

/**
 * Subir imagen del theme.
 * POST /api/theme-config/admin/upload-image
 */
router.post(
  '/admin/upload-image',
  adminContext,
  strictLimiter,
  upload.single('image'),
  handleMulterError,
  uploadImage,
)

export default router
