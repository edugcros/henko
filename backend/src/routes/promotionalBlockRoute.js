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
  requireShopDomain,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

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
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  getPromotionalBlocksValidator,
  getAdminPromotionalBlocks,
)

/**
 * Crear bloque promocional.
 * POST /api/promotional-blocks
 */
router.post(
  '/',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
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
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  togglePromotionalBlockStatusValidator,
  togglePromotionalBlockStatus,
)

/**
 * Obtener bloque promocional por ID para admin.
 * GET /api/promotional-blocks/:id
 */
router.get(
  '/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  promotionalBlockIdValidator,
  getAdminPromotionalBlockById,
)

/**
 * Actualizar bloque promocional.
 * PUT /api/promotional-blocks/:id
 */
router.put(
  '/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
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
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  promotionalBlockIdValidator,
  deletePromotionalBlock,
)

export default router