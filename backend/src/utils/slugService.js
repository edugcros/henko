// 📁 src/utils/slugService.js
// VERSIÓN PRODUCCIÓN - SLUGS ÚNICOS POR TENANT

import slugify from 'slugify'

import Product from '../models/productModel.js'
import { isValidObjectId } from './requestContext.js'

const DEFAULT_SLUG_BASE = 'producto'
const MAX_SLUG_LENGTH = 80

const buildBaseSlug = title => {
  const normalized = slugify(String(title || ''), {
    lower: true,
    strict: true,
    trim: true,
  })

  return normalized.slice(0, MAX_SLUG_LENGTH) || DEFAULT_SLUG_BASE
}

const buildCandidateSlug = (baseSlug, counter) => {
  if (counter === 0) return baseSlug

  const suffix = `-${counter}`
  const maxBaseLength = Math.max(1, MAX_SLUG_LENGTH - suffix.length)

  return `${baseSlug.slice(0, maxBaseLength)}${suffix}`
}

/**
 * Genera un slug único dentro de un tenant.
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string|mongoose.Types.ObjectId} params.tenantId
 * @param {string|mongoose.Types.ObjectId|null} [params.excludeId]
 * @returns {Promise<string>}
 */
export async function generateUniqueSlug({ title, tenantId, excludeId = null }) {
  if (!tenantId || !isValidObjectId(tenantId)) {
    throw new Error('tenantId inválido para generar slug')
  }

  const baseSlug = buildBaseSlug(title)
  let counter = 0

  while (true) {
    const slug = buildCandidateSlug(baseSlug, counter)

    const query = {
      tenantId,
      slug,
    }

    if (excludeId) {
      query._id = { $ne: excludeId }
    }

    const exists = await Product.exists(query).setOptions({ tenantId })

    if (!exists) {
      return slug
    }

    counter += 1
  }
}

/**
 * SKU de producto cuando el comercio no cargó uno: TÍTULO-TIENDA-ALEATORIO.
 *
 * Vive acá, con el slug, porque los dos son los identificadores que cada camino
 * de alta tiene que poner igual. Estaba solo en productCtrl: el alta desde un
 * análisis (productAnalysisController) creaba productos SIN SKU, y el índice
 * único { tenantId, sku } —sparse en un índice compuesto indexa igual el
 * documento con sku null, porque tenantId siempre existe— hacía fallar el
 * segundo producto sin SKU de cada tienda.
 */
export const buildProductSku = ({ title, tenantId }) => {
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

  return [titlePart || 'PRODUCTO', tenantPart, randomPart].filter(Boolean).join('-')
}
