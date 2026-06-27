// 📁 src/models/aiAgentEventModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const CHANNELS = [
  'storefront',
  'website',
  'webchat',
  'whatsapp',
  'admin',
  'admin_test',
  'system',
  'unknown',
]

const EVENT_TYPES = [
  // Storefront / analytics
  'page_view',
  'product_impression',
  'product_click',
  'product_view',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'wishlist_add',
  'wishlist_remove',
  'checkout_start',
  'checkout_step',
  'payment_attempt',
  'payment_approved',
  'payment_rejected',
  'purchase',
  'login',
  'logout',

  // Legacy / IA agent
  'message_sent',
  'assistant_replied',
  'action_clicked',
  'view_product',
  'coupon_copied',
  'request_human',
  'positive_feedback',
  'negative_feedback',
  'checkout_started',
  'purchase_completed',

  // IA agent avanzado
  'ai_agent_message',
  'ai_agent_action',
  'ai_agent_tool_call',
  'ai_agent_recommendation',
  'ai_agent_lead',
  'ai_agent_cart_recovery',
]

const cleanString = value => {
  if (value === undefined || value === null) return ''

  return String(value).trim()
}

const normalizeEventType = value => {
  const clean = cleanString(value).toLowerCase()

  if (!clean) return ''

  return clean
}

const normalizeChannel = value => {
  const clean = cleanString(value).toLowerCase()

  if (!clean) return 'unknown'

  return CHANNELS.includes(clean) ? clean : 'unknown'
}

const normalizeCouponCode = value => {
  return cleanString(value).toUpperCase()
}

const flexibleEventTypeValidator = value => {
  const clean = normalizeEventType(value)

  if (!clean) return false

  if (EVENT_TYPES.includes(clean)) return true

  // Permite eventos nuevos sin romper producción,
  // pero evita texto libre peligroso o demasiado largo.
  return /^[a-z0-9_:-]{2,100}$/.test(clean)
}

const metricItemSchema = new Schema(
  {
    productId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: '',
    },
    sku: {
      type: String,
      trim: true,
      default: '',
    },
    quantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    price: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
  },
  {
    _id: false,
  },
)

const metadataSchema = new Schema(
  {
    label: {
      type: String,
      trim: true,
      default: '',
    },
    url: {
      type: String,
      trim: true,
      default: '',
    },
    intent: {
      type: String,
      trim: true,
      default: '',
    },
    leadScore: {
      type: Number,
      default: 0,
    },
    userAgent: {
      type: String,
      trim: true,
      default: '',
    },
    path: {
      type: String,
      trim: true,
      default: '',
    },
    referrer: {
      type: String,
      trim: true,
      default: '',
    },
    rawAction: {
      type: Schema.Types.Mixed,
      default: null,
    },

    // Compatibilidad con userMetricsService / checkout
    source: {
      type: String,
      trim: true,
      default: '',
    },
    sessionId: {
      type: String,
      trim: true,
      default: '',
    },
    tenantDomain: {
      type: String,
      trim: true,
      default: '',
    },
    orderId: {
      type: String,
      trim: true,
      default: '',
    },
    paymentId: {
      type: String,
      trim: true,
      default: '',
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    quantity: {
      type: Number,
      default: 0,
    },
    items: {
      type: [metricItemSchema],
      default: [],
    },
    commerce: {
      type: Schema.Types.Mixed,
      default: {},
    },
    attribution: {
      type: Schema.Types.Mixed,
      default: {},
    },
    device: {
      type: Schema.Types.Mixed,
      default: {},
    },
    occurredAt: {
      type: Date,
      default: null,
    },
    ip: {
      type: String,
      trim: true,
      default: '',
    },

    // Permite metadata anidada del frontend/controlador sin perderla.
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    _id: false,
    strict: false,
  },
)

const aiAgentEventSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    eventId: {
      type: String,
      trim: true,
      default: '',
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
      trim: true,
      lowercase: true,
      default: 'unknown',
      set: normalizeChannel,
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
      trim: true,
      lowercase: true,
      required: true,
      set: normalizeEventType,
      validate: {
        validator: flexibleEventTypeValidator,
        message: 'Tipo de evento inválido',
      },
      index: true,
    },

    actionType: {
      type: String,
      trim: true,
      lowercase: true,
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
      set: normalizeCouponCode,
      index: true,
    },

    value: {
      type: Number,
      default: 0,
    },

    // Campos top-level para consultas rápidas de analytics/checkout.
    source: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    sessionId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    tenantDomain: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    orderId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    paymentId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },

    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    quantity: {
      type: Number,
      default: 0,
    },

    items: {
      type: [metricItemSchema],
      default: [],
    },

    metadata: {
      type: metadataSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
    },
    toObject: {
      virtuals: true,
      versionKey: false,
    },
  },
)

aiAgentEventSchema.pre('validate', function normalizeBeforeValidate(next) {
  this.channel = normalizeChannel(this.channel)
  this.type = normalizeEventType(this.type)
  this.couponCode = normalizeCouponCode(this.couponCode)

  if (this.metadata) {
    if (!this.source && this.metadata.source) {
      this.source = cleanString(this.metadata.source)
    }

    if (!this.sessionId && this.metadata.sessionId) {
      this.sessionId = cleanString(this.metadata.sessionId)
    }

    if (!this.tenantDomain && this.metadata.tenantDomain) {
      this.tenantDomain = cleanString(this.metadata.tenantDomain)
    }

    if (!this.orderId && this.metadata.orderId) {
      this.orderId = cleanString(this.metadata.orderId)
    }

    if (!this.paymentId && this.metadata.paymentId) {
      this.paymentId = cleanString(this.metadata.paymentId)
    }

    if (!this.currency && this.metadata.currency) {
      this.currency = cleanString(this.metadata.currency).toUpperCase()
    }

    if (!this.quantity && this.metadata.quantity !== undefined) {
      const quantity = Number(this.metadata.quantity)
      this.quantity = Number.isFinite(quantity) ? quantity : 0
    }

    if ((!this.items || this.items.length === 0) && Array.isArray(this.metadata.items)) {
      this.items = this.metadata.items
    }
  }

  next()
})

aiAgentEventSchema.index({ tenantId: 1, type: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, channel: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, externalUserId: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, conversationId: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, productId: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, sessionId: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, orderId: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, paymentId: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, couponCode: 1, createdAt: -1 })
aiAgentEventSchema.index({ tenantId: 1, tenantDomain: 1, createdAt: -1 })

aiAgentEventSchema.index(
  { tenantId: 1, eventId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      eventId: {
        $type: 'string',
        $gt: '',
      },
    },
  },
)

const AiAgentEvent =
  mongoose.models.AiAgentEvent ||
  mongoose.model('AiAgentEvent', aiAgentEventSchema)

export default AiAgentEvent