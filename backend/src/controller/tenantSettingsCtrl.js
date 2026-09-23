import asyncHandler from 'express-async-handler'
import Tenant from '../models/tenantModel.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'
import {
  clearTenantSendingDomain,
  getTenantEmailIdentity,
  refreshTenantDomainStatus,
  registerTenantSendingDomain,
} from '../services/email/tenantEmailDomainService.js'
import {
  listTenantDomains,
  registerTenantDomain,
  removeTenantDomain,
  verifyTenantDomain,
} from '../services/tenant/tenantDomainService.js'
import { isValidEmail } from '../services/email/emailShared.js'

// Uso genérico (no solo emails): algunos campos de este controller son texto
// libre potencialmente multilínea (descripción, dirección), así que no puede
// compartir el sanitizeString de emailShared, que corta saltos de línea a
// propósito para valores que terminan en headers de email.
const clean = value => String(value ?? '').trim()

const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, { requireUserTenant: true }).tenantId

const ONBOARDING_STEPS = [
  'account',
  'store',
  'theme',
  'products',
  'payments',
  'domain',
  'completed',
]

export const getTenantSettings = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const tenant = await Tenant.findById(tenantId)
    .select('name slug settings onboarding plan subscriptionStatus trialEndsAt currency locale timezone country')
    .lean()

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  return res.status(200).json({
    success: true,
    data: {
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
      currency: tenant.currency,
      locale: tenant.locale,
      timezone: tenant.timezone,
      country: tenant.country,
      settings: tenant.settings,
      onboarding: tenant.onboarding,
    },
  })
})

/**
 * GET /api/tenants/me/email-domain
 */
export const getEmailDomain = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  return res.status(200).json({
    success: true,
    data: await getTenantEmailIdentity(tenantId),
  })
})

/**
 * PUT /api/tenants/me/email-domain
 *
 * Declara desde qué dirección quiere enviar el comercio. No cambia el
 * remitente todavía: hasta que el dominio esté verificado por DNS, los
 * correos siguen saliendo por la plataforma.
 */
export const updateEmailDomain = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const fromAddress = clean(req.body?.fromAddress)

  if (!isValidEmail(fromAddress)) {
    return res.status(400).json({
      success: false,
      message: 'Ingresá una dirección de correo válida.',
    })
  }

  const data = await registerTenantSendingDomain({ tenantId, fromAddress })

  return res.status(200).json({
    success: true,
    message:
      'Dominio registrado. Cargá los registros DNS y después verificá el estado.',
    data,
  })
})

/**
 * POST /api/tenants/me/email-domain/verify
 */
export const verifyEmailDomain = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const data = await refreshTenantDomainStatus(tenantId)

  return res.status(200).json({
    success: true,
    message:
      data.usingOwnDomain
        ? 'Dominio verificado: tus correos ya salen desde tu dirección.'
        : 'El dominio todavía no está verificado. Los cambios de DNS pueden tardar en propagarse.',
    data,
  })
})

/**
 * DELETE /api/tenants/me/email-domain
 */
export const deleteEmailDomain = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const data = await clearTenantSendingDomain(tenantId)

  return res.status(200).json({
    success: true,
    message: 'Volvés a enviar desde la dirección de la plataforma.',
    data,
  })
})

// =====================================================
// Dominios propios del comercio
// =====================================================
//
// Mismo patrón que el dominio de envío de correo: el controller es delgado y la
// lógica —validación, token, DNS, transiciones de estado— vive en el servicio,
// que se puede probar sin levantar HTTP.
//
// `requireTenantId` usa resolveAuthorizedTenantFromRequest, así que estas rutas
// ya cruzan el comercio del JWT contra el del dominio.

/**
 * GET /api/tenants/me/domains
 */
export const getDomains = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const domains = await listTenantDomains(tenantId)

  return res.status(200).json({ success: true, data: domains })
})

/**
 * POST /api/tenants/me/domains
 *
 * Da de alta el dominio en estado PENDIENTE y devuelve qué cargar en el DNS.
 * Pendiente no es un trámite: findTenantByDomainCandidates exige 'active', así
 * que hasta verificar, el dominio no resuelve a nada.
 */
export const addDomain = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const data = await registerTenantDomain({
    tenantId,
    hostname: clean(req.body?.hostname),
    // Sin `surface` el servicio asume tienda, que es lo que pide casi toda
    // alta. Un comercio que quiere su propio panel manda 'admin' y da de alta
    // un segundo hostname para eso: un hostname sirve una sola aplicación.
    ...(clean(req.body?.surface) ? { surface: clean(req.body.surface) } : {}),
  })

  return res.status(201).json({
    success: true,
    message: 'Dominio cargado. Creá el registro TXT y después verificalo.',
    data,
  })
})

/**
 * POST /api/tenants/me/domains/verify
 *
 * El hostname va en el cuerpo y no en la ruta: un dominio con puntos en un
 * parámetro de path obliga a encodear y se rompe con facilidad.
 */
export const verifyDomain = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const data = await verifyTenantDomain({
    tenantId,
    hostname: clean(req.body?.hostname),
  })

  return res.status(200).json({
    success: true,
    message: data.verified
      ? 'Dominio verificado: ya podés usarlo.'
      : 'Todavía no vemos el registro TXT. Los cambios de DNS pueden tardar en propagarse.',
    data,
  })
})

/**
 * DELETE /api/tenants/me/domains
 */
export const deleteDomain = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const data = await removeTenantDomain({
    tenantId,
    hostname: clean(req.body?.hostname),
  })

  return res.status(200).json({
    success: true,
    message: 'Dominio dado de baja.',
    data,
  })
})

export const updateTenantSettings = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const body = req.body || {}

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  if (body.name !== undefined) {
    const name = clean(body.name)
    if (name.length < 3 || name.length > 120) {
      return res.status(400).json({
        success: false,
        message: 'El nombre debe tener entre 3 y 120 caracteres',
      })
    }
    tenant.name = name
  }

  if (body.currency !== undefined) {
    tenant.currency = clean(body.currency).toUpperCase().slice(0, 3) || 'ARS'
  }

  if (body.settings?.branding) {
    const b = body.settings.branding
    if (b.logoUrl !== undefined) tenant.settings.branding.logoUrl = clean(b.logoUrl).slice(0, 500) || null
    if (b.faviconUrl !== undefined) tenant.settings.branding.faviconUrl = clean(b.faviconUrl).slice(0, 500) || null
  }

  if (body.settings?.store) {
    const s = body.settings.store
    if (s.description !== undefined) tenant.settings.store.description = clean(s.description).slice(0, 300)
    if (s.contactEmail !== undefined) {
      const email = clean(s.contactEmail)
      tenant.settings.store.contactEmail = email && isValidEmail(email) ? email.toLowerCase() : null
    }
    if (s.contactPhone !== undefined) tenant.settings.store.contactPhone = clean(s.contactPhone).slice(0, 30) || null
    if (s.address !== undefined) tenant.settings.store.address = clean(s.address).slice(0, 200)
  }

  if (body.settings?.checkout) {
    const c = body.settings.checkout
    if (c.allowGuestCheckout !== undefined) tenant.settings.checkout.allowGuestCheckout = Boolean(c.allowGuestCheckout)
  }

  await tenant.save()

  return res.status(200).json({
    success: true,
    message: 'Configuración actualizada',
    data: {
      name: tenant.name,
      currency: tenant.currency,
      settings: tenant.settings,
    },
  })
})

export const updateOnboardingStep = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { step } = req.body || {}

  if (!step || !ONBOARDING_STEPS.includes(step)) {
    return res.status(400).json({
      success: false,
      message: `Paso inválido. Valores: ${ONBOARDING_STEPS.join(', ')}`,
    })
  }

  const update = { 'onboarding.step': step }

  if (step === 'completed') {
    update['onboarding.completed'] = true
    update['onboarding.completedAt'] = new Date()
  }

  const tenant = await Tenant.findByIdAndUpdate(tenantId, { $set: update }, { new: true })
    .select('onboarding')
    .lean()

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  return res.status(200).json({
    success: true,
    data: { onboarding: tenant.onboarding },
  })
})
