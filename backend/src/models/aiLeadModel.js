// 📁 src/models/aiLeadModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const leadNoteSchema = new Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 3000,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdByName: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    _id: true,
  },
)

const productOfInterestSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    title: {
      type: String,
      default: '',
      trim: true,
    },
    slug: {
      type: String,
      default: '',
      trim: true,
    },
    sku: {
      type: String,
      default: '',
      trim: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: 'ARS',
      trim: true,
    },
    lastMentionedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
)

const aiLeadSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiConversation',
      default: null,
      index: true,
    },

    lastConversationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiConversation',
      default: null,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    channel: {
      type: String,
      enum: ['whatsapp', 'webchat', 'email', 'admin'],
      default: 'webchat',
      index: true,
    },

    source: {
      type: String,
      default: 'webchat',
      trim: true,
      index: true,
    },

    customer: {
      name: {
        type: String,
        default: '',
        trim: true,
      },
      phone: {
        type: String,
        default: '',
        trim: true,
        index: true,
      },
      email: {
        type: String,
        default: '',
        trim: true,
        lowercase: true,
        index: true,
      },
    },

    status: {
      type: String,
      enum: [
        'new',
        'qualified',
        'hot',
        'follow_up',
        'won',
        'lost',
        'discarded',
      ],
      default: 'new',
      index: true,
    },

    intent: {
      type: String,
      enum: [
        'unknown',
        'support',
        'browse',
        'compare',
        'price_check',
        'stock_question',
        'shipping_question',
        'policy_question',
        'promotion',
        'purchase_intent',
        'checkout_intent',
        'cart_recovery',
        'post_sale',
        'post_purchase',
      ],
      default: 'unknown',
      index: true,
    },

    intentScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true,
    },

    leadScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true,
    },

    // Alias compatible con código anterior.
    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true,
    },

    preferences: {
      colors: [{ type: String, trim: true }],
      sizes: [{ type: String, trim: true }],
      categories: [{ type: String, trim: true }],
      intents: [{ type: String, trim: true }],
      budgetMax: {
        type: Number,
        default: null,
      },
    },

    productsOfInterest: [productOfInterestSchema],

    // Alias compatible con código anterior.
    products: [
      {
        productId: {
          type: Schema.Types.ObjectId,
          ref: 'Product',
          default: null,
        },
        title: {
          type: String,
          default: '',
          trim: true,
        },
      },
    ],

    deletedAt: {
      type: Date,
      default: undefined,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deletedReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },

    lastMessage: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },

    lastInteractionAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    nextFollowUpAt: {
      type: Date,
      default: null,
      index: true,
    },

    wonAt: {
      type: Date,
      default: null,
    },

    lostAt: {
      type: Date,
      default: null,
    },

    discardedAt: {
      type: Date,
      default: null,
    },

    lostReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },

    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    notes: [leadNoteSchema],

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
)

aiLeadSchema.index({ tenantId: 1, deletedAt: 1, status: 1 })
aiLeadSchema.index({ tenantId: 1, status: 1, leadScore: -1 })
aiLeadSchema.index({ tenantId: 1, status: 1, score: -1 })
aiLeadSchema.index({ tenantId: 1, intent: 1, intentScore: -1 })
aiLeadSchema.index({ tenantId: 1, nextFollowUpAt: 1, status: 1 })
aiLeadSchema.index({ tenantId: 1, 'customer.phone': 1, status: 1 })
aiLeadSchema.index({ tenantId: 1, 'customer.email': 1, status: 1 })
aiLeadSchema.index({ tenantId: 1, channel: 1, lastInteractionAt: -1 })
aiLeadSchema.index({ tenantId: 1, assignedTo: 1, status: 1 })
aiLeadSchema.index(
  { tenantId: 1, conversationId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      conversationId: { $type: 'objectId' },
      deletedAt: { $exists: false },
    },
  },
)

const AiLead = mongoose.models.AiLead || mongoose.model('AiLead', aiLeadSchema)

export default AiLead
