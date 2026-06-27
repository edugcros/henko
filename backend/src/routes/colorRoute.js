import express from 'express'
import {
  createColor,
  updateColor,
  deleteColor,
  getColorById,
  getAllColors,
} from '../controller/colorCtrl.js'

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
const publicContext = [
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
]

router.post('/', adminContext, createColor)
router.put('/:id', adminContext, updateColor)
router.delete('/:id', adminContext, deleteColor)
router.get('/:id', publicContext, getColorById)
router.get('/', publicContext, getAllColors)

export default router
