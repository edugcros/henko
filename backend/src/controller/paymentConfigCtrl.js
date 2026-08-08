import asyncHandler from 'express-async-handler'
import Tenant from '../models/tenantModel.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'

const clean = value => String(value ?? '').trim()

const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, { requireUserTenant: true }).tenantId

const ALLOWED_MODES = new Set(['test', 'production'])

const formatMpResponse = mp => ({
  mode: mp.mode || 'test',
  publicKey: mp.publicKey || '',
  hasAccessToken: Boolean(mp.accessToken),
  isEnabled: Boolean(mp.isEnabled),
  connectedAt: mp.connectedAt || null,
  updatedAt: mp.updatedAt || null,
})

export const getPaymentConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const tenant = await Tenant.findById(tenantId)
    .select('integrations.mercadopago')
    .lean()

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  return res.status(200).json({
    success: true,
    data: { mercadopago: formatMpResponse(tenant.integrations?.mercadopago || {}) },
  })
})

export const updatePaymentConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const body = req.body?.mercadopago || {}

  const mode = clean(body.mode)
  const publicKey = clean(body.publicKey)
  const accessToken = clean(body.accessToken)
  const isEnabled = Boolean(body.isEnabled)

  if (mode && !ALLOWED_MODES.has(mode)) {
    return res.status(400).json({
      success: false,
      message: 'Modo inválido. Usar "test" o "production".',
    })
  }

  const current = await Tenant.findById(tenantId)
    .select('+integrations.mercadopago.accessToken')

  if (!current) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  const currentMp = current.integrations?.mercadopago || {}
  const hasExistingToken = Boolean(currentMp.accessToken)

  if (isEnabled && !publicKey) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere la Public Key para habilitar Mercado Pago.',
    })
  }

  if (isEnabled && !accessToken && !hasExistingToken) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere el Access Token para habilitar Mercado Pago.',
    })
  }

  if (publicKey && mode) {
    const pkMode = publicKey.startsWith('TEST-') ? 'test'
      : publicKey.startsWith('APP_USR-') ? 'production'
        : null
    if (pkMode && pkMode !== mode) {
      return res.status(400).json({
        success: false,
        message: `La Public Key es de modo "${pkMode}" pero seleccionaste "${mode}".`,
      })
    }
  }

  if (accessToken && mode) {
    const tkMode = accessToken.startsWith('TEST-') ? 'test'
      : accessToken.startsWith('APP_USR-') ? 'production'
        : null
    if (tkMode && tkMode !== mode) {
      return res.status(400).json({
        success: false,
        message: `El Access Token es de modo "${tkMode}" pero seleccionaste "${mode}".`,
      })
    }
  }

  const $set = {
    'integrations.mercadopago.isEnabled': isEnabled,
    'integrations.mercadopago.updatedAt': new Date(),
  }

  if (mode) $set['integrations.mercadopago.mode'] = mode
  if (publicKey) $set['integrations.mercadopago.publicKey'] = publicKey
  if (accessToken) $set['integrations.mercadopago.accessToken'] = accessToken

  if (isEnabled && !currentMp.connectedAt) {
    $set['integrations.mercadopago.connectedAt'] = new Date()
  }

  const tenant = await Tenant.findByIdAndUpdate(
    tenantId,
    { $set },
    { new: true },
  ).select('integrations.mercadopago')

  return res.status(200).json({
    success: true,
    data: { mercadopago: formatMpResponse(tenant.integrations?.mercadopago || {}) },
  })
})
