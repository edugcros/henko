// 📁 config/connectDB.js
import mongoose from 'mongoose'
import logger from './logger.js'
import { env } from './env.js'
import dns from 'node:dns'
// import { tenantPlugin } from '../src/models/tenantPlugin.js'

/**
 * `strictQuery` en false, que además es el default de Mongoose 7.
 *
 * En true, Mongoose BORRA del filtro las rutas que el schema no declara. Un
 * `findOne({'integrations.subscriptionMercadoPago.subscriptionId': x})` sobre un
 * campo no declarado se convertía en `findOne({})` y devolvía el primer
 * documento de la colección. Buscar por un identificador y recibir a otro es la
 * peor forma de fallar que tiene una consulta: no lanza, no avisa, y el código
 * de arriba actúa sobre el registro equivocado.
 *
 * En false la ruta viaja a Mongo tal cual y la consulta no encuentra nada, que
 * es el resultado correcto cuando se busca algo que no existe.
 */
mongoose.set('strictQuery', false)



if (String(process.env.MONGO_FORCE_PUBLIC_DNS || '').toLowerCase() === 'true') {
  dns.setServers(['1.1.1.1', '8.8.8.8'])
  logger.warn('🌐 Mongo DNS override activo: 1.1.1.1, 8.8.8.8')
}
// =====================================================
// ⚠️ PLUGIN GLOBAL
// =====================================================
// En producción SaaS multi-tenant, no conviene aplicar tenantPlugin globalmente
// salvo que el plugin excluya modelos globales como Tenant, User, RefreshToken,
// Domain, Subscription, etc.
// Recomendación: aplicar tenantPlugin por schema tenant-scoped.
// mongoose.plugin(tenantPlugin)

// =====================================================
// Utils
// =====================================================

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

let listenersRegistered = false

const registerConnectionListeners = () => {
  if (listenersRegistered) return
  listenersRegistered = true

  mongoose.connection.on('connected', () => {
    logger.info('🔌 MongoDB conectado (evento)')
  })

  mongoose.connection.on('error', err => {
    logger.error(`⚠️ MongoDB error: ${err.message}`)
  })

  mongoose.connection.on('disconnected', () => {
    logger.warn('⚠️ MongoDB desconectado')
  })

  mongoose.connection.on('reconnected', () => {
    logger.info('🔄 MongoDB reconectado')
  })
}


// =====================================================
// Connect
// =====================================================

const connectDB = async () => {
  if (!env.mongoUri) {
    logger.error('❌ MONGODB_URL/MONGO_URI no definido')
    process.exit(1)
  }

  registerConnectionListeners()
  //registerShutdownHandlers()

  const MAX_RETRIES = env.isProduction ? 5 : 2

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const conn = await mongoose.connect(env.mongoUri, {
        maxPoolSize: env.isProduction ? 30 : 10,
        minPoolSize: env.isProduction ? 5 : 1,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        retryWrites: true,
        autoIndex: !env.isProduction,
      })

      logger.info('✅ MongoDB conectado')
      logger.info(`📡 Host: ${conn.connection.host}`)
      logger.info(`🗄️ DB: ${conn.connection.name}`)
      logger.info(`🌍 Entorno: ${env.nodeEnv}`)
      logger.info(`🔎 autoIndex: ${!env.isProduction}`)

      return conn
    } catch (error) {
      logger.error(`❌ Intento ${attempt}/${MAX_RETRIES} fallido: ${error.message}`)

      if (attempt === MAX_RETRIES) {
        logger.error('❌ Máximo de intentos alcanzado. Abortando...')
        process.exit(1)
      }

      const backoff = Math.min(5000 * attempt, 20000)
      logger.warn(`🔁 Reintentando en ${backoff}ms...`)
      await delay(backoff)
    }
  }

  return null
}

// =====================================================
// Manual close
// =====================================================

export const closeDB = async () => {
  try {
    await mongoose.connection.close(false)
    logger.info('🛑 MongoDB cerrado manualmente')
  } catch (error) {
    logger.error(`❌ Error cerrando MongoDB: ${error.message}`)
  }
}

export default connectDB
