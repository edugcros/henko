// 📁 src/controllers/marketIntelligenceController.js
//
// Capa HTTP del Market Intelligence Agent. Sigue el mismo patrón que
// productAnalysisController.js: asyncHandler + resolveAuthorizedTenantFromRequest,
// para que el cruce tenant-por-dominio vs tenant-del-usuario sea idéntico
// al del resto del panel.

import asyncHandler from 'express-async-handler'

import { analyzeMarketDemand } from '../services/marketIntelligence/marketIntelligenceService.js'
import {
  getActorIdFromRequest,
  resolveAuthorizedTenantFromRequest,
} from '../utils/requestContext.js'
import logger from '../../config/logger.js'

const MAX_PRODUCT_LENGTH = 200

const normalizeString = value => (typeof value === 'string' ? value.trim() : '')

// Mismo cruce que productAnalysisController: el tenant resuelto por dominio
// (que un header x-tenant-domain puede sobreescribir) contra el tenant real
// del usuario autenticado.
const getTenantId = req => {
  const { tenantObjectId } = resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
    missingTenantMessage: 'Tenant no resuelto.',
    missingUserTenantMessage: 'El usuario autenticado no tiene tenantId válido.',
    mismatchMessage: 'El usuario no pertenece al tenant resuelto por el dominio.',
    onMismatch: ({ domainTenantId, userTenantId }) => {
      logger.warn(
        `🚨 Tenant mismatch en análisis de mercado | user=${getActorIdFromRequest(req, 'anonymous')} | userTenant=${userTenantId} | domainTenant=${domainTenantId} | ip=${req.ip} | endpoint=${req.method} ${req.originalUrl}`,
      )
    },
  })

  return tenantObjectId
}

/**
 * Normaliza los costos del body. Devuelve null si no hay costo unitario:
 * sin ese dato el motor de rentabilidad no calcula nada, así que no tiene
 * sentido pasarle un objeto a medias.
 *
 * Los porcentajes se topean en 100 acá y no en el motor porque un 500%
 * tipeado por error debe rechazarse en el borde, no propagarse al cálculo.
 */
const parseCosts = raw => {
  if (!raw || typeof raw !== 'object') return null

  const unitCost = Number(raw.unitCost)
  if (!Number.isFinite(unitCost) || unitCost <= 0) return null

  const percent = value => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.min(parsed, 100)
  }

  const positive = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  return {
    unitCost,
    shippingCost: positive(raw.shippingCost),
    platformFeePercent: percent(raw.platformFeePercent),
    taxPercent: percent(raw.taxPercent),
    targetPrice: positive(raw.targetPrice) || undefined,
  }
}

/**
 * POST /api/market-intelligence/analyze
 * Body: { product: string, country?: string, forceRefresh?: boolean }
 */
export const analyzeProduct = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto.',
    })
  }

  const product = normalizeString(req.body?.product)

  if (!product) {
    return res.status(400).json({
      success: false,
      message: 'Indicá qué producto o categoría querés analizar.',
    })
  }

  if (product.length > MAX_PRODUCT_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `El producto no puede superar los ${MAX_PRODUCT_LENGTH} caracteres.`,
    })
  }

  const country = (normalizeString(req.body?.country) || 'AR').toUpperCase()
  const forceRefresh = req.body?.forceRefresh === true

  // Los costos son opcionales: sin ellos el análisis devuelve señales de
  // mercado, con ellos agrega el cálculo de rentabilidad.
  const costs = parseCosts(req.body?.costs)

  const analysis = await analyzeMarketDemand({
    tenantId,
    product,
    country,
    forceRefresh,
    costs,
  })

  // Cuota agotada, suscripción inactiva o disyuntor de plataforma. 429 y no
  // 403 porque es un límite de uso que se renueva, no una falta de permiso.
  if (analysis.blocked) {
    return res.status(429).json({
      success: false,
      code: analysis.reason,
      message: analysis.message,
      budget: analysis.budget,
    })
  }

  return res.status(200).json({
    success: true,
    data: analysis,
  })
})

/**
 * GET /api/market-intelligence/history?limit=20
 *
 * TODO: implementar. Debe exponerse desde el servicio (no leer el modelo
 * MarketAnalysis directo acá) para no romper la separación de capas del
 * resto del paquete.
 */
export const getAnalysisHistory = asyncHandler(async (req, res) => {
  return res.status(501).json({
    success: false,
    message: 'Historial todavía no implementado.',
  })
})

export default { analyzeProduct, getAnalysisHistory }
