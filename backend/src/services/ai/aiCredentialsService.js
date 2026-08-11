// 📁 src/services/ai/aiCredentialsService.js
//
// Resuelve QUÉ API key usa cada tenant y CON QUÉ derechos.
//
// Hasta este refactor había una sola `process.env.GEMINI_API_KEY` leída
// directamente en tres servicios distintos. Eso significaba que:
//
//   - el gasto de todos los comercios caía siempre sobre la misma factura, y
//   - cuando un tenant agotaba la cuota del proyecto de Google, la IA se
//     caía para todos al mismo tiempo (429 compartido).
//
// Con BYOK ("bring your own key") un comercio grande apunta a su propio
// proyecto de Google: paga lo suyo, y su tráfico deja de competir por la
// cuota de los demás.
//
// La key del tenant se guarda cifrada en reposo con el mismo AES-256-GCM que
// ya usan los tokens de WhatsApp y Mercado Pago (secretCryptoService).

import Tenant from '../../models/tenantModel.js'
import logger from '../../../config/logger.js'
import { cacheGet, cacheSet, cacheDel } from '../../utils/cache.js'
import { isByokAllowedForPlan, normalizePlan } from './aiPlanPolicy.js'

const clean = value => String(value || '').trim()

const PROFILE_CACHE_PREFIX = 'ai:profile:'

// Corto a propósito: es la ventana máxima en la que un cambio de plan, una
// baja de suscripción o una key nueva puede seguir teniendo efecto viejo.
const PROFILE_CACHE_TTL_SEC = Number(process.env.AI_PROFILE_CACHE_TTL_SEC || 60)

const KEY_SOURCE = Object.freeze({
  TENANT: 'tenant',
  PLATFORM: 'platform',
  NONE: 'none',
})

export { KEY_SOURCE }

/**
 * Una key de Google pegada desde un mail o un chat suele traer un carácter
 * invisible. Como termina en un header HTTP, el error que devuelve fetch es
 * indescifrable ("Invalid character in header content"), así que conviene
 * detectarlo cuando el comercio la guarda y no cuando falla en producción.
 */
export const findInvalidHeaderChar = value => {
  const text = String(value || '')

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 32 || code > 126) return { index, code }
  }

  return null
}

const getPlatformApiKey = () => clean(process.env.GEMINI_API_KEY)

const buildProfile = ({ tenant, tenantId }) => {
  const plan = normalizePlan(tenant?.plan)
  const byokEnabled = Boolean(tenant?.ai?.byokEnabled)
  const tenantKey = clean(tenant?.ai?.geminiApiKey)
  const platformKey = getPlatformApiKey()

  const useTenantKey = byokEnabled && Boolean(tenantKey) && isByokAllowedForPlan(plan)

  const apiKey = useTenantKey ? tenantKey : platformKey
  const keySource = useTenantKey
    ? KEY_SOURCE.TENANT
    : platformKey
      ? KEY_SOURCE.PLATFORM
      : KEY_SOURCE.NONE

  return {
    tenantId: String(tenantId),
    plan,
    subscriptionStatus: clean(tenant?.subscriptionStatus) || 'trialing',
    trialEndsAt: tenant?.trialEndsAt || null,
    subscriptionPastDueAt: tenant?.subscriptionPastDueAt || null,
    updatedAt: tenant?.updatedAt || null,
    byokEnabled,
    byokAllowed: isByokAllowedForPlan(plan),
    hasTenantKey: Boolean(tenantKey),
    apiKey,
    keySource,
  }
}

const emptyProfile = tenantId => ({
  tenantId: String(tenantId || ''),
  plan: 'free',
  subscriptionStatus: 'trialing',
  trialEndsAt: null,
  subscriptionPastDueAt: null,
  updatedAt: null,
  byokEnabled: false,
  byokAllowed: false,
  hasTenantKey: false,
  apiKey: getPlatformApiKey(),
  keySource: getPlatformApiKey() ? KEY_SOURCE.PLATFORM : KEY_SOURCE.NONE,
})

/**
 * Plan + estado de suscripción + credencial, en una sola lectura cacheada.
 *
 * Lo consumen el medidor de cuota y los tres servicios que llaman a Gemini,
 * así que sin cache serían 2-3 lecturas de Tenant por mensaje del agente.
 */
export const loadTenantAiProfile = async tenantId => {
  const id = clean(tenantId)
  if (!id) return emptyProfile(id)

  const cacheKey = `${PROFILE_CACHE_PREFIX}${id}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  // No se usa .lean() a propósito: ai.geminiApiKey está cifrado en reposo y
  // solo se desencripta vía el getter del schema, que .lean() no aplica.
  const tenant = await Tenant.findById(id).select(
    '+ai.geminiApiKey ai.byokEnabled plan subscriptionStatus trialEndsAt subscriptionPastDueAt updatedAt',
  )

  if (!tenant) return emptyProfile(id)

  const profile = buildProfile({ tenant, tenantId: id })
  await cacheSet(cacheKey, profile, PROFILE_CACHE_TTL_SEC)

  return profile
}

export const invalidateTenantAiProfile = async tenantId => {
  const id = clean(tenantId)
  if (!id) return
  await cacheDel(`${PROFILE_CACHE_PREFIX}${id}`)
}

/**
 * Credencial a usar para este tenant. `source` es lo que decide después si el
 * consumo se cobra contra la cuota de la plataforma o solo se registra.
 */
export const resolveTenantAiCredentials = async tenantId => {
  const profile = await loadTenantAiProfile(tenantId)

  return {
    apiKey: profile.apiKey,
    source: profile.keySource,
    plan: profile.plan,
  }
}

export const isPlatformKeyConfigured = () => Boolean(getPlatformApiKey())

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Verifica la key contra Google antes de guardarla.
 *
 * Sin esto, una key mal pegada se descubre cuando un comprador escribe y el
 * asistente contesta el fallback genérico: el comercio cree que la configuró
 * bien y el error aparece horas después, en la conversación de un cliente.
 *
 * Se usa el listado de modelos porque no genera contenido: no cuesta tokens.
 */
export const verifyGeminiApiKey = async apiKey => {
  const key = clean(apiKey)
  if (!key) return { valid: false, reason: 'empty_key' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(GEMINI_MODELS_URL, {
      method: 'GET',
      headers: { 'x-goog-api-key': key },
      signal: controller.signal,
    })

    if (response.ok) return { valid: true }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { valid: false, reason: 'rejected_by_provider', status: response.status }
    }

    // 429/5xx no dicen nada sobre la key: es el proveedor con problemas. No
    // se bloquea el guardado por eso.
    return { valid: true, unverified: true, status: response.status }
  } catch (error) {
    logger.warn('[AI CREDENTIALS] No se pudo verificar la API key', {
      error: error?.message,
    })

    return { valid: true, unverified: true, reason: 'verification_unavailable' }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Guarda la API key propia del comercio. Devuelve el perfil actualizado.
 */
export const setTenantAiKey = async ({ tenantId, apiKey }) => {
  const id = clean(tenantId)
  const key = clean(apiKey)

  if (!id) {
    const error = new Error('Tenant no resuelto')
    error.statusCode = 400
    throw error
  }

  if (!key) {
    const error = new Error('La API key no puede estar vacía')
    error.statusCode = 400
    throw error
  }

  const invalidChar = findInvalidHeaderChar(key)
  if (invalidChar) {
    const error = new Error(
      `La API key tiene un carácter inválido en la posición ${invalidChar.index} (código ${invalidChar.code}). Volvé a copiarla desde Google AI Studio: debe ser texto ASCII sin espacios.`,
    )
    error.statusCode = 400
    throw error
  }

  const tenant = await Tenant.findById(id).select('plan')
  if (!tenant) {
    const error = new Error('Comercio no encontrado')
    error.statusCode = 404
    throw error
  }

  if (!isByokAllowedForPlan(tenant.plan)) {
    const error = new Error(
      'Tu plan actual no permite usar una API key propia. Está disponible desde el plan Pro.',
    )
    error.statusCode = 403
    throw error
  }

  const verification = await verifyGeminiApiKey(key)

  if (!verification.valid) {
    const error = new Error(
      'Google rechazó esa API key. Revisá que esté activa y que tenga habilitada la API de Generative Language.',
    )
    error.statusCode = 400
    throw error
  }

  await Tenant.updateOne(
    { _id: id },
    {
      $set: {
        'ai.geminiApiKey': key,
        'ai.byokEnabled': true,
        'ai.updatedAt': new Date(),
      },
    },
  )

  await invalidateTenantAiProfile(id)

  logger.info('[AI CREDENTIALS] BYOK activado', { tenantId: id })

  return loadTenantAiProfile(id)
}

/**
 * Vuelve a la key de la plataforma. No se borra el registro de consumo: el
 * histórico del mes tiene que seguir siendo auditable.
 */
export const clearTenantAiKey = async tenantId => {
  const id = clean(tenantId)
  if (!id) {
    const error = new Error('Tenant no resuelto')
    error.statusCode = 400
    throw error
  }

  await Tenant.updateOne(
    { _id: id },
    {
      $set: {
        'ai.geminiApiKey': '',
        'ai.byokEnabled': false,
        'ai.updatedAt': new Date(),
      },
    },
  )

  await invalidateTenantAiProfile(id)

  logger.info('[AI CREDENTIALS] BYOK desactivado', { tenantId: id })

  return loadTenantAiProfile(id)
}

export default {
  KEY_SOURCE,
  loadTenantAiProfile,
  invalidateTenantAiProfile,
  resolveTenantAiCredentials,
  isPlatformKeyConfigured,
  setTenantAiKey,
  clearTenantAiKey,
  findInvalidHeaderChar,
  verifyGeminiApiKey,
}
