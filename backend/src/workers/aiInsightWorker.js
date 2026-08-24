// 📁 src/workers/aiInsightWorker.js
//
// Mismo esqueleto que aiCartRecoveryWorker.js. Arranca APAGADO por defecto
// (AI_INSIGHT_WORKER_ENABLED default false) — a diferencia de la recuperación
// de carritos, que ya estaba en producción, este es nuevo y conviene
// confirmar que los números tienen sentido antes de dejarlo correr solo.

import Tenant from '../models/tenantModel.js'
import { runInsightScanForTenant, remeasureDueInsights } from '../services/insights/aiInsightService.js'

let intervalRef = null
let isRunning = false

const toSafeNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const runInsightCycle = async ({ logger = console } = {}) => {
  if (isRunning) return null

  isRunning = true

  try {
    // Un comercio suspendido no gasta ciclo de escaneo — mismo criterio que
    // el fix de tenants suspendidos del Bloque 8A en la recuperación de
    // carritos.
    const tenants = await Tenant.find({ status: 'active' }).select('_id').lean()

    let scanned = 0
    let insightsFound = 0

    for (const tenant of tenants) {
      try {
        const results = await runInsightScanForTenant(tenant._id)
        scanned += 1
        insightsFound += results.length
      } catch (error) {
        logger.warn?.('[AI Insights] Error escaneando tenant', {
          tenantId: String(tenant._id),
          error: error.message,
        })
      }
    }

    const remeasured = await remeasureDueInsights(
      toSafeNumber(process.env.AI_INSIGHT_REMEASURE_BATCH_LIMIT, 50),
    )

    if (scanned > 0 || remeasured.length > 0) {
      logger.info?.('[AI Insights] Ciclo procesado', {
        tenantsScanned: scanned,
        insightsFound,
        remeasured: remeasured.length,
      })
    }

    return { scanned, insightsFound, remeasured: remeasured.length }
  } catch (error) {
    logger.error?.('[AI Insights] Error', {
      message: error.message,
      stack: error.stack,
    })
    return null
  } finally {
    isRunning = false
  }
}

export const startAiInsightWorker = ({ logger = console } = {}) => {
  if (process.env.AI_INSIGHT_WORKER_ENABLED !== 'true') {
    logger.info?.('[AI Insights] Worker deshabilitado')
    return
  }

  if (intervalRef) return

  const configuredInterval = Number(process.env.AI_INSIGHT_WORKER_INTERVAL_MS || 21600000) // 6hs
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.min(Math.max(configuredInterval, 300000), 86400000)
    : 21600000

  if (process.env.AI_INSIGHT_RUN_ON_START === 'true') {
    runInsightCycle({ logger })
  }

  intervalRef = setInterval(() => {
    runInsightCycle({ logger })
  }, intervalMs)

  logger.info?.('[AI Insights] Worker iniciado', { intervalMs })
}

export const stopAiInsightWorker = () => {
  if (intervalRef) {
    clearInterval(intervalRef)
    intervalRef = null
  }

  isRunning = false
}

// Exportado para poder probar/disparar un ciclo directo, mismo criterio que
// tryPersonalizeMessage (Bloque 7) — evita depender del setInterval real
// para verificar la lógica de un ciclo.
export { runInsightCycle }
