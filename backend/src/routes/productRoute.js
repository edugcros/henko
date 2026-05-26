// 📁 src/routes/productRoute.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / CSRF / ADMIN / STOREFRONT

import express from 'express'
import expressAsyncHandler from 'express-async-handler'

import {
  createProduct,
  getaProduct,
  getAllProduct,
  getProductCategories,
  getCategoryConfig,
  updateProduct,
  deleteProduct,
  rating,
  rateLimiter,
  uploadProductImage,
  deleteProductImage,
  toggleHelpfulVote,
  assignVariantImage,
} from '../controller/productCtrl.js'

import { isAdmin, authMiddleware } from '../middlewares/authMiddleware.js'
import { resolveTenantByDomain } from '../middlewares/tenantMiddleware.js'
import { uploadPhoto, productImgResize } from '../middlewares/uploadImage.js'
import { analyzeImage } from '../services/aiVisionService.js'

const router = express.Router()

// =========================================================
// RATE LIMITERS ESPECÍFICOS
// =========================================================

const aiVisualLimiter = rateLimiter

// =========================================================
// IA VISUAL - ADMIN
// =========================================================

router.post(
  '/analyze-visual',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  uploadPhoto.single('images'),
  productImgResize,
  aiVisualLimiter,
  expressAsyncHandler(async (req, res) => {
    const tenantId = req.user?.tenantId

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'No se pudo identificar tu comercio. Reintentá el login.',
      })
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se subió ninguna imagen',
      })
    }

    try {
      const result = await analyzeImage(req.file.buffer, req.file.mimetype, tenantId)

      return res.status(200).json({
        success: true,
        data: result,
      })
    } catch (error) {
      if (
        error?.message?.includes('429') ||
        error?.message?.toLowerCase?.().includes('rate limit')
      ) {
        return res.status(429).json({
          success: false,
          message:
            'La IA está saturada. Intentá nuevamente en 60 segundos o completá los datos manualmente.',
        })
      }

      return res.status(500).json({
        success: false,
        message: 'Error al analizar la imagen con IA',
      })
    }
  }),
)

const normalizePath = value => {
  const normalized = String(value || '').replace(/\/+$/, '')
  return normalized || '/'
}

const isTrustedPredeployOrigin = req => {
  const origin = String(req.headers.origin || '').toLowerCase()

  return [
    'https://henko-web.vercel.app',
    'https://henko-admin.vercel.app',
  ].includes(origin)
}

const routePatternToRegex = pattern => {
  const normalized = normalizePath(pattern)

  const regexSource = normalized
    .split('/')
    .map(segment => {
      if (segment.startsWith(':')) {
        return '[^/]+'
      }

      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')

  return new RegExp(`^${regexSource}$`)
}

const predeployCsrfExemptRoutes = [
  { method: 'PUT', path: '/rating/:productId' },
  { method: 'PUT', path: '/:productId/rating/:ratingId/helpful' },
]

const matchesPredeployExemptRoute = req => {
  const requestPath = normalizePath(req.path)

  return predeployCsrfExemptRoutes.some(route => {
    return (
      route.method === req.method &&
      routePatternToRegex(route.path).test(requestPath)
    )
  })
}

const shouldSkipCsrfForPredeploy = req => {
  return (
    process.env.PREDEPLOY_TUNNEL_MODE === 'true' &&
    isTrustedPredeployOrigin(req) &&
    matchesPredeployExemptRoute(req)
  )
}

const conditionalCsrfProtection = (req, res, next) => {
  // La protección CSRF ya se aplica de forma global en app.js antes de montar rutas.
  // Este middleware queda solo como compatibilidad para las rutas de ratings.
  return next()
}

// =========================================================
// CRUD PRODUCTO - ADMIN
// =========================================================

router.post(
  '/',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  uploadPhoto.fields([
    { name: 'images', maxCount: 10 },
    { name: 'variantImages', maxCount: 20 },
  ]),
  productImgResize,
  createProduct,
)

router.put(
  '/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  updateProduct,
)

router.delete(
  '/:productId',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  deleteProduct,
)

// =========================================================
// IMÁGENES DEL PRODUCTO - ADMIN
// =========================================================

router.post(
  '/:productId/upload-image',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  uploadPhoto.array('images', 5),
  productImgResize,
  uploadProductImage,
)

router.delete(
  '/:productId/image',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  deleteProductImage,
)

// =========================================================
// IMAGEN DE VARIANTE - ADMIN
// =========================================================

router.put(
  '/:productId/variant-image',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  assignVariantImage,
)

// =========================================================
// RATINGS - USUARIO AUTENTICADO
// =========================================================

router.put(
  '/:productId/rating/:ratingId/helpful',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  toggleHelpfulVote,
)

router.put(
  '/rating/:productId',
  resolveTenantByDomain,
  authMiddleware,
  rating,
)

// =========================================================
// CATEGORÍAS Y CATÁLOGO PÚBLICO
// =========================================================

router.get(
  '/categories',
  rateLimiter,
  resolveTenantByDomain,
  getProductCategories,
)

router.get(
  '/categories/:category/config',
  rateLimiter,
  resolveTenantByDomain,
  getCategoryConfig,
)

router.get(
  '/',
  rateLimiter,
  resolveTenantByDomain,
  getAllProduct,
)

router.get(
  '/:productId',
  rateLimiter,
  resolveTenantByDomain,
  getaProduct,
)

export default router
