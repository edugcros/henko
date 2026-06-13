// 📁 src/controller/productController.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / VARIANTES / IMÁGENES / RATINGS

import Product from '../models/productModel.js'
import User from '../models/userModel.js'
import Cart from '../models/cartModel.js'
import Coupon from '../models/couponModel.js'
import ProductAnalysisJob from '../models/productAnalysisJobModel.js'
import PromotionalBlock from '../models/promotionalBlockModel.js'
import WishlistPromotionNotification from '../models/wishlistPromotionNotificationModel.js'
import {
  findCatalogCategory,
  listCatalogCategories,
  normalizeCatalogKey,
  upsertSubcategoryVariantTemplate,
} from '../services/catalogCategoryService.js'
import { registerAiCatalogChangedEvent } from '../services/aiAgent/aiCatalogEventService.js'

import expressAsyncHandler from 'express-async-handler'
import rateLimit from 'express-rate-limit'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'

import {
  cloudinaryDeleteImg,
  cloudinaryUploadImg,
} from '../utils/cloudinary.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
} from '../utils/requestContext.js'
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
const MAX_VARIANT_FILTER_ATTRIBUTES = 12
const MAX_VARIANT_FILTER_VALUES = 30

// =====================================================
// HELPERS GENERALES
// =====================================================

const ensureDir = async dir => {
  await fs.mkdir(dir, { recursive: true })
}

const deleteStoredProductImage = async publicId => {
  const normalizedPublicId = normalizeText(publicId)

  if (!normalizedPublicId) return false

  const driver = String(process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase()

  if (driver === 'cloudinary') {
    const result = await cloudinaryDeleteImg(normalizedPublicId)
    return result?.success === true
  }

  const uploadsDir = path.resolve(rootDir, 'uploads')
  const imagePath = path.resolve(uploadsDir, normalizedPublicId)

  if (
    imagePath !== uploadsDir &&
    !imagePath.startsWith(`${uploadsDir}${path.sep}`)
  ) {
    throw new Error('Ruta de imagen fuera del directorio permitido')
  }

  try {
    await fs.unlink(imagePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

const removeProductFromCarts = async ({ productId, tenantId }) => {
  const carts = await Cart.find({
    tenantId,
    'products.productId': productId,
  })

  let modifiedCount = 0

  for (const cart of carts) {
    const previousLength = cart.products.length
    cart.products = cart.products.filter(
      item => String(item.productId) !== String(productId),
    )

    if (cart.products.length !== previousLength) {
      await cart.save()
      modifiedCount += 1
    }
  }

  return modifiedCount
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

const normalizeVariantFilterKey = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
}

const parseVariantFilters = rawValue => {
  if (!rawValue) return {}

  let parsed = rawValue

  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue)
    } catch {
      return {}
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  return Object.entries(parsed)
    .slice(0, MAX_VARIANT_FILTER_ATTRIBUTES)
    .reduce((acc, [rawKey, rawValues]) => {
      const key = normalizeVariantFilterKey(rawKey)
      if (!key) return acc

      const values = [
        ...new Set(
          (Array.isArray(rawValues) ? rawValues : [rawValues])
            .slice(0, MAX_VARIANT_FILTER_VALUES)
            .map(value => normalizeText(String(value)))
            .filter(Boolean),
        ),
      ]

      if (values.length > 0) acc[key] = values
      return acc
    }, {})
}

const buildVariantFilterMatch = variantFilters => {
  const entries = Object.entries(variantFilters)
  if (entries.length === 0) return null

  return {
    $elemMatch: {
      isActive: { $ne: false },
      stock: { $gt: 0 },
      ...Object.fromEntries(
        entries.map(([key, values]) => [
          `attributes.${key}`,
          { $in: values },
        ]),
      ),
    },
  }
}

const buildVariantFacets = async ({ tenantId, match }) => {
  const rows = await Product.aggregate([
    { $match: match },
    { $unwind: '$variants' },
    {
      $match: {
        'variants.isActive': { $ne: false },
        'variants.stock': { $gt: 0 },
      },
    },
    {
      $project: {
        productId: '$_id',
        attributes: { $objectToArray: '$variants.attributes' },
      },
    },
    { $unwind: '$attributes' },
    {
      $match: {
        'attributes.k': { $type: 'string', $ne: '' },
        'attributes.v': { $type: 'string', $ne: '' },
      },
    },
    {
      $group: {
        _id: {
          key: '$attributes.k',
          value: '$attributes.v',
        },
        productIds: { $addToSet: '$productId' },
      },
    },
    {
      $project: {
        _id: 0,
        key: '$_id.key',
        value: '$_id.value',
        count: { $size: '$productIds' },
      },
    },
    { $sort: { key: 1, value: 1 } },
  ]).option({ tenantId })

  const facetMap = new Map()

  for (const row of rows) {
    const key = normalizeVariantFilterKey(row.key)
    if (!key) continue

    if (!facetMap.has(key)) {
      facetMap.set(key, {
        key,
        options: [],
      })
    }

    facetMap.get(key).options.push({
      value: row.value,
      count: row.count,
    })
  }

  return [...facetMap.values()]
}

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

const getRequestUserId = getUserIdFromRequest

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

const slugifySkuPart = value => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 24)
}

const isWeakSku = sku => {
  const normalized = String(sku || '').trim().toLowerCase()

  if (!normalized) return true

  return [
    '1',
    '2',
    '3',
    'sku',
    'default',
    'sin-sku',
    'n/a',
    'na',
    'null',
    'undefined',
  ].includes(normalized)
}

const getVariantAttributesForSku = variant => {
  const attrs =
    variant?.attributes ||
    variant?.attributeValues ||
    variant?.selectedAttributes ||
    {}

  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
    return {}
  }

  return attrs
}

const buildVariantSignature = variant => {
  const attrs = getVariantAttributesForSku(variant)

  return Object.entries(attrs)
    .filter(([, value]) => {
      return value !== undefined && value !== null && String(value).trim()
    })
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([key, value]) => {
      const keyPart = slugifySkuPart(key)
      const valuePart = slugifySkuPart(value)

      return [keyPart, valuePart].filter(Boolean).join('-')
    })
    .filter(Boolean)
    .join('-')
}

const generateVariantSku = ({ productTitle, variant, index }) => {
  const titlePart = slugifySkuPart(productTitle || 'PRODUCTO').slice(0, 18)
  const variantPart = buildVariantSignature(variant)
  const indexPart = String(index + 1).padStart(2, '0')

  return [titlePart, variantPart, indexPart]
    .filter(Boolean)
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

const ensureUniqueVariantSkus = (variants = [], productTitle = '') => {
  if (!Array.isArray(variants)) return []

  const used = new Set()

  return variants.map((variant, index) => {
    const currentSku = String(variant?.sku || '').trim()
    let baseSku = currentSku
    const normalizedCurrentSku = currentSku.toLowerCase()

    if (isWeakSku(currentSku) || used.has(normalizedCurrentSku)) {
      baseSku = generateVariantSku({
        productTitle,
        variant,
        index,
      })
    }

    if (!baseSku) {
      baseSku = `PRODUCTO-${String(index + 1).padStart(2, '0')}`
    }

    let uniqueSku = baseSku
    let counter = 2

    while (used.has(String(uniqueSku).toLowerCase())) {
      uniqueSku = `${baseSku}-${counter}`
      counter += 1
    }

    used.add(String(uniqueSku).toLowerCase())

    return {
      ...variant,
      sku: uniqueSku,
    }
  })
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

const syncProductCatalogTemplate = async ({
  tenantId,
  product,
  userId,
}) => {
  if (!product?.categoria || !product?.subcategoria) return null

  return upsertSubcategoryVariantTemplate({
    tenantId,
    category: product.categoria,
    subcategory: product.subcategoria,
    variantAttributes: product.variantAttributes,
    variants: product.variants,
    userId,
  })
}

const normalizeSku = value => {
  const clean = String(value || '')
    .trim()
    .toUpperCase()

  if (!clean) return null
  if (['NULL', 'UNDEFINED', 'N/A', 'NA', 'SIN-SKU', 'SKU'].includes(clean)) return null

  return clean
}

const buildProductSku = ({ title, tenantId }) => {
  const titlePart = String(title || 'PRODUCTO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 24)

  const tenantPart = String(tenantId || '')
    .slice(-6)
    .toUpperCase()

  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase()

  return [titlePart || 'PRODUCTO', tenantPart, randomPart]
    .filter(Boolean)
    .join('-')
}

// =====================================================
// 🧠 CREATE PRODUCT + AI LEARNING
// =====================================================
export const createProduct = expressAsyncHandler(async (req, res) => {
  try {
    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    const userId = getRequestUserId(req)

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

    const normalizedVariants = normalizeVariantsPayload(rawVariants, tenantId)
    const variants = ensureUniqueVariantSkus(normalizedVariants, finalTitle)
    const variantAttributes = normalizeVariantAttributesPayload(rawVariantAttributes)

    const safeBody = sanitizeCreateProductInput(req.body)

    const atributos = safeJsonParse(req.body.atributos, {})
    const tags = safeJsonParse(req.body.tags, [])

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

    const normalizedProductSku = normalizeSku(req.body.sku)

    const productSku =
        normalizedProductSku ||
        buildProductSku({
          title: finalTitle,
          tenantId,
        })
        
    const product = new Product({
      ...safeBody,

      title: finalTitle,
      slug,
      tenantId,

      variants,
      variantAttributes,
      hasVariants,

      sku: productSku,

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
    await registerAiCatalogChangedEvent({
      tenantId,
      productId: product._id,
      action: 'product_created',
    })

    try {
      await syncProductCatalogTemplate({
        tenantId,
        product,
        userId,
      })
    } catch (catalogError) {
      logger.error('❌ No se pudo sincronizar la plantilla de subcategoría', {
        category: product.categoria,
        error: catalogError.message,
        productId: String(product._id),
        subcategory: product.subcategoria,
        tenantId: String(tenantId),
      })
    }

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

    if (
      error?.name === 'ValidationError' ||
      error?.message?.toLowerCase?.().includes('sku') ||
      error?.message?.toLowerCase?.().includes('duplicada') ||
      error?.message?.toLowerCase?.().includes('duplicado')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Datos inválidos para crear el producto',
      })
    }

    return sendControllerError(res, error, 'Error creando producto')
  }
})

// =====================================================
// GET SINGLE PUBLIC PRODUCT
// =====================================================

export const getaProduct = expressAsyncHandler(async (req, res) => {
  const { productId } = req.params
  const tenantId = requireTenantId(req.tenantId)
  const cleanParam = String(productId || '').trim()

  if (!cleanParam) {
    return res.status(400).json({
      success: false,
      message: 'Producto requerido',
    })
  }

  const storefrontMatch = buildStorefrontMatch(tenantId)

  const productQuery = isValidObjectId(cleanParam)
    ? {
      _id: cleanParam,
      ...storefrontMatch,
    }
    : {
      slug: cleanParam,
      ...storefrontMatch,
    }

  const product = await Product.findOne(productQuery)
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
  const variantFilters = parseVariantFilters(req.query.attributes)
  const includeFacets =
    Boolean(categoria && subcategoria) &&
    (req.query.includeFacets === true ||
      String(req.query.includeFacets || '').toLowerCase() === 'true')

  const baseQuery = buildStorefrontMatch(tenantId)

  if (categoria) baseQuery.categoria = categoria
  if (subcategoria) baseQuery.subcategoria = subcategoria

  if (q) {
    const safeRegex = new RegExp(escapeRegex(q), 'i')

    baseQuery.$or = [
      { title: safeRegex },
      { description: safeRegex },
      { marca: safeRegex },
      { categoria: safeRegex },
      { subcategoria: safeRegex },
      { tags: { $in: [safeRegex] } },
    ]
  }

  const query = { ...baseQuery }
  const variantMatch = buildVariantFilterMatch(variantFilters)
  if (variantMatch) query.variants = variantMatch

  const skip = (page - 1) * limit

  const [products, total, facets] = await Promise.all([
    Product.find(query)
      .setOptions({ tenantId })
      .sort(getSafePublicSort(sort))
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query).setOptions({ tenantId }),
    includeFacets
      ? buildVariantFacets({
        tenantId,
        match: baseQuery,
      })
      : Promise.resolve([]),
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
      attributes: variantFilters,
    },
    facets,
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

  const configuredCategories = await listCatalogCategories(tenantId)
  const configuredCategoryMap = new Map(
    configuredCategories.map(category => [category.normalizedName, category]),
  )

  const data = []
  for (const row of rows) {
    const categoryKey = normalizeCatalogKey(row.name)
    const configuredCategory = configuredCategoryMap.get(categoryKey)
    const configuredSubcategoryMap = new Map(
      (configuredCategory?.subcategories || [])
        .filter(subcategory => subcategory.isActive !== false)
        .map(subcategory => [subcategory.normalizedName, subcategory]),
    )

    const category = {
      id: configuredCategory?._id,
      name: row.name,
      count: row.count,
      configured: Boolean(configuredCategory),
      subcategories: [],
    }

    for (const subcategory of row.subcategories || []) {
      const subcategoryKey = normalizeCatalogKey(subcategory.name)
      const configuredSubcategory = configuredSubcategoryMap.get(subcategoryKey)

      category.subcategories.push({
        id: configuredSubcategory?._id,
        name: subcategory.name,
        count: subcategory.count,
        configured: Boolean(configuredSubcategory),
        variantAttributes: configuredSubcategory?.variantAttributes || [],
      })
    }

    category.subcategories.sort((a, b) =>
      String(a.name).localeCompare(String(b.name), 'es'),
    )
    data.push(category)
  }

  data.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'es'),
  )

  return res.status(200).json({
    success: true,
    data,
  })
})

export const getCategoryConfig = expressAsyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req.tenantId)
  const categoria = decodeURIComponent(req.params.category || '').trim()
  const requestedSubcategory = normalizeText(req.query.subcategory)

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

  const configuredCategory = await findCatalogCategory({
    tenantId,
    category: categoria,
  })

  const configuredSubcategoryMap = new Map(
    (configuredCategory?.subcategories || [])
      .filter(subcategory => subcategory.isActive !== false)
      .map(subcategory => [subcategory.normalizedName, subcategory]),
  )

  const configuredSubcategories = rows.map(row => {
    const configuredSubcategory = configuredSubcategoryMap.get(
      normalizeCatalogKey(row.name),
    )

    return {
      id: configuredSubcategory?._id,
      name: row.name,
      count: row.count,
      configured: Boolean(configuredSubcategory),
      variantAttributes: configuredSubcategory?.variantAttributes || [],
    }
  })

  configuredSubcategories.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'es'),
  )

  const selectedSubcategory = requestedSubcategory
    ? configuredSubcategories.find(
      subcategory =>
        normalizeCatalogKey(subcategory.name) ===
        normalizeCatalogKey(requestedSubcategory),
    ) || null
    : null

  return res.status(200).json({
    success: true,
    data: {
      categoria: configuredCategory?.name || categoria,
      configured: Boolean(configuredCategory),
      subcategories: configuredSubcategories,
      selectedSubcategory,
      variantAttributes: selectedSubcategory?.variantAttributes || [],
    },
  })
})

export const upsertCategoryConfig = expressAsyncHandler(async (req, res) => {
  try {
    const tenantId = requireUserTenantId(req)
    assertSameResolvedTenant(req, tenantId)

    const category = normalizeText(req.body.category || req.body.categoria)
    const subcategory = normalizeText(
      req.body.subcategory || req.body.subcategoria,
    )

    if (!category || !subcategory) {
      return res.status(400).json({
        success: false,
        message: 'Categoría y subcategoría son obligatorias',
      })
    }

    const variantAttributes = safeJsonParse(
      req.body.variantAttributes,
      req.body.variantAttributes || [],
    )

    if (!Array.isArray(variantAttributes)) {
      return res.status(400).json({
        success: false,
        message: 'variantAttributes debe ser un arreglo',
      })
    }

    const catalogCategory = await upsertSubcategoryVariantTemplate({
      tenantId,
      category,
      subcategory,
      variantAttributes,
      userId: getRequestUserId(req),
      replace: req.body.replace === true || req.body.replace === 'true',
    })

    return res.status(200).json({
      success: true,
      message: 'Plantilla de subcategoría guardada',
      data: catalogCategory,
    })
  } catch (error) {
    logger.error(`❌ Error en upsertCategoryConfig: ${error.stack || error.message}`)
    return sendControllerError(
      res,
      error,
      'Error guardando la configuración de subcategoría',
    )
  }
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

    try {
      await syncProductCatalogTemplate({
        tenantId,
        product,
        userId: getRequestUserId(req),
      })
    } catch (catalogError) {
      logger.error('❌ No se pudo sincronizar la plantilla de subcategoría', {
        category: product.categoria,
        error: catalogError.message,
        productId: String(product._id),
        subcategory: product.subcategoria,
        tenantId: String(tenantId),
      })
    }

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
// PERMANENT DELETE PRODUCT
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
    }).setOptions({ tenantId })

    if (!product) {
      logger.warn(`❌ Falló la eliminación. Producto no encontrado: ID ${productId}`)
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    const productObjectId = product._id
    const imagePublicIds = [
      ...(product.images || []).map(image => image?.public_id),
      ...(product.variants || []).map(variant => variant?.image?.public_id),
    ]
      .map(normalizeText)
      .filter(Boolean)

    const uniqueImagePublicIds = [...new Set(imagePublicIds)]

    const [
      cartsModified,
      wishlistResult,
      promotionsResult,
      couponsResult,
      notificationsResult,
      analysisJobsResult,
    ] = await Promise.all([
      removeProductFromCarts({
        productId: productObjectId,
        tenantId,
      }),
      User.updateMany(
        { tenantId, wishlist: productObjectId },
        { $pull: { wishlist: productObjectId } },
      ),
      PromotionalBlock.updateMany(
        { tenantId, 'products.productId': productObjectId },
        { $pull: { products: { productId: productObjectId } } },
      ),
      Coupon.updateMany(
        {
          tenantId,
          $or: [
            { applicableProducts: productObjectId },
            { excludedProducts: productObjectId },
          ],
        },
        {
          $pull: {
            applicableProducts: productObjectId,
            excludedProducts: productObjectId,
          },
        },
      ),
      WishlistPromotionNotification.deleteMany({
        tenantId,
        productId: productObjectId,
      }),
      ProductAnalysisJob.updateMany(
        { tenantId, createdProductId: productObjectId },
        { $set: { createdProductId: null } },
      ),
    ])

    const deleteResult = await Product.deleteOne({
      _id: productObjectId,
      tenantId,
    }).setOptions({ tenantId })

    if (deleteResult.deletedCount !== 1) {
      return res.status(409).json({
        success: false,
        message: 'El producto cambió o ya fue eliminado. Actualizá el listado.',
      })
    }

    const imageCleanupResults = await Promise.allSettled(
      uniqueImagePublicIds.map(deleteStoredProductImage),
    )
    const imageCleanupFailures = imageCleanupResults.filter(
      result => result.status === 'rejected',
    )

    if (imageCleanupFailures.length) {
      logger.warn('[Product] Algunas imágenes no pudieron eliminarse del storage', {
        productId,
        tenantId: String(tenantId),
        failures: imageCleanupFailures.map(result => result.reason?.message),
      })
    }

    logger.info('[Product] Producto eliminado permanentemente', {
      productId,
      tenantId: String(tenantId),
      cartsModified,
      wishlistsModified: wishlistResult.modifiedCount || 0,
      promotionsModified: promotionsResult.modifiedCount || 0,
      couponsModified: couponsResult.modifiedCount || 0,
      notificationsDeleted: notificationsResult.deletedCount || 0,
      analysisJobsUnlinked: analysisJobsResult.modifiedCount || 0,
      imagesScheduled: uniqueImagePublicIds.length,
      imageCleanupFailures: imageCleanupFailures.length,
    })

    return res.status(200).json({
      success: true,
      message: 'Producto eliminado permanentemente',
      data: {
        productId,
        cartsModified,
        wishlistsModified: wishlistResult.modifiedCount || 0,
        promotionsModified: promotionsResult.modifiedCount || 0,
        couponsModified: couponsResult.modifiedCount || 0,
        notificationsDeleted: notificationsResult.deletedCount || 0,
        imagesDeleted:
          uniqueImagePublicIds.length - imageCleanupFailures.length,
        imageCleanupFailures: imageCleanupFailures.length,
      },
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

const getRateLimitTenantKey = req => {
  const tenantId =
    req.tenant?._id?.toString?.() ||
    req.user?.tenantId?.toString?.() ||
    req.headers?.['x-tenant-id'] ||
    req.headers?.['x-tenant-domain'] ||
    req.hostname ||
    'unknown-tenant'

  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()

  return `${tenantId}:${forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown-client'}`
}

const productRateLimitHandler = message => (req, res, _next, options) => {
  const resetTime = req.rateLimit?.resetTime
  const retryAfter = resetTime
    ? Math.max(1, Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000))
    : Math.ceil((options.windowMs || 60 * 1000) / 1000)

  res.setHeader('Retry-After', String(retryAfter))

  return res.status(options.statusCode).json({
    success: false,
    message,
    retryAfter,
  })
}

export const productPublicReadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitTenantKey,
  handler: productRateLimitHandler(
    'Demasiadas solicitudes de catálogo, intenta nuevamente en unos segundos.',
  ),
})

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitTenantKey,
  handler: productRateLimitHandler(
    'Demasiadas solicitudes, intenta nuevamente más tarde.',
  ),
})
