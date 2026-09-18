// 📁 src/services/tenant/tenantDomainService.js
//
// Los dominios propios que carga un comercio.
//
// QUÉ RESUELVE, Y QUÉ NO
//
// El modelo ya tenía todo lo necesario —hostname, verificationToken,
// verifiedAt, sslStatus, lastCheckedAt, y un índice único sobre domainKeys— y
// no lo usaba nadie. Faltaba el flujo.
//
// Esto cubre el alta, la verificación de propiedad y la baja. La emisión del
// certificado la hace el proveedor de borde (Cloudflare for SaaS o equivalente)
// y se refleja en sslStatus, que ya nace en 'pending' para un custom_domain.
//
// LA VERIFICACIÓN DE PROPIEDAD NO ES UN TRÁMITE
//
// Sin ella, un comercio podría reclamar el dominio de otro —o uno ajeno a la
// plataforma— y HENKO se lo serviría. Por eso el dominio entra en
// `status: 'pending'`: findTenantByDomainCandidates exige 'active', así que un
// dominio sin verificar sencillamente no resuelve. La seguridad no depende de
// que nadie se equivoque después; depende de que el estado inicial sea inerte.
//
// POR QUÉ UN TXT EN UN SUBDOMINIO Y NO EN EL ÁPEX
//
// `_henko-verify.midominio.com` no compite con nada: el ápex suele tener SPF y
// otros TXT que no se pueden pisar, y pedirle al comercio que toque el registro
// donde vive su correo es pedirle que arriesgue el correo para probar que el
// dominio es suyo.

import { promises as dns } from 'node:dns'
import { randomBytes } from 'node:crypto'

import Tenant from '../../models/tenantModel.js'
import logger from '../../../config/logger.js'
import { env } from '../../../config/env.js'
import {
  normalizeDomainValue,
  normalizeHostname,
} from '../../utils/domainUtils.js'

/** El prefijo donde se busca el TXT de verificación. */
export const VERIFICATION_PREFIX = '_henko-verify'

const buildError = (statusCode, message) => {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/**
 * Un hostname aceptable: sin protocolo, sin ruta, sin puerto, con punto.
 *
 * Se exige el punto porque un valor sin él no es un dominio sino un nombre de
 * host interno, y aceptarlo dejaría entrar cosas como 'localhost'.
 */
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/**
 * Los dominios de la plataforma, que ningún comercio puede reclamar.
 *
 * Sin esto, un comercio podría cargar el subdominio de OTRO —o el dominio raíz
 * de HENKO— y como el alta lo deja en 'pending' hasta verificar, bastaría con
 * que quien controla ese DNS creara el TXT. El índice único sobre domainKeys no
 * alcanza: protege de reclamar un dominio YA cargado, no de reclamar uno que
 * todavía no existe en la base.
 */
const getPlatformRoots = () =>
  [env.rootDomain, env.publicBaseDomain, env.adminBaseDomain, env.apiDomain]
    .map(value => normalizeHostname(value || ''))
    .filter(Boolean)

const isPlatformDomain = hostname =>
  getPlatformRoots().some(root => hostname === root || hostname.endsWith(`.${root}`))

/** El hostname normalizado, o un error 400 con el motivo. */
const parseHostname = value => {
  const hostname = normalizeHostname(normalizeDomainValue(value || ''))

  if (!hostname) {
    throw buildError(400, 'Indicá el dominio que querés usar.')
  }

  if (!HOSTNAME_RE.test(hostname)) {
    throw buildError(
      400,
      'El dominio no es válido. Va solo el nombre, sin https:// ni barras (ej: mitienda.com.ar).',
    )
  }

  if (isPlatformDomain(hostname)) {
    throw buildError(400, 'Ese dominio pertenece a la plataforma y no se puede reclamar.')
  }

  return hostname
}

/** Lo que el comercio tiene que cargar en su DNS. */
const buildInstructions = (hostname, verificationToken) => ({
  verification: {
    type: 'TXT',
    name: `${VERIFICATION_PREFIX}.${hostname}`,
    value: verificationToken,
  },
  // El destino real lo define el proveedor de borde. Se informa desde el
  // entorno para no hardcodear infraestructura en el código.
  pointing: {
    type: 'CNAME',
    name: hostname,
    value: env.apiDomain || null,
  },
})

/** La forma que ve el comercio. Nunca incluye el token de otro dominio. */
const serializeDomain = domain => ({
  hostname: domain.hostname,
  type: domain.type,
  context: domain.context,
  status: domain.status,
  isPrimary: Boolean(domain.isPrimary),
  verifiedAt: domain.verifiedAt || null,
  sslStatus: domain.sslStatus,
  lastCheckedAt: domain.lastCheckedAt || null,
})

const findDomainEntry = (tenant, hostname) =>
  (tenant.domains || []).find(
    domain => normalizeHostname(domain.hostname) === hostname,
  )

export const listTenantDomains = async tenantId => {
  const tenant = await Tenant.findById(tenantId).select('domains')

  if (!tenant) throw buildError(404, 'Comercio no encontrado')

  return (tenant.domains || []).map(serializeDomain)
}

/**
 * Da de alta un dominio propio, en estado pendiente.
 *
 * Nace con `context: 'both'`: un comercio tiene UN dominio y desde ahí entra
 * tanto a su tienda como a su panel. Eso es lo que resolveSurfacesForTenant
 * sabe interpretar desde que las superficies dejaron de ser un solo booleano.
 */
export const registerTenantDomain = async ({ tenantId, hostname: raw }) => {
  const hostname = parseHostname(raw)

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) throw buildError(404, 'Comercio no encontrado')

  if (findDomainEntry(tenant, hostname)) {
    throw buildError(409, 'Ese dominio ya está cargado en tu comercio.')
  }

  const verificationToken = `henko-verify=${randomBytes(16).toString('hex')}`

  tenant.domains.push({
    hostname,
    normalizedHostname: hostname,
    type: 'custom_domain',
    context: 'both',
    // Inerte hasta verificar: findTenantByDomainCandidates exige 'active'.
    status: 'pending',
    isPrimary: false,
    verificationToken,
  })

  try {
    await tenant.save()
  } catch (error) {
    // 11000 sobre el índice único de domainKeys: lo tiene otro comercio. Es la
    // base resolviendo la carrera, no una comprobación previa que pueda
    // perderla.
    if (error?.code === 11000) {
      throw buildError(409, 'Ese dominio ya está en uso por otro comercio.')
    }

    throw error
  }

  logger.info('[DOMINIO] Alta pendiente de verificación', {
    tenantId: String(tenantId),
    hostname,
  })

  const creado = findDomainEntry(tenant, hostname)

  return {
    domain: serializeDomain(creado),
    instructions: buildInstructions(hostname, verificationToken),
  }
}

/**
 * Busca el TXT de verificación. No lanza: un dominio sin registros todavía es
 * el caso NORMAL, no un error.
 */
const lookupVerificationTxt = async hostname => {
  try {
    const records = await dns.resolveTxt(`${VERIFICATION_PREFIX}.${hostname}`)

    // resolveTxt devuelve arrays de fragmentos: un TXT largo llega partido y
    // hay que unirlo antes de comparar.
    return records.map(chunks => chunks.join(''))
  } catch (error) {
    logger.debug('[DOMINIO] Sin TXT de verificación todavía', {
      hostname,
      code: error?.code || null,
    })

    return []
  }
}

/**
 * Comprueba la propiedad del dominio y lo activa si corresponde.
 *
 * Se vuelve a leer el token de la base en vez de confiar en lo que llegue por
 * la request: el campo es `select: false` justamente para que no viaje solo.
 */
export const verifyTenantDomain = async ({ tenantId, hostname: raw }) => {
  const hostname = parseHostname(raw)

  const tenant = await Tenant.findById(tenantId).select('+domains.verificationToken')
  if (!tenant) throw buildError(404, 'Comercio no encontrado')

  const entry = findDomainEntry(tenant, hostname)
  if (!entry) throw buildError(404, 'Ese dominio no está cargado en tu comercio.')

  const encontrados = await lookupVerificationTxt(hostname)
  const verificado = encontrados.includes(entry.verificationToken)

  entry.lastCheckedAt = new Date()

  if (verificado) {
    entry.status = 'active'
    entry.verifiedAt = entry.verifiedAt || new Date()
  }

  await tenant.save()

  if (verificado) {
    logger.info('[DOMINIO] Verificado y activo', {
      tenantId: String(tenantId),
      hostname,
    })
  }

  return {
    verified: verificado,
    domain: serializeDomain(findDomainEntry(tenant, hostname)),
    instructions: verificado
      ? null
      : buildInstructions(hostname, entry.verificationToken),
  }
}

/**
 * Baja de un dominio.
 *
 * Solo toca los custom_domain: el subdominio de plataforma es la dirección que
 * siempre funciona, y borrarla dejaría al comercio sin ninguna forma de entrar
 * si el dominio propio falla.
 */
export const removeTenantDomain = async ({ tenantId, hostname: raw }) => {
  const hostname = parseHostname(raw)

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) throw buildError(404, 'Comercio no encontrado')

  const entry = findDomainEntry(tenant, hostname)
  if (!entry) throw buildError(404, 'Ese dominio no está cargado en tu comercio.')

  if (entry.type !== 'custom_domain') {
    throw buildError(
      400,
      'El subdominio de la plataforma no se puede borrar: es la dirección que siempre funciona.',
    )
  }

  tenant.domains = tenant.domains.filter(
    domain => normalizeHostname(domain.hostname) !== hostname,
  )

  await tenant.save()

  logger.info('[DOMINIO] Baja', { tenantId: String(tenantId), hostname })

  return { removed: hostname }
}

export default {
  listTenantDomains,
  registerTenantDomain,
  verifyTenantDomain,
  removeTenantDomain,
  VERIFICATION_PREFIX,
}
