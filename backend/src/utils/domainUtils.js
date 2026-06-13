// 📁 src/utils/domainUtils.js
// Utilidades compartidas de dominio para arquitectura multi-tenant

// =====================================================
// Normalización
// =====================================================

export const normalizeDomainValue = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split(',')[0]
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/:\d+$/, '')
}

export const normalizeHostname = value => {
  return normalizeDomainValue(value).replace(/^www\./, '')
}

export const normalizeSlug = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

export const withoutWww = value => {
  return String(value || '').replace(/^www\./, '')
}

/**
 * Construye los dominios internos de un tenant sin repetir el slug cuando el
 * tenant representa el dominio raíz de la plataforma.
 *
 * Ejemplos:
 * - henko + henko.local => henko.local / admin.henko.local
 * - tienda + henko.local => tienda.henko.local / admin.tienda.henko.local
 */
export const buildPlatformTenantDomains = ({
  slug,
  publicBaseDomain,
  adminBaseDomain,
}) => {
  const normalizedSlug = normalizeSlug(slug)
  const publicBase = normalizeHostname(publicBaseDomain)
  const adminBase = normalizeHostname(adminBaseDomain)

  if (!normalizedSlug) {
    throw new Error('Slug requerido para construir dominios del tenant')
  }

  if (!publicBase) {
    throw new Error('Dominio público base requerido')
  }

  const shopDomain =
    publicBase === normalizedSlug || publicBase.startsWith(`${normalizedSlug}.`)
      ? publicBase
      : `${normalizedSlug}.${publicBase}`

  if (!adminBase) {
    return {
      shopDomain,
      adminDomain: `admin.${shopDomain}`,
    }
  }

  if (shopDomain === publicBase) {
    return {
      shopDomain,
      adminDomain: adminBase,
    }
  }

  const adminPrefix = adminBase.endsWith(`.${publicBase}`)
    ? adminBase.slice(0, -(publicBase.length + 1))
    : ''

  return {
    shopDomain,
    adminDomain: adminPrefix
      ? `${adminPrefix}.${shopDomain}`
      : `admin.${shopDomain}`,
  }
}

// =====================================================
// Candidatos de resolución
// =====================================================

export const getDomainCandidates = value => {
  const raw = normalizeDomainValue(value)

  if (!raw) return []

  const normalized = normalizeHostname(raw)

  return [...new Set(
    [
      raw,
      normalized,
      withoutWww(raw),
      withoutWww(normalized),
    ]
      .filter(Boolean)
      .map(item => String(item).trim().toLowerCase()),
  )]
}

// =====================================================
// Helpers
// =====================================================

export const getDomainHostname = domain => {
  if (!domain) return null

  if (typeof domain === 'string') {
    return normalizeDomainValue(domain)
  }

  return normalizeDomainValue(domain.hostname || domain.normalizedHostname || '')
}

export const isActiveDomain = domain => {
  if (!domain) return false

  if (typeof domain === 'string') {
    // Legacy domains no tenían estado; se consideran activos mientras existan.
    return true
  }

  return domain.status === 'active'
}

export const buildDomainKeys = ({ domains = [], adminDomains = [] } = {}) => {
  return [...new Set(
    [...domains, ...adminDomains]
      .map(getDomainHostname)
      .filter(Boolean)
      .map(normalizeHostname),
  )]
}
