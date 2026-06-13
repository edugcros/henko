// 📁 src/services/aiAgent/aiAgentProvisioningService.js
import AiAgent from '../../models/aiAgentModel.js'

const clean = value => String(value || '').trim()

const getTenantName = tenant => {
  return (
    clean(tenant?.name) ||
    clean(tenant?.storeName) ||
    clean(tenant?.businessName) ||
    clean(tenant?.commerceName) ||
    clean(tenant?.domain) ||
    'la tienda'
  )
}

const getTenantCurrency = tenant => {
  return clean(tenant?.currency || tenant?.moneda || 'ARS').toUpperCase()
}

export const buildDefaultAiAgentPayload = ({ tenantId, tenant = null } = {}) => {
  const storeName = getTenantName(tenant)
  const currency = getTenantCurrency(tenant)

  return {
    tenantId,
    name: `Asistente IA de ${storeName}`,
    enabled: true,

    channels: {
      webchat: {
        enabled: true,
      },
      whatsapp: {
        enabled: false,
      },
    },

    behavior: {
      tone: 'friendly_professional',
      language: 'es-AR',
      maxMessagesBeforeHuman: 12,
    },

    businessContext: {
      storeName,
      currency,
      description:
        'Asistente comercial para responder consultas de productos, stock, promociones, envíos y ayuda de compra.',
    },

    policies: {
      doNotInvent: true,
      useOnlyCatalogProducts: true,
      requireHumanForSensitiveCases: true,
      requireHumanForVehiclesOrHighTicket: true,
    },

    stats: {
      conversations: 0,
      leads: 0,
      handoffs: 0,
      lastInteractionAt: null,
    },
  }
}

export const getOrCreateAiAgentForTenant = async ({
  tenantId,
  tenant = null,
} = {}) => {
  if (!tenantId) {
    throw new Error('tenantId es obligatorio para provisionar AiAgent')
  }

  const payload = buildDefaultAiAgentPayload({
    tenantId,
    tenant,
  })

  const agent = await AiAgent.findOneAndUpdate(
    { tenantId },
    {
      $setOnInsert: payload,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  )
    .setOptions({ tenantId })
    .lean()

  return agent
}