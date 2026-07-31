// 📁 src/routes/productRoute.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / CSRF / ADMIN / STOREFRONT

import express from 'express'
import expressAsyncHandler from 'express-async-handler'

import {
  createProduct,
  getaProduct,
  getAllProduct,
  listDraftProducts,
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
import { buildNormalizedDraftFromAnalysis } from '../services/autonomousProductBuilder.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'
import logger from '../../config/logger.js'

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
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  uploadPhoto.single('images'),
  productImgResize,
  aiVisualLimiter,
  expressAsyncHandler(async (req, res) => {
    const { file } = req
    const tenantId = req.user?.tenantId
    
    if (!file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No se subió imagen' 
      })
    }
    
    try {
      const analysis = await analyzeImage(file.buffer, file.mimetype, tenantId)
      return res.json({ success: true, data: analysis })
    } catch (error) {
      logger.error('[ANALYZE VISUAL ERROR]', {
        message: error.message,
        tenantId,
      })
      return res.status(500).json({
        success: false,
        message: 'Error al analizar la imagen con IA'
      })
    }
  })
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

router.get('/admin/drafts', adminContext, listDraftProducts)

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
