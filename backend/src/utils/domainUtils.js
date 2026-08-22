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

  const isAdminSubdomainOfPublic = adminBase.endsWith(`.${publicBase}`)

  if (isAdminSubdomainOfPublic) {
    const adminPrefix = adminBase.slice(0, -(publicBase.length + 1))
    return {
      shopDomain,
      adminDomain: `${adminPrefix}.${shopDomain}`,
    }
  }

  return {
    shopDomain,
    adminDomain: `${normalizedSlug}.${adminBase}`,
  }
}

// =====================================================
// Slugs reservados — evitar colisión con infraestructura
// =====================================================

const RESERVED_SLUGS = new Set([
  'api', 'admin', 'www', 'mail', 'smtp', 'imap', 'pop',
  'ftp', 'sftp', 'ssh', 'cdn', 'assets', 'static', 'media',
  'ns1', 'ns2', 'ns3', 'dns', 'mx', 'autoconfig', 'autodiscover',
  'webmail', 'cpanel', 'whm', 'cgi', 'status', 'health',
  'blog', 'docs', 'support', 'help', 'app', 'dashboard',
  'login', 'signup', 'register', 'auth', 'oauth', 'sso',
  'graphql', 'ws', 'wss', 'socket', 'realtime',
  'test', 'staging', 'dev', 'demo', 'sandbox', 'preview',
  'null', 'undefined', 'root', 'system', 'platform',
  'billing', 'payment', 'checkout', 'store', 'shop',
  'henko', 'noreply', 'no-reply', 'postmaster', 'abuse',
])

// Distancia de edición simple (Levenshtein) para atrapar typos de slugs
// reservados críticos (ej. "henkoo", "henk0" en vez de "henko") que de
// otro modo pasarían la validación por no matchear el Set exacto.
const levenshteinDistance = (a, b) => {
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)])
  matrix[0] = Array.from({ length: cols }, (_, j) => j)

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  return matrix[rows - 1][cols - 1]
}

// Slugs que, por ser el nombre de la propia plataforma, son especialmente
// sensibles a typos (generan subdominios sintácticamente válidos pero sin
// DNS/hosts configurado, o habilitan typosquatting de la marca).
const TYPO_SENSITIVE_SLUGS = ['henko']
const TYPO_DISTANCE_THRESHOLD = 1

export const isReservedSlug = slug => {
  const normalized = normalizeSlug(slug)

  if (RESERVED_SLUGS.has(normalized)) return true

  return TYPO_SENSITIVE_SLUGS.some(
    reserved => levenshteinDistance(normalized, reserved) <= TYPO_DISTANCE_THRESHOLD,
  )
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
