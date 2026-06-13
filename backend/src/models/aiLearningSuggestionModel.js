// 📁 src/models/aiLearningSuggestionModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const aiLearningSuggestionSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        'faq_suggestion',
        'product_gap',
        'policy_gap',
        'handoff_pattern',
        'conversion_pattern',
        'negative_signal',
        'general',
      ],
      default: 'general',
      index: true,
    },

    status: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected', 'archived'],
      default: 'pending_review',
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },

    question: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },

    suggestedAnswer: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: '',
    },

    normalizedQuestion: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
      default: '',
    },

    fingerprint: {
      type: String,
      required: true,
      index: true,
    },

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
      index: true,
    },

    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },

    signals: {
      occurrences: {
        type: Number,
        default: 1,
      },
      handoffs: {
        type: Number,
        default: 0,
      },
      productClicks: {
        type: Number,
        default: 0,
      },
      cartAdds: {
        type: Number,
        default: 0,
      },
      negativeFeedback: {
        type: Number,
        default: 0,
      },
      positiveFeedback: {
        type: Number,
        default: 0,
      },
    },

    sourceConversationIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'AiConversation',
      },
    ],

    sourceEventIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'AiAgentEvent',
      },
    ],

    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },

    approvedKnowledgeId: {
      type: Schema.Types.ObjectId,
      ref: 'AiKnowledge',
      default: null,
    },

    metadata: {
      intent: String,
      leadScore: Number,
      channel: String,
      sampleUserText: String,
      sampleAssistantText: String,
      productIds: [String],
      actionTypes: [String],
    },
  },
  {
    timestamps: true,
  },
)

aiLearningSuggestionSchema.index(
  { tenantId: 1, fingerprint: 1 },
  { unique: true },
)

aiLearningSuggestionSchema.index({
  tenantId: 1,
  status: 1,
  type: 1,
  priority: 1,
  updatedAt: -1,
})

export default mongoose.model(
  'AiLearningSuggestion',
  aiLearningSuggestionSchema,
)