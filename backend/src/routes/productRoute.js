// 📁 src/routes/productRoute.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / CSRF / ADMIN / STOREFRONT

import express from 'express'

import {
  createProduct,
  getaProduct,
  getAllProduct,
  listAdminProducts,
  listDraftProducts,
  bulkPublishDrafts,
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
  uploadProductVideo,
  deleteProductVideo,
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
import { uploadPhoto, productImgResize, uploadVideo } from '../middlewares/uploadImage.js'
import { requireAiEntitlement } from '../middlewares/aiEntitlementMiddleware.js'
import { AI_METRICS } from '../services/ai/aiPlanPolicy.js'
import { analyzeVisualProduct } from '../controller/productAnalysisController.js'
import { generateProductSocialContent } from '../controller/socialPromotionCtrl.js'

const router = express.Router()

const adminContext = [
  resolveTenantByDomain,
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdmin,
]

const shopContext = [resolveTenantByDomain, requireTenant, requireShopDomain]

const tenantReadContext = [resolveTenantByDomain, requireTenant]

const aiVisualLimiter = rateLimiter

router.post(
  '/analyze-visual',
  adminContext,
  // Antes de subir y redimensionar la imagen: si el comercio ya no tiene
  // cupo, procesar el archivo es trabajo (y memoria) tirados a la basura.
  requireAiEntitlement(AI_METRICS.VISION),
  uploadPhoto.single('images'),
  productImgResize,
  aiVisualLimiter,
  analyzeVisualProduct,
)

const conditionalCsrfProtection = (req, res, next) => {
  // TODO: Re-enable CSRF after Redis issues resolved
  next()
}

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

router.get('/admin/list', adminContext, listAdminProducts)
router.get('/admin/drafts', adminContext, listDraftProducts)
router.put('/admin/drafts/bulk-publish', adminContext, bulkPublishDrafts)

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

// Kit de contenido para redes (caption + hashtags generados por IA). Mismo
// costo que un mensaje del agente — gate temprano acá, cobro atómico en el
// controller (ver services/ai/socialCaptionService.js).
router.post(
  '/:id/social-caption',
  adminContext,
  requireAiEntitlement(AI_METRICS.AGENT_MESSAGES),
  generateProductSocialContent,
)

router.post(
  '/:productId/upload-video',
  adminContext,
  uploadVideo.single('video'),
  uploadProductVideo,
)

router.delete('/:productId/video', adminContext, deleteProductVideo)

router.put(
  '/:productId/rating/:ratingId/helpful',
  shopContext,
  authMiddleware,
  conditionalCsrfProtection,
  toggleHelpfulVote,
)

router.put('/rating/:productId', shopContext, authMiddleware, rating)

router.get('/categories', tenantReadContext, productPublicReadLimiter, getProductCategories)
router.get(
  '/categories/:category/config',
  tenantReadContext,
  productPublicReadLimiter,
  getCategoryConfig,
)
router.get('/', tenantReadContext, productPublicReadLimiter, getAllProduct)
router.get('/:productId', tenantReadContext, productPublicReadLimiter, getaProduct)

export default router
