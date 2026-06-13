// src/routes/index.js - VERSIÓN PRODUCCIÓN
import express from 'express'

// Importaciones de rutas
import userRoute from './userRoute.js'
import productRouter from './productRoute.js'
import colorRouter from './colorRoute.js'
import enqRouter from './enqRoute.js'
import couponRouter from './couponRoute.js'
import orderRoute from './orderRoute.js'
import themeConfigRoute from './themeConfigRoute.js'
import paymentRoutes from './paymentRoutes.js'
import dashboardRoute from './dashboardRoute.js'
import tenantRoutes from './tenantRoutes.js'
import promotionalBlockRoute from './promotionalBlockRoute.js'
import productAnalysisRoutes from './productAnalysisRoutes.js'
import userMetricsRoutes from './userMetricsRoutes.js'
import aiAgentRoutes from './aiAgentRoutes.js'
import whatsappRoutes from './whatsappRoutes.js'
import aiWebchatRoutes from './aiWebchatRoutes.js'
import aiLeadAdminRoutes from './aiLeadAdminRoutes.js'


const router = express.Router()

// =======================================================
// 🔐 AUTENTICACIÓN Y USUARIOS
// =======================================================
router.use('/user', userRoute)
router.use('/dash', dashboardRoute)

// =======================================================
// 🛍️ CATÁLOGO DE PRODUCTOS
// =======================================================
router.use('/product', productRouter)

router.use('/color', colorRouter)
router.use('/coupons', couponRouter)
router.use('/ai-webchat', aiWebchatRoutes)

//AGENTE
router.use('/product-analysis', productAnalysisRoutes)
router.use('/metrics', userMetricsRoutes)
router.use('/ai-agent', aiAgentRoutes)
router.use('/ai-agent', aiLeadAdminRoutes)
router.use('/whatsapp', whatsappRoutes)

// =======================================================
// 🎨 TEMAS Y CONFIGURACIÓN VISUAL
// =======================================================
// /api/theme/* y /api/themes/* (alias para compatibilidad)
router.use('/theme', themeConfigRoute)

// =======================================================
// 🏢 TENANTS (Multi-tenant management)
// =======================================================
router.use('/tenants', tenantRoutes)

// =======================================================
// 💳 PAGOS Y TRANSACCIONES
// =======================================================
router.use('/payments', paymentRoutes)


router.use('/promotional-blocks', promotionalBlockRoute) 
// =======================================================
// 📬 COMUNICACIÓN
// =======================================================
router.use('/enquiry', enqRouter)

// =======================================================
// 📦 ÓRDENES Y PEDIDOS
// =======================================================
router.use('/order', orderRoute)

export default router
