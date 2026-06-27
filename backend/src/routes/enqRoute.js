import express from 'express'
import rateLimit from 'express-rate-limit'
import {
  createEnquiry,
  updateEnquiryStatus,
  deleteEnquiry,
  getEnquiryById,
  getAllEnquiries,
  replyEnquiry,
} from '../controller/enqCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import {
  requireAdminDomain,
  requireShopDomain,
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()
const publicEnquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `${req.tenantId || 'no-tenant'}:${req.ip}`,
  message: {
    success: false,
    message: 'Demasiadas consultas. Intentá nuevamente en unos minutos.',
  },
})

const adminContext = [
  resolveTenantByDomain,
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdmin,
]

router.post(
  '/reply/:id',
  adminContext,
  replyEnquiry,
)
router.post(
  '/',
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
  publicEnquiryLimiter,
  createEnquiry,
)
router.get('/get', adminContext, getAllEnquiries)
router.get('/:id', adminContext, getEnquiryById)
router.put('/:id', adminContext, updateEnquiryStatus)
router.delete('/:id', adminContext, deleteEnquiry)

export default router
