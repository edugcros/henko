// 📁 server.js
import process from 'process'

import { env } from './config/env.js'
import connectDB, { closeDB } from './config/connectDB.js'
import app from './app.js'
import logger from './config/logger.js'
import {
  startAiCartRecoveryWorker,
  stopAiCartRecoveryWorker,
} from './src/workers/aiCartRecoveryWorker.js'
import {
  startAiInsightWorker,
  stopAiInsightWorker,
} from './src/workers/aiInsightWorker.js'
import { refreshPlatformAiSettings } from './src/services/ai/platformAiSettingService.js'

// =====================================================
// Configuración servidor
// =====================================================

const PORT = env.port || 5000

let serverInstance = null
let isShuttingDown = false
let isServerListening = false

// =====================================================
// Arranque
// =====================================================

const startServer = async () => {
  try {
    logger.info('[SERVER] 🔄 Iniciando servidor...')

    await connectDB()
    logger.info('[SERVER] 🟢 MongoDB conectado')

    // Los ajustes de plataforma se leen de memoria y se refrescan en segundo
    // plano (ver platformAiSettingService). Eso alcanza para el techo de gasto,
    // que cae a su variable de entorno mientras tanto, pero NO para los precios:
    // no hay variable configurada, así que la respuesta de arranque es "sin
    // precio" — y un plan sin precio no se vende. Comprobado en producción: el
    // primer GET /subscriptions/plans después de un deploy devolvía los dos
    // planes en null, o sea el panel sin botón de contratar y un intento de
    // pago rechazado, hasta que terminaba el primer refresh.
    //
    // No corta el arranque si falla: se cae al comportamiento de siempre.
    await refreshPlatformAiSettings()
    logger.info('[SERVER] 🟢 Ajustes de plataforma cargados')

    logger.info('[SERVER] 🔄 Inicializando CSRF token store...')
    
    logger.info('[SERVER] ✅ CSRF token store inicializado')

    serverInstance = app.listen(PORT, '0.0.0.0', () => {
      isServerListening = true

      logger.info(`🚀 API running on port ${PORT}`)
      logger.info(`🌍 Entorno: ${env.nodeEnv}`)
      logger.info(`🔗 API Prefix: ${env.apiPrefix}`)

      startAiCartRecoveryWorker({ logger })
      startAiInsightWorker({ logger })
    })

    serverInstance.on('error', err => {
      isServerListening = false

      logger.error(`❌ Error en servidor HTTP: ${err.message}`)

      if (err.code === 'EADDRINUSE') {
        logger.error(`❌ El puerto ${PORT} ya está en uso. Cerrá el proceso anterior o cambiá PORT.`)
        logger.error(`👉 Windows: netstat -ano | findstr :${PORT}`)
        logger.error('👉 Luego: taskkill /PID TU_PID /F')
      }

      shutdown('HTTP_ERROR')
    })
  } catch (error) {
    logger.error(`❌ Error crítico iniciando servidor: ${error.stack || error.message}`)
    process.exit(1)
  }
}

// =====================================================
// Graceful shutdown
// =====================================================

const shutdown = async signal => {
  if (isShuttingDown) return

  isShuttingDown = true

  logger.warn(`⚠️ Señal recibida: ${signal}`)

  try {
    stopAiCartRecoveryWorker()
    stopAiInsightWorker()

    if (serverInstance && isServerListening) {
      await new Promise((resolve, reject) => {
        serverInstance.close(error => {
          if (error) return reject(error)
          return resolve()
        })
      })

      isServerListening = false
      logger.info('🛑 Servidor HTTP cerrado')
    }

    await closeDB()

    logger.info('✅ Shutdown completo')
    process.exit(0)
  } catch (error) {
    logger.error(`❌ Error durante shutdown: ${error.stack || error.message}`)
    process.exit(1)
  }
}

// =====================================================
// Señales del sistema
// =====================================================

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

// =====================================================
// Errores globales
// =====================================================

process.once('unhandledRejection', reason => {
  logger.error(`❌ Unhandled Rejection: ${reason?.stack || reason}`)
  shutdown('unhandledRejection')
})

process.once('uncaughtException', err => {
  logger.error(`💥 Uncaught Exception: ${err?.stack || err}`)
  shutdown('uncaughtException')
})

// =====================================================
// Start
// =====================================================

startServer()