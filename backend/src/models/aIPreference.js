// 📁 src/models/aIPreference.js
import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

export const AI_PREFERENCE_TYPES = Object.freeze([
  'category',
  'subcategory',
  'brand',
  'material',
  'attribute',
  'tag',
  'general',
])

export const AI_PREFERENCE_SOURCES = Object.freeze([
  'manual',
  'auto-learning',
])

const clean = value => String(value || '').trim()
const normalizeLower = value => clean(value).toLowerCase()
const clampConfidence = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.7
  return Math.max(0, Math.min(1, number))
}

const normalizePreferenceType = value => {
  const type = normalizeLower(value || 'general')
  return AI_PREFERENCE_TYPES.includes(type) ? type : 'general'
}

const normalizePreferenceSource = value => {
  const source = normalizeLower(value || 'manual')
  return AI_PREFERENCE_SOURCES.includes(source) ? source : 'manual'
}

const sanitizeMetadata = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const safe = {
    source: clean(value.source).slice(0, 120),
    field: clean(value.field).slice(0, 120),
    correctionLogId: clean(value.correctionLogId).slice(0, 80),
    promotedAt: value.promotedAt || undefined,
    occurrences: Number.isFinite(Number(value.occurrences))
      ? Math.max(0, Number(value.occurrences))
      : undefined,
    contradictions: Number.isFinite(Number(value.contradictions))
      ? Math.max(0, Number(value.contradictions))
      : undefined,
  }

  return Object.fromEntries(
    Object.entries(safe).filter(([, item]) => item !== undefined && item !== ''),
  )
}

const aIPreferenceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    rawInput: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180,
    },

    correctedValue: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },

    type: {
      type: String,
      enum: AI_PREFERENCE_TYPES,
      default: 'general',
      index: true,
      set: normalizePreferenceType,
    },

    usageCount: {
      type: Number,
      default: 1,
      min: 1,
    },

    confidence: {
      type: Number,
      default: 0.7,
      min: 0,
      max: 1,
      set: clampConfidence,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    source: {
      type: String,
      enum: AI_PREFERENCE_SOURCES,
      default: 'manual',
      index: true,
      set: normalizePreferenceSource,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
)

aIPreferenceSchema.index(
  { tenantId: 1, rawInput: 1, type: 1 },
  { unique: true },
)

aIPreferenceSchema.index({ tenantId: 1, type: 1, usageCount: -1 })
aIPreferenceSchema.index({ tenantId: 1, type: 1, confidence: -1, usageCount: -1 })
aIPreferenceSchema.index({ tenantId: 1, updatedAt: -1 })
aIPreferenceSchema.index({ tenantId: 1, source: 1, lastUsedAt: -1 })

aIPreferenceSchema.pre('validate', function normalize(next) {
  if (typeof this.rawInput === 'string') {
    this.rawInput = normalizeLower(this.rawInput).slice(0, 180)
  }

  if (typeof this.correctedValue === 'string') {
    this.correctedValue = clean(this.correctedValue).slice(0, 180)
  }

  this.type = normalizePreferenceType(this.type)
  this.source = normalizePreferenceSource(this.source)
  this.confidence = clampConfidence(this.confidence)

  next()
})

aIPreferenceSchema.pre('save', function touchLastUsed(next) {
  if (this.isNew || this.isModified('correctedValue') || this.isModified('usageCount')) {
    this.lastUsedAt = new Date()
  }
  next()
})

aIPreferenceSchema.statics.registerPreference = async function registerPreference({
  tenantId,
  rawInput,
  correctedValue,
  type = 'general',
  confidence = 0.7,
  source = 'manual',
  metadata = {},
} = {}) {
  if (!tenantId) {
    throw new Error('tenantId requerido para registrar preferencia IA')
  }

  const normalizedRawInput = normalizeLower(rawInput).slice(0, 180)
  const normalizedCorrectedValue = clean(correctedValue).slice(0, 180)
  const normalizedType = normalizePreferenceType(type)
  const normalizedSource = normalizePreferenceSource(source)
  const normalizedConfidence = clampConfidence(confidence)

  if (!normalizedRawInput) {
    throw new Error('rawInput requerido para registrar preferencia IA')
  }

  if (!normalizedCorrectedValue) {
    throw new Error('correctedValue requerido para registrar preferencia IA')
  }

  return this.findOneAndUpdate(
    {
      tenantId,
      rawInput: normalizedRawInput,
      type: normalizedType,
    },
    {
      $set: {
        correctedValue: normalizedCorrectedValue,
        source: normalizedSource,
        metadata: sanitizeMetadata(metadata),
        lastUsedAt: new Date(),
      },
      $max: {
        confidence: normalizedConfidence,
      },
      $inc: {
        usageCount: 1,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).setOptions({ tenantId })
}

aIPreferenceSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const AIPreference =
  mongoose.models.AIPreference || mongoose.model('AIPreference', aIPreferenceSchema)

export default AIPreference
