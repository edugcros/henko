// 📁 src/models/aIPreference.js
import mongoose from 'mongoose'

const AI_PREFERENCE_TYPES = [
  'category',
  'subcategory',
  'brand',
  'material',
  'attribute',
  'tag',
  'general',
]

const AI_PREFERENCE_SOURCES = [
  'manual',
  'auto-learning',
]

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
aIPreferenceSchema.index({ tenantId: 1, updatedAt: -1 })
aIPreferenceSchema.index({ tenantId: 1, source: 1, lastUsedAt: -1 })

aIPreferenceSchema.pre('validate', function normalize(next) {
  if (typeof this.rawInput === 'string') {
    this.rawInput = this.rawInput.trim().toLowerCase()
  }

  if (typeof this.correctedValue === 'string') {
    this.correctedValue = this.correctedValue.trim()
  }

  if (typeof this.type === 'string') {
    this.type = this.type.trim().toLowerCase()
  }

  if (typeof this.source === 'string') {
    this.source = this.source.trim().toLowerCase()
  }

  next()
})

aIPreferenceSchema.pre('save', function touchLastUsed(next) {
  this.lastUsedAt = new Date()
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
}) {
  if (!tenantId) {
    throw new Error('tenantId requerido para registrar preferencia IA')
  }

  const normalizedRawInput = String(rawInput || '').trim().toLowerCase()
  const normalizedCorrectedValue = String(correctedValue || '').trim()
  const normalizedType = String(type || 'general').trim().toLowerCase()
  const normalizedSource = String(source || 'manual').trim().toLowerCase()

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
        confidence,
        source: normalizedSource,
        metadata,
        lastUsedAt: new Date(),
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
  )
}

const AIPreference =
  mongoose.models.AIPreference ||
  mongoose.model('AIPreference', aIPreferenceSchema)

export default AIPreference