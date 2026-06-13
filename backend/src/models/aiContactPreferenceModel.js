// 📁 src/models/aiContactPreferenceModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const aiContactPreferenceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true, immutable: true },
    channel: { type: String, enum: ['whatsapp', 'email'], required: true, index: true },
    destination: { type: String, required: true, trim: true, index: true },
    marketingConsent: { type: Boolean, default: false, index: true },
    consentSource: { type: String, default: '', trim: true },
    consentAt: { type: Date, default: null },
    optedOut: { type: Boolean, default: false, index: true },
    optedOutAt: { type: Date, default: null },
    reason: { type: String, default: '', maxlength: 500 },
    lastContactAt: { type: Date, default: null },
    contactCount24h: { type: Number, default: 0 },
    lastCustomerMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
)

aiContactPreferenceSchema.index({ tenantId: 1, channel: 1, destination: 1 }, { unique: true })
const AiContactPreference = mongoose.models.AiContactPreference || mongoose.model('AiContactPreference', aiContactPreferenceSchema)
export default AiContactPreference
