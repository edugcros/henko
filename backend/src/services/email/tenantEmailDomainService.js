// 📁 src/services/email/tenantEmailDomainService.js
//
// Dominio de envío propio por comercio.
//
// Un correo solo puede salir desde @sucomercio.com si ese dominio publica los
// registros SPF/DKIM que autorizan al proveedor a enviar en su nombre. No es
// una exigencia de Resend: es cómo funciona el correo. Cualquier proveedor
// serio pide lo mismo, y sin eso el mensaje rebota o cae en spam.
//
// Este servicio da de alta el dominio en el proveedor, guarda los registros
// DNS que el comercio tiene que cargar, y consulta el estado de verificación.
//
// Requiere una API key con permisos de administración: la key de envío que
// usa emailService no puede crear ni consultar dominios (devuelve
// "restricted_api_key"). Si no está configurada, el alta queda registrada
// igual en estado 'pending' con una explicación, y alguien la completa a mano
// desde el panel de Resend — el sistema nunca queda en un estado en el que
// crea estar mandando desde un dominio que no controla.

import Tenant from '../../models/tenantModel.js'
import logger from '../../../config/logger.js'
import { resolveSenderAddress } from '../emailService.js'

const RESEND_API = 'https://api.resend.com'
const REQUEST_TIMEOUT_MS = 15000

const clean = value => String(value ?? '').trim()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const extractDomain = address => {
  const value = clean(address).toLowerCase()
  if (!EMAIL_RE.test(value)) return ''
  return value.split('@')[1] || ''
}

const getManagementKey = () =>
  clean(process.env.RESEND_MANAGEMENT_API_KEY) ||
  clean(process.env.RESEND_API_KEY)

const resendRequest = async (path, { method = 'GET', body } = {}) => {
  const key = getManagementKey()

  if (!key) {
    const error = new Error('No hay API key de Resend configurada')
    error.code = 'RESEND_NOT_CONFIGURED'
    throw error
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${RESEND_API}${path}`, {
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
      const error = new Error(
        data?.message || `Resend respondió ${response.status}`,
      )
      // El caso más probable en este proyecto: la key de envío no sirve para
      // administrar dominios, y el mensaje del proveedor no lo deja claro.
      error.code =
        data?.name === 'restricted_api_key'
          ? 'RESEND_KEY_CANNOT_MANAGE_DOMAINS'
          : data?.name || 'RESEND_ERROR'
      error.statusCode = response.status
      throw error
    }

    return data
  } finally {
    clearTimeout(timeout)
  }
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

// Resend usa 'verified' cuando el dominio quedó listo; el resto de sus
// estados (not_started, pending, temporary_failure) siguen siendo espera, y
// 'failure' es un no definitivo.
const mapProviderStatus = status => {
  const value = clean(status).toLowerCase()

  if (value === 'verified') return 'verified'
  if (value === 'failure' || value === 'failed') return 'failed'

  return 'pending'
}

/**
 * Declara la dirección desde la que quiere enviar un comercio y da de alta su
 * dominio en el proveedor.
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
    const created = await resendRequest('/domains', {
      method: 'POST',
      body: { name: domain },
    })

    update['email.providerDomainId'] = clean(created?.id)
    update['email.dnsRecords'] = normalizeRecords(created?.records)
    update['email.status'] = mapProviderStatus(created?.status)
  } catch (error) {
    // Un dominio ya dado de alta antes no es un fallo: se resuelve al
    // consultar el estado.
    const alreadyExists = /already exists/i.test(error.message || '')

    if (!alreadyExists) {
      update['email.lastError'] =
        error.code === 'RESEND_KEY_CANNOT_MANAGE_DOMAINS'
          ? 'La API key configurada no puede administrar dominios. Un administrador tiene que dar de alta el dominio en Resend.'
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
    // Con id se consulta directo; sin él hay que buscarlo por nombre, que es
    // el caso de un dominio dado de alta a mano en el panel de Resend.
    const data = domainId
      ? await resendRequest(`/domains/${domainId}`)
      : (await resendRequest('/domains'))?.data?.find(
        item => clean(item?.name).toLowerCase() === tenant.email.domain,
      )

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

    const status = mapProviderStatus(data?.status)

    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          'email.providerDomainId': clean(data?.id) || domainId,
          'email.status': status,
          'email.dnsRecords': normalizeRecords(data?.records),
          'email.lastCheckedAt': new Date(),
          'email.lastError': '',
          ...(status === 'verified' ? { 'email.verifiedAt': new Date() } : {}),
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
            error.code === 'RESEND_KEY_CANNOT_MANAGE_DOMAINS'
              ? 'La API key configurada no puede consultar dominios. Verificá el estado desde el panel de Resend.'
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
    canManageDomains: Boolean(clean(process.env.RESEND_MANAGEMENT_API_KEY)),
  }
}

export default {
  extractDomain,
  registerTenantSendingDomain,
  refreshTenantDomainStatus,
  clearTenantSendingDomain,
  getTenantEmailIdentity,
}
