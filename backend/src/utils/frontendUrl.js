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

  const primaryActive =
    domains.find(domain => {
      if (typeof domain === 'string') return false

      return (
        domain?.isPrimary === true &&
        domain?.status === 'active' &&
        getDomainHostname(domain)
      )
    }) || null

  if (primaryActive) {
    return getDomainHostname(primaryActive)
  }

  const firstActive =
    domains.find(domain => {
      if (typeof domain === 'string') return Boolean(domain)

      return domain?.status !== 'deleted' && getDomainHostname(domain)
    }) || null

  return getDomainHostname(firstActive)
}

const getTenantStorefrontUrl = tenant => {
  if (!tenant) return null

  if (tenant.shopUrl) return trimTrailingSlash(tenant.shopUrl)
  if (tenant.storefrontUrl) return trimTrailingSlash(tenant.storefrontUrl)
  if (tenant.urls?.storefront) return trimTrailingSlash(tenant.urls.storefront)

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

export const getFrontendBaseUrl = (req, tenant = null) => {
  const tenantUrl = getTenantStorefrontUrl(tenant)

  if (tenantUrl) {
    return appendDevelopmentPortIfNeeded(tenantUrl)
  }

  const requestUrl = getRequestFrontendUrl(req)

  if (requestUrl) {
    return appendDevelopmentPortIfNeeded(requestUrl)
  }

  const fallback =
    env.clientUrl ||
    env.shopFrontendUrl ||
    env.app?.url ||
    null

  if (fallback) {
    return trimTrailingSlash(fallback)
  }

  if (!env.isProduction) {
    return 'http://henko.local:3002'
  }

  throw new Error('CLIENT_URL / SHOP_FRONTEND_URL no configurado')
}

export const buildFrontendUrl = (path, req, tenant = null) => {
  const baseUrl = getFrontendBaseUrl(req, tenant)
  const cleanPath = String(path || '').replace(/^\/+/, '')

  return `${baseUrl}/${cleanPath}`
}