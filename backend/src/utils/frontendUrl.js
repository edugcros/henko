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

// La tienda corre en 3002 y el panel en 3001 (ver .claude/launch.json y los
// scripts dev de cada paquete), así que el puerto depende de a cuál de los dos
// apunta el link.
const STOREFRONT_DEV_PORT = '3002'
const ADMIN_DEV_PORT = '3001'

const appendDevelopmentPortIfNeeded = (value, port = STOREFRONT_DEV_PORT) => {
  if (env.isProduction) return value

  try {
    const url = new URL(value)

    if (!url.port && url.hostname.endsWith('.local')) {
      url.port = port
    }

    return trimTrailingSlash(url.toString())
  } catch {
    return value
  }
}

const getTenantAdminUrl = tenant => {
  if (!tenant) return null

  if (tenant.adminUrl && (!env.isProduction || !isLocalHostname(tenant.adminUrl))) {
    return trimTrailingSlash(tenant.adminUrl)
  }

  const domain = getActiveDomain(tenant.adminDomains)

  if (!domain) return null

  return ensureUrl(domain)
}

// =====================================================
// Public API
// =====================================================

export const getFrontendBaseUrl = (req = null, tenant = null) => {
  const envFallback =
    env.clientUrl ||
    env.shopFrontendUrl ||
    env.app?.url ||
    null

  /**
   * El dominio del comercio manda, también en producción.
   *
   * Antes el fallback del ENV se devolvía primero cuando isProduction, para
   * evitar mandar links a dominios locales tipo henko.local. El efecto
   * colateral era peor que el problema: en un producto multi-tenant, TODOS
   * los comercios mandaban los mails de verificación y de reseteo apuntando
   * a la tienda por defecto de la plataforma. Un comprador que se registraba
   * en la tienda de un comercio recibía un link a otro sitio.
   *
   * El riesgo original ya está cubierto aguas abajo: getTenantStorefrontUrl
   * descarta hostnames locales cuando isProduction (ver getActiveDomain y las
   * ramas de shopUrl/storefrontUrl), así que devuelve null antes que un
   * .local. El ENV sigue siendo el respaldo cuando el tenant no tiene un
   * dominio propio utilizable.
   */
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
    const devDomain = env.publicBaseDomain || 'localhost'
    return `http://${devDomain}:3002`
  }

  throw new Error('CLIENT_URL / SHOP_FRONTEND_URL no configurado')
}

export const buildFrontendUrl = (path, req = null, tenant = null) => {
  const baseUrl = getFrontendBaseUrl(req, tenant)
  const cleanPath = String(path || '').replace(/^\/+/, '')

  return `${baseUrl}/${cleanPath}`
}

/**
 * Base del PANEL del comercio, con la misma prioridad que la tienda: primero
 * el dominio propio del tenant, después el del entorno.
 *
 * Existe porque el dueño de un comercio no se verifica en la tienda. Su mail
 * de alta apuntaba al storefront —donde además no tiene cuenta de comprador—
 * y terminaba en un "ya podés iniciar sesión" sobre la aplicación equivocada.
 */
export const getAdminBaseUrl = (req = null, tenant = null) => {
  const envFallback = env.adminUrl || env.adminFrontendUrl || null

  const tenantUrl = getTenantAdminUrl(tenant)

  if (tenantUrl) {
    return appendDevelopmentPortIfNeeded(tenantUrl, ADMIN_DEV_PORT)
  }

  if (envFallback) {
    return trimTrailingSlash(envFallback)
  }

  if (!env.isProduction) {
    const devDomain = env.adminBaseDomain || 'localhost'
    return `http://${devDomain}:${ADMIN_DEV_PORT}`
  }

  throw new Error('ADMIN_URL / ADMIN_FRONTEND_URL no configurado')
}

export const buildAdminUrl = (path, req = null, tenant = null) => {
  const baseUrl = getAdminBaseUrl(req, tenant)
  const cleanPath = String(path || '').replace(/^\/+/, '')

  return `${baseUrl}/${cleanPath}`
}