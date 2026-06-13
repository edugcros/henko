import express from 'express'
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
  createEnquiry,
)
router.get('/get', adminContext, getAllEnquiries)
router.get('/:id', adminContext, getEnquiryById)
router.put('/:id', adminContext, updateEnquiryStatus)
router.delete('/:id', adminContext, deleteEnquiry)

export default router
