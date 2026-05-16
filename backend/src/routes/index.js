// src/routes/index.js - VERSIÓN PRODUCCIÓN
import express from 'express'

// Importaciones de rutas
import userRoute from './userRoute.js'
import productRouter from './productRoute.js'
import brandRouter from './brandRoute.js'
import colorRouter from './colorRoute.js'
import enqRouter from './enqRoute.js'
import emailRoutes from './emailRoute.js'
import couponRouter from './couponRoute.js'
import orderRoute from './orderRoute.js'
import uploadRoutes from './uploadRoute.js'
import themeConfigRoute from './themeConfigRoute.js'
import paymentRoutes from './paymentRoutes.js'
import dashboardRoute from './dashboardRoute.js'
import tenantRoutes from './tenantRoutes.js'
import promotionalBlockRoute from './promotionalBlockRoute.js'

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
router.use('/imgup', uploadRoutes)

router.use('/brand', brandRouter)
router.use('/color', colorRouter)
router.use('/coupons', couponRouter)

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
router.use('/email', emailRoutes)

// =======================================================
// 📦 ÓRDENES Y PEDIDOS
// =======================================================
router.use('/order', orderRoute)

export default router