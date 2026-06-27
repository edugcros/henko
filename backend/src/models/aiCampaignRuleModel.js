// 📁 src/models/aiCampaignRuleModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const BUSINESS_HOUR_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

const aiCampaignRuleSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    type: {
      type: String,
      enum: ['abandoned_cart', 'lead_follow_up', 'post_purchase', 'winback'],
      required: true,
      index: true,
    },
    enabled: { type: Boolean, default: true, index: true },
    channel: { type: String, enum: ['whatsapp', 'email'], default: 'whatsapp' },
    trigger: {
      delayMinutes: { type: Number, default: 30, min: 1, max: 43200 },
      minCartAmountCents: { type: Number, default: 0, min: 0 },
      maxAttempts: { type: Number, default: 2, min: 1, max: 5 },
      onlyBusinessHours: { type: Boolean, default: true },
      businessHours: {
        start: {
          type: String,
          default: '09:00',
          validate: {
            validator: value => BUSINESS_HOUR_REGEX.test(String(value || '')),
            message: 'Hora de inicio inválida. Use HH:mm',
          },
        },
        end: {
          type: String,
          default: '20:00',
          validate: {
            validator: value => BUSINESS_HOUR_REGEX.test(String(value || '')),
            message: 'Hora de fin inválida. Use HH:mm',
          },
        },
      },
      minHoursBetweenContacts: { type: Number, default: 6, min: 1, max: 168 },
    },
    messageTemplate: { type: String, required: true, trim: true, maxlength: 2000 },
    whatsappTemplate: {
      enabled: { type: Boolean, default: false },
      name: { type: String, default: '', trim: true, maxlength: 120 },
      languageCode: { type: String, default: 'es_AR', trim: true, maxlength: 20 },
    },
    useAiPersonalization: { type: Boolean, default: true },
    offer: {
      enabled: { type: Boolean, default: false },
      couponCode: { type: String, default: '', trim: true, uppercase: true, maxlength: 80 },
    },
    stats: {
      sent: { type: Number, default: 0, min: 0 },
      responses: { type: Number, default: 0, min: 0 },
      conversions: { type: Number, default: 0, min: 0 },
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
)

aiCampaignRuleSchema.index({ tenantId: 1, type: 1, enabled: 1 })
aiCampaignRuleSchema.index({ tenantId: 1, channel: 1, enabled: 1 })

const AiCampaignRule =
  mongoose.models.AiCampaignRule ||
  mongoose.model('AiCampaignRule', aiCampaignRuleSchema)

export default AiCampaignRule
