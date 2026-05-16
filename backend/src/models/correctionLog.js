import mongoose from 'mongoose'

const learnedRuleSchema = new mongoose.Schema(
  {
    field: {
      type: String,
      trim: true,
      default: null,
    },
    rule: {
      type: String,
      required: true,
      trim: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
  },
  { _id: false },
)

const diffSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    originalValue: { type: mongoose.Schema.Types.Mixed, default: null },
    correctedValue: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
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
      default: null,
      index: true,
    },

    sourceModel: {
      type: String,
      trim: true,
      default: null,
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
  },
  {
    timestamps: true,
  },
)

correctionLogSchema.index({ tenantId: 1, createdAt: -1 })
correctionLogSchema.index({ tenantId: 1, promotedToPreference: 1, createdAt: -1 })

const CorrectionLog = mongoose.model('CorrectionLog', correctionLogSchema)

export default CorrectionLog