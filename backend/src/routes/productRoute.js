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
  upsertCategoryConfig,
  updateProduct,
  deleteProduct,
  rating,
  rateLimiter,
  productPublicReadLimiter,
  uploadProductImage,
  deleteProductImage,
  toggleHelpfulVote,
  assignVariantImage,
} from '../controller/productCtrl.js'

import { isAdmin, authMiddleware } from '../middlewares/authMiddleware.js'
import {
  requireAdminDomain,
  requireShopDomain,
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'
import { uploadPhoto, productImgResize } from '../middlewares/uploadImage.js'
import { analyzeImage } from '../services/aiVisionService.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'

const router = express.Router()

const adminContext = [
  resolveTenantByDomain,
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdmin,
]

const shopContext = [
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
]

const tenantReadContext = [
  resolveTenantByDomain,
  requireTenant,
]

const aiVisualLimiter = rateLimiter

router.post(
  '/analyze-visual',
  adminContext,
  aiVisualLimiter,
  uploadPhoto.single('images'),
  productImgResize,
  expressAsyncHandler(async (req, res) => {
    let tenantId

    try {
      ;({ tenantId } = resolveAuthorizedTenantFromRequest(req, {
        requireUserTenant: true,
        missingTenantMessage: 'No se pudo identificar el comercio por dominio.',
        missingUserTenantMessage: 'El usuario autenticado no tiene tenantId válido.',
        mismatchMessage: 'Tenant inconsistente entre usuario autenticado y dominio.',
      }))
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message || 'No se pudo identificar tu comercio. Reintentá el login.',
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
      const status =
        error?.status ||
        error?.statusCode ||
        error?.response?.status ||
        error?.cause?.status

      const rawMessage = String(
        error?.message ||
          error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          '',
      )

      const message = rawMessage.toLowerCase()

      const isGeminiRateLimit =
        status === 429 ||
        message.includes('429') ||
        message.includes('quota') ||
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('resource exhausted')

      const isAuthError =
        status === 401 ||
        status === 403 ||
        message.includes('api key') ||
        message.includes('permission') ||
        message.includes('unauthorized') ||
        message.includes('forbidden')

      const isModelError =
        status === 400 &&
        (
          message.includes('model') ||
          message.includes('not found') ||
          message.includes('invalid argument')
        )

      if (isGeminiRateLimit) {
        return res.status(429).json({
          success: false,
          code: 'AI_RATE_LIMIT',
          message:
            'La IA está saturada o se alcanzó la cuota de Gemini. Intentá nuevamente en 60 segundos o completá los datos manualmente.',
          retryAfter: 60,
        })
      }

      if (isAuthError) {
        return res.status(502).json({
          success: false,
          code: 'AI_AUTH_ERROR',
          message:
            'La IA no está configurada correctamente. Revisá la API Key de Gemini.',
        })
      }

      if (isModelError) {
        return res.status(502).json({
          success: false,
          code: 'AI_MODEL_ERROR',
          message:
            'El modelo de IA configurado no es válido. Revisá GEMINI_MODEL / GOOGLE_IMAGE_MODEL.',
        })
      }

      return res.status(500).json({
        success: false,
        code: 'AI_ANALYSIS_ERROR',
        message: 'Error al analizar la imagen con IA',
      })
    }
  }),
)

const conditionalCsrfProtection = (req, res, next) => next()

router.put('/categories/config', adminContext, upsertCategoryConfig)

router.post(
  '/',
  adminContext,
  uploadPhoto.fields([
    { name: 'images', maxCount: 10 },
    { name: 'variantImages', maxCount: 20 },
  ]),
  productImgResize,
  createProduct,
)

router.put('/:id', adminContext, updateProduct)
router.delete('/:productId', adminContext, deleteProduct)

router.post(
  '/:productId/upload-image',
  adminContext,
  uploadPhoto.array('images', 5),
  productImgResize,
  uploadProductImage,
)

router.delete('/:productId/image', adminContext, deleteProductImage)
router.put('/:productId/variant-image', adminContext, assignVariantImage)

router.put(
  '/:productId/rating/:ratingId/helpful',
  shopContext,
  authMiddleware,
  conditionalCsrfProtection,
  toggleHelpfulVote,
)

router.put('/rating/:productId', shopContext, authMiddleware, rating)

router.get('/categories', tenantReadContext, productPublicReadLimiter, getProductCategories)
router.get('/categories/:category/config', tenantReadContext, productPublicReadLimiter, getCategoryConfig)
router.get('/', tenantReadContext, productPublicReadLimiter, getAllProduct)
router.get('/:productId', tenantReadContext, productPublicReadLimiter, getaProduct)

export default router
