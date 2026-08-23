// 📁 src/controller/metaPixelConfigCtrl.js
//
// CRUD de la config de Meta Pixel / Conversions API por tenant. Mismo
// esqueleto que paymentConfigCtrl.js (mercadopago): el access token nunca
// sale del backend una vez guardado — el endpoint solo informa si hay uno
// (`hasAccessToken`), nunca lo devuelve.

import asyncHandler from 'express-async-handler'
import Tenant from '../models/tenantModel.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'
import { invalidateTenantMetaProfile } from '../services/meta/metaCredentialsService.js'

const clean = value => String(value ?? '').trim()

const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, { requireUserTenant: true }).tenantId

// Solo dígitos, típicamente 15-16 — un ID de Pixel real nunca trae letras.
const PIXEL_ID_REGEX = /^\d{6,20}$/

const formatMetaResponse = meta => ({
  pixelId: meta.pixelId || '',
  hasAccessToken: Boolean(meta.accessToken),
  isEnabled: Boolean(meta.isEnabled),
  connectedAt: meta.connectedAt || null,
  updatedAt: meta.updatedAt || null,
})

export const getMetaPixelConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const tenant = await Tenant.findById(tenantId)
    .select('integrations.meta')
    .lean()

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  return res.status(200).json({
    success: true,
    data: { meta: formatMetaResponse(tenant.integrations?.meta || {}) },
  })
})

export const updateMetaPixelConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const body = req.body?.meta || {}

  const pixelId = clean(body.pixelId)
  const accessToken = clean(body.accessToken)
  const isEnabled = Boolean(body.isEnabled)

  if (pixelId && !PIXEL_ID_REGEX.test(pixelId)) {
    return res.status(400).json({
      success: false,
      message: 'El ID de Pixel debe ser numérico (lo encontrás en Meta Events Manager).',
    })
  }

  const current = await Tenant.findById(tenantId)
    .select('+integrations.meta.accessToken')

  if (!current) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  const currentMeta = current.integrations?.meta || {}
  const hasExistingToken = Boolean(currentMeta.accessToken)

  if (isEnabled && !pixelId && !currentMeta.pixelId) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere el ID de Pixel para habilitar Meta Pixel.',
    })
  }

  if (isEnabled && !accessToken && !hasExistingToken) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere el Access Token de Conversions API para habilitar Meta Pixel.',
    })
  }

  const $set = {
    'integrations.meta.isEnabled': isEnabled,
    'integrations.meta.updatedAt': new Date(),
  }

  if (pixelId) $set['integrations.meta.pixelId'] = pixelId
  if (accessToken) $set['integrations.meta.accessToken'] = accessToken

  if (isEnabled && !currentMeta.connectedAt) {
    $set['integrations.meta.connectedAt'] = new Date()
  }

  const tenant = await Tenant.findByIdAndUpdate(
    tenantId,
    { $set },
    { new: true },
  ).select('integrations.meta')

  await invalidateTenantMetaProfile(tenantId)

  return res.status(200).json({
    success: true,
    data: { meta: formatMetaResponse(tenant.integrations?.meta || {}) },
  })
})
