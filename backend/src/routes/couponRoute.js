// 📁 src/routes/couponRoute.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / CSRF / ADMIN + STOREFRONT SAFE

import express from 'express'

import {
  createCoupon,
  getCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  applyCouponToOrder,
  assignProductsToCoupon,
  generateBulkCoupons,
  cloneCoupon,
  getCouponsByProduct,
  permanentDeleteCoupon,
  getDeletedCoupons,
  restoreCoupon,
} from '../controller/couponCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import {
  requireAdminDomain,
  requireTenant,
  resolveTenantByDomain,
  requireShopDomain,
} from '../middlewares/tenantMiddleware.js'

import { validateCouponCreation } from '../middlewares/validation.js'

const router = express.Router()
const adminContext = [
  resolveTenantByDomain,
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdmin,
]

// =====================================================
// STOREFRONT / CUSTOMER
// =====================================================

/**
 * Validar un cupón contra el carrito actual del usuario.
 * POST /api/coupon/validate
 *
 * Solo storefront:
 * - henko.local
 * - tienda.com
 *
 * No disponible desde:
 * - admin.henko.local
 */
router.post(
  '/validate',
  resolveTenantByDomain,
  requireShopDomain,
  authMiddleware,
  
  validateCoupon,
)

/**
 * Nombre legacy conservado por compatibilidad:
 * ahora aplica cupón al carrito actual, no a una orden.
 * POST /api/coupon/apply
 *
 * Solo storefront.
 */
router.post(
  '/apply',
  resolveTenantByDomain,
  requireShopDomain,
  authMiddleware,
  
  applyCouponToOrder,
)

/**
 * Cupones visibles que aplican a un producto.
 * GET /api/coupon/by-product/:productId
 *
 * Público/storefront.
 */
router.get(
  '/by-product/:productId',
  resolveTenantByDomain,
  requireShopDomain,
  getCouponsByProduct,
)

// =====================================================
// ADMINISTRACIÓN
// =====================================================

/**
 * Crear cupón.
 * POST /api/coupon
 */
router.post(
  '/',
  adminContext,
  
  validateCouponCreation,
  createCoupon,
)

/**
 * Generar cupones masivos.
 * POST /api/coupon/bulk
 */
router.post(
  '/bulk',
  adminContext,
  
  generateBulkCoupons,
)

/**
 * Listar cupones activos/no eliminados.
 * GET /api/coupon
 */
router.get(
  '/',
  adminContext,
  getCoupons,
)

/**
 * Listar cupones eliminados lógicamente.
 * GET /api/coupon/deleted
 */
router.get(
  '/deleted',
  adminContext,
  getDeletedCoupons,
)

/**
 * Eliminar permanentemente un cupón.
 * DELETE /api/coupon/:id/permanent
 */
router.delete(
  '/:id/permanent',
  adminContext,
  
  permanentDeleteCoupon,
)

/**
 * Restaurar cupón eliminado.
 * PATCH /api/coupon/:id/restore
 */
router.patch(
  '/:id/restore',
  adminContext,
  
  restoreCoupon,
)

/**
 * Clonar cupón.
 * POST /api/coupon/:id/clone
 */
router.post(
  '/:id/clone',
  adminContext,
  
  cloneCoupon,
)

/**
 * Asignar productos a un cupón.
 * PUT /api/coupon/:couponId/products
 */
router.put(
  '/:couponId/products',
  adminContext,
  
  assignProductsToCoupon,
)

/**
 * Obtener cupón por ID.
 * GET /api/coupon/:id
 */
router.get(
  '/:id',
  adminContext,
  getCouponById,
)

/**
 * Actualizar cupón.
 * PUT /api/coupon/:id
 */
router.put(
  '/:id',
  adminContext,
  
  updateCoupon,
)

/**
 * Eliminar cupón lógicamente.
 * DELETE /api/coupon/:id
 */
router.delete(
  '/:id',
  adminContext,
  
  deleteCoupon,
)

export default router
