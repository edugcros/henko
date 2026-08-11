// 📁 src/middlewares/aiEntitlementMiddleware.js
//
// Portero de las rutas que gastan IA.
//
// División de responsabilidades a propósito: este middleware SOLO CHEQUEA,
// nunca incrementa. El cobro atómico vive dentro de cada servicio, pegado a
// la llamada real al proveedor, porque es el único lugar que sabe si el
// gasto efectivamente ocurrió (un cache-hit del análisis de imagen, por
// ejemplo, no cuesta nada y no debe descontar cupo).
//
// Si el middleware también reservara, todo lo que muere entre el router y el
// proveedor le descontaría cuota al comercio sin darle nada a cambio.

import asyncHandler from 'express-async-handler'
import {
  buildBudgetDenialMessage,
  checkAiEntitlement,
  DENY_REASONS,
} from '../services/ai/aiBudgetService.js'

const getTenantId = req =>
  String(req.tenantId || req.user?.tenantId || req.tenant?._id || '').trim()

/**
 * 402 vs 403: el límite de plan es "pagá más y seguís" (Payment Required),
 * mientras que la suscripción caída es un permiso revocado. El frontend los
 * distingue para ofrecer upgrade en un caso y cobranza en el otro.
 */
const getStatusCode = reason => {
  if (reason === DENY_REASONS.SUBSCRIPTION) return 403
  if (reason === DENY_REASONS.NO_API_KEY) return 503
  if (reason === DENY_REASONS.PLATFORM_BUDGET) return 503
  return 402
}

export const requireAiEntitlement = metric =>
  asyncHandler(async (req, res, next) => {
    const tenantId = getTenantId(req)

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        code: 'TENANT_NOT_RESOLVED',
        message: 'Comercio no resuelto',
      })
    }

    const result = await checkAiEntitlement({ tenantId, metric })

    if (result.allowed) {
      // Lo consume el servicio de abajo para no volver a leer Tenant.
      req.aiEntitlement = result
      return next()
    }

    return res.status(getStatusCode(result.reason)).json({
      success: false,
      code: 'AI_ENTITLEMENT_DENIED',
      reason: result.reason,
      message: buildBudgetDenialMessage(result),
      data: {
        metric: result.metric,
        used: result.used,
        limit: result.limit,
        plan: result.plan,
      },
    })
  })

export default { requireAiEntitlement }
