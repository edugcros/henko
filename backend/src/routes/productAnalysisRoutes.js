// 📁 src/routes/productAnalysisRoutes.js
import express from 'express'
import multer from 'multer'
import crypto from 'crypto'

import {
  importImageForAnalysis,
  listAnalysisJobs,
  getAnalysisJobById,
  processDueAnalysisJobs,
  downloadAnalysisJobImage,
  markAnalysisJobImportedToAddProduct,
  completeAddProductJob,
  retryAnalysisJob,
  approveAnalysisJob,
  rejectAnalysisJob,
  deleteAnalysisJob,
  runWishlistPromotionNotifications,
} from '../controller/productAnalysisController.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import { resolveTenantByDomain } from '../middlewares/tenantMiddleware.js'

const router = express.Router()

const timingSafeEqualString = (left = '', right = '') => {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))

  if (leftBuffer.length !== rightBuffer.length) return false

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

const agentOrAdminAuth = (req, res, next) => {
  const configuredAgentKey = process.env.PRODUCT_ANALYSIS_AGENT_KEY
  const requestAgentKey = req.get('x-agent-api-key')

  if (
    configuredAgentKey &&
    requestAgentKey &&
    timingSafeEqualString(requestAgentKey, configuredAgentKey)
  ) {
    req.user = {
      id: null,
      _id: null,
      role: 'agent',
      tenantId: req.tenantId,
    }

    return next()
  }

  return authMiddleware(req, res, error => {
    if (error) return next(error)
    return isAdmin(req, res, next)
  })
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Formato de imagen no permitido'))
    }

    cb(null, true)
  },
})

router.use(resolveTenantByDomain)
router.use(agentOrAdminAuth)

router.post('/import', upload.single('image'), importImageForAnalysis)
router.post('/process-due', processDueAnalysisJobs)
router.post('/wishlist-promotions/run', runWishlistPromotionNotifications)

router.get('/', listAnalysisJobs)
router.get('/:jobId/image-file', downloadAnalysisJobImage)
router.get('/:jobId', getAnalysisJobById)

router.post('/:jobId/import-to-add-product', markAnalysisJobImportedToAddProduct)
router.post('/:jobId/complete-add-product', completeAddProductJob)
router.post('/:jobId/retry', retryAnalysisJob)
router.post('/:jobId/approve', approveAnalysisJob)
router.post('/:jobId/reject', rejectAnalysisJob)

router.delete('/:jobId', deleteAnalysisJob)

export default router
