// 📁 src/models/aiConversationModel.js
import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

const messageSchema = new Schema(
  {
    role: {
      type: String,
      enum: ['user', 'assistant', 'system', 'human', 'tool'],
      required: true,
    },
    channel: {
      type: String,
      enum: ['whatsapp', 'webchat', 'admin'],
      default: 'whatsapp',
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 12000,
    },
    externalMessageId: { type: String, default: '', trim: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { _id: true },
)

const aiConversationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true, immutable: true },
    channel: { type: String, enum: ['whatsapp', 'webchat'], default: 'whatsapp', index: true },
    externalUserId: { type: String, required: true, trim: true, index: true },

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
      },
      email: {
        type: String,
        default: '',
        trim: true,
        lowercase: true,
      },
    },

    customerName: {
      type: String,
      default: '',
      trim: true,
    },

    customerPhone: {
      type: String,
      default: '',
      trim: true,
    },

    customerEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },

    status: {
      type: String,
      enum: ['open', 'waiting_customer', 'waiting_human', 'human_active', 'closed', 'converted', 'lost'],
      default: 'open',
      index: true,
    },

    intent: { type: String, default: 'general_question', trim: true, index: true },
    leadScore: { type: Number, default: 0, min: 0, max: 100, index: true },
    handoffRequired: { type: Boolean, default: false, index: true },
    handoffReason: { type: String, default: '', trim: true, maxlength: 500 },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    messages: { type: [messageSchema], default: [] },
    summary: { type: String, default: '', maxlength: 5000 },
    lastCustomerMessageAt: { type: Date, default: null, index: true },
    lastBusinessMessageAt: { type: Date, default: null, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },

    source: { type: String, enum: ['organic', 'cart_recovery', 'campaign', 'post_purchase'], default: 'organic' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date, default: undefined, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true },
)

aiConversationSchema.index({ tenantId: 1, customerName: 1 })
aiConversationSchema.index({ tenantId: 1, customerEmail: 1 })
aiConversationSchema.index({ tenantId: 1, customerPhone: 1 })
aiConversationSchema.index({ tenantId: 1, channel: 1, externalUserId: 1, status: 1 })
aiConversationSchema.index({ tenantId: 1, status: 1, leadScore: -1, lastMessageAt: -1 })
aiConversationSchema.index({ tenantId: 1, handoffRequired: 1, lastMessageAt: -1 })
aiConversationSchema.index({ tenantId: 1, deletedAt: 1, lastMessageAt: -1 })

aiConversationSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const AiConversation = mongoose.models.AiConversation || mongoose.model('AiConversation', aiConversationSchema)
export default AiConversation
