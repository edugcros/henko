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

router.post('/', adminContext, createColor)
router.put('/:id', adminContext, updateColor)
router.delete('/:id', adminContext, deleteColor)
router.get('/:id', getColorById)
router.get('/', getAllColors)

export default router
