import crypto from 'node:crypto'
import AiAgent from '../../models/aiAgentModel.js'
import AiCartRecovery from '../../models/aiCartRecoveryModel.js'
import AiCampaignRule from '../../models/aiCampaignRuleModel.js'
import Tenant from '../../models/tenantModel.js'
import {
  canContactCustomer,
  isWithinWhatsappCustomerWindow,
  registerCustomerContact,
} from './aiContactPolicyService.js'
import {
  sendWhatsappTemplateMessage,
  sendWhatsappTextMessage,
} from './whatsappService.js'

const clean = value => String(value || '').trim()
const PROCESSING_LEASE_MS = Math.min(
  Math.max(Number(process.env.AI_CART_RECOVERY_LEASE_MS || 120000), 30000),
  600000,
)

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
  const match = clean(value).match(/^(\d{2}):(\d{2})$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null

  return { hour, minute, total: hour * 60 + minute }
}

const getTenantTimezone = tenant => {
  return (
    clean(tenant?.timezone) ||
    clean(tenant?.settings?.timezone) ||
    clean(process.env.DEFAULT_TIMEZONE) ||
    'America/Argentina/Buenos_Aires'
  )
}

const getTimeParts = (date, timezone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const values = Object.fromEntries(
      parts.map(part => [part.type, part.value]),
    )
    return { hour: Number(values.hour), minute: Number(values.minute) }
  } catch {
    return { hour: date.getHours(), minute: date.getMinutes() }
  }
}

const canSendByBusinessHours = ({ rule, tenant }) => {
  if (!rule?.trigger?.onlyBusinessHours) return true

  const start =
    normalizeBusinessHour(rule?.trigger?.businessHours?.start) ||
    normalizeBusinessHour('09:00')
  const end =
    normalizeBusinessHour(rule?.trigger?.businessHours?.end) ||
    normalizeBusinessHour('20:00')
  const now = getTimeParts(new Date(), getTenantTimezone(tenant))
  const current = now.hour * 60 + now.minute

  // Soporta ventanas que cruzan medianoche, por ejemplo 20:00 → 02:00.
  if (start.total > end.total) {
    return current >= start.total || current <= end.total
  }

  return current >= start.total && current <= end.total
}

const getNextBusinessHour = rule => {
  const start =
    normalizeBusinessHour(rule?.trigger?.businessHours?.start) ||
    normalizeBusinessHour('09:00')
  const nextAttempt = new Date()
  nextAttempt.setHours(start.hour, start.minute, 0, 0)

  if (nextAttempt <= new Date()) nextAttempt.setDate(nextAttempt.getDate() + 1)
  return nextAttempt
}

const buildTemplateValues = (recovery, tenant) => {
  const items = recovery?.cartSnapshot?.items || []
  const firstItem = items[0]
  const customerName =
    clean(recovery?.customer?.name).split(/\s+/)[0] || 'Hola'

  return {
    customerName,
    productName: firstItem?.title || 'tu producto',
    itemCount: String(items.length),
    cartTotal: formatMoneyFromCents(
      recovery?.cartSnapshot?.subtotalCents,
      recovery?.cartSnapshot?.currency || tenant?.currency || 'ARS',
    ),
    checkoutUrl: recovery?.cartSnapshot?.checkoutUrl || '',
  }
}

const buildDefaultRecoveryMessage = values => {
  return `Hola ${values.customerName}, vimos que dejaste ${values.productName} en tu carrito por ${values.cartTotal}. Podés retomarlo acá: ${values.checkoutUrl}`
}

const replaceTemplateVars = (template, values) => {
  const baseTemplate = clean(template) || buildDefaultRecoveryMessage(values)

  return baseTemplate
    .replaceAll('{{customerName}}', values.customerName)
    .replaceAll('{{productName}}', values.productName)
    .replaceAll('{{itemCount}}', values.itemCount)
    .replaceAll('{{cartTotal}}', values.cartTotal)
    .replaceAll('{{checkoutUrl}}', values.checkoutUrl)
}

const claimNextRecovery = async () => {
  const now = new Date()
  const lockToken = crypto.randomUUID()
  const recovery = await AiCartRecovery.findOneAndUpdate(
    {
      status: 'scheduled',
      scheduledAt: { $lte: now },
      $and: [
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } },
          ],
        },
        {
          $or: [
            { processingLeaseExpiresAt: null },
            { processingLeaseExpiresAt: { $exists: false } },
            { processingLeaseExpiresAt: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        status: 'processing',
        processingLock: lockToken,
        processingStartedAt: now,
        processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { scheduledAt: 1 } },
  )
    .setOptions({ ignoreTenant: true })
    .select('+processingLock')

  return recovery ? { recovery, lockToken } : null
}

const markExpiredProcessingAsFailed = async () => {
  const now = new Date()

  return AiCartRecovery.updateMany(
    {
      status: 'processing',
      processingLeaseExpiresAt: { $lte: now },
    },
    {
      $set: {
        status: 'failed',
        'metadata.lastError': 'processing_lease_expired',
        'metadata.lastErrorCode': 'PROCESSING_LEASE_EXPIRED',
        'metadata.failedAt': now,
        'metadata.requiresManualReview': true,
      },
      $unset: {
        processingLock: 1,
        processingStartedAt: 1,
        processingLeaseExpiresAt: 1,
      },
    },
  ).setOptions({ ignoreTenant: true })
}


const markExpiredScheduledRecoveries = async () => {
  const now = new Date()

  return AiCartRecovery.updateMany(
    {
      status: { $in: ['pending', 'scheduled'] },
      expiresAt: { $ne: null, $lte: now },
    },
    {
      $set: {
        status: 'expired',
        'metadata.expiredAt': now,
        'metadata.expiredReason': 'recovery_expired',
      },
    },
  ).setOptions({ ignoreTenant: true })
}

const finishRecovery = async ({ recovery, lockToken, status, set = {} }) => {
  return AiCartRecovery.findOneAndUpdate(
    {
      _id: recovery._id,
      tenantId: recovery.tenantId,
      status: 'processing',
      processingLock: lockToken,
    },
    {
      $set: { status, ...set },
      $unset: {
        processingLock: 1,
        processingStartedAt: 1,
        processingLeaseExpiresAt: 1,
      },
    },
    { new: true },
  ).setOptions({ tenantId: recovery.tenantId })
}

const cancelRecovery = (params, reason) => {
  return finishRecovery({
    ...params,
    status: 'cancelled',
    set: {
      'metadata.cancelledReason': reason,
    },
  })
}

const failRecovery = (params, error) => {
  return finishRecovery({
    ...params,
    status: 'failed',
    set: {
      'metadata.lastError': clean(error?.message || error),
      'metadata.lastErrorCode': clean(error?.code),
      'metadata.failedAt': new Date(),
      'metadata.requiresManualReview': true,
    },
  })
}

export const processDueCartRecoveries = async ({ limit = 25 } = {}) => {
  const cleanLimit = Math.min(Math.max(Number(limit || 25), 1), 100)
  const results = []

  await Promise.all([
    markExpiredProcessingAsFailed(),
    markExpiredScheduledRecoveries(),
  ])

  for (let index = 0; index < cleanLimit; index += 1) {
    const claimed = await claimNextRecovery()
    if (!claimed) break

    const { recovery, lockToken } = claimed
    const tenantId = recovery.tenantId
    const lockParams = { recovery, lockToken }

    try {
      if (!tenantId) {
        await failRecovery(lockParams, 'missing_tenant_id')
        continue
      }

      const [tenant, agent, rule] = await Promise.all([
        Tenant.findById(tenantId).setOptions({ ignoreTenant: true }).lean(),
        AiAgent.findOne({
          tenantId,
          enabled: true,
          'channels.whatsapp.enabled': true,
        })
          .select('+channels.whatsapp.accessToken')
          .setOptions({ tenantId }),
        recovery?.metadata?.ruleId
          ? AiCampaignRule.findOne({
            _id: recovery.metadata.ruleId,
            tenantId,
            enabled: true,
          }).setOptions({ tenantId })
          : AiCampaignRule.findOne({
            tenantId,
            type: 'abandoned_cart',
            enabled: true,
            channel: 'whatsapp',
          }).setOptions({ tenantId }),
      ])

      if (!tenant || !agent || !rule) {
        await cancelRecovery(lockParams, 'tenant_agent_or_rule_disabled')
        results.push({ recoveryId: recovery._id, status: 'cancelled' })
        continue
      }

      const destination = clean(recovery?.customer?.phone)
      if (!destination) {
        await cancelRecovery(lockParams, 'missing_customer_phone')
        results.push({ recoveryId: recovery._id, status: 'cancelled' })
        continue
      }

      if (!canSendByBusinessHours({ rule, tenant })) {
        const scheduledAt = getNextBusinessHour(rule)
        await finishRecovery({
          ...lockParams,
          status: 'scheduled',
          set: {
            scheduledAt,
            attempts: Math.max(Number(recovery.attempts || 1) - 1, 0),
          },
        })
        results.push({
          recoveryId: recovery._id,
          status: 'rescheduled',
          scheduledAt,
        })
        continue
      }

      if (recovery.attempts > Number(rule?.trigger?.maxAttempts || 2)) {
        await finishRecovery({ ...lockParams, status: 'expired' })
        results.push({ recoveryId: recovery._id, status: 'expired' })
        continue
      }

      const policy = await canContactCustomer({
        tenantId,
        channel: 'whatsapp',
        destination,
        minHoursBetweenContacts: Number(
          rule?.trigger?.minHoursBetweenContacts || 6,
        ),
        requireMarketingConsent: true,
      })

      if (!policy.allowed) {
        await cancelRecovery(lockParams, policy.reason)
        results.push({
          recoveryId: recovery._id,
          status: 'cancelled',
          reason: policy.reason,
        })
        continue
      }

      const phoneNumberId = clean(agent?.channels?.whatsapp?.phoneNumberId)
      const accessToken = clean(agent?.channels?.whatsapp?.accessToken)
      if (!phoneNumberId || !accessToken) {
        await failRecovery(lockParams, 'missing_whatsapp_credentials')
        results.push({
          recoveryId: recovery._id,
          status: 'failed',
          error: 'missing_whatsapp_credentials',
        })
        continue
      }

      const values = buildTemplateValues(recovery, tenant)

      if (!values.checkoutUrl) {
        await cancelRecovery(lockParams, 'missing_checkout_url')
        results.push({
          recoveryId: recovery._id,
          status: 'cancelled',
          reason: 'missing_checkout_url',
        })
        continue
      }
      const withinCustomerWindow = isWithinWhatsappCustomerWindow(
        policy.preference,
      )

      if (withinCustomerWindow) {
        await sendWhatsappTextMessage({
          phoneNumberId,
          accessToken,
          to: destination,
          text: replaceTemplateVars(rule.messageTemplate, values),
        })
      } else {
        const templateName = clean(rule?.whatsappTemplate?.name)
        if (!rule?.whatsappTemplate?.enabled || !templateName) {
          await cancelRecovery(lockParams, 'whatsapp_template_required')
          results.push({
            recoveryId: recovery._id,
            status: 'cancelled',
            reason: 'whatsapp_template_required',
          })
          continue
        }

        await sendWhatsappTemplateMessage({
          phoneNumberId,
          accessToken,
          to: destination,
          templateName,
          languageCode: rule.whatsappTemplate.languageCode || 'es_AR',
          bodyParameters: [
            values.customerName,
            values.productName,
            values.cartTotal,
            values.checkoutUrl,
          ],
        })
      }

      const sentAt = new Date()
      await finishRecovery({
        ...lockParams,
        status: 'sent',
        set: {
          sentAt,
          lastMessage: replaceTemplateVars(rule.messageTemplate, values),
          'metadata.lastSentBy': 'ai_cart_recovery_worker',
          'metadata.sentAsTemplate': !withinCustomerWindow,
        },
      })

      await Promise.all([
        AiCampaignRule.updateOne(
          { _id: rule._id, tenantId },
          { $inc: { 'stats.sent': 1 } },
        ).setOptions({ tenantId }),
        AiAgent.updateOne(
          { _id: agent._id, tenantId },
          { $inc: { 'stats.cartRecoveriesSent': 1 } },
        ).setOptions({ tenantId }),
        registerCustomerContact({
          tenantId,
          channel: 'whatsapp',
          destination,
        }),
      ])

      results.push({ recoveryId: recovery._id, status: 'sent' })
    } catch (error) {
      await failRecovery(lockParams, error).catch(() => null)
      results.push({
        recoveryId: recovery._id,
        status: 'failed',
        error: clean(error?.message || error),
      })
    }
  }

  return results
}
