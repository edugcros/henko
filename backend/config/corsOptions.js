// 📁 config/corsOptions.js
import Tenant from '../src/models/tenantModel.js'
import { env } from './env.js'

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

const isTenantOriginAllowed = async hostnameCandidates => {
  if (!env.allowDynamicTenantOrigins) return false

  const tenant = await Tenant.findOne({
    status: 'active',
    $or: [
      { 'domains.hostname': { $in: hostnameCandidates } },
      { 'domains.normalizedHostname': { $in: hostnameCandidates } },
      { 'adminDomains.hostname': { $in: hostnameCandidates } },
      { 'adminDomains.normalizedHostname': { $in: hostnameCandidates } },

      { legacyDomains: { $in: hostnameCandidates } },
      { legacyAdminDomains: { $in: hostnameCandidates } },
    ],
  }).select('_id')

  return Boolean(tenant)
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

      return callback(new Error(`CORS bloqueado para origen: ${origin}`), false)
    } catch (error) {
      return callback(error, false)
    }
  },
}

export default corsOptions
