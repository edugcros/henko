// 📁 admin/src/services/aiLeadService.js
import api from '@utils/axiosConfig'

const BASE_URL = '/ai-agent/leads'

const clean = value => String(value || '').trim()

const getTenantDomain = () => {
  if (typeof window === 'undefined') return ''
  return window.location.hostname || ''
}

const buildRequestConfig = config => ({
  ...(config || {}),
  headers: {
    ...(config?.headers || {}),
    'x-tenant-domain': getTenantDomain(),
  },
})

const unwrap = response => response?.data?.data || response?.data

const requireLeadId = leadId => {
  const id = clean(leadId)

  if (!id) {
    throw new Error('leadId requerido')
  }

  return id
}

const normalizeReason = reason => clean(reason).slice(0, 500)

const normalizeProductsOfInterest = products => {
  if (!Array.isArray(products)) return []

  return products
    .map(product => ({
      productId:
        clean(product?.productId || product?._id || product?.id) || null,
      title: clean(product?.title || product?.name || product?.nombre),
      slug: clean(product?.slug),
      sku: clean(product?.sku || product?.variantSku || product?.variantSKU),
      price: Number(product?.price || 0),
      lastMentionedAt: product?.lastMentionedAt || new Date().toISOString(),
    }))
    .filter(
      product =>
        product.productId || product.title || product.slug || product.sku,
    )
}

export const getAiLeadSummary = async () => {
  const response = await api.get(`${BASE_URL}/summary`, buildRequestConfig())
  return unwrap(response)
}

export const getAiLeads = async params => {
  const response = await api.get(
    BASE_URL,
    buildRequestConfig({
      params,
    }),
  )

  return unwrap(response)
}

export const getAiLeadById = async leadId => {
  const id = requireLeadId(leadId)

  const response = await api.get(`${BASE_URL}/${id}`, buildRequestConfig())
  return unwrap(response)
}

export const updateAiLeadStatus = async (leadId, { status, reason } = {}) => {
  const id = requireLeadId(leadId)

  const response = await api.patch(
    `${BASE_URL}/${id}/status`,
    {
      status: clean(status),
      reason: normalizeReason(reason),
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export const assignAiLead = async (leadId, assignedTo = null) => {
  const id = requireLeadId(leadId)

  const response = await api.patch(
    `${BASE_URL}/${id}/assign`,
    {
      assignedTo: assignedTo || null,
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export const scheduleAiLeadFollowUp = async (leadId, nextFollowUpAt = null) => {
  const id = requireLeadId(leadId)

  const response = await api.patch(
    `${BASE_URL}/${id}/follow-up`,
    {
      nextFollowUpAt: nextFollowUpAt || null,
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export const addAiLeadNote = async (leadId, text) => {
  const id = requireLeadId(leadId)
  const cleanText = clean(text)

  if (!cleanText) {
    throw new Error('La nota no puede estar vacía')
  }

  const response = await api.post(
    `${BASE_URL}/${id}/notes`,
    {
      text: cleanText.slice(0, 3000),
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export const markAiLeadWon = async (leadId, reason = '') => {
  const id = requireLeadId(leadId)

  const response = await api.post(
    `${BASE_URL}/${id}/mark-won`,
    {
      reason: normalizeReason(reason),
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export const markAiLeadLost = async (leadId, reason = '') => {
  const id = requireLeadId(leadId)

  const response = await api.post(
    `${BASE_URL}/${id}/mark-lost`,
    {
      reason: normalizeReason(reason),
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export const discardAiLead = async (leadId, reason = '') => {
  const id = requireLeadId(leadId)

  const response = await api.post(
    `${BASE_URL}/${id}/discard`,
    {
      reason: normalizeReason(reason),
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export const deleteAiLead = async (leadId, reason = '') => {
  const id = requireLeadId(leadId)

  const response = await api.delete(
    `${BASE_URL}/${id}`,
    buildRequestConfig({
      data: {
        reason: normalizeReason(reason),
      },
    }),
  )

  return unwrap(response)
}

export const permanentlyDeleteAiLead = async leadId => {
  const id = requireLeadId(leadId)

  const response = await api.delete(
    `${BASE_URL}/${id}/permanent`,
    buildRequestConfig(),
  )

  return unwrap(response)
}

/**
 * Quita un producto de interés mal detectado.
 * productRef puede ser productId, slug, sku, title o _id interno del subdocumento.
 */
export const removeAiLeadProductOfInterest = async (
  leadId,
  productRef,
  reason = '',
) => {
  const id = requireLeadId(leadId)
  const ref = clean(productRef)

  if (!ref) {
    throw new Error('productRef requerido')
  }

  const response = await api.delete(
    `${BASE_URL}/${id}/products-of-interest/${encodeURIComponent(ref)}`,
    buildRequestConfig({
      data: {
        reason: normalizeReason(reason),
      },
    }),
  )

  return unwrap(response)
}

/**
 * Reemplaza la lista completa de productos de interés.
 * Útil si el Admin corrige manualmente productos asociados al lead.
 */
export const updateAiLeadProductsOfInterest = async (
  leadId,
  productsOfInterest = [],
) => {
  const id = requireLeadId(leadId)

  const response = await api.patch(
    `${BASE_URL}/${id}/products-of-interest`,
    {
      productsOfInterest: normalizeProductsOfInterest(productsOfInterest),
    },
    buildRequestConfig(),
  )

  return unwrap(response)
}

export default {
  getAiLeadSummary,
  getAiLeads,
  getAiLeadById,
  updateAiLeadStatus,
  assignAiLead,
  scheduleAiLeadFollowUp,
  addAiLeadNote,
  markAiLeadWon,
  markAiLeadLost,
  discardAiLead,
  deleteAiLead,
  permanentlyDeleteAiLead,
  removeAiLeadProductOfInterest,
  updateAiLeadProductsOfInterest,
}
