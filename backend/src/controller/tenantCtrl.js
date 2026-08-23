// 📁 src/controller/tenantCtrl.js
// VERSIÓN PRODUCCIÓN - RESOLUCIÓN PÚBLICA DE TENANT

import expressAsyncHandler from 'express-async-handler'
import Tenant from '../models/tenantModel.js'
import AiAgent from '../models/aiAgentModel.js'

import {
  getDomainCandidates,
  normalizeSlug,
} from '../utils/domainUtils.js'

// =====================================================
// Helpers
// =====================================================

/**
 * ¿Este comercio tiene el asistente activo para la tienda?
 *
 * Viaja en la resolución de tenant y no en un endpoint propio porque la
 * tienda ya llama a este endpoint una vez al arrancar: un request más por
 * visita, en todas las páginas, para responder un booleano no se justifica.
 *
 * Sin este dato la tienda no tiene forma de saberlo y termina mostrándole la
 * burbuja de chat a todos los compradores, incluso de comercios que nunca
 * activaron el asistente — que al abrirla reciben "un asesor va a revisar tu
 * consulta". Peor que no mostrar nada.
 */
const isAiAssistantEnabled = async tenantId => {
  try {
    const agent = await AiAgent.findOne({ tenantId })
      .select('enabled channels.webchat.enabled')
      .setOptions({ tenantId })
      .lean()

    if (!agent?.enabled) return false

    return agent?.channels?.webchat?.enabled !== false
  } catch {
    // La resolución de tenant es lo que hace arrancar la tienda entera: si
    // esta consulta falla, la tienda abre sin asistente, no rota.
    return false
  }
}

const buildPublicTenantResponse = (tenant, { aiAssistantEnabled = false } = {}) => {
  const primaryDomain = tenant.getPrimaryDomain?.() || null
  const mp = tenant.integrations?.mercadopago
  const meta = tenant.integrations?.meta

  return {
    tenantId: tenant._id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    currency: tenant.currency,
    locale: tenant.locale,
    timezone: tenant.timezone,
    country: tenant.country,
    domains: tenant.domains,
    primaryDomain,
    settings: tenant.settings,
    paymentMethods: {
      mercadopago: mp?.isEnabled
        ? { publicKey: mp.publicKey || '', mode: mp.mode || 'test' }
        : null,
    },
    // Solo el pixelId — es un identificador público, pensado para vivir en
    // el HTML. El accessToken de Conversions API es select:false y jamás
    // debe salir por acá: ese lado corre server-side (metaCapiService.js).
    tracking: {
      meta: meta?.isEnabled && meta?.pixelId ? { pixelId: meta.pixelId } : null,
    },
    aiAssistant: {
      enabled: aiAssistantEnabled,
    },
  }
}

// =====================================================
// @desc    Resolver tenant por dominio o slug
// @route   GET /api/tenants/resolve?domains=henko.local
// @route   GET /api/tenants/resolve?slug=mi-tienda
// @access  Public
// =====================================================

export const resolveTenant = expressAsyncHandler(async (req, res) => {
  const { domains, domain, slug } = req.query

  if (slug) {
    const cleanSlug = normalizeSlug(slug)

    if (!cleanSlug) {
      return res.status(400).json({
        success: false,
        message: 'Slug inválido',
      })
    }

    const tenantBySlug = await Tenant.findOne({
      slug: cleanSlug,
      status: 'active',
    }).select(
      '_id name slug domains status plan settings currency locale timezone country integrations.mercadopago.publicKey integrations.mercadopago.isEnabled integrations.mercadopago.mode integrations.meta.pixelId integrations.meta.isEnabled',
    )

    if (!tenantBySlug) {
      return res.status(404).json({
        success: false,
        message: 'Tenant no encontrado',
      })
    }

    return res.status(200).json({
      success: true,
      data: buildPublicTenantResponse(tenantBySlug, {
        aiAssistantEnabled: await isAiAssistantEnabled(tenantBySlug._id),
      }),
    })
  }

  const requestedDomain =
    domains ||
    domain ||
    req.headers['x-tenant-domain'] ||
    null

  if (!requestedDomain) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere domain, domains, slug o header x-tenant-domain',
    })
  }

  const candidates = getDomainCandidates(requestedDomain)

  if (!candidates.length) {
    return res.status(400).json({
      success: false,
      message: 'Dominio inválido',
    })
  }

  const tenantByDomain = await Tenant.findOne({
    status: 'active',
    $or: [
      { 'domains.hostname': { $in: candidates } },
      { 'domains.normalizedHostname': { $in: candidates } },
      { 'adminDomains.hostname': { $in: candidates } },
      { 'adminDomains.normalizedHostname': { $in: candidates } },

      { legacyDomains: { $in: candidates } },
      { legacyAdminDomains: { $in: candidates } },
    ],
  }).lean()

  if (!tenantByDomain) {
    return res.status(404).json({
      success: false,
      message: 'Tenant no encontrado',
    })
  }

  return res.status(200).json({
    success: true,
    data: buildPublicTenantResponse(tenantByDomain, {
      aiAssistantEnabled: await isAiAssistantEnabled(tenantByDomain._id),
    }),
  })
})