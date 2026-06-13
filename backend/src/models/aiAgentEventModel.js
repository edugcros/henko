// 📁 src/models/aiAgentEventModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const aiAgentEventSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiConversation',
      default: null,
      index: true,
    },

    channel: {
      type: String,
      enum: ['webchat', 'whatsapp', 'admin_test', 'unknown'],
      default: 'webchat',
      index: true,
    },

    externalUserId: {
      type: String,
      trim: true,
      index: true,
      default: '',
    },

    type: {
      type: String,
      enum: [
        'message_sent',
        'assistant_replied',
        'action_clicked',
        'view_product',
        'add_to_cart',
        'coupon_copied',
        'request_human',
        'positive_feedback',
        'negative_feedback',
        'checkout_started',
        'purchase_completed',
      ],
      required: true,
      index: true,
    },

    actionType: {
      type: String,
      trim: true,
      default: '',
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
    },

    couponCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    value: {
      type: Number,
      default: 0,
    },

    metadata: {
      label: String,
      url: String,
      intent: String,
      leadScore: Number,
      userAgent: String,
      path: String,
      rawAction: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
)

aiAgentEventSchema.index({
  tenantId: 1,
  type: 1,
  createdAt: -1,
})

export default mongoose.model('AiAgentEvent', aiAgentEventSchema)