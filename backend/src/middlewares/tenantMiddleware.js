// 📁 src/middlewares/tenantMiddleware.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT

import Tenant from '../models/tenantModel.js'
import { sendResponse } from '../utils/response.js'
import { env } from '../../config/env.js'
import logger from '../../config/logger.js'

import {
  getDomainCandidates,
  normalizeHostname,
} from '../utils/domainUtils.js'
import {
  isValidObjectId,
  toObjectId,
} from '../utils/requestContext.js'

import {
  runWithTenantContext,
} from '../utils/tenantRequestContext.js'
import expressAsyncHandler from 'express-async-handler'

// =====================================================
// Configuración
// =====================================================

const isDev = env.isDevelopment
const isTest = env.nodeEnv === 'test'

const DEV_DOMAINS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
])

const CACHE_TTL = 5 * 60 * 1000
const CLEANUP_INTERVAL = 30 * 60 * 1000
const MAX_CACHE_SIZE = 5000

const tenantCache = new Map()

// =====================================================
// Utilidades internas
// =====================================================

const getHeaderValue = (req, headerName) => {
  const value = req.headers?.[headerName]
  return Array.isArray(value) ? value[0] : value
}

const getHostResolutionInput = req => {
  const explicitTenantHeader =
    getHeaderValue(req, env.tenantHeader) ||
    getHeaderValue(req, 'x-tenant-domain') ||
    null

  const forwardedHost = getHeaderValue(req, 'x-forwarded-host') || null
  const hostHeader = getHeaderValue(req, 'host') || null

  return {
    explicitTenantHeader,
    forwardedHost,
    hostHeader,
    selectedHost:
      explicitTenantHeader ||
      forwardedHost ||
      hostHeader ||
      '',
  }
}

const getApiDomain = () => {
  return normalizeHostname(env.apiDomain || process.env.API_DOMAIN || '')
}

const isApiHostWithoutTenantHeader = ({ explicitTenantHeader, selectedHost }) => {
  const apiDomain = getApiDomain()

  if (!apiDomain) return false

  return (
    !explicitTenantHeader &&
    normalizeHostname(selectedHost) === apiDomain
  )
}

const extractDomain = req => {
  const hostInput = getHostResolutionInput(req)
  const candidates = getDomainCandidates(hostInput.selectedHost)

  return {
    ...hostInput,
    rawHost: hostInput.selectedHost,
    host: candidates[0] || null,
    candidates,
  }
}

const getCacheKey = candidates => {
  return `tenant:${candidates.join('|')}`
}

const NEGATIVE_CACHE_TTL = 60 * 1000

const NOT_FOUND_SENTINEL = Symbol('NOT_FOUND')

const getCachedTenant = candidates => {
  const key = getCacheKey(candidates)
  const cached = tenantCache.get(key)

  if (!cached) return undefined

  const ttl = cached.data === NOT_FOUND_SENTINEL ? NEGATIVE_CACHE_TTL : CACHE_TTL

  if (Date.now() - cached.timestamp > ttl) {
    tenantCache.delete(key)
    return undefined
  }

  // LRU: re-insert to move to end of Map iteration order
  tenantCache.delete(key)
  tenantCache.set(key, cached)

  return cached.data === NOT_FOUND_SENTINEL ? null : cached.data
}

const inflight = new Map()

const getOrFetchTenant = async candidates => {
  const cached = getCachedTenant(candidates)
  if (cached !== undefined) return cached

  const key = getCacheKey(candidates)

  if (inflight.has(key)) {
    return inflight.get(key)
  }

  const promise = findTenantByDomainCandidates(candidates)
    .then(tenant => {
      if (tenantCache.size >= MAX_CACHE_SIZE) {
        const firstKey = tenantCache.keys().next().value
        if (firstKey) tenantCache.delete(firstKey)
      }

      tenantCache.set(key, {
        data: tenant || NOT_FOUND_SENTINEL,
        timestamp: Date.now(),
      })

      return tenant
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)

  return promise
}

const deleteCacheByDomain = domain => {
  const candidates = getDomainCandidates(domain)

  for (const key of tenantCache.keys()) {
    if (candidates.some(candidate => key.includes(candidate))) {
      tenantCache.delete(key)
      inflight.delete(key)
    }
  }
}

const clearTenantContext = req => {
  req.tenantId = null
  req.tenant = null
  req.isAdminContext = false
  // Sin comercio no hay superficie de ninguna clase. Dejarlo en true haría que
  // requireShopDomain pasara sobre un contexto limpio.
  req.isShopContext = false
}

/** ¿Esta entrada de dominio corresponde al host que llegó? */
const domainMatches = (domain, candidates) => {
  if (typeof domain === 'string') {
    return getDomainCandidates(domain).some(candidate => candidates.includes(candidate))
  }

  if (domain?.status !== 'active') return false

  return [domain.hostname, domain.normalizedHostname]
    .filter(Boolean)
    .flatMap(value => getDomainCandidates(value))
    .some(value => candidates.includes(value))
}

/**
 * Qué superficies sirve el host que llegó: panel, tienda, o las dos.
 *
 * ANTES ERA UN SOLO BOOLEANO, Y POR ESO NO HABÍA DOMINIO ÚNICO POSIBLE
 *
 * `isAdminDomainForTenant` devolvía true/false mirando solo `adminDomains`, y
 * las dos guardas de ruta son excluyentes: requireAdminDomain exige contexto
 * admin, requireShopDomain lo prohíbe. Con un dominio sirviendo las dos cosas,
 * cualquiera de las dos respuestas rompía la mitad del sistema — 27 rutas de
 * panel o 30 de tienda, según de qué lado cayera.
 *
 * Son dos preguntas independientes, no una con dos respuestas. Un dominio
 * puede ser superficie de panel, de tienda, o de ambas.
 *
 * COMPATIBLE CON LO QUE YA HAY, POR CONSTRUCCIÓN
 *
 *   dominio en domains, context 'storefront'  → tienda        (como antes)
 *   dominio en adminDomains                   → panel         (como antes)
 *   dominio con context 'both'                → las dos       (lo nuevo)
 *
 * Un comercio con dominios separados obtiene exactamente los mismos valores
 * que obtenía con el booleano viejo.
 */
const resolveSurfacesForTenant = (tenant, candidates) => {
  let isAdminSurface = false
  let isShopSurface = false

  const admin = Array.isArray(tenant?.adminDomains) ? tenant.adminDomains : []
  const shop = Array.isArray(tenant?.domains) ? tenant.domains : []

  for (const domain of admin) {
    if (!domainMatches(domain, candidates)) continue

    isAdminSurface = true
    if (domain?.context === 'both') isShopSurface = true
  }

  for (const domain of shop) {
    if (!domainMatches(domain, candidates)) continue

    isShopSurface = true
    if (domain?.context === 'both' || domain?.context === 'admin') isAdminSurface = true
  }

  return { isAdminSurface, isShopSurface }
}

const findTenantByDomainCandidates = async candidates => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null

  return Tenant.findOne({
    status: 'active',
    $or: [
      {
        domains: {
          $elemMatch: {
            status: 'active',
            $or: [
              { hostname: { $in: candidates } },
              { normalizedHostname: { $in: candidates } },
            ],
          },
        },
      },
      {
        adminDomains: {
          $elemMatch: {
            status: 'active',
            $or: [
              { hostname: { $in: candidates } },
              { normalizedHostname: { $in: candidates } },
            ],
          },
        },
      },
      { legacyDomains: { $in: candidates } },
      { legacyAdminDomains: { $in: candidates } },
    ],
  }).select('_id name slug domains adminDomains status plan email').lean()
}

const attachTenantToRequest = ({
  req,
  tenant,
  host,
  rawHost,
  isAdminContext,
  // Por defecto, lo contrario de admin: es lo que valía cuando el contexto era
  // un solo booleano, y mantiene el comportamiento de cualquier llamador que
  // todavía no informe las dos superficies.
  isShopContext = !isAdminContext,
}) => {
  req.tenantId = tenant._id
  req.tenant = tenant
  req.isAdminContext = isAdminContext
  req.isShopContext = isShopContext

  return {
    tenantId: tenant._id,
    slug: tenant.slug,
    domain: host,
    rawHost,
    isAdmin: isAdminContext,
    isShop: isShopContext,
  }
}

// =====================================================
// Middleware: resolver tenant por slug
// =====================================================

const normalizeDomain = value => {
  return String(value || '')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^www\./, '')
    .trim()
    .toLowerCase()
}

export const resolveTenant = expressAsyncHandler(async (req, res) => {
  const rawDomain =
    req.query.domains ||
    req.query.domain ||
    req.headers['x-tenant-domain'] ||
    req.headers['x-forwarded-host'] ||
    req.headers.host

  const domain = normalizeDomain(rawDomain)

  if (!domain) {
    return res.status(400).json({
      success: false,
      message: 'Dominio requerido',
    })
  }

  const candidates = [...new Set([
    domain,
    domain.replace(/^www\./, ''),
  ])]

  const tenant = await Tenant.findOne({
    status: 'active',
    $or: [
      // Modelo actual como array de objetos
      { 'domains.hostname': { $in: candidates } },
      { 'domains.normalizedHostname': { $in: candidates } },
      { 'adminDomains.hostname': { $in: candidates } },
      { 'adminDomains.normalizedHostname': { $in: candidates } },

      // Compatibilidad por si algún tenant usa array de strings
      { domains: { $in: candidates } },
      { adminDomains: { $in: candidates } },

      // Compatibilidad legacy
      { legacyDomains: { $in: candidates } },
      { legacyAdminDomains: { $in: candidates } },
    ],
  }).lean()

  if (!tenant) {
    return res.status(404).json({
      success: false,
      message: 'Tenant no encontrado',
      debug: process.env.NODE_ENV !== 'production'
        ? { domain, candidates }
        : undefined,
    })
  }

  return res.status(200).json({
    success: true,
    data: {
      _id: tenant._id,
      id: tenant._id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      domains: tenant.domains,
      adminDomains: tenant.adminDomains,
      ownerUserId: tenant.ownerUserId,
    },
  })
})

// =====================================================
// Middleware: resolver tenant por dominio
// =====================================================

export const resolveTenantByDomain = async (req, res, next) => {
  try {
    const {
      explicitTenantHeader,
      rawHost,
      host,
      candidates,
    } = extractDomain(req)

    if (!host || candidates.length === 0) {
      return sendResponse(res, 400, false, 'No se pudo determinar el dominio')
    }

    if (
      isApiHostWithoutTenantHeader({
        explicitTenantHeader,
        selectedHost: rawHost,
      })
    ) {
      logger.warn('[TENANT] Falta x-tenant-domain sobre host de API', {
        host: req.headers?.host,
        forwardedHost: req.headers?.['x-forwarded-host'],
        origin: req.headers?.origin,
        hostname: req.hostname,
        tenantHeader: env.tenantHeader,
        headerNames: Object.keys(req.headers || {}).sort(),
      })

      return sendResponse(
        res,
        400,
        false,
        'Se requiere x-tenant-domain para resolver el comercio desde el host de API',
      )
    }

    if (isDev && DEV_DOMAINS.has(host)) {
      const defaultTenantId = toObjectId(process.env.DEFAULT_TENANT_ID)

      if (defaultTenantId) {
        const tenant = {
          _id: defaultTenantId,
          name: 'Development',
          slug: 'development',
          status: 'active',
        }

        const context = attachTenantToRequest({
          req,
          tenant,
          host,
          rawHost,
          isAdminContext: false,
        })

        if (isDev) {
          logger.debug(`[DEV BYPASS] Tenant: ${defaultTenantId}`)
        }

        return runWithTenantContext(context, () => next())
      }
    }

    const cachedCheck = getCachedTenant(candidates)
    const fromCache = cachedCheck !== undefined
    const tenant = fromCache ? cachedCheck : await getOrFetchTenant(candidates)

    if (!tenant) {
      if (isDev) {
        logger.warn(`[TENANT ERROR] No encontrado: ${host}`, {
          rawHost,
          candidates,
        })
      }

      return sendResponse(res, 404, false, 'El comercio no existe o está inactivo')
    }

    const { isAdminSurface, isShopSurface } = resolveSurfacesForTenant(tenant, candidates)

    const context = attachTenantToRequest({
      req,
      tenant,
      host,
      rawHost,
      isAdminContext: isAdminSurface,
      isShopContext: isShopSurface,
    })

    if (isDev) {
      logger.debug(
        // Las tres combinaciones posibles, porque ahora existe la doble. Un log
        // que dijera solo ADMIN o SHOP escondería justamente el caso nuevo.
        `[TENANT] ${tenant.name} | ${fromCache ? 'CACHE HIT' : 'CACHE MISS'} | ${
          isAdminSurface && isShopSurface ? 'ADMIN+SHOP' : isAdminSurface ? 'ADMIN' : 'SHOP'
        } | ${host}`,
      )
    }

    return runWithTenantContext(context, () => next())
  } catch (error) {
    clearTenantContext(req)
    return next(error)
  }
}

// =====================================================
// Middleware: requiere tenant
// =====================================================

export const requireTenant = (req, res, next) => {
  if (!req.tenantId || !isValidObjectId(req.tenantId)) {
    return sendResponse(res, 400, false, 'Tenant no identificado')
  }

  return next()
}

// =====================================================
// Middleware: solo admin domain
// =====================================================

export const requireAdminDomain = (req, res, next) => {
  if (!req.isAdminContext) {
    return sendResponse(res, 403, false, 'Acceso solo desde dominio administrativo')
  }

  return next()
}

// =====================================================
// Middleware: solo storefront
// =====================================================

export const requireShopDomain = (req, res, next) => {
  // Pregunta "¿sos superficie de tienda?" y no "¿no sos admin?".
  //
  // Con la negación, un dominio que sirve las dos cosas quedaba fuera: era
  // admin, entonces no era tienda, y las 30 rutas de storefront devolvían 403.
  // Preguntando por lo que se necesita —que sea tienda— el dominio doble pasa
  // las dos guardas, y los dominios separados se comportan igual que siempre
  // porque para ellos las dos superficies siguen siendo excluyentes.
  if (!req.isShopContext) {
    return sendResponse(res, 403, false, 'Acceso no disponible desde panel admin')
  }

  return next()
}

// =====================================================
// Utils para controllers
// =====================================================
//
// ACÁ VIVÍA UN SEGUNDO getTenantIdFromRequest, Y ERA UNA TRAMPA.
//
// Tenía el MISMO NOMBRE que el de utils/requestContext.js y la precedencia
// INVERTIDA:
//
//   este            req.tenantId || req.user?.tenantId   → ganaba el DOMINIO
//   requestContext  preferUserTenant = true              → gana el JWT
//
// El dominio sale de `x-tenant-domain`, un header que manda el cliente. Un
// controller que resolviera el comercio con esta versión habría dejado que un
// usuario autenticado de un comercio operara sobre otro con solo cambiar ese
// header — y el import correcto y el peligroso se veían idénticos en el código.
//
// No lo usaba nadie: los tres controllers que llaman a esa función
// (colorCtrl, enqCtrl, userMetricsCtrl) importan la de requestContext. Se borra
// en vez de renombrarse porque un duplicado muerto con el nombre correcto es
// exactamente lo que un autocompletado elige mal algún día.
//
// La resolución de comercio para controllers vive en un solo lugar:
// utils/requestContext.js.



export const cleanupTenantCache = () => {
  const now = Date.now()
  let cleaned = 0

  for (const [key, value] of tenantCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      tenantCache.delete(key)
      cleaned += 1
    }
  }

  if (isDev && cleaned > 0) {
    logger.debug(`[CACHE CLEANUP] Eliminados: ${cleaned} entries`)
  }

  return cleaned
}

if (!isTest) {
  const interval = setInterval(cleanupTenantCache, CLEANUP_INTERVAL)

  if (typeof interval.unref === 'function') {
    interval.unref()
  }
}
