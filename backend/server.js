// 📁 server.js
import process from 'process'

import { env } from './config/env.js'
import connectDB, { closeDB } from './config/connectDB.js'
import app from './app.js'
import logger from './config/logger.js'

// =====================================================
// Configuración servidor
// =====================================================

const PORT = env.port || 5000
let serverInstance = null
let isShuttingDown = false

// =====================================================
// Arranque
// =====================================================

const startServer = async () => {
  try {
    await connectDB()

    logger.info('🟢 Conexión a MongoDB establecida')

    serverInstance = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 API running on port ${PORT}`)
      logger.info(`🌍 Entorno: ${env.nodeEnv}`)
      logger.info(`🔗 API Prefix: ${env.apiPrefix}`)
    })

    serverInstance.on('error', err => {
      logger.error(`❌ Error en servidor HTTP: ${err.message}`)
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
    if (serverInstance) {
      await new Promise((resolve, reject) => {
        serverInstance.close(error => {
          if (error) return reject(error)
          return resolve()
        })
      })

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