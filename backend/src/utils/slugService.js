// 📁 src/utils/slugService.js
// VERSIÓN PRODUCCIÓN - SLUGS ÚNICOS POR TENANT

import slugify from 'slugify'
import mongoose from 'mongoose'

import Product from '../models/productModel.js'

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
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
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
