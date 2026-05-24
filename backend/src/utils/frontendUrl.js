// 📁 src/utils/frontendUrl.js
import { env } from '../../config/env.js'

// =====================================================
// Helpers
// =====================================================

const trimTrailingSlash = value => {
  return String(value || '').replace(/\/+$/, '')
}

const normalizeHostname = value => {
  if (!value) return ''

  let raw = String(value).trim().toLowerCase()

  try {
    raw = new URL(raw).hostname
  } catch {
    raw = raw
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(',')[0]
      .split(':')[0]
      .trim()
      .toLowerCase()
  }

  return raw.replace(/^www\./, '')
}

const isLocalHostname = hostname => {
  const value = normalizeHostname(hostname)

  return (
    value === 'localhost' ||
    value === '127.0.0.1' ||
    value.endsWith('.local')
  )
}

const ensureUrl = value => {
  if (!value) return null

  const clean = String(value).trim()

  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return trimTrailingSlash(clean)
  }

  return trimTrailingSlash(`${env.isProduction ? 'https' : 'http'}://${clean}`)
}

const getDomainHostname = domain => {
  if (!domain) return null

  if (typeof domain === 'string') {
    return domain
  }

  return domain.hostname || domain.normalizedHostname || null
}

const getActiveDomain = domains => {
  if (!Array.isArray(domains)) return null

  const activeDomains = domains
    .map(getDomainHostname)
    .filter(Boolean)
    .filter(hostname => {
      if (!env.isProduction) return true
      return !isLocalHostname(hostname)
    })

  if (activeDomains.length === 0) return null

  const primaryActive = domains.find(domain => {
    if (typeof domain === 'string') return false

    const hostname = getDomainHostname(domain)

    return (
      domain?.isPrimary === true &&
      domain?.status === 'active' &&
      hostname &&
      (!env.isProduction || !isLocalHostname(hostname))
    )
  })

  if (primaryActive) {
    return getDomainHostname(primaryActive)
  }

  return activeDomains[0]
}

const getTenantStorefrontUrl = tenant => {
  if (!tenant) return null

  if (tenant.shopUrl && (!env.isProduction || !isLocalHostname(tenant.shopUrl))) {
    return trimTrailingSlash(tenant.shopUrl)
  }

  if (tenant.storefrontUrl && (!env.isProduction || !isLocalHostname(tenant.storefrontUrl))) {
    return trimTrailingSlash(tenant.storefrontUrl)
  }

  if (tenant.urls?.storefront && (!env.isProduction || !isLocalHostname(tenant.urls.storefront))) {
    return trimTrailingSlash(tenant.urls.storefront)
  }

  const domain = getActiveDomain(tenant.domains)

  if (!domain) return null

  return ensureUrl(domain)
}

const getRequestFrontendUrl = req => {
  if (!req) return null

  const tenantHeader =
    req.headers?.[env.tenantHeader] ||
    req.headers?.['x-tenant-domain'] ||
    req.headers?.['X-Tenant-Domain']

  const origin = req.headers?.origin
  const referer = req.headers?.referer || req.headers?.referrer

  const source = tenantHeader || origin || referer

  if (!source) return null

  const hostname = normalizeHostname(source)

  if (!hostname) return null

  if (env.isProduction && isLocalHostname(hostname)) {
    return null
  }

  return ensureUrl(hostname)
}

const appendDevelopmentPortIfNeeded = value => {
  if (env.isProduction) return value

  try {
    const url = new URL(value)

    if (!url.port && url.hostname.endsWith('.local')) {
      url.port = '3002'
    }

    return trimTrailingSlash(url.toString())
  } catch {
    return value
  }
}

// =====================================================
// Public API
// =====================================================

export const getFrontendBaseUrl = (req = null, tenant = null) => {
  /**
   * En producción/predeploy, el fallback explícito del ENV debe tener prioridad
   * para evitar enviar emails con dominios locales como henko.local.
   */
  const envFallback =
    env.clientUrl ||
    env.shopFrontendUrl ||
    env.app?.url ||
    null

  if (env.isProduction && envFallback) {
    return trimTrailingSlash(envFallback)
  }

  const tenantUrl = getTenantStorefrontUrl(tenant)

  if (tenantUrl) {
    return appendDevelopmentPortIfNeeded(tenantUrl)
  }

  const requestUrl = getRequestFrontendUrl(req)

  if (requestUrl) {
    return appendDevelopmentPortIfNeeded(requestUrl)
  }

  if (envFallback) {
    return trimTrailingSlash(envFallback)
  }

  if (!env.isProduction) {
    return 'http://henko.local:3002'
  }

  throw new Error('CLIENT_URL / SHOP_FRONTEND_URL no configurado')
}

export const buildFrontendUrl = (path, req = null, tenant = null) => {
  const baseUrl = getFrontendBaseUrl(req, tenant)
  const cleanPath = String(path || '').replace(/^\/+/, '')

  return `${baseUrl}/${cleanPath}`
}