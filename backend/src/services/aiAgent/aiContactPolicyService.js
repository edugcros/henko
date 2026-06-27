// 📁 src/services/aiAgent/aiContactPolicyService.js
import AiContactPreference from '../../models/aiContactPreferenceModel.js'

const clean = value => String(value || '').trim()
const normalizeDestination = (value, channel = '') => {
  const cleanValue = clean(value).toLowerCase()

  if (normalizeChannel(channel) === 'whatsapp') {
    return cleanValue.replace(/[^\d+]/g, '')
  }

  return cleanValue
}

const getRolling24hWindowStart = () => new Date(Date.now() - 24 * 60 * 60 * 1000)

const normalizeChannel = value => clean(value).toLowerCase()

export const canContactCustomer = async ({
  tenantId,
  channel,
  destination,
  minHoursBetweenContacts = 6,
  requireMarketingConsent = true,
  allowWhatsappCustomerWindow = true,
  maxContactsPer24h = Number(process.env.AI_CONTACT_MAX_CONTACTS_24H || 3),
}) => {
  const cleanChannel = normalizeChannel(channel)
  const cleanDestination = normalizeDestination(destination, cleanChannel)

  if (!tenantId || !cleanChannel || !cleanDestination) {
    return { allowed: false, reason: 'missing_contact_data' }
  }

  const preference = await AiContactPreference.findOne({
    tenantId,
    channel: cleanChannel,
    destination: cleanDestination,
  }).setOptions({ tenantId })

  if (preference?.optedOut) {
    return { allowed: false, reason: 'customer_opted_out', preference }
  }

  const withinWhatsappWindow =
    cleanChannel === 'whatsapp' &&
    allowWhatsappCustomerWindow &&
    isWithinWhatsappCustomerWindow(preference)

  if (
    requireMarketingConsent &&
    !preference?.marketingConsent &&
    !withinWhatsappWindow
  ) {
    return { allowed: false, reason: 'missing_marketing_consent', preference }
  }

  if (preference?.lastContactAt) {
    const diffHours = (Date.now() - preference.lastContactAt.getTime()) / 36e5
    if (diffHours < Number(minHoursBetweenContacts || 0)) {
      return { allowed: false, reason: 'contact_too_recent', preference }
    }
  }

  const resetAt = preference?.contactCountResetAt || preference?.updatedAt
  const countStillInWindow =
    resetAt && resetAt >= getRolling24hWindowStart()

  const currentCount = countStillInWindow
    ? Number(preference?.contactCount24h || 0)
    : 0

  if (maxContactsPer24h > 0 && currentCount >= maxContactsPer24h) {
    return { allowed: false, reason: 'daily_contact_limit_reached', preference }
  }

  return { allowed: true, reason: 'allowed', preference }
}

export const registerCustomerContact = async ({
  tenantId,
  channel,
  destination,
}) => {
  const cleanChannel = normalizeChannel(channel)
  const cleanDestination = normalizeDestination(destination, cleanChannel)

  if (!tenantId || !cleanChannel || !cleanDestination) return null

  const now = new Date()
  const existing = await AiContactPreference.findOne({
    tenantId,
    channel: cleanChannel,
    destination: cleanDestination,
  }).setOptions({ tenantId })

  const resetAt = existing?.contactCountResetAt || existing?.updatedAt
  const shouldReset = !resetAt || resetAt < getRolling24hWindowStart()

  return AiContactPreference.findOneAndUpdate(
    { tenantId, channel: cleanChannel, destination: cleanDestination },
    {
      $set: {
        lastContactAt: now,
        ...(shouldReset ? { contactCountResetAt: now, contactCount24h: 1 } : {}),
      },
      ...(shouldReset ? {} : { $inc: { contactCount24h: 1 } }),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

export const registerCustomerInboundMessage = async ({
  tenantId,
  channel,
  destination,
  consentSource = 'inbound_message',
}) => {
  const cleanChannel = normalizeChannel(channel)
  const cleanDestination = normalizeDestination(destination, cleanChannel)

  if (!tenantId || !cleanChannel || !cleanDestination) return null

  return AiContactPreference.findOneAndUpdate(
    { tenantId, channel: cleanChannel, destination: cleanDestination },
    {
      $set: {
        lastCustomerMessageAt: new Date(),
        consentSource,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

export const registerMarketingConsent = async ({
  tenantId,
  channel,
  destination,
  consentSource = 'explicit_customer_consent',
}) => {
  const cleanChannel = normalizeChannel(channel)
  const cleanDestination = normalizeDestination(destination, cleanChannel)

  if (!tenantId || !cleanChannel || !cleanDestination) return null

  return AiContactPreference.findOneAndUpdate(
    { tenantId, channel: cleanChannel, destination: cleanDestination },
    {
      $set: {
        marketingConsent: true,
        consentSource,
        consentAt: new Date(),
        optedOut: false,
        optedOutAt: null,
        reason: '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

export const optOutCustomer = async ({
  tenantId,
  channel,
  destination,
  reason = 'customer_requested',
}) => {
  const cleanChannel = normalizeChannel(channel)
  const cleanDestination = normalizeDestination(destination, cleanChannel)

  if (!tenantId || !cleanChannel || !cleanDestination) return null

  return AiContactPreference.findOneAndUpdate(
    { tenantId, channel: cleanChannel, destination: cleanDestination },
    {
      $set: {
        optedOut: true,
        marketingConsent: false,
        optedOutAt: new Date(),
        reason: clean(reason).slice(0, 500),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

export const isWithinWhatsappCustomerWindow = preference => {
  if (!preference?.lastCustomerMessageAt) return false

  return (
    Date.now() - preference.lastCustomerMessageAt.getTime() <=
    24 * 60 * 60 * 1000
  )
}
