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
import tls from 'node:tls'
import { randomBytes } from 'node:crypto'

import Tenant from '../../models/tenantModel.js'
import logger from '../../../config/logger.js'
import { env } from '../../../config/env.js'
import {
  obtenerDestinoDelBorde,
  registrarDominioEnBorde,
  quitarDominioDelBorde,
} from './edgeDomainService.js'
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

/**
 * El hostname normalizado, o un error 400 con el motivo.
 *
 * Valida FORMA, no permiso. La regla de quién puede reclamar qué se aplica
 * aparte, y solo donde corresponde — ver assertClaimable.
 */
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

  return hostname
}

/**
 * ¿Este comercio puede RECLAMAR este dominio?
 *
 * SOLO EN EL ALTA, Y ESA DISTINCIÓN COSTÓ UN INCIDENTE
 *
 * Esta comprobación vivía dentro de parseHostname, o sea que corría también al
 * verificar y al dar de baja. El efecto: un dominio ya registrado quedaba
 * imposible de operar si la regla cambiaba después del alta — que es
 * exactamente lo que pasó. Se cargó `henkart.com.ar` cuando ROOT_DOMAIN
 * todavía no estaba configurado, y al configurarlo el mismo dominio pasó a ser
 * "de la plataforma": la verificación empezó a rechazarlo y la tienda quedó
 * devolviendo 404 sin forma de destrabarla desde el panel.
 *
 * La regla de reclamo pertenece al momento del reclamo. Verificar y dar de baja
 * operan sobre algo que YA está en el comercio —findDomainEntry devuelve 404 si
 * no está— así que no hay nada que reclamar ahí.
 *
 * EL MENSAJE TIENE QUE DECIR QUÉ HACER
 *
 * Decía "Ese dominio pertenece a la plataforma y no se puede reclamar". Es
 * cierto y no sirve de nada: quien escribe un subdominio de HENKO acá está
 * confundiendo la dirección que le dimos con un dominio propio, y ese mensaje
 * no lo saca del error — solo le dice que no. Medido en producción: dos
 * intentos seguidos del mismo usuario contra el mismo 400, sin cambiar de idea
 * entre uno y otro, porque nada le indicaba hacia dónde corregir.
 */
const assertClaimable = hostname => {
  if (isPlatformDomain(hostname)) {
    throw buildError(
      400,
      `${hostname} es una dirección de HENKO, no un dominio propio. ` +
        'La dirección de tu tienda ya funciona sola y no hace falta cargarla acá. ' +
        'Este campo es para un dominio que hayas comprado vos, por ejemplo mitienda.com.ar.',
    )
  }
}

/** Lo que el comercio tiene que cargar en su DNS. */
const buildInstructions = (hostname, verificationToken) => ({
  verification: {
    type: 'TXT',
    name: `${VERIFICATION_PREFIX}.${hostname}`,
    value: verificationToken,
  },
  // EL DESTINO ES EL BORDE DE LA TIENDA, NO LA API
  //
  // Acá decía env.apiDomain, o sea api.henkart.com.ar — el BACKEND. Un comercio
  // que siguiera esa instrucción apuntaba su dominio a la API: recibía JSON, no
  // su tienda. Nunca se probó de punta a punta.
  //
  // Sale de PLATFORM_EDGE_CNAME. Sin esa variable devuelve null y el panel
  // muestra el paso como pendiente, que es mejor que dar una instrucción
  // equivocada con aire de correcta.
  pointing: {
    type: 'CNAME',
    name: hostname,
    value: obtenerDestinoDelBorde(),
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
  // Solo viaja cuando hay algo que hacer. Mandar un array vacío haría que el
  // panel tuviera que distinguir "no falta nada" de "todavía no se intentó".
  edgeVerification: domain.edgeVerification?.length
    ? domain.edgeVerification.map(item => ({
      type: item.type,
      name: item.name,
      value: item.value,
    }))
    : null,
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

  // La regla de reclamo va acá y solo acá: es el único momento en que alguien
  // pide quedarse con un dominio.
  assertClaimable(hostname)

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

    // DAR DE ALTA EN EL BORDE ES UN PASO APARTE, Y VA DESPUÉS DEL save()
    //
    // Verificar prueba quién es el dueño; registrar en el borde decide quién lo
    // atiende. Sin lo segundo, el hostname no tiene a dónde ir ni certificado
    // que presentar.
    //
    // Va después de guardar y sin await sobre el resultado del comercio: el
    // dominio ya quedó verificado, y que el proveedor falle no debe deshacer
    // eso ni dejar al comercio con un error que no puede resolver. El
    // certificado lo confirma después el watcher, por handshake real.
    const alta = await registrarDominioEnBorde(hostname)

    if (!alta.ok) {
      logger.warn('[DOMINIO] Verificado pero sin alta en el borde', {
        tenantId: String(tenantId),
        hostname,
        motivo: alta.motivo,
      })
    }

    // Lo que el borde pide ADEMÁS de lo nuestro. Se guarda aunque esté vacío
    // para limpiar lo de un intento anterior: si el comercio ya cargó el
    // registro que faltaba, dejarlo puesto lo mandaría a hacer algo hecho.
    const entradaActual = findDomainEntry(tenant, hostname)
    const pendiente = alta.verificacionPendiente || []

    if (entradaActual) {
      entradaActual.edgeVerification = pendiente.length ? pendiente : undefined
      await tenant.save()
    }
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

  // Sacarlo también del borde. Si no, el hostname sigue dado de alta en el
  // proyecto ocupando cupo, con su certificado renovándose para siempre, y
  // ningún comercio lo reclama: nadie lo va a notar hasta que el cupo importe.
  const baja = await quitarDominioDelBorde(hostname)

  if (!baja.ok && baja.motivo !== 'sin_credenciales') {
    logger.warn('[DOMINIO] Dado de baja en el comercio pero no en el borde', {
      hostname,
      motivo: baja.motivo,
    })
  }

  return { removed: hostname }
}

// ─── EL CERTIFICADO ──────────────────────────────────────────────────────────
//
// QUIÉN CONFIRMA QUE EL CERTIFICADO EXISTE
//
// La respuesta obvia sería preguntarle al proveedor de borde. No se hace así,
// por dos motivos.
//
// El primero es que ataría este código a un proveedor que todavía no está
// elegido. El segundo es mejor: preguntarle al proveedor devuelve lo que el
// proveedor CREE, y lo que importa es lo que ve el navegador del cliente. Entre
// "Cloudflare dice que emitió el certificado" y "el handshake TLS contra ese
// dominio funciona" hay un montón de formas de fallar — DNS que todavía apunta
// a otro lado, un proxy mal configurado, un certificado emitido para otro
// nombre.
//
// Abrir la conexión responde la pregunta de verdad, y sirve igual con
// Cloudflare, con ACM o con certbot.

const TLS_TIMEOUT_MS = Number(process.env.DOMAIN_TLS_TIMEOUT_MS || 8000)

/**
 * ¿Este dominio presenta un certificado válido para su propio nombre?
 *
 * No lanza nunca: que todavía no haya certificado es el estado NORMAL de un
 * dominio recién verificado, no una falla.
 */
export const hasValidCertificate = hostname =>
  new Promise(resolve => {
    let resuelto = false

    const terminar = (ok, detalle) => {
      if (resuelto) return
      resuelto = true

      socket.destroy()
      resolve({ ok, detail: detalle })
    }

    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        // servername es lo que hace que esto mida lo correcto: sin SNI, un
        // borde compartido devolvería su certificado por defecto y daríamos por
        // bueno un certificado que no cubre este dominio.
        servername: hostname,
        // Se valida contra las CA del sistema: un certificado autofirmado no
        // sirve de nada para el cliente, así que tampoco acá.
        rejectUnauthorized: true,
      },
      () => terminar(socket.authorized, socket.authorizationError || null),
    )

    socket.setTimeout(TLS_TIMEOUT_MS, () => terminar(false, 'timeout'))
    socket.on('error', error => terminar(false, error.code || error.message))
  })

/**
 * Revisa los dominios verificados que todavía no tienen certificado.
 *
 * Solo mira los que ya pasaron la verificación de propiedad: preguntar por el
 * certificado de un dominio que ni siquiera apunta acá es gastar ocho segundos
 * de timeout para aprender nada.
 *
 * Nunca baja un dominio de 'active' a 'pending'. Un certificado que hoy no
 * responde puede ser un problema de red pasajero, y degradar el estado por eso
 * haría que el panel alarme al comercio por algo que se arregla solo. Para
 * bajarlo haría falta una racha de fallos, que es otra decisión.
 */
export const refreshPendingCertificates = async ({ logger: log = logger } = {}) => {
  const tenants = await Tenant.find({
    'domains.type': 'custom_domain',
    'domains.status': 'active',
    'domains.sslStatus': 'pending',
  }).setOptions({
    ignoreTenant: true,
    platformScope: 'job de certificados: cruza comercios por definición',
  })

  let revisados = 0
  let activados = 0

  for (const tenant of tenants) {
    let cambio = false

    for (const domain of tenant.domains) {
      if (domain.type !== 'custom_domain') continue
      if (domain.status !== 'active' || domain.sslStatus !== 'pending') continue

      revisados += 1

      const { ok, detail } = await hasValidCertificate(domain.hostname)

      domain.lastCheckedAt = new Date()
      cambio = true

      if (ok) {
        domain.sslStatus = 'active'
        activados += 1

        log.info?.('[DOMINIO SSL] Certificado activo', {
          tenantId: String(tenant._id),
          hostname: domain.hostname,
        })
      } else {
        log.debug?.('[DOMINIO SSL] Todavía sin certificado', {
          hostname: domain.hostname,
          detail,
        })
      }
    }

    if (cambio) await tenant.save()
  }

  if (revisados > 0) {
    log.info?.('[DOMINIO SSL] Revisión terminada', { revisados, activados })
  }

  return { revisados, activados }
}

let certInterval = null

/**
 * Arranca la revisión periódica de certificados.
 *
 * CON UNA PASADA AL ARRANQUE, que es lo que hace que sirva.
 *
 * Es la misma lección que dejó el barrido de reservas colgadas: el intervalo se
 * reinicia en cada deploy, y en un servicio que se reinicia seguido un timer
 * largo sin pasada inicial es un timer que no corre nunca. Acá pesa más todavía
 * porque el momento en que hace falta —justo después de que el comercio
 * verificó su dominio— es cuando más ansioso está mirando la pantalla.
 */
export const startCertificateWatcher = ({ logger: log = logger } = {}) => {
  if (process.env.DOMAIN_CERT_WATCHER_ENABLED === 'false') {
    log.info?.('[DOMINIO SSL] Revisión de certificados deshabilitada')
    return
  }

  if (certInterval) return

  const intervalMs = Number(process.env.DOMAIN_CERT_INTERVAL_MS || 10 * 60 * 1000)
  const arranqueMs = Number(process.env.DOMAIN_CERT_ON_START_MS || 60 * 1000)

  const correr = () =>
    refreshPendingCertificates({ logger: log }).catch(error => {
      log.error?.('[DOMINIO SSL] La revisión falló', { error: error.message })
    })

  const primeraPasada = setTimeout(correr, arranqueMs)
  primeraPasada.unref?.()

  certInterval = setInterval(correr, intervalMs)
  certInterval.unref?.()

  log.info?.('[DOMINIO SSL] Revisión de certificados iniciada', {
    intervalMinutes: Math.round(intervalMs / 60000),
    primeraPasadaEnSegundos: Math.round(arranqueMs / 1000),
  })
}

export const stopCertificateWatcher = () => {
  if (!certInterval) return

  clearInterval(certInterval)
  certInterval = null
}

export default {
  listTenantDomains,
  registerTenantDomain,
  verifyTenantDomain,
  removeTenantDomain,
  hasValidCertificate,
  refreshPendingCertificates,
  startCertificateWatcher,
  stopCertificateWatcher,
  VERIFICATION_PREFIX,
}
