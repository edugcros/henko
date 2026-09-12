import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { SharedRateLimitStore } from '../middlewares/sharedRateLimitStore.js'
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
  // Compartido entre instancias: con el almacén por defecto, que vive en la
  // memoria del proceso, este techo se multiplica por la cantidad de procesos.
  store: new SharedRateLimitStore('enquiry'),
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: req =>
    `${req.tenantId || 'no-tenant'}:${ipKeyGenerator(req.ip)}`,

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
