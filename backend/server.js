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
import {
  startStaleOperationSweeper,
  stopStaleOperationSweeper,
} from './src/services/ai/aiBudgetService.js'
import {
  startAccountingAudit,
  stopAccountingAudit,
} from './src/services/ai/aiAccountingService.js'
import {
  startCertificateWatcher,
  stopCertificateWatcher,
} from './src/services/tenant/tenantDomainService.js'
import { describeMpAccount } from './src/services/paymentTenantConfigService.js'

// =====================================================
// Configuración servidor
// =====================================================

const PORT = env.port || 5000

let serverInstance = null
let isShuttingDown = false
let isServerListening = false

// =====================================================
// La credencial de plataforma tiene que ser de una cuenta real
// =====================================================
//
// config/env.js ya rechaza en producción un MP_ACCESS_TOKEN que empiece con
// TEST-. Eso deja pasar el caso que importa: una cuenta de PRUEBA de Mercado
// Pago emite credenciales APP_USR-, iguales por fuera a las reales. Con una de
// esas, los comercios "pagan" su suscripción contra una cuenta que no existe y
// el panel los da por activos.
//
// Offline no hay nada que mirar —el id de cuenta de prueba no se ve distinto—,
// así que se le pregunta a Mercado Pago una vez, al arrancar.
//
// ASIMETRÍA DELIBERADA CON paymentConfigCtrl: allá, si no se puede preguntar,
// se corta. Acá no. Lo que está en juego allá es un guardado de configuración
// que se reintenta con un click; acá es todo el backend —tiendas, catálogos,
// pedidos—, y dejarlo caído por una caída de Mercado Pago sería peor que el
// riesgo que se está cuidando. Si no se puede verificar, queda el registro.
const assertPlatformMpAccountIsReal = async () => {
  if (env.nodeEnv !== 'production') return

  const token = String(env.mercadoPago?.accessToken || '').trim()

  if (!token) return

  let cuenta

  try {
    cuenta = await describeMpAccount(token)
  } catch (error) {
    logger.error(
      '[SERVER] ⚠️ No se pudo verificar la cuenta de Mercado Pago de plataforma. ' +
        'El arranque sigue, pero nadie comprobó que la credencial no sea de prueba.',
      { message: error.message, code: error.code || null },
    )
    return
  }

  if (cuenta.isTestAccount) {
    throw new Error(
      `MP_ACCESS_TOKEN pertenece a una cuenta de prueba de Mercado Pago (${cuenta.nickname}, id ${cuenta.id}). ` +
        'Empieza con APP_USR- igual que una real, pero los cobros de suscripción no recaudarían nada.',
    )
  }

  logger.info('[SERVER] 🟢 Cuenta de Mercado Pago de plataforma verificada', {
    id: cuenta.id,
  })
}

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

    await assertPlatformMpAccountIsReal()

    logger.info('[SERVER] 🔄 Inicializando CSRF token store...')

    logger.info('[SERVER] ✅ CSRF token store inicializado')

    serverInstance = app.listen(PORT, '0.0.0.0', () => {
      isServerListening = true

      logger.info(`🚀 API running on port ${PORT}`)
      logger.info(`🌍 Entorno: ${env.nodeEnv}`)
      logger.info(`🔗 API Prefix: ${env.apiPrefix}`)

      startAiCartRecoveryWorker({ logger })
      startAiInsightWorker({ logger })
      // Devuelve el cupo de las operaciones que quedaron corriendo para
      // siempre: un deploy a mitad de una llamada deja al comercio pagando un
      // mensaje que nunca se envió, y nada lo devolvía hasta cambiar el mes.
      startStaleOperationSweeper({ logger })
      // Detecta, registra y avisa si el libro, los comercios y la plataforma
      // dejan de coincidir. Nunca corrige sola.
      startAccountingAudit({ logger })
      // Pasa sslStatus a 'active' cuando el dominio del comercio ya presenta un
      // certificado válido. Lo comprueba abriendo la conexión TLS, no
      // preguntándole al proveedor: lo que importa es lo que ve el navegador
      // del cliente.
      startCertificateWatcher({ logger })
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
    stopStaleOperationSweeper()
    stopAccountingAudit()
    stopCertificateWatcher()

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