import mongoose from 'mongoose'

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
    },

    correctedValue: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      enum: [
        'category',
        'subcategory',
        'brand',
        'material',
        'attribute',
        'tag',
        'general',
      ],
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
      enum: ['manual', 'auto-learning'],
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
  },
)

aIPreferenceSchema.index(
  { tenantId: 1, rawInput: 1, type: 1 },
  { unique: true },
)

aIPreferenceSchema.index({ tenantId: 1, type: 1, usageCount: -1 })
aIPreferenceSchema.index({ tenantId: 1, updatedAt: -1 })

aIPreferenceSchema.pre('save', function (next) {
  if (typeof this.rawInput === 'string') {
    this.rawInput = this.rawInput.trim().toLowerCase()
  }

  if (typeof this.correctedValue === 'string') {
    this.correctedValue = this.correctedValue.trim()
  }

  this.lastUsedAt = new Date()
  next()
})

const AIPreference = mongoose.model('AIPreference', aIPreferenceSchema)

export default AIPreference