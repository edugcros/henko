import express from 'express'
import { getDashboardData } from '../controller/dashboardCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

// Ruta para enviar correos manualmente
router.get('/stats', authMiddleware, isAdmin, getDashboardData)
router.get('/analytics', authMiddleware, isAdmin, getDashboardData)
router.get('/analytics/dashboard', authMiddleware, isAdmin, getDashboardData)

export default router
