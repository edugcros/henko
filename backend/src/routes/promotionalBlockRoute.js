// 📁 src/routes/promotionalBlockRoute.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / SHOP DOMAIN / ADMIN DOMAIN / CSRF

import express from 'express'

import {
  createPromotionalBlock,
  deletePromotionalBlock,
  getAdminPromotionalBlockById,
  getAdminPromotionalBlocks,
  getPublicPromotionalBlockBySlug,
  getPublicPromotionalBlocks,
  togglePromotionalBlockStatus,
  updatePromotionalBlock,
} from '../controller/promotionalBlockCtrl.js'

import {
  createPromotionalBlockValidator,
  getPromotionalBlocksValidator,
  promotionalBlockIdValidator,
  togglePromotionalBlockStatusValidator,
  updatePromotionalBlockValidator,
} from '../validators/promotionalBlockValidator.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import {
  requireAdminDomain,
  requireTenant,
  requireShopDomain,
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

// =====================================================
// PUBLIC STOREFRONT ROUTES
// =====================================================

/**
 * Alias legacy para compatibilidad con frontend existente.
 * GET /api/promotional-blocks/store
 */
router.get(
  '/store',
  resolveTenantByDomain,
  requireShopDomain,
  getPublicPromotionalBlocks,
)

/**
 * Alias legacy para compatibilidad con frontend existente.
 * GET /api/promotional-blocks/store/:slug
 */
router.get(
  '/store/:slug',
  resolveTenantByDomain,
  requireShopDomain,
  getPublicPromotionalBlockBySlug,
)

/**
 * Contrato público recomendado.
 * GET /api/promotional-blocks/public
 */
router.get(
  '/public',
  resolveTenantByDomain,
  requireShopDomain,
  getPublicPromotionalBlocks,
)

/**
 * Contrato público recomendado.
 * GET /api/promotional-blocks/public/:slug
 */
router.get(
  '/public/:slug',
  resolveTenantByDomain,
  requireShopDomain,
  getPublicPromotionalBlockBySlug,
)

// =====================================================
// ADMIN ROUTES
// =====================================================

/**
 * Listar bloques promocionales para admin.
 * GET /api/promotional-blocks
 */
router.get(
  '/',
  adminContext,
  getPromotionalBlocksValidator,
  getAdminPromotionalBlocks,
)

/**
 * Crear bloque promocional.
 * POST /api/promotional-blocks
 */
router.post(
  '/',
  adminContext,
  createPromotionalBlockValidator,
  createPromotionalBlock,
)

/**
 * Cambiar estado activo/inactivo.
 * PATCH /api/promotional-blocks/:id/status
 *
 * Importante:
 * Esta ruta debe ir antes de GET /:id, PUT /:id y DELETE /:id.
 */
router.patch(
  '/:id/status',
  adminContext,
  togglePromotionalBlockStatusValidator,
  togglePromotionalBlockStatus,
)

/**
 * Obtener bloque promocional por ID para admin.
 * GET /api/promotional-blocks/:id
 */
router.get(
  '/:id',
  adminContext,
  promotionalBlockIdValidator,
  getAdminPromotionalBlockById,
)

/**
 * Actualizar bloque promocional.
 * PUT /api/promotional-blocks/:id
 */
router.put(
  '/:id',
  adminContext,
  promotionalBlockIdValidator,
  updatePromotionalBlockValidator,
  updatePromotionalBlock,
)

/**
 * Eliminar bloque promocional.
 * DELETE /api/promotional-blocks/:id
 */
router.delete(
  '/:id',
  adminContext,
  promotionalBlockIdValidator,
  deletePromotionalBlock,
)

export default router
