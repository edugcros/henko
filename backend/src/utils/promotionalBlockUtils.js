// 📁 src/utils/promotionalBlockUtils.js
// VERSIÓN PRODUCCIÓN - NORMALIZACIÓN SEGURA / MULTI-TENANT SAFE

import mongoose from 'mongoose'

const MAX_TITLE_LENGTH = 120
const MAX_LABEL_LENGTH = 80
const MAX_PRODUCTS = 20

const clampNumber = ({ value, min, max, fallback }) => {
  const number = Number(value)

  if (!Number.isFinite(number)) return fallback

  return Math.min(max, Math.max(min, number))
}

const clampInteger = ({ value, min, max, fallback }) => {
  return Math.trunc(
    clampNumber({
      value,
      min,
      max,
      fallback,
    }),
  )
}

const cleanString = (value, maxLength = 255) => {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}

export const normalizeSlug = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

export const buildSlugFromTitle = title => {
  const slug = normalizeSlug(title)

  if (!slug) {
    return `bloque-${Date.now()}`
  }

  return slug
}

export const normalizeProductId = value => {
  const raw =
    value?._id ||
    value?.id ||
    value?.productId ||
    value

  const clean = String(raw || '').trim()

  if (!mongoose.Types.ObjectId.isValid(clean)) {
    return null
  }

  return new mongoose.Types.ObjectId(clean)
}

export const normalizeDiscountPercentage = value => {
  return clampNumber({
    value,
    min: 0,
    max: 100,
    fallback: 0,
  })
}

export const normalizePriority = value => {
  return clampInteger({
    value,
    min: 1,
    max: 100,
    fallback: 1,
  })
}

export const normalizeMaxItems = value => {
  return clampInteger({
    value,
    min: 1,
    max: MAX_PRODUCTS,
    fallback: 5,
  })
}

export const normalizePromotionalProducts = products => {
  if (!Array.isArray(products)) return []

  const seen = new Set()

  return products
    .slice(0, MAX_PRODUCTS)
    .map((item, index) => {
      const productId = normalizeProductId(item?.productId)

      if (!productId) return null

      const idKey = String(productId)

      if (seen.has(idKey)) return null

      seen.add(idKey)

      return {
        productId,
        customTitle: cleanString(item?.customTitle, MAX_TITLE_LENGTH),
        customLabel: cleanString(item?.customLabel, MAX_LABEL_LENGTH),
        discountPercentage: normalizeDiscountPercentage(item?.discountPercentage),
        priority: normalizePriority(item?.priority || index + 1),
        isActive: item?.isActive !== false,
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }

      return String(a.productId).localeCompare(String(b.productId))
    })
}