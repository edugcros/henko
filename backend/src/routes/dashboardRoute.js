import express from 'express'
import { getDashboardData } from '../controller/dashboardCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import {
  requireAdminDomain,
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

// Ruta para enviar correos manualmente
const adminContext = [
  resolveTenantByDomain,
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdmin,
]

router.get('/stats', adminContext, getDashboardData)
router.get('/analytics', adminContext, getDashboardData)
router.get('/analytics/dashboard', adminContext, getDashboardData)

export default router
