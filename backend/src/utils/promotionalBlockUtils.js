// promotionalBlockUtils
import mongoose from 'mongoose'

export const isValidObjectId = value => mongoose.Types.ObjectId.isValid(value)

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

export const getTenantIdFromRequest = req => {
  return req.tenantId || req.tenant?._id || req.user?.tenantId || req.user?.tenant?._id
}

export const normalizePromotionalProducts = products => {
  if (!Array.isArray(products)) return []

  const seen = new Set()

  return products
    .filter(item => item?.productId)
    .map(item => ({
      productId: item.productId,
      customTitle: String(item.customTitle || '').trim(),
      customLabel: String(item.customLabel || '').trim(),
      discountPercentage: Number(item.discountPercentage || 0),
      priority: Number(item.priority || 1),
      isActive: item.isActive !== false,
    }))
    .filter(item => {
      const id = String(item.productId)

      if (seen.has(id)) return false

      seen.add(id)
      return true
    })
    .sort((a, b) => a.priority - b.priority)
}