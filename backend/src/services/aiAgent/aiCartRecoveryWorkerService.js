// 📁 src/services/aiAgent/aiCartRecoveryWorkerService.js
import AiAgent from '../../models/aiAgentModel.js'
import AiCartRecovery from '../../models/aiCartRecoveryModel.js'
import AiCampaignRule from '../../models/aiCampaignRuleModel.js'
import AiContactPreference from '../../models/aiContactPreferenceModel.js'
import Tenant from '../../models/tenantModel.js'
import { sendWhatsappTextMessage } from './whatsappService.js'

const clean = value => String(value || '').trim()

const formatMoneyFromCents = (cents, currency = 'ARS') => {
  const amount = Number(cents || 0) / 100

  try {
    return amount.toLocaleString('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  } catch {
    return `$${Math.round(amount).toLocaleString('es-AR')}`
  }
}

const normalizeBusinessHour = value => {
  const cleanValue = clean(value)

  if (!/^\d{2}:\d{2}$/.test(cleanValue)) {
    return null
  }

  const [hour, minute] = cleanValue.split(':').map(Number)

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  return {
    hour,
    minute,
    total: hour * 60 + minute,
  }
}

const canSendByBusinessHours = rule => {
  if (!rule?.trigger?.onlyBusinessHours) return true

  const start =
    normalizeBusinessHour(rule?.trigger?.businessHours?.start) ||
    normalizeBusinessHour('09:00')

  const end =
    normalizeBusinessHour(rule?.trigger?.businessHours?.end) ||
    normalizeBusinessHour('20:00')

  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()

  return current >= start.total && current <= end.total
}

const getNextBusinessHour = rule => {
  const start =
    normalizeBusinessHour(rule?.trigger?.businessHours?.start) ||
    normalizeBusinessHour('09:00')

  const nextAttempt = new Date()
  nextAttempt.setHours(start.hour, start.minute, 0, 0)

  if (nextAttempt <= new Date()) {
    nextAttempt.setDate(nextAttempt.getDate() + 1)
  }

  return nextAttempt
}

const replaceTemplateVars = (template, recovery, tenant) => {
  const items = recovery?.cartSnapshot?.items || []
  const firstItem = items[0]
  const itemCount = items.length
  const total = formatMoneyFromCents(
    recovery?.cartSnapshot?.subtotalCents,
    recovery?.cartSnapshot?.currency || tenant?.currency || 'ARS',
  )

  const customerName =
    clean(recovery?.customer?.name).split(/\s+/)[0] || 'Hola'

  return clean(template)
    .replaceAll('{{customerName}}', customerName)
    .replaceAll('{{productName}}', firstItem?.title || 'tu producto')
    .replaceAll('{{itemCount}}', String(itemCount))
    .replaceAll('{{cartTotal}}', total)
    .replaceAll('{{checkoutUrl}}', recovery?.cartSnapshot?.checkoutUrl || '')
}

const canContactCustomer = async ({ tenantId, channel, destination }) => {
  const cleanDestination = clean(destination)

  if (!tenantId || !cleanDestination) {
    return {
      allowed: false,
      reason: 'missing_tenant_or_destination',
    }
  }

  const preference = await AiContactPreference.findOne({
    tenantId,
    channel,
    destination: cleanDestination,
  }).setOptions({ tenantId })

  if (preference?.optedOut) {
    return {
      allowed: false,
      reason: 'customer_opted_out',
    }
  }

  const minHoursBetweenContacts = Number(
    process.env.AI_MIN_HOURS_BETWEEN_CONTACTS || 6,
  )

  if (preference?.lastContactAt) {
    const diffMs = Date.now() - preference.lastContactAt.getTime()
    const diffHours = diffMs / (1000 * 60 * 60)

    if (diffHours < minHoursBetweenContacts) {
      return {
        allowed: false,
        reason: 'contact_too_recent',
      }
    }
  }

  return {
    allowed: true,
    reason: 'allowed',
  }
}

const registerCustomerContact = async ({ tenantId, channel, destination }) => {
  const cleanDestination = clean(destination)

  if (!tenantId || !cleanDestination) return null

  return AiContactPreference.findOneAndUpdate(
    {
      tenantId,
      channel,
      destination: cleanDestination,
    },
    {
      $set: {
        lastContactAt: new Date(),
      },
      $inc: {
        contactCount24h: 1,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).setOptions({ tenantId })
}

export const processDueCartRecoveries = async ({ limit = 25 } = {}) => {
  const cleanLimit = Math.min(Math.max(Number(limit || 25), 1), 100)

  const recoveries = await AiCartRecovery.find({
    status: 'scheduled',
    scheduledAt: {
      $lte: new Date(),
    },
  })
    .sort({ scheduledAt: 1 })
    .limit(cleanLimit)

  const results = []

  for (const recovery of recoveries) {
    const tenantId = recovery.tenantId

    try {
      if (!tenantId) {
        recovery.status = 'failed'
        recovery.metadata = {
          ...recovery.metadata,
          lastError: 'missing_tenant_id',
        }
        await recovery.save()
        continue
      }

      const [tenant, agent, rule] = await Promise.all([
        Tenant.findById(tenantId).lean(),
        AiAgent.findOne({
          tenantId,
          enabled: true,
          'channels.whatsapp.enabled': true,
        })
          .select('+channels.whatsapp.accessTokenEncrypted +channels.whatsapp.accessToken')
          .setOptions({ tenantId }),
        recovery?.metadata?.ruleId
          ? AiCampaignRule.findById(recovery.metadata.ruleId).setOptions({ tenantId })
          : AiCampaignRule.findOne({
            tenantId,
            type: 'abandoned_cart',
            enabled: true,
            channel: 'whatsapp',
          }).setOptions({ tenantId }),
      ])

      if (!tenant || !agent || !rule?.enabled) {
        recovery.status = 'cancelled'
        recovery.metadata = {
          ...recovery.metadata,
          cancelledReason: 'tenant_agent_or_rule_disabled',
        }
        await recovery.save({ tenantId })

        results.push({
          recoveryId: recovery._id,
          status: 'cancelled',
          reason: 'tenant_agent_or_rule_disabled',
        })

        continue
      }

      if (!clean(recovery?.customer?.phone)) {
        recovery.status = 'cancelled'
        recovery.metadata = {
          ...recovery.metadata,
          cancelledReason: 'missing_customer_phone',
        }
        await recovery.save({ tenantId })

        results.push({
          recoveryId: recovery._id,
          status: 'cancelled',
          reason: 'missing_customer_phone',
        })

        continue
      }

      if (!canSendByBusinessHours(rule)) {
        recovery.scheduledAt = getNextBusinessHour(rule)
        await recovery.save({ tenantId })

        results.push({
          recoveryId: recovery._id,
          status: 'rescheduled',
          scheduledAt: recovery.scheduledAt,
        })

        continue
      }

      if (recovery.attempts >= Number(rule?.trigger?.maxAttempts || 2)) {
        recovery.status = 'expired'
        await recovery.save({ tenantId })

        results.push({
          recoveryId: recovery._id,
          status: 'expired',
        })

        continue
      }

      const policy = await canContactCustomer({
        tenantId,
        channel: 'whatsapp',
        destination: recovery.customer.phone,
      })

      if (!policy.allowed) {
        recovery.status = 'cancelled'
        recovery.metadata = {
          ...recovery.metadata,
          cancelledReason: policy.reason,
        }
        await recovery.save({ tenantId })

        results.push({
          recoveryId: recovery._id,
          status: 'cancelled',
          reason: policy.reason,
        })

        continue
      }

      const message = replaceTemplateVars(rule.messageTemplate, recovery, tenant)

      const phoneNumberId = clean(agent?.channels?.whatsapp?.phoneNumberId)

      const accessToken =
        clean(agent?.channels?.whatsapp?.accessToken) ||
        clean(agent?.channels?.whatsapp?.accessTokenEncrypted)

      if (!phoneNumberId || !accessToken) {
        recovery.status = 'failed'
        recovery.metadata = {
          ...recovery.metadata,
          lastError: 'missing_whatsapp_credentials',
        }
        await recovery.save({ tenantId })

        results.push({
          recoveryId: recovery._id,
          status: 'failed',
          error: 'missing_whatsapp_credentials',
        })

        continue
      }

      await sendWhatsappTextMessage({
        phoneNumberId,
        accessToken,
        to: recovery.customer.phone,
        text: message,
      })

      recovery.status = 'sent'
      recovery.sentAt = new Date()
      recovery.attempts += 1
      recovery.lastMessage = message
      recovery.metadata = {
        ...recovery.metadata,
        lastSentBy: 'ai_cart_recovery_worker',
      }

      await recovery.save({ tenantId })

      rule.stats.sent += 1
      await rule.save({ tenantId })

      await registerCustomerContact({
        tenantId,
        channel: 'whatsapp',
        destination: recovery.customer.phone,
      })

      results.push({
        recoveryId: recovery._id,
        status: 'sent',
      })
    } catch (error) {
      recovery.status = 'failed'
      recovery.metadata = {
        ...recovery.metadata,
        lastError: error.message,
      }

      await recovery.save({ tenantId }).catch(() => null)

      results.push({
        recoveryId: recovery._id,
        status: 'failed',
        error: error.message,
      })
    }
  }

  return results
}