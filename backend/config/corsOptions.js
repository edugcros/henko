// 📁 config/corsOptions.js
import Tenant from '../src/models/tenantModel.js'
import { env } from './env.js'
import logger from './logger.js'
import { estadoDeBase } from './connectDB.js'

const getHostnameFromOrigin = origin => {
  try {
    return new URL(origin).hostname.trim().toLowerCase()
  } catch {
    return String(origin || '')
      .replace(/^https?:\/\//, '')
      .split(',')[0]
      .split(':')[0]
      .trim()
      .toLowerCase()
  }
}

const withoutWww = hostname => {
  return String(hostname || '').replace(/^www\./, '')
}

const getHostnameCandidates = origin => {
  const hostname = getHostnameFromOrigin(origin)
  const normalized = withoutWww(hostname)

  return [...new Set([hostname, normalized].filter(Boolean))]
}

const isLocalhost = origin => {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

const isLocalDevelopmentOrigin = origin => {
  if (!env.isDevelopment) return false

  try {
    const { protocol, hostname } = new URL(origin)

    return (
      protocol === 'http:' &&
      (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.endsWith('.local')
      )
    )
  } catch {
    return false
  }
}

const isAllowedRootDomain = hostname => {
  return env.allowedRootDomains.some(root => {
    const cleanRoot = withoutWww(String(root).toLowerCase())

    return hostname === cleanRoot || hostname.endsWith(`.${cleanRoot}`)
  })
}

const CORS_CACHE_TTL = 5 * 60 * 1000
const CORS_CACHE_MAX = 2000
const corsOriginCache = new Map()

// Tope para la consulta cuando SÍ hay conexión pero la base está lenta. Es una
// búsqueda por índice sobre una colección chica: si no contestó en este tiempo,
// no va a contestar.
const TOPE_DE_CONSULTA_MS = 1500

/**
 * ¿Este origen pertenece a algún comercio?
 *
 * POR QUÉ SE MIRA EL ESTADO DE LA CONEXIÓN ANTES DE CONSULTAR
 *
 * Mongoose encola las consultas mientras no hay conexión y las suelta recién a
 * los 10 segundos, con un error de buffering. Eso acá se paga carísimo: el
 * preflight de CORS es lo PRIMERO que hace el navegador, antes de llegar a
 * ninguna ruta. Con la base caída, cada pedido desde el dominio propio de un
 * comercio se quedaba 10 segundos colgado antes de fallar.
 *
 * Y el momento en que más duele es el peor posible: en el plan free de Render
 * el servicio duerme, así que después de cada despertar hay una ventana con la
 * conexión todavía no establecida y la caché vacía.
 *
 * Preguntando el estado primero, ese caso no encola nada y se resuelve al
 * instante.
 *
 * QUÉ PASA CUANDO NO SE PUEDE AVERIGUAR
 *
 * Se cae a la caché AUNQUE ESTÉ VENCIDA. Un comercio que entró hace seis
 * minutos no dejó de ser suyo porque la base no conteste ahora, y vencer la
 * entrada por tiempo es una heurística de frescura, no un cambio de dueño.
 * Así, una caída de Mongo no desconecta a los comercios que venían andando.
 *
 * Si no hay ni caché vencida, se lanza. No es "denegar": es decir que no se
 * pudo averiguar, que es un 500 honesto y nuestro. Dejarlo pasar sería abrir
 * CORS a cualquiera justo cuando no podemos verificar nada.
 */
const isTenantOriginAllowed = async hostnameCandidates => {
  if (!env.allowDynamicTenantOrigins) return false

  const cacheKey = hostnameCandidates.join('|')
  const cached = corsOriginCache.get(cacheKey)

  if (cached && Date.now() - cached.ts < CORS_CACHE_TTL) {
    return cached.allowed
  }

  const recurrirACacheVencida = causa => {
    if (cached) {
      logger.warn(
        `CORS: la base no respondió (${causa}); se usa la caché vencida para ${cacheKey}`,
      )
      return cached.allowed
    }

    const error = new Error(
      `No se pudo verificar el origen contra la base (${causa})`,
    )
    error.code = 'CORS_TENANT_LOOKUP_UNAVAILABLE'
    throw error
  }

  // readyState 1 es "conectado". Cualquier otro valor significa que la consulta
  // se encolaría, que es justamente lo que no queremos.
  if (estadoDeBase().readyState !== 1) {
    return recurrirACacheVencida('sin conexión')
  }

  let tenant

  try {
    tenant = await Tenant.findOne({
      status: 'active',
      $or: [
        { 'domains.hostname': { $in: hostnameCandidates } },
        { 'domains.normalizedHostname': { $in: hostnameCandidates } },
        { 'adminDomains.hostname': { $in: hostnameCandidates } },
        { 'adminDomains.normalizedHostname': { $in: hostnameCandidates } },

        { legacyDomains: { $in: hostnameCandidates } },
        { legacyAdminDomains: { $in: hostnameCandidates } },
      ],
    })
      .select('_id')
      .maxTimeMS(TOPE_DE_CONSULTA_MS)
      .lean()
  } catch (error) {
    return recurrirACacheVencida(error.message)
  }

  const allowed = Boolean(tenant)

  if (corsOriginCache.size >= CORS_CACHE_MAX) {
    const firstKey = corsOriginCache.keys().next().value
    if (firstKey) corsOriginCache.delete(firstKey)
  }

  corsOriginCache.set(cacheKey, { allowed, ts: Date.now() })

  return allowed
}

export const corsOptions = {
  credentials: env.corsCredentials,

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-CSRF-Token',
    'x-csrf-token',
    'X-Tenant-Domain',
    'x-tenant-domain',
    'X-Metric-Session-Id',
    'x-metric-session-id',
    'X-Requested-With',
    'x-access-token',
  ],

  exposedHeaders: [
    'X-CSRF-Token',
    'x-csrf-token',
  ],

  async origin(origin, callback) {
    try {
      // Requests server-to-server, curl, Postman o same-origin sin Origin.
      if (!origin) {
        return callback(null, true)
      }

      // Solo desarrollo.
      if (env.corsAllowAll && !env.isProduction) {
        return callback(null, true)
      }

      // Origins exactos globales.
      if (env.allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      // Localhost solo si está habilitado.
      if (env.allowLocalhost && isLocalhost(origin)) {
        return callback(null, true)
      }

      // Desarrollo local con dominios tipo henko.local / api.henko.local.
      if (isLocalDevelopmentOrigin(origin)) {
        return callback(null, true)
      }

      const hostnameCandidates = getHostnameCandidates(origin)

      // Subdominios de la plataforma.
      if (hostnameCandidates.some(isAllowedRootDomain)) {
        return callback(null, true)
      }

      // Custom domains / adminDomains desde DB.
      const allowedByTenant = await isTenantOriginAllowed(hostnameCandidates)

      if (allowedByTenant) {
        return callback(null, true)
      }

      // UN ORIGEN BLOQUEADO ES 403, NO 500
      //
      // Sin `statusCode`, el manejador global clasifica cualquier Error pelado
      // como 500. O sea que la política de CORS funcionando exactamente como se
      // diseñó se contabilizaba como falla del servidor: cada bot, cada escáner
      // y cada dominio mal configurado sumaba un 5xx. Eso es justo la señal que
      // se mira para encontrar incidentes reales, y quedaba enterrada bajo
      // ruido que no significa nada.
      //
      // El mensaje de la respuesta no repite el origen —ya está en el log, con
      // requestId— porque es un valor que manda quien llama y no hay razón para
      // devolvérselo.
      const bloqueo = new Error('Origen no permitido')
      bloqueo.statusCode = 403
      bloqueo.code = 'CORS_ORIGIN_BLOCKED'
      bloqueo.origin = origin

      return callback(bloqueo, false)
    } catch (error) {
      // Distinto caso: acá falló algo nuestro —la consulta que resuelve los
      // dominios de los comercios, por ejemplo—. Eso sí es 500 y tiene que
      // seguir contándose como tal.
      return callback(error, false)
    }
  },
}

export default corsOptions
