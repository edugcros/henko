// 📁 src/services/aiAgent/aiContactPolicyService.js
import AiContactPreference from '../../models/aiContactPreferenceModel.js'

const normalizeDestination = value => String(value || '').trim()

export const canContactCustomer = async ({
  tenantId,
  channel,
  destination,
  minHoursBetweenContacts = 6,
  requireMarketingConsent = true,
}) => {
  const cleanDestination = normalizeDestination(destination)

  if (!tenantId || !channel || !cleanDestination) {
    return { allowed: false, reason: 'missing_contact_data' }
  }

  const preference = await AiContactPreference.findOne({
    tenantId,
    channel,
    destination: cleanDestination,
  }).setOptions({ tenantId })

  if (preference?.optedOut) return { allowed: false, reason: 'customer_opted_out' }
  if (requireMarketingConsent && !preference?.marketingConsent) {
    return { allowed: false, reason: 'missing_marketing_consent' }
  }

  if (preference?.lastContactAt) {
    const diffHours = (Date.now() - preference.lastContactAt.getTime()) / 36e5
    if (diffHours < minHoursBetweenContacts) return { allowed: false, reason: 'contact_too_recent' }
  }

  return { allowed: true, reason: 'allowed' }
}

export const registerCustomerContact = async ({ tenantId, channel, destination }) => {
  return AiContactPreference.findOneAndUpdate(
    { tenantId, channel, destination: normalizeDestination(destination) },
    { $set: { lastContactAt: new Date() }, $inc: { contactCount24h: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

export const registerCustomerInboundMessage = async ({ tenantId, channel, destination, consentSource = 'inbound_message' }) => {
  return AiContactPreference.findOneAndUpdate(
    { tenantId, channel, destination: normalizeDestination(destination) },
    {
      $set: {
        lastCustomerMessageAt: new Date(),
        marketingConsent: true,
        consentSource,
        consentAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

export const optOutCustomer = async ({ tenantId, channel, destination, reason = 'customer_requested' }) => {
  return AiContactPreference.findOneAndUpdate(
    { tenantId, channel, destination: normalizeDestination(destination) },
    { $set: { optedOut: true, optedOutAt: new Date(), reason } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

export const isWithinWhatsappCustomerWindow = preference => {
  if (!preference?.lastCustomerMessageAt) return false
  return Date.now() - preference.lastCustomerMessageAt.getTime() <= 24 * 60 * 60 * 1000
}
