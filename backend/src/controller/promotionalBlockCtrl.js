// 📁 src/controller/promotionalBlockCtrl.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / SOFT DELETE / STOREFRONT / ADMIN

import expressAsyncHandler from 'express-async-handler'
import { validationResult } from 'express-validator'

import PromotionalBlock from '../models/promotionalBlockModel.js'
import {
  buildSlugFromTitle,
  normalizePromotionalProducts,
  normalizeSlug,
} from '../utils/promotionalBlockUtils.js'
import {
  findAdminBlocks,
  findPublicBlockBySlug,
  findPublicBlocks,
  validateProductsBelongToTenant,
} from '../services/promotionalBlockService.js'
import {
  getUserIdFromRequest,
  resolveTenantFromRequest,
} from '../utils/requestContext.js'
import { notifyWishlistPromotions } from '../services/wishlistPromotionNotifierService.js'
import logger from '../../config/logger.js'

// =====================================================
// HELPERS
// =====================================================

const getUserId = getUserIdFromRequest

const sendValidationErrors = (req, res) => {
  const errors = validationResult(req)

  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: 'Errores de validación.',
      errors: errors.array(),
    })

    return true
  }

  return false
}

const resolveTenantContext = req =>
  resolveTenantFromRequest(req, {
    missingTenantMessage: 'Tenant no resuelto.',
    mismatchMessage: 'El usuario no pertenece al tenant resuelto por el dominio.',
    includeObjectId: false,
  })

const populateBlock = ({ blockId, tenantId }) => {
  return PromotionalBlock.findOne({
    _id: blockId,
    tenantId,
    isDeleted: false,
  })
    .setOptions({ tenantId })
    .populate({
      path: 'products.productId',
      match: {
        tenantId,
        isDeleted: { $ne: true },
      },
      select:
        'title slug price compareAtPrice currency images categoria subcategoria status visibility stock tenantId hasVariants variants',
    })
}

const normalizeBlockSlug = ({ slug, title }) => {
  const normalized = slug ? normalizeSlug(slug) : buildSlugFromTitle(title)
  return normalized.slice(0, 140)
}

const scheduleWishlistPromotionNotifications = ({ tenantId, blockId, reason }) => {
  logger.info('[PromotionalBlock] Programando avisos wishlist', {
    tenantId: String(tenantId),
    blockId: blockId ? String(blockId) : null,
    reason,
  })

  setTimeout(async () => {
    try {
      logger.info('[PromotionalBlock] Ejecutando avisos wishlist', {
        tenantId: String(tenantId),
        blockId: blockId ? String(blockId) : null,
        reason,
      })

      const result = await notifyWishlistPromotions({
        tenantId,
        promotionBlockId: blockId,
        dryRun: false,
        limit: 500,
      })

      logger.info('[PromotionalBlock] Avisos wishlist procesados', {
        tenantId: String(tenantId),
        blockId: blockId ? String(blockId) : null,
        reason,
        scannedPromotions: result.scannedPromotions,
        matchedUsers: result.matchedUsers,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        items: result.items,
      })
    } catch (error) {
      logger.error('[PromotionalBlock] Error procesando avisos wishlist', {
        tenantId: String(tenantId),
        blockId: blockId ? String(blockId) : null,
        reason,
        error: error.stack || error.message,
      })
    }
  }, 0)
}

// =====================================================
// ADMIN: CREATE
// =====================================================

export const createPromotionalBlock = expressAsyncHandler(async (req, res) => {
  if (sendValidationErrors(req, res)) return

  const tenantId = resolveTenantContext(req)
  const products = normalizePromotionalProducts(req.body.products)

  await validateProductsBelongToTenant({ tenantId, products })

  const title = String(req.body.title || '').trim()
  const slug = normalizeBlockSlug({
    slug: req.body.slug,
    title,
  })

  const existing = await PromotionalBlock.findOne({
    tenantId,
    slug,
    isDeleted: false,
  })
    .setOptions({ tenantId })
    .select('_id')
    .lean()

  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'Ya existe un bloque promocional con ese slug para este comercio.',
    })
  }

  const block = await PromotionalBlock.create({
    tenantId,
    title,
    slug,
    type: req.body.type || 'custom',
    placement: req.body.placement || 'home',
    description: req.body.description || '',
    products,
    maxItems: req.body.maxItems || 5,
    priority: req.body.priority || 1,
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    isActive: req.body.isActive !== false,
    visibility: req.body.visibility || 'public',
    createdBy: getUserId(req),
    updatedBy: getUserId(req),
  })

  const populated = await populateBlock({
    blockId: block._id,
    tenantId,
  })

  scheduleWishlistPromotionNotifications({
    tenantId,
    blockId: block._id,
    reason: 'promotion_created',
  })

  return res.status(201).json({
    success: true,
    message: 'Bloque promocional creado correctamente.',
    data: populated,
  })
})

// =====================================================
// ADMIN: LIST
// =====================================================

export const getAdminPromotionalBlocks = expressAsyncHandler(async (req, res) => {
  if (sendValidationErrors(req, res)) return

  const tenantId = resolveTenantContext(req)

  const result = await findAdminBlocks({
    tenantId,
    page: req.query.page,
    limit: req.query.limit,
    placement: req.query.placement,
    type: req.query.type,
    q: req.query.q,
    includeHidden: true,
    includeDeleted: false,
  })

  return res.status(200).json({
    success: true,
    ...result,
  })
})

// =====================================================
// ADMIN: GET BY ID
// =====================================================

export const getAdminPromotionalBlockById = expressAsyncHandler(async (req, res) => {
  if (sendValidationErrors(req, res)) return

  const tenantId = resolveTenantContext(req)

  const block = await populateBlock({
    blockId: req.params.id,
    tenantId,
  })

  if (!block) {
    return res.status(404).json({
      success: false,
      message: 'Bloque promocional no encontrado.',
    })
  }

  return res.status(200).json({
    success: true,
    data: block,
  })
})

// =====================================================
// ADMIN: UPDATE
// =====================================================

export const updatePromotionalBlock = expressAsyncHandler(async (req, res) => {
  if (sendValidationErrors(req, res)) return

  const tenantId = resolveTenantContext(req)

  const block = await PromotionalBlock.findOne({
    _id: req.params.id,
    tenantId,
    isDeleted: false,
  }).setOptions({ tenantId })

  if (!block) {
    return res.status(404).json({
      success: false,
      message: 'Bloque promocional no encontrado.',
    })
  }

  const products = Array.isArray(req.body.products)
    ? normalizePromotionalProducts(req.body.products)
    : block.products

  await validateProductsBelongToTenant({ tenantId, products })

  const nextTitle = req.body.title !== undefined
    ? String(req.body.title || '').trim()
    : block.title

  const nextSlug = req.body.slug || req.body.title
    ? normalizeBlockSlug({
      slug: req.body.slug,
      title: nextTitle,
    })
    : block.slug

  const duplicate = await PromotionalBlock.findOne({
    _id: { $ne: block._id },
    tenantId,
    slug: nextSlug,
    isDeleted: false,
  })
    .setOptions({ tenantId })
    .select('_id')
    .lean()

  if (duplicate) {
    return res.status(409).json({
      success: false,
      message: 'Ya existe otro bloque promocional con ese slug.',
    })
  }

  block.title = nextTitle
  block.slug = nextSlug
  block.type = req.body.type ?? block.type
  block.placement = req.body.placement ?? block.placement
  block.description = req.body.description ?? block.description
  block.products = products
  block.maxItems = req.body.maxItems ?? block.maxItems
  block.priority = req.body.priority ?? block.priority
  block.startDate = req.body.startDate ?? block.startDate
  block.endDate = req.body.endDate ?? block.endDate
  block.isActive = req.body.isActive ?? block.isActive
  block.visibility = req.body.visibility ?? block.visibility
  block.updatedBy = getUserId(req)

  await block.save()

  const populated = await populateBlock({
    blockId: block._id,
    tenantId,
  })

  scheduleWishlistPromotionNotifications({
    tenantId,
    blockId: block._id,
    reason: 'promotion_updated',
  })

  return res.status(200).json({
    success: true,
    message: 'Bloque promocional actualizado correctamente.',
    data: populated,
  })
})

// =====================================================
// ADMIN: TOGGLE STATUS
// =====================================================

export const togglePromotionalBlockStatus = expressAsyncHandler(async (req, res) => {
  if (sendValidationErrors(req, res)) return

  const tenantId = resolveTenantContext(req)

  const block = await PromotionalBlock.findOne({
    _id: req.params.id,
    tenantId,
    isDeleted: false,
  }).setOptions({ tenantId })

  if (!block) {
    return res.status(404).json({
      success: false,
      message: 'Bloque promocional no encontrado.',
    })
  }

  block.isActive = req.body.isActive
  block.updatedBy = getUserId(req)

  await block.save()

  const populated = await populateBlock({
    blockId: block._id,
    tenantId,
  })

  if (block.isActive) {
    scheduleWishlistPromotionNotifications({
      tenantId,
      blockId: block._id,
      reason: 'promotion_activated',
    })
  }

  return res.status(200).json({
    success: true,
    message: 'Estado actualizado correctamente.',
    data: populated,
  })
})


// =====================================================
// ADMIN: DELETE
// Soft delete por defecto.
// Hard delete físico con ?hard=true
// =====================================================

export const deletePromotionalBlock = expressAsyncHandler(async (req, res) => {
  if (sendValidationErrors(req, res)) return

  const tenantId = resolveTenantContext(req)
  const userId = getUserId(req)

  const hardDelete =
    String(req.query.hard || '').trim().toLowerCase() === 'true'

  const block = await PromotionalBlock.findOne({
    _id: req.params.id,
    tenantId,
    ...(hardDelete ? {} : { isDeleted: false }),
  }).setOptions({ tenantId })

  if (!block) {
    return res.status(404).json({
      success: false,
      message: 'Bloque promocional no encontrado o ya eliminado.',
    })
  }

  if (hardDelete) {
    const result = await PromotionalBlock.deleteOne({
      _id: block._id,
      tenantId,
    }).setOptions({ tenantId })

    logger.warn('[PromotionalBlock] Bloque eliminado físicamente', {
      tenantId: String(tenantId),
      blockId: String(block._id),
      deletedBy: userId ? String(userId) : null,
      deletedCount: result.deletedCount,
    })

    return res.status(200).json({
      success: true,
      message: 'Bloque promocional eliminado definitivamente.',
      data: {
        id: String(block._id),
        hardDeleted: true,
        deletedCount: result.deletedCount,
      },
    })
  }

  if (typeof block.softDelete === 'function') {
    await block.softDelete({ userId })
  } else {
    block.isDeleted = true
    block.isActive = false
    block.visibility = 'hidden'
    block.deletedAt = new Date()
    block.deletedBy = userId || null
    block.updatedBy = userId || null
    await block.save()
  }

  logger.info('[PromotionalBlock] Bloque eliminado por soft delete', {
    tenantId: String(tenantId),
    blockId: String(block._id),
    deletedBy: userId ? String(userId) : null,
  })

  return res.status(200).json({
    success: true,
    message: 'Bloque promocional eliminado correctamente.',
    data: {
      id: String(block._id),
      hardDeleted: false,
      isDeleted: true,
    },
  })
})

// =====================================================
// STOREFRONT: LIST
// =====================================================

export const getPublicPromotionalBlocks = expressAsyncHandler(async (req, res) => {
  const tenantId = resolveTenantContext(req)

  const blocks = await findPublicBlocks({
    tenantId,
    placement: req.query.placement || 'home',
    type: req.query.type,
  })

  return res.status(200).json({
    success: true,
    data: blocks,
  })
})

// =====================================================
// STOREFRONT: GET BY SLUG
// =====================================================

export const getPublicPromotionalBlockBySlug = expressAsyncHandler(async (req, res) => {
  const tenantId = resolveTenantContext(req)
  const slug = normalizeSlug(req.params.slug)

  const block = await findPublicBlockBySlug({
    tenantId,
    slug,
  })

  if (!block) {
    return res.status(404).json({
      success: false,
      message: 'Bloque promocional no encontrado.',
    })
  }

  return res.status(200).json({
    success: true,
    data: block,
  })
})
