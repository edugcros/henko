// 📁 src/services/meta/metaCredentialsService.js
//
// Resuelve la config de Meta Pixel / Conversions API de un tenant. Mismo
// patrón cacheado que aiCredentialsService.js: el evento Purchase se dispara
// en el camino crítico de cada pago aprobado (webhook, poll de estado, y la
// respuesta directa), así que no puede costar una lectura + desencriptado de
// Mongo por cada uno.

import Tenant from '../../models/tenantModel.js'
import { cacheGet, cacheSet, cacheDel } from '../../utils/cache.js'

const clean = value => String(value || '').trim()

const PROFILE_CACHE_PREFIX = 'meta:profile:'
const PROFILE_CACHE_TTL_SEC = Number(process.env.META_PROFILE_CACHE_TTL_SEC || 60)

const emptyProfile = tenantId => ({
  tenantId: String(tenantId || ''),
  isEnabled: false,
  pixelId: '',
  accessToken: '',
})

/**
 * Config de Meta lista para usar, en una sola lectura cacheada.
 */
export const resolveTenantMetaCredentials = async tenantId => {
  const id = clean(tenantId)
  if (!id) return emptyProfile(id)

  const cacheKey = `${PROFILE_CACHE_PREFIX}${id}`
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  // No se usa .lean() a propósito: integrations.meta.accessToken está
  // cifrado en reposo y solo se desencripta vía el getter del schema.
  const tenant = await Tenant.findById(id).select(
    '+integrations.meta.accessToken integrations.meta.pixelId integrations.meta.isEnabled',
  )

  if (!tenant) return emptyProfile(id)

  const meta = tenant.integrations?.meta || {}

  const profile = {
    tenantId: id,
    isEnabled: Boolean(meta.isEnabled) && Boolean(meta.pixelId) && Boolean(meta.accessToken),
    pixelId: clean(meta.pixelId),
    accessToken: clean(meta.accessToken),
  }

  await cacheSet(cacheKey, profile, PROFILE_CACHE_TTL_SEC)

  return profile
}

export const invalidateTenantMetaProfile = async tenantId => {
  const id = clean(tenantId)
  if (!id) return
  await cacheDel(`${PROFILE_CACHE_PREFIX}${id}`)
}

export default { resolveTenantMetaCredentials, invalidateTenantMetaProfile }
