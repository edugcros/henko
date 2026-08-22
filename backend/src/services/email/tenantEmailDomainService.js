// 📁 src/services/email/tenantEmailDomainService.js
//
// Dominio de envío propio por comercio.
//
// Un correo solo puede salir desde @sucomercio.com si ese dominio publica los
// registros SPF/DKIM que autorizan al proveedor a enviar en su nombre. No es
// una exigencia de un proveedor en particular: es cómo funciona el correo.
// Cualquiera serio pide lo mismo, y sin eso el mensaje rebota o cae en spam.
//
// Este servicio da de alta el dominio en SendGrid (el único proveedor de
// envío, ver emailService.js), guarda los registros DNS que el comercio
// tiene que cargar, y consulta el estado de verificación.

import Tenant from '../../models/tenantModel.js'
import logger from '../../../config/logger.js'
import { resolveSenderAddress } from '../emailService.js'
import { sanitizeString as clean, EMAIL_REGEX as EMAIL_RE } from './emailShared.js'

const REQUEST_TIMEOUT_MS = 15000

export const extractDomain = address => {
  const value = clean(address).toLowerCase()
  if (!EMAIL_RE.test(value)) return ''
  return value.split('@')[1] || ''
}

const normalizeRecords = records => {
  if (!Array.isArray(records)) return []

  return records.map(item => ({
    record: clean(item?.record),
    name: clean(item?.name),
    type: clean(item?.type),
    value: clean(item?.value),
    priority:
      item?.priority === undefined || item?.priority === null
        ? null
        : Number(item.priority),
  }))
}

// ─── SendGrid ────────────────────────────────────────────

const SENDGRID_API = 'https://api.sendgrid.com/v3'

// Misma cuenta que autentica el envío por SMTP (usuario literal "apikey",
// contraseña = esta key): no hace falta una segunda credencial salvo que se
// quiera separar una key de solo-envío de una con permiso de administrar
// dominios, para lo cual SENDGRID_API_KEY pisa a EMAIL_PASS.
const getSendGridApiKey = () =>
  clean(process.env.SENDGRID_API_KEY) || clean(process.env.EMAIL_PASS)

const sendGridRequest = async (path, { method = 'GET', body } = {}) => {
  const key = getSendGridApiKey()

  if (!key) {
    const error = new Error('No hay API key de SendGrid configurada')
    error.code = 'PROVIDER_NOT_CONFIGURED'
    throw error
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${SENDGRID_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const message =
        data?.errors?.[0]?.message ||
        data?.message ||
        `SendGrid respondió ${response.status}`
      const error = new Error(message)
      // SendGrid controla permisos por scope de API key, no por un código de
      // error dedicado: un 401/403 acá casi siempre significa que la key no
      // tiene el scope de Domain Authentication habilitado.
      error.code =
        response.status === 401 || response.status === 403
          ? 'PROVIDER_KEY_CANNOT_MANAGE_DOMAINS'
          : 'PROVIDER_ERROR'
      error.statusCode = response.status
      throw error
    }

    return data
  } finally {
    clearTimeout(timeout)
  }
}

// El DNS de SendGrid llega como objeto {mail_cname, dkim1, dkim2, ...}, no
// como array — cada clave es un registro con {type, host, data}.
const normalizeSendGridDns = dns => {
  if (!dns || typeof dns !== 'object') return []

  return Object.entries(dns).map(([key, record]) => ({
    record: key,
    name: clean(record?.host),
    type: clean(record?.type) || 'CNAME',
    value: clean(record?.data),
    priority: null,
  }))
}

// SendGrid no expone un estado terminal de "falló": un dominio queda
// pendiente indefinidamente hasta que el DNS esté bien, nunca se marca como
// fallido. Por eso acá solo hay dos estados posibles.
const mapSendGridStatus = valid => (valid ? 'verified' : 'pending')

const sendGridCreateDomain = async domain => {
  const created = await sendGridRequest('/whitelabel/domains', {
    method: 'POST',
    body: {
      domain,
      // CNAME en vez de TXT+MX: la variante MX reemplaza el registro MX del
      // dominio, lo que le robaría al comercio su correo entrante real. La
      // variante CNAME (automatic_security) convive con cualquier MX que ya
      // tenga.
      automatic_security: true,
    },
  })

  return {
    id: clean(created?.id),
    dns: normalizeSendGridDns(created?.dns),
    status: mapSendGridStatus(created?.valid),
  }
}

const sendGridFindDomainId = async domain => {
  const list = await sendGridRequest('/whitelabel/domains')

  const match = Array.isArray(list)
    ? list.find(item => clean(item?.domain).toLowerCase() === domain)
    : null

  return clean(match?.id)
}

const sendGridFetchDomain = async ({ domainId, domain }) => {
  const id = domainId || (await sendGridFindDomainId(domain))

  if (!id) return null

  // GET devuelve el último estado conocido; validate fuerza una consulta
  // fresca de DNS, que es justo lo que un refresh necesita. Los valores de
  // los registros (host/data) no cambian una vez asignados, así que no hace
  // falta pedirlos de nuevo — se conserva lo ya guardado.
  const validated = await sendGridRequest(`/whitelabel/domains/${id}/validate`, {
    method: 'POST',
  })

  return {
    id,
    dns: null,
    status: mapSendGridStatus(validated?.valid),
  }
}

const isDuplicateDomainError = error => {
  const message = String(error?.message || '').toLowerCase()
  return (
    /already exists|already authenticated|duplicate|conflict/.test(message) ||
    error?.statusCode === 409
  )
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

  const tenant = await Tenant.findById(tenantId)

  if (!tenant) {
    const error = new Error('Comercio no encontrado')
    error.statusCode = 404
    throw error
  }

  const update = {
    'email.fromAddress': address,
    'email.domain': domain,
    'email.status': 'pending',
    'email.verifiedAt': null,
    'email.lastCheckedAt': new Date(),
    'email.lastError': '',
    'email.dnsRecords': [],
    'email.providerDomainId': '',
  }

  try {
    const created = await sendGridCreateDomain(domain)

    update['email.providerDomainId'] = created.id
    update['email.dnsRecords'] = created.dns
    update['email.status'] = created.status
  } catch (error) {
    // Un dominio ya dado de alta antes no es un fallo: se resuelve al
    // consultar el estado.
    if (!isDuplicateDomainError(error)) {
      update['email.lastError'] =
        error.code === 'PROVIDER_KEY_CANNOT_MANAGE_DOMAINS'
          ? 'La API key configurada no puede administrar dominios. Un administrador tiene que dar de alta el dominio en SendGrid.'
          : error.message

      logger.warn('[EMAIL DOMAIN] No se pudo dar de alta el dominio', {
        tenantId: String(tenantId),
        domain,
        code: error.code,
      })
    }
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

  const domainId = clean(tenant.email.providerDomainId)

  try {
    const data = await sendGridFetchDomain({
      domainId,
      domain: tenant.email.domain,
    })

    if (!data) {
      await Tenant.updateOne(
        { _id: tenantId },
        {
          $set: {
            'email.status': 'pending',
            'email.lastCheckedAt': new Date(),
            'email.lastError':
                'El dominio todavía no figura en la cuenta del proveedor.',
          },
        },
      )

      return getTenantEmailIdentity(tenantId)
    }

    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          'email.providerDomainId': data.id || domainId,
          'email.status': data.status,
          // null significa "no volver a pedirlos": ya están guardados y no
          // cambian una vez asignados por el proveedor.
          ...(data.dns ? { 'email.dnsRecords': data.dns } : {}),
          'email.lastCheckedAt': new Date(),
          'email.lastError': '',
          ...(data.status === 'verified' ? { 'email.verifiedAt': new Date() } : {}),
        },
      },
    )
  } catch (error) {
    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          'email.lastCheckedAt': new Date(),
          'email.lastError':
            error.code === 'PROVIDER_KEY_CANNOT_MANAGE_DOMAINS'
              ? 'La API key configurada no puede consultar dominios. Verificá el estado desde el panel de SendGrid.'
              : error.message,
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
  const verified = email.status === 'verified' && Boolean(email.fromAddress)

  return {
    fromName: tenant?.name || '',
    // Lo que realmente se va a usar. Se resuelve con la misma función que el
    // envío, no con una copia de la regla: si el panel y el envío pudieran
    // discrepar, el comercio vería "verificado" mientras sus correos siguen
    // saliendo por la plataforma.
    effectiveFromAddress: resolveSenderAddress({ email }),
    usingOwnDomain: verified,
    provider: 'SendGrid',
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
    canManageDomains: Boolean(getSendGridApiKey()),
  }
}

export default {
  extractDomain,
  registerTenantSendingDomain,
  refreshTenantDomainStatus,
  clearTenantSendingDomain,
  getTenantEmailIdentity,
}
