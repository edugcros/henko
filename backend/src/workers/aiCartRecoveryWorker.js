// 📁 src/workers/aiCartRecoveryWorker.js
import { detectAbandonedCarts } from '../services/aiAgent/aiAbandonedCartDetectorService.js'
import { processDueCartRecoveries } from '../services/aiAgent/aiCartRecoveryWorkerService.js'

let intervalRef = null
let isRunning = false

const toSafeNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const runRecoveryCycle = async ({ logger = console } = {}) => {
  if (isRunning) return null

  isRunning = true

  try {
    const abandonedResults = await detectAbandonedCarts({
      olderThanMinutes: toSafeNumber(process.env.AI_ABANDONED_CART_MINUTES, 30),
      limit: toSafeNumber(process.env.AI_ABANDONED_CART_DETECTOR_LIMIT, 50),
    })

    const recoveryResults = await processDueCartRecoveries({
      limit: toSafeNumber(process.env.AI_CART_RECOVERY_WORKER_LIMIT, 25),
    })

    const total = abandonedResults.length + recoveryResults.length

    if (total > 0) {
      logger.info?.('[AI Cart Recovery] Ciclo procesado', {
        abandoned: abandonedResults.length,
        recoveries: recoveryResults.length,
      })
    }

    return { abandonedResults, recoveryResults }
  } catch (error) {
    logger.error?.('[AI Cart Recovery] Error', {
      message: error.message,
      stack: error.stack,
    })
    return null
  } finally {
    isRunning = false
  }
}

export const startAiCartRecoveryWorker = ({ logger = console } = {}) => {
  if (process.env.AI_CART_RECOVERY_WORKER_ENABLED !== 'true') {
    logger.info?.('[AI Cart Recovery] Worker deshabilitado')
    return
  }

  if (intervalRef) return

  const configuredInterval = Number(
    process.env.AI_CART_RECOVERY_WORKER_INTERVAL_MS || 60000,
  )
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.min(Math.max(configuredInterval, 10000), 3600000)
    : 60000

  if (process.env.AI_CART_RECOVERY_RUN_ON_START === 'true') {
    runRecoveryCycle({ logger })
  }

  intervalRef = setInterval(() => {
    runRecoveryCycle({ logger })
  }, intervalMs)

  logger.info?.('[AI Cart Recovery] Worker iniciado', {
    intervalMs,
  })
}

export const stopAiCartRecoveryWorker = () => {
  if (intervalRef) {
    clearInterval(intervalRef)
    intervalRef = null
  }

  isRunning = false
}
