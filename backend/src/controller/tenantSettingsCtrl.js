import asyncHandler from 'express-async-handler'
import Tenant from '../models/tenantModel.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'

const clean = value => String(value ?? '').trim()

const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, { requireUserTenant: true }).tenantId

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isValidEmail = v => EMAIL_RE.test(clean(v))

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
