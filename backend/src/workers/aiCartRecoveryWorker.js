// 📁 src/workers/aiCartRecoveryWorker.js
import { detectAbandonedCarts } from '../services/aiAgent/aiAbandonedCartDetectorService.js'
import { processDueCartRecoveries } from '../services/aiAgent/aiCartRecoveryWorkerService.js'

let intervalRef = null
let isRunning = false

export const startAiCartRecoveryWorker = ({ logger = console } = {}) => {
  if (process.env.AI_CART_RECOVERY_WORKER_ENABLED !== 'true') {
    logger.info?.('[AI Cart Recovery] Worker deshabilitado')
    return
  }

  if (intervalRef) return

  const intervalMs = Number(process.env.AI_CART_RECOVERY_WORKER_INTERVAL_MS || 60000)

  intervalRef = setInterval(async () => {
    if (isRunning) return

    isRunning = true

    try {
      const abandonedResults = await detectAbandonedCarts({
        olderThanMinutes: Number(process.env.AI_ABANDONED_CART_MINUTES || 30),
        limit: Number(process.env.AI_ABANDONED_CART_DETECTOR_LIMIT || 50),
      })

      const recoveryResults = await processDueCartRecoveries({
        limit: Number(process.env.AI_CART_RECOVERY_WORKER_LIMIT || 25),
      })

      const total = abandonedResults.length + recoveryResults.length

      if (total > 0) {
        logger.info?.('[AI Cart Recovery] Ciclo procesado', {
          abandoned: abandonedResults.length,
          recoveries: recoveryResults.length,
        })
      }
    } catch (error) {
      logger.error?.('[AI Cart Recovery] Error', {
        message: error.message,
        stack: error.stack,
      })
    } finally {
      isRunning = false
    }
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