// 📁 src/services/aiAgent/aiAgentEventService.js
import mongoose from 'mongoose'
import AiAgentEvent from '../../models/aiAgentEventModel.js'
import AiLearningSuggestion from '../../models/aiLearningSuggestionModel.js'

const clean = value => String(value || '').trim()

const toObjectIdOrNull = value => {
  const cleanValue = clean(value)
  return mongoose.Types.ObjectId.isValid(cleanValue) ? cleanValue : null
}

const eventToSignalUpdate = type => {
  if (type === 'view_product') return { 'signals.productClicks': 1 }
  if (type === 'add_to_cart') return { 'signals.cartAdds': 1 }
  if (type === 'negative_feedback') return { 'signals.negativeFeedback': 1 }
  if (type === 'positive_feedback') return { 'signals.positiveFeedback': 1 }
  return null
}

export const registerAiAgentEvent = async ({
  tenantId,
  conversationId,
  channel = 'webchat',
  externalUserId = '',
  type,
  actionType = '',
  productId = null,
  couponCode = '',
  value = 0,
  metadata = {},
} = {}) => {
  if (!tenantId || !type) {
    const error = new Error('tenantId y type son obligatorios')
    error.statusCode = 400
    throw error
  }

  const event = await AiAgentEvent.create({
    tenantId,
    conversationId: toObjectIdOrNull(conversationId),
    channel,
    externalUserId: clean(externalUserId),
    type,
    actionType: clean(actionType),
    productId: toObjectIdOrNull(productId),
    couponCode: clean(couponCode).toUpperCase(),
    value: Number(value || 0),
    metadata,
  })

  const signalUpdate = eventToSignalUpdate(type)

  if (signalUpdate && conversationId) {
    await AiLearningSuggestion.updateMany(
      {
        tenantId,
        sourceConversationIds: toObjectIdOrNull(conversationId),
        status: 'pending_review',
      },
      {
        $inc: signalUpdate,
      },
    )
  }

  return event.toObject()
}