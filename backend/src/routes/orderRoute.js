// 📁 src/routes/orderRoute.js
// VERSIÓN PRODUCCIÓN / PREDEPLOY SAFE - MULTI-TENANT / ADMIN + STOREFRONT

import express from 'express'
import expressAsyncHandler from 'express-async-handler'

import {
  createOrder,
  resendConfirmationEmail,
  getOrders,
  getAllOrders,
  updateOrderStatus,
  updateOrderPaymentStatus,
  updateOrderFulfillmentStatus,
  cancelOrder,
  refundOrder,
  deleteOrder,
  orderWriteLimiter,
} from '../controller/orderCtrl.js'

import { authMiddleware } from '../middlewares/authMiddleware.js'
import {
  resolveTenantByDomain,
  requireShopDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

// =========================================================
// HELPERS
// =========================================================

const isAdminOrManager = expressAsyncHandler(async (req, res, next) => {
  const role = req.user?.role

  if (['admin', 'manager', 'owner', 'superadmin'].includes(role)) {
    return next()
  }

  return res.status(403).json({
    success: false,
    message: 'Permisos insuficientes',
  })
})

// =========================================================
// CSRF CONDICIONAL PARA PREDEPLOY / TÚNEL
// =========================================================

const normalizePath = value => {
  const normalized = String(value || '').replace(/\/+$/, '')
  return normalized || '/'
}

const isTrustedPredeployOrigin = req => {
  const origin = String(req.headers.origin || '').toLowerCase()

  return [
    'https://henko-web.vercel.app',
    'https://henko-admin.vercel.app',
  ].includes(origin)
}

const routePatternToRegex = pattern => {
  const normalized = normalizePath(pattern)

  const escaped = normalized
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\:([^/]+)/g, '[^/]+')

  return new RegExp(`^${escaped}$`)
}

const predeployCsrfExemptRoutes = [
  // Storefront checkout durante túnel
  { method: 'POST', path: '/create' },
  { method: 'POST', path: '/:orderId/resend-email' },

  // Admin order mutations durante túnel
  { method: 'PUT', path: '/:id/status' },
  { method: 'PUT', path: '/:id/payment-status' },
  { method: 'PUT', path: '/:id/fulfillment-status' },
  { method: 'POST', path: '/:id/cancel' },
  { method: 'POST', path: '/:id/refund' },
  { method: 'DELETE', path: '/:id' },
]

const matchesPredeployExemptRoute = req => {
  const requestPath = normalizePath(req.path)

  return predeployCsrfExemptRoutes.some(route => {
    return (
      route.method === req.method &&
      routePatternToRegex(route.path).test(requestPath)
    )
  })
}

const shouldSkipCsrfForPredeploy = req => {
  return (
    process.env.PREDEPLOY_TUNNEL_MODE === 'true' &&
    isTrustedPredeployOrigin(req) &&
    matchesPredeployExemptRoute(req)
  )
}

// =========================================================
// CLIENTE / USUARIO AUTENTICADO - STOREFRONT
// =========================================================

/**
 * Crear orden
 * POST /api/order/create
 *
 * Solo storefront.
 */
router.post(
  '/create',
  resolveTenantByDomain,
  requireShopDomain,
  authMiddleware,
  orderWriteLimiter,
  createOrder,
)

/**
 * Obtener mis órdenes
 * GET /api/order/my-orders
 *
 * Solo storefront.
 */
router.get(
  '/my-orders',
  resolveTenantByDomain,
  requireShopDomain,
  authMiddleware,
  getOrders,
)

/**
 * Reenviar email de confirmación
 * POST /api/order/:orderId/resend-email
 *
 * Solo storefront.
 */
router.post(
  '/:orderId/resend-email',
  resolveTenantByDomain,
  requireShopDomain,
  authMiddleware,
  orderWriteLimiter,
  resendConfirmationEmail,
)

// =========================================================
// ADMIN / MANAGER - ADMIN DOMAIN
// =========================================================

/**
 * Obtener todas las órdenes del tenant
 * GET /api/order/getAll
 */
router.get(
  '/getAll',
  resolveTenantByDomain,
  authMiddleware,
  isAdminOrManager,
  getAllOrders,
)

/**
 * Legacy: actualizar estado agregado
 * PUT /api/order/:id/status
 */
router.put(
  '/:id/status',
  resolveTenantByDomain,
  authMiddleware,
  isAdminOrManager,
  orderWriteLimiter,
  updateOrderStatus,
)

/**
 * Actualizar estado de pago
 * PUT /api/order/:id/payment-status
 */
router.put(
  '/:id/payment-status',
  resolveTenantByDomain,
  authMiddleware,
  isAdminOrManager,
  orderWriteLimiter,
  updateOrderPaymentStatus,
)

/**
 * Actualizar estado logístico
 * PUT /api/order/:id/fulfillment-status
 */
router.put(
  '/:id/fulfillment-status',
  resolveTenantByDomain,
  authMiddleware,
  isAdminOrManager,
  orderWriteLimiter,
  updateOrderFulfillmentStatus,
)

/**
 * Cancelar orden
 * POST /api/order/:id/cancel
 */
router.post(
  '/:id/cancel',
  resolveTenantByDomain,
  authMiddleware,
  isAdminOrManager,
  orderWriteLimiter,
  cancelOrder,
)

/**
 * Reembolsar orden
 * POST /api/order/:id/refund
 */
router.post(
  '/:id/refund',
  resolveTenantByDomain,
  authMiddleware,
  isAdminOrManager,
  orderWriteLimiter,
  refundOrder,
)

/**
 * Eliminar orden lógicamente
 * DELETE /api/order/:id
 *
 * Solo admin/manager.
 * No usa requireShopDomain porque debe funcionar desde admin.
 */
router.delete(
  '/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdminOrManager,
  orderWriteLimiter,
  deleteOrder,
)

export default router