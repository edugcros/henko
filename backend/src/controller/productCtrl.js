// 📁 src/controller/productController.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / VARIANTES / IMÁGENES / RATINGS

import Product from '../models/productModel.js'
import User from '../models/userModel.js'

import expressAsyncHandler from 'express-async-handler'
import rateLimit from 'express-rate-limit'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'

import { cloudinaryUploadImg } from '../utils/cloudinary.js'
import { validateMongoDbIdMiddleware } from '../utils/validation.js'
import { generateUniqueSlug } from '../utils/slugService.js'
import { registerVisualFeedback } from '../services/aiLearningService.js'

import logger from '../../config/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '../../')

// =====================================================
// CONSTANTES
// =====================================================

const ALLOWED_PRODUCT_STATUSES = ['active', 'draft', 'archived', 'out-of-stock']
const ALLOWED_PRODUCT_VISIBILITIES = ['visible', 'hidden']
const ALLOWED_PRODUCT_CONDITIONS = ['nuevo', 'usado', 'reacondicionado']
const ALLOWED_VARIANT_ATTRIBUTE_TYPES = ['select', 'color', 'text']
const MAX_PUBLIC_PRODUCTS_LIMIT = 100
const DEFAULT_PUBLIC_PRODUCTS_LIMIT = 12

// =====================================================
// HELPERS GENERALES
// =====================================================

const ensureDir = async dir => {
  await fs.mkdir(dir, { recursive: true })
}



const publicBaseUrl = () => process.env.PUBLIC_URL || ''

const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

const normalizeRatingValue = body => {
  const raw =
    body?.star ??
    body?.rating ??
    body?.value ??
    body?.rate ??
    body?.score

  if (raw === undefined || raw === null || raw === '') {
    return {
      value: NaN,
      raw,
    }
  }

  if (typeof raw === 'object') {
    const nested =
      raw.star ??
      raw.rating ??
      raw.value ??
      raw.rate ??
      raw.score

    return {
      value: Number(nested),
      raw,
    }
  }

  return {
    value: Number(raw),
    raw,
  }
}

const normalizeOptionalText = value => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  return value.trim()
}

const safeJsonParse = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback

  if (typeof value === 'object') {
    return value
  }

  if (typeof value !== 'string') {
    return fallback
  }

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const toSafePositiveInt = (value, fallback, { min = 1, max = 100 } = {}) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const intValue = Math.trunc(parsed)
  if (intValue < min) return min
  if (intValue > max) return max
  return intValue
}

const toSafeNumber = (value, fallback = 0, { min = 0 } = {}) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed < min ? min : parsed
}

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isValidObjectId = value => mongoose.Types.ObjectId.isValid(String(value || ''))

const requireTenantId = (tenantId, message = 'Tenant no resuelto') => {
  if (!tenantId || !isValidObjectId(tenantId)) {
    const error = new Error(message)
    error.statusCode = 400
    throw error
  }

  return tenantId
}

const requireUserTenantId = req => {
  const tenantId = req.user?.tenantId

  if (!tenantId || !isValidObjectId(tenantId)) {
    const error = new Error('Tenant no autorizado')
    error.statusCode = 403
    throw error
  }

  return tenantId
}

const getRequestUserId = req => req.user?._id || req.user?.id || null

const assertSameResolvedTenant = (req, tenantId) => {
  if (req.tenantId && String(req.tenantId) !== String(tenantId)) {
    const error = new Error('El usuario no pertenece al tenant resuelto por el dominio')
    error.statusCode = 403
    throw error
  }
}

const buildStorefrontMatch = tenantId => {
  requireTenantId(tenantId, 'tenantId inválido para storefront match')

  return {
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    isDeleted: { $ne: true },
    visibility: 'visible',
    status: { $in: ['active', 'out-of-stock'] },
  }
}

const normalizeVariantAttributes = attributes => {
  if (!attributes) return {}
  if (attributes instanceof Map) return Object.fromEntries(attributes)
  if (typeof attributes === 'object' && !Array.isArray(attributes)) return attributes
  return {}
}

const normalizeVariantImage = image => {
  if (!image || typeof image !== 'object') return null
  if (!image.url) return null

  return {
    public_id: normalizeText(image.public_id, ''),
    url: normalizeText(image.url, ''),
  }
}

const normalizeVariantsPayload = (rawVariants, tenantId) => {
  if (!Array.isArray(rawVariants)) return []

  return rawVariants.map((variant, index) => {
    const attributes = normalizeVariantAttributes(
      variant.attributes || variant.combinacion || {},
    )

    const key =
      normalizeText(variant.key) ||
      Object.entries(attributes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${value}`)
        .join('|') ||
      `variant-${index}`

    return {
      _id: variant._id || variant.id || undefined,
      key,
      attributes,
      price: toSafeNumber(variant.price, 0),
      stock: toSafeNumber(variant.stock, 0),
      sku: normalizeText(variant.sku).toUpperCase() || undefined,
      image: normalizeVariantImage(variant.image),
      isActive: variant.isActive !== false,
      tenantId,
    }
  })
}

const normalizeVariantAttributesPayload = rawVariantAttributes => {
  if (!Array.isArray(rawVariantAttributes)) return []

  return rawVariantAttributes
    .map(attr => ({
      name: normalizeText(attr.name),
      label: normalizeText(attr.label || attr.name),
      type: ALLOWED_VARIANT_ATTRIBUTE_TYPES.includes(attr.type)
        ? attr.type
        : 'select',
    }))
    .filter(attr => attr.name && attr.label)
}

const findVariantIndex = (variants = [], variantId) => {
  return variants.findIndex(variant =>
    String(variant._id) === String(variantId) ||
    String(variant.id) === String(variantId) ||
    String(variant.key) === String(variantId) ||
    String(variant.sku) === String(variantId),
  )
}

const sanitizeCreateProductInput = body => ({
  title: normalizeText(body.title, ''),
  description: normalizeText(body.description, ''),
  marca: normalizeText(body.marca, ''),
  categoria: normalizeText(body.categoria, ''),
  subcategoria: normalizeText(body.subcategoria, ''),
  compareAtPrice: toSafeNumber(body.compareAtPrice, 0),
  currency: normalizeText(body.currency, 'ARS').toUpperCase(),
  sku: normalizeText(body.sku, '').toUpperCase() || undefined,
  condicion: ALLOWED_PRODUCT_CONDITIONS.includes(body.condicion)
    ? body.condicion
    : 'nuevo',
  status: ALLOWED_PRODUCT_STATUSES.includes(body.status)
    ? body.status
    : 'active',
  visibility: ALLOWED_PRODUCT_VISIBILITIES.includes(body.visibility)
    ? body.visibility
    : 'visible',
  iaGenerated: Boolean(body.iaGenerated),
  iaSource: normalizeText(body.iaSource, 'manual'),
})

const sanitizeUpdateProductInput = body => {
  const updates = {}

  if (body.title !== undefined) updates.title = normalizeOptionalText(body.title)
  if (body.description !== undefined) updates.description = normalizeOptionalText(body.description)
  if (body.marca !== undefined) updates.marca = normalizeOptionalText(body.marca)
  if (body.categoria !== undefined) updates.categoria = normalizeOptionalText(body.categoria)
  if (body.subcategoria !== undefined) updates.subcategoria = normalizeOptionalText(body.subcategoria)
  if (body.compareAtPrice !== undefined) updates.compareAtPrice = toSafeNumber(body.compareAtPrice, 0)
  if (body.currency !== undefined) updates.currency = normalizeText(body.currency, 'ARS').toUpperCase()
  if (body.sku !== undefined) updates.sku = normalizeText(body.sku, '').toUpperCase() || undefined
  if (body.condicion !== undefined && ALLOWED_PRODUCT_CONDITIONS.includes(body.condicion)) {
    updates.condicion = body.condicion
  }
  if (body.status !== undefined && ALLOWED_PRODUCT_STATUSES.includes(body.status)) {
    updates.status = body.status
  }
  if (body.visibility !== undefined && ALLOWED_PRODUCT_VISIBILITIES.includes(body.visibility)) {
    updates.visibility = body.visibility
  }
  if (body.iaGenerated !== undefined) updates.iaGenerated = Boolean(body.iaGenerated)
  if (body.iaSource !== undefined) updates.iaSource = normalizeText(body.iaSource, 'manual')
  if (body.price !== undefined) updates.price = toSafeNumber(body.price, 0)
  if (body.stock !== undefined) updates.stock = toSafeNumber(body.stock, 0)

  return updates
}

const buildHumanCorrectionPayload = payload => ({
  titulo: normalizeText(payload.title, null),
  descripcion: normalizeText(payload.description, null),
  categoria: normalizeText(payload.categoria, null),
  subcategoria: normalizeText(payload.subcategoria, null),
  marca: normalizeText(payload.marca, null),
  precio_sugerido:
    payload.price !== undefined && payload.price !== null
      ? toSafeNumber(payload.price, 0)
      : null,
  moneda: normalizeText(payload.currency, 'ARS'),
  atributos:
    typeof payload.atributos === 'string'
      ? safeJsonParse(payload.atributos, {})
      : payload.atributos || {},
  tags:
    typeof payload.tags === 'string'
      ? safeJsonParse(payload.tags, [])
      : Array.isArray(payload.tags)
        ? payload.tags
        : [],
  hasVariants: Boolean(payload.hasVariants),
})

const getSafePublicSort = sort => {
  const sortMap = {
    'price-asc': { price: 1, _id: 1 },
    'price-desc': { price: -1, _id: 1 },
    'created-asc': { createdAt: 1, _id: 1 },
    'created-desc': { createdAt: -1, _id: 1 },
    'title-asc': { title: 1, _id: 1 },
    'title-desc': { title: -1, _id: 1 },
  }

  return sortMap[sort] || { createdAt: -1, _id: 1 }
}

const sendControllerError = (res, error, fallbackMessage) => {
  const statusCode = error.statusCode || 500

  return res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? fallbackMessage : error.message,
  })
}

// =====================================================
// 🧠 CREATE PRODUCT + AI LEARNING
// =====================================================
export const createProduct = expressAsyncHandler(async (req, res) => {
  try {
    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    const userId = getRequestUserId(req)

    // =====================================================
    // 🧠 DEBUG TEMPORAL - CONFIRMAR PAYLOAD IA
    // =====================================================
    logger.info('🧠 AI payload recibido en createProduct', {
      iaGenerated: req.body.iaGenerated,
      hasAiOriginalOutput: Boolean(req.body.aiOriginalOutput),
      aiOriginalOutputType: typeof req.body.aiOriginalOutput,
      aiOriginalOutputPreview:
        typeof req.body.aiOriginalOutput === 'string'
          ? req.body.aiOriginalOutput.slice(0, 300)
          : req.body.aiOriginalOutput,
      aiConfidence: req.body.aiConfidence,
      aiSource: req.body.aiSource,
      aiImageHash: req.body.aiImageHash,
      aiNeedsReview: req.body.aiNeedsReview,
    })

    const finalTitle = normalizeText(req.body.title, 'Producto sin título')

    const slug = await generateUniqueSlug({
      title: finalTitle,
      tenantId,
    })

    const rawVariants = safeJsonParse(
      req.body.variants,
      req.body.variants || [],
    )

    const rawVariantAttributes = safeJsonParse(
      req.body.variantAttributes,
      req.body.variantAttributes || [],
    )

    const variants = normalizeVariantsPayload(rawVariants, tenantId)
    const variantAttributes = normalizeVariantAttributesPayload(rawVariantAttributes)

    const safeBody = sanitizeCreateProductInput(req.body)

    const atributos = safeJsonParse(req.body.atributos, {})
    const tags = safeJsonParse(req.body.tags, [])

    logger.info('🧠 AI payload recibido en createProduct', {
      iaGenerated: req.body.iaGenerated,
      hasAiOriginalOutput: Boolean(req.body.aiOriginalOutput),
      aiOriginalOutputType: typeof req.body.aiOriginalOutput,
      aiOriginalOutputPreview:
    typeof req.body.aiOriginalOutput === 'string'
      ? req.body.aiOriginalOutput.slice(0, 300)
      : req.body.aiOriginalOutput,
      aiConfidence: req.body.aiConfidence,
      aiSource: req.body.aiSource,
      aiImageHash: req.body.aiImageHash,
    })

    const aiOriginal = safeJsonParse(req.body.aiOriginalOutput, null)

    const iaGenerated =
      req.body.iaGenerated === true ||
      req.body.iaGenerated === 'true' ||
      Boolean(aiOriginal)

    const hasVariants =
      req.body.hasVariants === true ||
      req.body.hasVariants === 'true' ||
      variants.length > 0

    const aiConfidence =
      aiOriginal?.confidence ??
      aiOriginal?.confianza ??
      toSafeNumber(req.body.aiConfidence, null)

    const aiSource =
      aiOriginal?.source ||
      aiOriginal?.model ||
      normalizeText(req.body.aiSource, null)

    const aiImageHash =
      aiOriginal?.hash ||
      aiOriginal?.imageHash ||
      normalizeText(req.body.aiImageHash, null)

    const aiNeedsReview =
      aiOriginal?.needsReview === true ||
      aiOriginal?.requiresHumanReview === true ||
      req.body.aiNeedsReview === true ||
      req.body.aiNeedsReview === 'true' ||
      false

    const product = new Product({
      ...safeBody,

      title: finalTitle,
      slug,
      tenantId,

      variants,
      variantAttributes,
      hasVariants,

      images: [],

      atributos,
      tags,

      price: toSafeNumber(req.body.price, 0),
      stock: toSafeNumber(req.body.stock, 0),

      // =====================================================
      // 🧠 AI METADATA
      // =====================================================
      iaGenerated,
      aiOriginalOutput: aiOriginal,
      aiConfidence,
      aiSource,
      aiImageHash,
      aiNeedsReview,
      aiAgentJobId: isValidObjectId(req.body.aiAgentJobId) ? req.body.aiAgentJobId : null,
      aiAgentScheduledAt: req.body.aiAgentScheduledAt ? new Date(req.body.aiAgentScheduledAt) : null,
      aiAutomationMode: ['manual', 'agent-assisted', 'agent-autosave'].includes(req.body.aiAutomationMode)
        ? req.body.aiAutomationMode
        : 'manual',

      createdBy: userId,
      updatedBy: userId,
    })

    await product.save()

    // =====================================================
    // 🧠 HUMAN FEEDBACK / AUTO LEARNING
    // =====================================================
    if (iaGenerated && aiOriginal && typeof aiOriginal === 'object') {
      try {
        await registerVisualFeedback({
          tenantId,
          originalIAOutput: aiOriginal,
          humanCorrection: buildHumanCorrectionPayload(product),
          metadata: {
            source: 'createProduct',
            productId: String(product._id),
            imageHash: aiImageHash || null,
            sourceModel: aiSource || null,
            aiConfidence: aiConfidence ?? null,
            createdBy: userId ? String(userId) : null,
          },
        })

        logger.info(
          `🧠 Learning registrado en CREATE | product=${product._id} | tenant=${tenantId}`,
        )
      } catch (learningError) {
        logger.error(
          `❌ Error learning CREATE | product=${product._id} | tenant=${tenantId} | error=${
            learningError.stack || learningError.message
          }`,
        )
      }
    } else {
      logger.warn('⚠️ Learning omitido en CREATE: falta aiOriginalOutput válido', {
        productId: String(product._id),
        tenantId: String(tenantId),
        iaGenerated,
        hasAiOriginal: Boolean(aiOriginal),
        aiOriginalType: typeof aiOriginal,
      })
    }

    logger.info(`✨ Producto creado: ${product._id} | Tenant: ${tenantId}`)

    return res.status(201).json({
      success: true,
      message: 'Producto creado correctamente',
      data: product,
    })
  } catch (error) {
    logger.error(`❌ Error en createProduct: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error creando producto')
  }
})

// =====================================================
// GET SINGLE PUBLIC PRODUCT
// =====================================================

export const getaProduct = expressAsyncHandler(async (req, res) => {
  const { productId } = req.params
  const tenantId = requireTenantId(req.tenantId)

  if (!isValidObjectId(productId)) {
    return res.status(400).json({
      success: false,
      message: 'ID de producto inválido',
    })
  }

  const product = await Product.findOne({
    _id: productId,
    ...buildStorefrontMatch(tenantId),
  })
    .setOptions({ tenantId })
    .lean()

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Producto no encontrado',
    })
  }

  return res.status(200).json({
    success: true,
    data: product,
  })
})

// =====================================================
// GET ALL PUBLIC PRODUCTS
// =====================================================

export const getAllProduct = expressAsyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req.tenantId)

  const page = toSafePositiveInt(req.query.page, 1, { min: 1, max: 100000 })
  const limit = toSafePositiveInt(req.query.limit, DEFAULT_PUBLIC_PRODUCTS_LIMIT, {
    min: 1,
    max: MAX_PUBLIC_PRODUCTS_LIMIT,
  })

  const q = normalizeText(req.query.q)
  const categoria = normalizeText(req.query.categoria)
  const subcategoria = normalizeText(req.query.subcategoria)
  const sort = normalizeText(req.query.sort)

  const query = buildStorefrontMatch(tenantId)

  if (categoria) query.categoria = categoria
  if (subcategoria) query.subcategoria = subcategoria

  if (q) {
    const safeRegex = new RegExp(escapeRegex(q), 'i')

    query.$or = [
      { title: safeRegex },
      { description: safeRegex },
      { marca: safeRegex },
      { categoria: safeRegex },
      { subcategoria: safeRegex },
      { tags: { $in: [safeRegex] } },
    ]
  }

  const skip = (page - 1) * limit

  const [products, total] = await Promise.all([
    Product.find(query)
      .setOptions({ tenantId })
      .sort(getSafePublicSort(sort))
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query).setOptions({ tenantId }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return res.status(200).json({
    success: true,
    data: products,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    filters: {
      q: q || null,
      categoria: categoria || null,
      subcategoria: subcategoria || null,
      sort: sort || null,
    },
  })
})

// =====================================================
// CATEGORIES
// =====================================================

export const getProductCategories = expressAsyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req.tenantId)
  const match = buildStorefrontMatch(tenantId)

  const rows = await Product.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          categoria: '$categoria',
          subcategoria: '$subcategoria',
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.categoria',
        count: { $sum: '$count' },
        subcategories: {
          $push: {
            name: '$_id.subcategoria',
            count: '$count',
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        name: '$_id',
        count: 1,
        subcategories: 1,
      },
    },
    { $sort: { name: 1 } },
  ]).option({ tenantId })

  return res.status(200).json({
    success: true,
    data: rows,
  })
})

export const getCategoryConfig = expressAsyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req.tenantId)
  const categoria = decodeURIComponent(req.params.category || '').trim()

  if (!categoria) {
    return res.status(400).json({
      success: false,
      message: 'Categoría requerida',
    })
  }

  const match = {
    ...buildStorefrontMatch(tenantId),
    categoria,
  }

  const rows = await Product.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$subcategoria',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        name: '$_id',
        count: 1,
      },
    },
    { $sort: { name: 1 } },
  ]).option({ tenantId })

  return res.status(200).json({
    success: true,
    data: {
      categoria,
      subcategories: rows,
    },
  })
})

// =====================================================
// UPDATE PRODUCT
// =====================================================

export const updateProduct = expressAsyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    validateMongoDbIdMiddleware(id)

    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    const product = await Product.findOne({
      _id: id,
      tenantId,
      isDeleted: { $ne: true },
    }).setOptions({ tenantId })

    if (!product) {
      logger.warn(`❌ Falló la actualización. Producto no encontrado: ID ${id}`)
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    const updates = sanitizeUpdateProductInput(req.body)

    if (req.body.title !== undefined) {
      const nextTitle = normalizeText(req.body.title, product.title)

      if (nextTitle && nextTitle !== product.title) {
        updates.slug = await generateUniqueSlug({
          title: nextTitle,
          tenantId,
          excludeId: product._id,
        })
      }
    }

    if (req.body.variants !== undefined) {
      const rawVariants = safeJsonParse(req.body.variants, req.body.variants)
      updates.variants = normalizeVariantsPayload(rawVariants, tenantId)
      updates.hasVariants = Boolean(req.body.hasVariants ?? updates.variants.length > 0)
    }

    if (req.body.variantAttributes !== undefined) {
      const rawVariantAttributes = safeJsonParse(
        req.body.variantAttributes,
        req.body.variantAttributes,
      )

      updates.variantAttributes = normalizeVariantAttributesPayload(rawVariantAttributes)
    }

    if (req.body.tags !== undefined) {
      updates.tags = safeJsonParse(req.body.tags, req.body.tags || [])
    }

    if (req.body.atributos !== undefined) {
      updates.atributos = safeJsonParse(req.body.atributos, req.body.atributos || {})
    }

    updates.updatedBy = getRequestUserId(req)

    Object.assign(product, updates)
    await product.save()

    const aiOriginal = safeJsonParse(req.body.aiOriginalOutput, null)

    if (product.iaGenerated && aiOriginal) {
      try {
        await registerVisualFeedback({
          tenantId,
          originalIAOutput: aiOriginal,
          humanCorrection: buildHumanCorrectionPayload(product),
          metadata: {
            source: 'updateProduct',
            productId: product._id,
          },
        })

        logger.info(`🧠 Learning registrado en UPDATE | product=${product._id}`)
      } catch (error) {
        logger.error(`❌ Error learning UPDATE: ${error.message}`)
      }
    }

    logger.info(`✅ Producto actualizado: ID ${id}`)

    return res.status(200).json({
      success: true,
      data: product,
    })
  } catch (error) {
    logger.error(`❌ Error en updateProduct: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error actualizando producto')
  }
})

// =====================================================
// SOFT DELETE PRODUCT
// =====================================================

export const deleteProduct = expressAsyncHandler(async (req, res) => {
  try {
    const { productId } = req.params
    validateMongoDbIdMiddleware(productId)

    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: { $ne: true },
    }).setOptions({ tenantId })

    if (!product) {
      logger.warn(`❌ Falló la eliminación. Producto no encontrado: ID ${productId}`)
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    await product.softDelete({ userId: getRequestUserId(req) })

    logger.info(`🗑️ Producto archivado lógicamente: ID ${productId}`)

    return res.status(200).json({
      success: true,
      message: 'Producto eliminado correctamente',
    })
  } catch (error) {
    logger.error(`❌ Error en deleteProduct: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error eliminando producto')
  }
})

// =====================================================
// UPLOAD GLOBAL PRODUCT IMAGES
// =====================================================

export const uploadProductImage = expressAsyncHandler(async (req, res) => {
  try {
    const { productId } = req.params
    validateMongoDbIdMiddleware(productId)

    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: { $ne: true },
    }).setOptions({ tenantId })

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se enviaron imágenes',
      })
    }

    const driver = String(process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase()
    const uploadedImages = []

    for (const file of req.files) {
      const buffer = file.processedBuffer || file.buffer
      if (!buffer) continue

      let result

      if (driver === 'cloudinary') {
        result = await cloudinaryUploadImg(buffer, productId, tenantId)
      } else {
        const folderAbs = path.join(rootDir, 'uploads', 'products', productId)
        await ensureDir(folderAbs)

        const fileName = file.safeName || `${Date.now()}-${file.originalname}`
        const absPath = path.join(folderAbs, fileName)

        await fs.writeFile(absPath, buffer)

        result = {
          url: `${publicBaseUrl()}/uploads/products/${productId}/${fileName}`,
          public_id: `products/${productId}/${fileName}`,
        }
      }

      uploadedImages.push({
        url: result.url,
        public_id: result.public_id,
        alt: '',
        isMain: false,
        order: product.images.length + uploadedImages.length,
        tenantId,
      })
    }

    if (uploadedImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se pudieron procesar las imágenes',
      })
    }

    product.images.push(...uploadedImages)
    product.updatedBy = getRequestUserId(req)
    await product.save()

    logger.info(`📸 ${uploadedImages.length} imágenes subidas | Producto ${productId}`)

    return res.status(201).json({
      success: true,
      data: product.images,
    })
  } catch (error) {
    logger.error(`Error subiendo imagen: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error subiendo imagen')
  }
})

// =====================================================
// ASSIGN EXISTING IMAGE TO VARIANT
// =====================================================

export const assignVariantImage = expressAsyncHandler(async (req, res) => {
  try {
    const { productId } = req.params
    const { variantId, image } = req.body || {}

    validateMongoDbIdMiddleware(productId)

    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    if (!variantId) {
      return res.status(400).json({
        success: false,
        message: 'variantId es requerido',
      })
    }

    const normalizedImage = normalizeVariantImage(image)

    if (!normalizedImage) {
      return res.status(400).json({
        success: false,
        message: 'La imagen de variante es inválida',
      })
    }

    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: { $ne: true },
    }).setOptions({ tenantId })

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    const variantIndex = findVariantIndex(product.variants, variantId)

    if (variantIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Variante no encontrada',
      })
    }

    const imageExistsInProduct = product.images.some(
      item => item.url === normalizedImage.url || item.public_id === normalizedImage.public_id,
    )

    if (!imageExistsInProduct) {
      return res.status(400).json({
        success: false,
        message: 'La imagen seleccionada no pertenece al producto',
      })
    }

    product.variants[variantIndex].image = normalizedImage
    product.updatedBy = getRequestUserId(req)
    product.markModified('variants')

    await product.save()

    logger.info(`🧩 Imagen asignada a variante | product=${productId} variant=${variantId}`)

    return res.status(200).json({
      success: true,
      data: product.toObject(),
    })
  } catch (error) {
    logger.error(`❌ Error en assignVariantImage: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error asignando imagen a variante')
  }
})

// =====================================================
// DELETE GLOBAL PRODUCT IMAGE
// =====================================================

export const deleteProductImage = expressAsyncHandler(async (req, res) => {
  try {
    const { productId } = req.params
    const { public_id: publicId } = req.query

    validateMongoDbIdMiddleware(productId)

    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'public_id es requerido',
      })
    }

    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: { $ne: true },
    }).setOptions({ tenantId })

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    const imageIndex = product.images.findIndex(
      image => String(image.public_id) === String(publicId),
    )

    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Imagen no encontrada en el producto',
      })
    }

    const removedImage = product.images[imageIndex]
    const driver = String(process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase()

    if (driver !== 'cloudinary') {
      const absPath = path.join(rootDir, 'uploads', removedImage.public_id)

      try {
        await fs.unlink(absPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }

    product.images.splice(imageIndex, 1)

    product.variants.forEach(variant => {
      if (
        variant?.image?.public_id &&
        String(variant.image.public_id) === String(publicId)
      ) {
        variant.image = null
      }
    })

    product.updatedBy = getRequestUserId(req)
    product.markModified('variants')

    await product.save()

    logger.info(`🗑️ Imagen eliminada ${publicId} del producto ${productId}`)

    return res.status(200).json({
      success: true,
      data: product.images,
    })
  } catch (error) {
    logger.error(`Error eliminando imagen de producto: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error eliminando imagen')
  }
})

// =====================================================
// RATING
// =====================================================

export const rating = expressAsyncHandler(async (req, res) => {
  try {
    const { productId } = req.params
    const userId = getRequestUserId(req)
    const tenantId = requireUserTenantId(req)

    const { value: star, raw: rawRating } = normalizeRatingValue(req.body)
    const comment = normalizeText(req.body?.comment, '')

    assertSameResolvedTenant(req, tenantId)

    if (!isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de producto inválido',
      })
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Sesión inválida',
      })
    }

    if (!Number.isInteger(star) || star < 1 || star > 5) {
      logger.warn('⚠️ Rating inválido recibido', {
        body: req.body,
        rawRating,
        parsedStar: Number.isNaN(star) ? null : star,
        productId,
        userId,
        tenantId,
      })

      return res.status(400).json({
        success: false,
        message: 'La calificación debe ser un entero entre 1 y 5',
        received: rawRating ?? null,
        parsedStar: Number.isNaN(star) ? null : star,
      })
    }

    // sigue tu lógica actual...

    const [product, user] = await Promise.all([
      Product.findOne({
        _id: productId,
        tenantId,
        isDeleted: { $ne: true },
      }).setOptions({ tenantId }),

      User.findOne({
        _id: userId,
        tenantId,
      }).select('firstname lastname firstName lastName name email'),
    ])

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    if (!Array.isArray(product.ratings)) {
      product.ratings = []
    }

    const existingRating = product.ratings.find(row => {
      return row.postedBy && String(row.postedBy) === String(userId)
    })

    const postedByName = normalizeText(
      [
        user.firstname || user.firstName,
        user.lastname || user.lastName,
      ]
        .filter(Boolean)
        .join(' '),
      user.name || user.email || 'Usuario',
    )

    if (existingRating) {
      existingRating.star = star
      existingRating.comment = comment
      existingRating.postedByName = postedByName
      existingRating.tenantId = tenantId
      existingRating.updatedAt = new Date()
    } else {
      product.ratings.push({
        star,
        comment,
        postedBy: userId,
        tenantId,
        postedByName,
        helpfulVotes: [],
      })
    }

    /**
     * Si tu schema recalcula totalrating en pre('save'), esto alcanza.
     * Si no lo hace, abajo te dejo el cálculo manual seguro.
     */
    const validRatings = product.ratings.filter(row => {
      return Number.isInteger(Number(row.star)) && Number(row.star) >= 1 && Number(row.star) <= 5
    })

    product.totalrating =
      validRatings.length > 0
        ? Number(
          (
            validRatings.reduce((sum, row) => sum + Number(row.star), 0) /
              validRatings.length
          ).toFixed(1),
        )
        : 0

    product.markModified('ratings')

    await product.save()

    return res.status(200).json({
      success: true,
      message: 'Reseña registrada correctamente',
      totalrating: product.totalrating,
      ratings: product.ratings,
    })
  } catch (error) {
    logger.error(`❌ Error persistiendo rating: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error registrando reseña')
  }
})

// =====================================================
// TOGGLE HELPFUL VOTE
// =====================================================

export const toggleHelpfulVote = expressAsyncHandler(async (req, res) => {
  try {
    const { productId, ratingId } = req.params
    const userId = getRequestUserId(req)
    const tenantId = requireUserTenantId(req)

    assertSameResolvedTenant(req, tenantId)

    if (!isValidObjectId(productId) || !isValidObjectId(ratingId)) {
      return res.status(400).json({
        success: false,
        message: 'ID inválido',
      })
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Sesión inválida',
      })
    }

    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: { $ne: true },
    }).setOptions({ tenantId })

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    const ratingRow = product.ratings.id(ratingId)

    if (!ratingRow) {
      return res.status(404).json({
        success: false,
        message: 'Reseña no encontrada',
      })
    }

    if (!Array.isArray(ratingRow.helpfulVotes)) {
      ratingRow.helpfulVotes = []
    }

    const voteIndex = ratingRow.helpfulVotes.findIndex(id => {
      return String(id) === String(userId)
    })

    if (voteIndex === -1) {
      ratingRow.helpfulVotes.push(userId)
    } else {
      ratingRow.helpfulVotes.splice(voteIndex, 1)
    }

    product.markModified('ratings')

    await product.save()

    return res.status(200).json({
      success: true,
      message:
        voteIndex === -1
          ? 'Voto útil registrado'
          : 'Voto útil eliminado',
      ratingId,
      helpfulVotes: ratingRow.helpfulVotes,
      helpfulVotesCount: ratingRow.helpfulVotes.length,
    })
  } catch (error) {
    logger.error(`❌ Error en toggleHelpfulVote: ${error.stack || error.message}`)
    return sendControllerError(res, error, 'Error actualizando voto útil')
  }
})

// =====================================================
// RATE LIMITER
// =====================================================

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiadas solicitudes, intenta nuevamente más tarde.',
  },
})
