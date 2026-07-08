// 📁 src/models/correctionLog.js
import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

export const AI_LEARNING_RULE_TYPES = Object.freeze([
  'category',
  'subcategory',
  'brand',
  'material',
  'attribute',
  'tag',
  'general',
])

const clean = value => String(value || '').trim()
const normalizeLower = value => clean(value).toLowerCase()
const clampConfidence = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.5
  return Math.max(0, Math.min(1, number))
}

const normalizeRuleType = value => {
  const type = normalizeLower(value || 'general')
  return AI_LEARNING_RULE_TYPES.includes(type) ? type : 'general'
}

const learnedRuleSchema = new mongoose.Schema(
  {
    field: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
      maxlength: 160,
    },

    type: {
      type: String,
      enum: AI_LEARNING_RULE_TYPES,
      default: 'general',
      index: true,
      set: normalizeRuleType,
    },

    rawInput: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      maxlength: 180,
    },

    correctedValue: {
      type: String,
      trim: true,
      default: null,
      maxlength: 180,
    },

    rule: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1200,
    },

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
      set: clampConfidence,
    },
  },
  {
    _id: false,
  },
)

const diffSchema = new mongoose.Schema(
  {
    field: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },

    originalValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    correctedValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    _id: false,
  },
)

const correctionLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    imageHash: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
      maxlength: 128,
    },

    // Alias legacy opcional, por compatibilidad con datos/código viejo.
    aiImageHash: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
      maxlength: 128,
    },

    sourceModel: {
      type: String,
      trim: true,
      default: null,
      index: true,
      maxlength: 180,
    },

    originalIAOutput: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    humanCorrection: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    diffSummary: {
      type: [diffSchema],
      default: [],
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    learnedRules: {
      type: [learnedRuleSchema],
      default: [],
    },

    promotedToPreference: {
      type: Boolean,
      default: false,
      index: true,
    },

    promotedAt: {
      type: Date,
      default: null,
    },

    promotedPreferenceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'AIPreference',
      default: [],
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
)

correctionLogSchema.pre('validate', function normalize(next) {
  if (this.imageHash) this.imageHash = normalizeLower(this.imageHash)
  if (this.aiImageHash) this.aiImageHash = normalizeLower(this.aiImageHash)

  if (!this.imageHash && this.aiImageHash) this.imageHash = this.aiImageHash
  if (!this.aiImageHash && this.imageHash) this.aiImageHash = this.imageHash

  if (Array.isArray(this.learnedRules)) {
    this.learnedRules = this.learnedRules.map(rule => ({
      ...rule,
      field: rule?.field ? normalizeLower(rule.field).slice(0, 160) : null,
      type: normalizeRuleType(rule?.type),
      rawInput: rule?.rawInput ? normalizeLower(rule.rawInput).slice(0, 180) : null,
      correctedValue: rule?.correctedValue
        ? clean(rule.correctedValue).slice(0, 180)
        : null,
      confidence: clampConfidence(rule?.confidence),
    }))
  }

  next()
})

correctionLogSchema.index({ tenantId: 1, createdAt: -1 })
correctionLogSchema.index({ tenantId: 1, imageHash: 1, createdAt: -1 })
correctionLogSchema.index({ tenantId: 1, promotedToPreference: 1, createdAt: -1 })
correctionLogSchema.index({ tenantId: 1, 'learnedRules.type': 1, createdAt: -1 })
correctionLogSchema.index({ tenantId: 1, 'learnedRules.field': 1, createdAt: -1 })

correctionLogSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const CorrectionLog =
  mongoose.models.CorrectionLog || mongoose.model('CorrectionLog', correctionLogSchema)

export default CorrectionLog
