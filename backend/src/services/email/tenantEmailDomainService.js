// 📁 src/services/email/tenantEmailDomainService.js
//
// Dominio de envío propio por comercio.
//
// Un correo solo puede salir desde @sucomercio.com si ese dominio publica los
// registros SPF/DKIM que autorizan al proveedor a enviar en su nombre. No es
// una exigencia de un proveedor en particular: es cómo funciona el correo.
// Cualquiera serio pide lo mismo, y sin eso el mensaje rebota o cae en spam.
//
// Este servicio da de alta el dominio en el proveedor activo (cuál es lo
// decide EMAIL_PROVIDER; los drivers están en emailProviders.js), guarda los
// registros DNS que el comercio tiene que cargar, y consulta el estado de
// verificación.
//
// Lo que es del proveedor —qué endpoint, qué forma tiene el DNS, cómo se
// llama su estado de verificación— vive en el driver. Acá queda lo que no
// cambia al mudarse: qué dominios se aceptan, de quién es cada uno, y qué se
// guarda.

import Tenant from '../../models/tenantModel.js'
import logger from '../../../config/logger.js'
import { resolveSenderAddress } from '../emailService.js'
import { sanitizeString as clean, EMAIL_REGEX as EMAIL_RE } from './emailShared.js'
import { CODIGOS, dominiosDelProveedor } from './emailProviders.js'

/**
 * Un TLD de verdad: dos letras o más, sin dígitos.
 *
 * POR QUÉ NO ALCANZA CON EMAIL_REGEX
 *
 * Esa expresión valida la FORMA de una dirección y la comparten todos los
 * registros del sistema, así que es deliberadamente permisiva. Para un dominio
 * de ENVÍO no alcanza: acá hay que poder publicar registros DNS, y eso exige
 * un dominio que pueda existir.
 *
 * Medido sobre lo que aceptaba antes:
 *
 *   juan@gmail.c        -> "gmail.c"        TLD de una letra
 *   juan@x.a            -> "x.a"            íd.
 *   juan@mitienda.c0m   -> "mitienda.c0m"   TLD con un dígito
 *
 * Ninguno puede existir. No hay TLD de una sola letra ni con números, así que
 * esto no deja afuera nada legítimo. Y apareció solo: en la cuenta de SendGrid
 * quedó un `em5064.gmail.c` en estado "pending" para siempre, de un alta que
 * nunca iba a poder verificarse.
 */
const TLD_PLAUSIBLE = /\.[a-z]{2,}$/

export const extractDomain = address => {
  const value = clean(address).toLowerCase()
  if (!EMAIL_RE.test(value)) return ''

  const domain = value.split('@')[1] || ''

  // NO intenta adivinar typos como `gmai.com`. Eso es un dominio que PODRÍA
  // existir, solo que no es suyo, y distinguirlo exigiría comparar por
  // parecido contra la lista de proveedores — que bloquearía dominios
  // legítimos por cercanía (`soho.com` está a un carácter de `zoho.com`). Ese
  // caso lo resuelve bien la verificación de SendGrid: nunca pasa a
  // 'verified', y el remitente efectivo solo usa dominios verificados.
  return TLD_PLAUSIBLE.test(domain) ? domain : ''
}

// Proveedores de correo gratuitos/personales conocidos. El DNS de estos
// dominios lo controla el proveedor (Google, Microsoft, Yahoo...), no el
// comercio — SendGrid da de alta el dominio igual (no lo rechaza en el
// alta), pero la validación de DNS nunca puede pasar porque el comercio no
// tiene forma de publicar los registros CNAME/DKIM que pide. Sin este
// guard, el estado queda en "pending" para siempre, sin ningún error que
// explique por qué — muy común en comercios chicos que todavía no tienen
// dominio propio. Lista no exhaustiva (cubre los casos más comunes en
// Argentina y global), no reemplaza la explicación en la UI.
const FREE_EMAIL_PROVIDER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.ar',
  'hotmail.es',
  'outlook.com',
  'outlook.com.ar',
  'outlook.es',
  'live.com',
  'live.com.ar',
  'msn.com',
  'yahoo.com',
  'yahoo.com.ar',
  'yahoo.es',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
])

export const isFreeEmailProviderDomain = domain =>
  FREE_EMAIL_PROVIDER_DOMAINS.has(clean(domain).toLowerCase())

/**
 * Qué decirle al comercio cuando el proveedor rechaza administrar dominios.
 *
 * El código es del sistema (ver CODIGOS en emailProviders.js), así que el
 * mensaje no depende de cuál sea el proveedor — pero sí nombra al activo,
 * porque es el dato que falta para saber dónde mirar.
 */
const explicarFalla = (error, proveedor) => {
  if (error?.code === CODIGOS.AUTENTICACION) {
    return `La credencial configurada no puede administrar dominios en ${proveedor}. Un administrador tiene que darlo de alta a mano.`
  }

  if (error?.code === CODIGOS.SIN_CONFIGURAR) {
    return `Falta configurar las credenciales de ${proveedor}.`
  }

  return error?.message || `No se pudo completar la operación en ${proveedor}.`
}

// ─── API pública ─────────────────────────────────────────

/**
 * Declara la dirección desde la que quiere enviar un comercio y da de alta su
 * dominio en el proveedor activo.
 *
 * No cambia el remitente efectivo: hasta que el dominio quede verificado, los
 * correos siguen saliendo por la plataforma.
 */
export const registerTenantSendingDomain = async ({ tenantId, fromAddress }) => {
  const address = clean(fromAddress).toLowerCase()
  const domain = extractDomain(address)

  if (!domain) {
    const error = new Error('La dirección de envío no es válida')
    error.statusCode = 400
    throw error
  }

  if (isFreeEmailProviderDomain(domain)) {
    const error = new Error(
      'Los proveedores de correo gratuitos (Gmail, Hotmail, Outlook, Yahoo, etc.) no se pueden verificar como dominio propio — el DNS de ese dominio lo controla el proveedor, no vos. Necesitás un dominio propio (por ejemplo, tumarca.com) para esta función.',
    )
    error.statusCode = 400
    error.code = 'FREE_EMAIL_PROVIDER_NOT_SUPPORTED'
    throw error
  }

  // La cuenta de SendGrid es una sola, compartida por todos los comercios —
  // sin este chequeo, un segundo tenant podría registrar el mismo dominio
  // que otro ya verificó por DNS y quedar mostrando "verificado" (y
  // enviando correo con esa identidad) sin controlar el dominio realmente.
  const domainOwner = await Tenant.findOne({
    _id: { $ne: tenantId },
    'email.domain': domain,
  })
    .select('_id')
    .lean()

  if (domainOwner) {
    const error = new Error(
      'Este dominio ya está registrado como remitente por otro comercio de la plataforma. Si te pertenece, contactá a soporte.',
    )
    error.statusCode = 409
    error.code = 'DOMAIN_ALREADY_CLAIMED'
    throw error
  }

  const tenant = await Tenant.findById(tenantId)

  if (!tenant) {
    const error = new Error('Comercio no encontrado')
    error.statusCode = 404
    throw error
  }

  const proveedor = dominiosDelProveedor()

  // Un proveedor que no administra dominios de terceros tiene que decirlo
  // ANTES de guardar nada: si no, el comercio queda con un estado
  // "pendiente" esperando una verificación que nadie va a hacer.
  if (!proveedor.soportado) {
    const error = new Error(
      `El proveedor de correo activo (${proveedor.proveedor}) no permite registrar el dominio propio de un comercio. Es temporal, mientras se completa la mudanza de proveedor.`,
    )
    error.statusCode = 503
    error.code = 'DOMAIN_MANAGEMENT_UNAVAILABLE'
    throw error
  }

  const update = {
    'email.fromAddress': address,
    'email.domain': domain,
    'email.provider': proveedor.id,
    'email.status': 'pending',
    'email.verifiedAt': null,
    'email.lastCheckedAt': new Date(),
    'email.lastError': '',
    'email.dnsRecords': [],
    'email.providerDomainId': '',
  }

  try {
    // El inquilino es el comercio: es lo que hace que la reputación de envío
    // se mida por tienda y no por cuenta. Sin eso, una que mande a una lista
    // sucia se lleva puesto el envío de todas las demás.
    const creado = await proveedor.alta(domain, { inquilino: String(tenantId) })

    update['email.providerDomainId'] = creado.id
    update['email.dnsRecords'] = creado.dns
    update['email.status'] = creado.status
  } catch (error) {
    update['email.lastError'] = explicarFalla(error, proveedor.proveedor)

    logger.warn('[EMAIL DOMAIN] No se pudo dar de alta el dominio', {
      tenantId: String(tenantId),
      domain,
      proveedor: proveedor.id,
      code: error.code,
    })
  }

  await Tenant.updateOne({ _id: tenantId }, { $set: update })

  return getTenantEmailIdentity(tenantId)
}

/**
 * Vuelve a preguntarle al proveedor si el dominio ya quedó verificado.
 */
export const refreshTenantDomainStatus = async tenantId => {
  const tenant = await Tenant.findById(tenantId).select('email').lean()

  if (!tenant?.email?.domain) {
    const error = new Error('El comercio no tiene un dominio de envío cargado')
    error.statusCode = 400
    throw error
  }

  const proveedor = dominiosDelProveedor()

  if (!proveedor.soportado) {
    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          'email.lastCheckedAt': new Date(),
          'email.lastError': `El proveedor activo (${proveedor.proveedor}) no administra dominios de comercios. El estado guardado no se puede confirmar ahora.`,
        },
      },
    )

    return getTenantEmailIdentity(tenantId)
  }

  const domainId = clean(tenant.email.providerDomainId)

  // El dominio se verificó con OTRO proveedor.
  //
  // Los registros DNS y el id guardados son de ese servicio y no significan
  // nada acá: preguntarle al proveedor nuevo por un dominio que nunca le
  // dieron de alta responde "no existe", y el comercio quedaría en un callejón
  // sin salida sin entender por qué. Como el alta es idempotente, se rehace
  // acá mismo: así se lleva los registros nuevos en la misma pantalla.
  const seMudoDeProveedor = Boolean(tenant.email.provider) && tenant.email.provider !== proveedor.id

  try {
    const datos = seMudoDeProveedor
      ? await proveedor.alta(tenant.email.domain, { inquilino: String(tenantId) })
      : await proveedor.estado({
          id: domainId,
          dominio: tenant.email.domain,
          inquilino: String(tenantId),
        })

    if (!datos) {
      await Tenant.updateOne(
        { _id: tenantId },
        {
          $set: {
            'email.status': 'pending',
            'email.lastCheckedAt': new Date(),
            'email.lastError': 'El dominio todavía no figura en la cuenta del proveedor.',
          },
        },
      )

      return getTenantEmailIdentity(tenantId)
    }

    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          'email.provider': proveedor.id,
          'email.providerDomainId': datos.id || domainId,
          'email.status': datos.status,
          // null significa "no volver a pedirlos": ya están guardados y no
          // cambian una vez asignados por el proveedor.
          ...(datos.dns ? { 'email.dnsRecords': datos.dns } : {}),
          'email.lastCheckedAt': new Date(),
          'email.lastError': seMudoDeProveedor
            ? `La plataforma cambió de proveedor de correo a ${proveedor.proveedor}. Hay registros DNS nuevos para publicar: los anteriores ya no sirven.`
            : '',
          ...(datos.status === 'verified' ? { 'email.verifiedAt': new Date() } : {}),
        },
      },
    )
  } catch (error) {
    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          'email.lastCheckedAt': new Date(),
          'email.lastError': explicarFalla(error, proveedor.proveedor),
        },
      },
    )
  }

  return getTenantEmailIdentity(tenantId)
}

export const clearTenantSendingDomain = async tenantId => {
  await Tenant.updateOne(
    { _id: tenantId },
    {
      $set: {
        'email.fromAddress': '',
        'email.domain': '',
        'email.provider': '',
        'email.providerDomainId': '',
        'email.status': 'none',
        'email.dnsRecords': [],
        'email.verifiedAt': null,
        'email.lastError': '',
      },
    },
  )

  return getTenantEmailIdentity(tenantId)
}

/**
 * Identidad de correo efectiva del comercio, tal como la va a usar el envío.
 */
export const getTenantEmailIdentity = async tenantId => {
  const tenant = await Tenant.findById(tenantId)
    .select('name email settings.store.contactEmail')
    .lean()

  const email = tenant?.email || {}
  const proveedor = dominiosDelProveedor()

  return {
    fromName: tenant?.name || '',
    // Lo que realmente se va a usar. Se resuelve con la misma función que el
    // envío, no con una copia de la regla: si el panel y el envío pudieran
    // discrepar, el comercio vería "verificado" mientras sus correos siguen
    // saliendo por la plataforma.
    effectiveFromAddress: resolveSenderAddress({ email }),

    // Se pregunta lo mismo que el envío, por la misma razón: un dominio
    // verificado con el proveedor ANTERIOR no autoriza a nadie a enviar con
    // el actual, y mostrarlo como propio sería prometer algo que no pasa.
    usingOwnDomain:
      resolveSenderAddress({ email }) === email.fromAddress && Boolean(email.fromAddress),

    provider: proveedor.proveedor,
    replyTo: tenant?.settings?.store?.contactEmail || null,
    requested: {
      fromAddress: email.fromAddress || '',
      domain: email.domain || '',
      status: email.status || 'none',
      dnsRecords: email.dnsRecords || [],
      verifiedAt: email.verifiedAt || null,
      lastCheckedAt: email.lastCheckedAt || null,
      lastError: email.lastError || '',
    },

    canManageDomains: proveedor.soportado,
  }
}

export default {
  extractDomain,
  isFreeEmailProviderDomain,
  registerTenantSendingDomain,
  refreshTenantDomainStatus,
  clearTenantSendingDomain,
  getTenantEmailIdentity,
}
