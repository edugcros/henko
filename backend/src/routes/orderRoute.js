// 📁 src/routes/orderRoute.js
// VERSIÓN PRODUCCIÓN / PREDEPLOY SAFE - MULTI-TENANT / ADMIN + STOREFRONT

import express from 'express'
import expressAsyncHandler from 'express-async-handler'

import {
  createOrder,
  resendConfirmationEmail,
  getOrders,
  getOrderById,
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
  requireAdminDomain,
  requireTenant,
  resolveTenantByDomain,
  requireShopDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()
const ADMIN_ORDER_ROLES = ['admin', 'moderator', 'manager', 'owner', 'superadmin']

// =========================================================
// HELPERS
// =========================================================

const isAdminOrManager = expressAsyncHandler(async (req, res, next) => {
  const role = req.user?.role

  if (ADMIN_ORDER_ROLES.includes(role)) {
    return next()
  }

  return res.status(403).json({
    success: false,
    message: 'Permisos insuficientes',
  })
})

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

router.get(
  '/my-orders/:orderId',
  resolveTenantByDomain,
  requireShopDomain,
  authMiddleware,
  getOrderById,
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
  requireTenant,
  requireAdminDomain,
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
  requireTenant,
  requireAdminDomain,
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
  requireTenant,
  requireAdminDomain,
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
  requireTenant,
  requireAdminDomain,
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
  requireTenant,
  requireAdminDomain,
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
  requireTenant,
  requireAdminDomain,
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
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdminOrManager,
  orderWriteLimiter,
  deleteOrder,
)

export default router
