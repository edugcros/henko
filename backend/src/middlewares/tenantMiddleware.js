// 📁 src/middlewares/tenantMiddleware.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT

import mongoose from 'mongoose'

import Tenant from '../models/tenantModel.js'
import { sendResponse } from '../utils/response.js'
import { env } from '../../config/env.js'

import {
  getDomainCandidates,
  normalizeHostname,
  normalizeSlug,
} from '../utils/domainUtils.js'

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

const toObjectId = value => {
  if (!value) return null

  const id = String(value)

  if (!mongoose.Types.ObjectId.isValid(id)) return null

  return new mongoose.Types.ObjectId(id)
}

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

const getCachedTenant = candidates => {
  const key = getCacheKey(candidates)
  const cached = tenantCache.get(key)

  if (!cached) return null

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    tenantCache.delete(key)
    return null
  }

  return cached.data
}

const setCachedTenant = (candidates, tenant) => {
  if (!tenant) return

  if (tenantCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tenantCache.keys().next().value
    if (firstKey) tenantCache.delete(firstKey)
  }

  tenantCache.set(getCacheKey(candidates), {
    data: tenant,
    timestamp: Date.now(),
  })
}

const deleteCacheByDomain = domain => {
  const candidates = getDomainCandidates(domain)

  for (const key of tenantCache.keys()) {
    if (candidates.some(candidate => key.includes(candidate))) {
      tenantCache.delete(key)
    }
  }
}

const clearTenantContext = req => {
  req.tenantId = null
  req.tenant = null
  req.isAdminContext = false
}

const isAdminDomainForTenant = (tenant, candidates) => {
  if (!tenant?.adminDomains || !Array.isArray(tenant.adminDomains)) {
    return false
  }

  return tenant.adminDomains.some(domain => {
    if (typeof domain === 'string') {
      const domainCandidates = getDomainCandidates(domain)
      return domainCandidates.some(candidate => candidates.includes(candidate))
    }

    if (domain.status !== 'active') return false

    const values = [
      domain.hostname,
      domain.normalizedHostname,
    ]
      .filter(Boolean)
      .flatMap(value => getDomainCandidates(value))

    return values.some(value => candidates.includes(value))
  })
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
  }).select('_id name slug domains adminDomains status plan')
}

const attachTenantToRequest = ({
  req,
  tenant,
  host,
  rawHost,
  isAdminContext,
}) => {
  req.tenantId = tenant._id
  req.tenant = tenant
  req.isAdminContext = isAdminContext

  return {
    tenantId: tenant._id,
    slug: tenant.slug,
    domain: host,
    rawHost,
    isAdmin: isAdminContext,
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
          console.log(`[DEV BYPASS] Tenant: ${defaultTenantId}`)
        }

        return runWithTenantContext(context, () => next())
      }
    }

    let tenant = getCachedTenant(candidates)
    let fromCache = true

    if (!tenant) {
      fromCache = false
      tenant = await findTenantByDomainCandidates(candidates)

      if (tenant) {
        setCachedTenant(candidates, tenant)
      }
    }

    if (!tenant) {
      if (isDev) {
        console.error(`[TENANT ERROR] No encontrado: ${host}`, {
          rawHost,
          candidates,
        })
      }

      return sendResponse(res, 404, false, 'El comercio no existe o está inactivo')
    }

    const isAdminContext = isAdminDomainForTenant(tenant, candidates)

    const context = attachTenantToRequest({
      req,
      tenant,
      host,
      rawHost,
      isAdminContext,
    })

    if (isDev) {
      console.log(
        `[TENANT] ${tenant.name} | ${fromCache ? 'CACHE HIT' : 'CACHE MISS'} | ${isAdminContext ? 'ADMIN' : 'SHOP'} | ${host}`,
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
  if (!req.tenantId || !mongoose.Types.ObjectId.isValid(String(req.tenantId))) {
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
  if (req.isAdminContext) {
    return sendResponse(res, 403, false, 'Acceso no disponible desde panel admin')
  }

  return next()
}

// =====================================================
// Utils para controllers
// =====================================================

export const getTenantIdFromRequest = req => {
  const tenantId = req.tenantId || req.user?.tenantId

  return toObjectId(tenantId)
}

export const invalidateTenantCache = domain => {
  deleteCacheByDomain(domain)
}

export const clearAllTenantCache = () => {
  tenantCache.clear()
}

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
    console.log(`[CACHE CLEANUP] Eliminados: ${cleaned} entries`)
  }

  return cleaned
}

if (!isTest) {
  const interval = setInterval(cleanupTenantCache, CLEANUP_INTERVAL)

  if (typeof interval.unref === 'function') {
    interval.unref()
  }
}