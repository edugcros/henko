// 📁 src/models/aiContactPreferenceModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const CONTACT_CHANNELS = ['whatsapp', 'email', 'webchat']

const clean = value => String(value || '').trim()

const normalizeDestination = value => clean(value).toLowerCase()

const aiContactPreferenceSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },
    channel: {
      type: String,
      enum: CONTACT_CHANNELS,
      required: true,
      index: true,
      set: value => clean(value).toLowerCase(),
    },
    destination: {
      type: String,
      required: true,
      trim: true,
      index: true,
      set: normalizeDestination,
    },
    marketingConsent: {
      type: Boolean,
      default: false,
      index: true,
    },
    consentSource: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    consentAt: {
      type: Date,
      default: null,
    },
    optedOut: {
      type: Boolean,
      default: false,
      index: true,
    },
    optedOutAt: {
      type: Date,
      default: null,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    lastContactAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastCustomerMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    contactCount24h: {
      type: Number,
      default: 0,
      min: 0,
    },
    contactCountResetAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
)

aiContactPreferenceSchema.index(
  { tenantId: 1, channel: 1, destination: 1 },
  { unique: true },
)
aiContactPreferenceSchema.index({ tenantId: 1, channel: 1, optedOut: 1 })
aiContactPreferenceSchema.index({ tenantId: 1, channel: 1, marketingConsent: 1 })

const AiContactPreference =
  mongoose.models.AiContactPreference ||
  mongoose.model('AiContactPreference', aiContactPreferenceSchema)

export { CONTACT_CHANNELS }
export default AiContactPreference
