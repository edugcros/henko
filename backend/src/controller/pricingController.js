// 📁 src/controller/pricingController.js

import asyncHandler from 'express-async-handler'
import mongoose from 'mongoose'

import PricingPolicy from '../models/pricingPolicyModel.js'
import {
  applyRecommendedPrice,
  recommendPriceForProduct,
} from '../services/pricing/pricingRecommendationService.js'
import {
  getActorIdFromRequest,
  resolveAuthorizedTenantFromRequest,
} from '../utils/requestContext.js'
import logger from '../../config/logger.js'

/**
 * Tenant del request, verificando que el usuario autenticado pertenezca al
 * que resolvió el dominio.
 *
 * Se usa el helper estricto y no getTenantIdFromRequest: acá se lee y escribe
 * la política de precios y los costos de un comercio, que es de lo más
 * sensible que tiene. Mismo criterio que marketIntelligenceController.
 */
const requireTenant = req =>
  resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
    missingTenantMessage: 'Tenant no resuelto.',
    missingUserTenantMessage: 'El usuario autenticado no tiene tenantId válido.',
    mismatchMessage: 'El usuario no pertenece al tenant resuelto por el dominio.',
    onMismatch: ({ domainTenantId, userTenantId }) => {
      logger.warn(
        `🚨 Tenant mismatch en pricing | user=${getActorIdFromRequest(req, 'anonymous')} | userTenant=${userTenantId} | domainTenant=${domainTenantId} | ip=${req.ip} | endpoint=${req.method} ${req.originalUrl}`,
      )
    },
  }).tenantObjectId

/**
 * GET /api/pricing/policy
 * La política del comercio, o la de fábrica si nunca configuró nada.
 */
export const getPricingPolicy = asyncHandler(async (req, res) => {
  const tenantId = requireTenant(req)

  const policy = await PricingPolicy.forTenant(tenantId)

  return res.status(200).json({ success: true, data: policy })
})

/**
 * PUT /api/pricing/policy
 *
 * Solo se aceptan los campos conocidos: un body con claves de más no debería
 * poder inyectar configuración que el motor después lea como propia.
 */
export const updatePricingPolicy = asyncHandler(async (req, res) => {
  const tenantId = requireTenant(req)

  const body = req.body || {}
  const update = {}

  const numeric = [
    'minMarginPercent',
    'targetMarginPercent',
    'maxChangePercent',
    'maxWeeklyChangePercent',
    'autoApplyMaxPercent',
    'priceFloor',
    'priceCeiling',
  ]

  for (const key of numeric) {
    if (body[key] === undefined) continue
    if (body[key] === null) {
      update[key] = null
      continue
    }

    const value = Number(body[key])
    if (Number.isFinite(value) && value >= 0) update[key] = value
  }

  if (typeof body.strategy === 'string') update.strategy = body.strategy
  if (typeof body.mode === 'string') update.mode = body.mode

  if (body.rounding && typeof body.rounding === 'object') {
    update.rounding = {
      enabled: Boolean(body.rounding.enabled),
      endings: Array.isArray(body.rounding.endings)
        ? body.rounding.endings.map(Number).filter(n => Number.isFinite(n) && n >= 0).slice(0, 5)
        : [990],
    }
  }

  if (body.consider && typeof body.consider === 'object') {
    update.consider = {
      cost: body.consider.cost !== false,
      competition: body.consider.competition !== false,
      stock: body.consider.stock !== false,
      demand: body.consider.demand !== false,
      seasonality: body.consider.seasonality !== false,
    }
  }

  update.updatedBy = req.user?._id || null

  // El margen objetivo por debajo del mínimo dejaría al motor apuntando a un
  // lugar que él mismo tiene prohibido: se rechaza en el borde.
  const min = update.minMarginPercent ?? null
  const target = update.targetMarginPercent ?? null

  if (min !== null && target !== null && target < min) {
    return res.status(400).json({
      success: false,
      message: 'El margen objetivo no puede ser menor que el mínimo.',
    })
  }

  const policy = await PricingPolicy.findOneAndUpdate({ tenantId }, { $set: update }, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  }).lean()

  logger.info('[PRICING] Política actualizada', {
    tenantId: String(tenantId),
    mode: policy.mode,
    minMarginPercent: policy.minMarginPercent,
  })

  return res.status(200).json({ success: true, data: policy })
})

/**
 * POST /api/pricing/recommend/:productId
 *
 * Devuelve los indicadores siempre; la recomendación de IA solo cuando el
 * producto tiene alguna señal que la justifique. `force` la pide igual y
 * cuesta una llamada, así que debería venir de una acción explícita sobre un
 * producto puntual y nunca de un recorrido masivo.
 */
export const recommendPrice = asyncHandler(async (req, res) => {
  const tenantId = requireTenant(req)

  const { productId } = req.params

  if (!mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ success: false, message: 'productId inválido.' })
  }

  const result = await recommendPriceForProduct({
    tenantId,
    productId,
    force: req.body?.force === true,
  })

  if (!result.found) {
    return res.status(404).json({ success: false, message: 'Producto no encontrado.' })
  }

  if (result.blocked) {
    // 429 y no 403: es un límite de uso que se renueva, no una falta de
    // permiso. Las señales viajan igual — valen sin la explicación de la IA.
    return res.status(429).json({
      success: false,
      code: result.reason,
      message: result.message,
      data: { signals: result.signals },
    })
  }

  return res.status(200).json({ success: true, data: result })
})

/**
 * POST /api/pricing/apply/:productId
 *
 * Aplica el precio recomendado. Queda registrado en el historial como cambio
 * originado en una recomendación, que es lo que después permite medir si el
 * motor sirve para algo.
 */
export const applyPrice = asyncHandler(async (req, res) => {
  const tenantId = requireTenant(req)

  const { productId } = req.params

  if (!mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ success: false, message: 'productId inválido.' })
  }

  const result = await applyRecommendedPrice({
    tenantId,
    productId,
    price: req.body?.price,
    reason: req.body?.reason,
    userId: req.user?._id || null,
  })

  return res.status(200).json({ success: true, data: result })
})
