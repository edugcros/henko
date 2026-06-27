// 📁 src/models/aiCartRecoveryModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const aiCartRecoverySchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    cartId: {
      type: Schema.Types.ObjectId,
      ref: 'Cart',
      default: null,
      index: true,
    },
    dedupeKey: { type: String, default: '', trim: true, index: true },
    channel: {
      type: String,
      enum: ['whatsapp', 'email', 'webchat'],
      default: 'whatsapp',
      index: true,
    },
    customer: {
      name: { type: String, default: '', trim: true },
      phone: { type: String, default: '', trim: true, index: true },
      email: { type: String, default: '', trim: true, lowercase: true },
    },
    cartSnapshot: {
      items: [
        {
          productId: {
            type: Schema.Types.ObjectId,
            ref: 'Product',
            required: true,
          },
          title: { type: String, required: true, trim: true },
          quantity: { type: Number, default: 1, min: 1 },
          priceCents: { type: Number, default: 0, min: 0 },
          image: { type: String, default: '' },
          url: { type: String, default: '' },
          variant: { type: Schema.Types.Mixed, default: null },
        },
      ],
      subtotalCents: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: 'ARS', uppercase: true, trim: true },
      checkoutUrl: { type: String, default: '', trim: true },
    },
    status: {
      type: String,
      enum: [
        'pending',
        'scheduled',
        'processing',
        'sent',
        'responded',
        'converted',
        'cancelled',
        'expired',
        'failed',
      ],
      default: 'pending',
      index: true,
    },
    recoveryStage: { type: Number, default: 0, min: 0, max: 5 },
    scheduledAt: { type: Date, default: null, index: true },
    expiresAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },
    lastMessage: { type: String, default: '', maxlength: 2500 },
    attempts: { type: Number, default: 0, min: 0, max: 10 },
    processingLock: { type: String, default: '', select: false },
    processingStartedAt: { type: Date, default: null },
    processingLeaseExpiresAt: { type: Date, default: null, index: true },
    requiresTemplate: { type: Boolean, default: false },
    templateName: { type: String, default: '', trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
)

aiCartRecoverySchema.index({ tenantId: 1, userId: 1, status: 1 })
aiCartRecoverySchema.index({ tenantId: 1, 'customer.phone': 1, status: 1 })
aiCartRecoverySchema.index({ tenantId: 1, scheduledAt: 1, status: 1 })
aiCartRecoverySchema.index({ tenantId: 1, cartId: 1, status: 1 })
aiCartRecoverySchema.index(
  { tenantId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: 'string', $gt: '' } },
  },
)
aiCartRecoverySchema.index({
  status: 1,
  scheduledAt: 1,
  processingLeaseExpiresAt: 1,
})
aiCartRecoverySchema.index({ tenantId: 1, status: 1, expiresAt: 1 })

const AiCartRecovery =
  mongoose.models.AiCartRecovery ||
  mongoose.model('AiCartRecovery', aiCartRecoverySchema)
export default AiCartRecovery
