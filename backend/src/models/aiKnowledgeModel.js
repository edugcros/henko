// 📁 src/models/aiKnowledgeModel.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const aiKnowledgeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true, immutable: true },
    type: {
      type: String,
      enum: ['faq', 'policy', 'product_hint', 'objection', 'sales_script', 'custom', 'learning_suggestion'],
      default: 'custom',
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, required: true, trim: true, maxlength: 10000 },
    source: { type: String, enum: ['admin', 'conversation', 'import', 'system'], default: 'admin' },
    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected', 'archived'], default: 'approved', index: true },
    confidence: { type: Number, default: 1, min: 0, max: 1 },
    tags: { type: [String], default: [] },
    relatedConversationId: { type: Schema.Types.ObjectId, ref: 'AiConversation', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

aiKnowledgeSchema.index({ tenantId: 1, type: 1, status: 1 })
aiKnowledgeSchema.index({ tenantId: 1, title: 'text', content: 'text', tags: 'text' })

const AiKnowledge = mongoose.models.AiKnowledge || mongoose.model('AiKnowledge', aiKnowledgeSchema)
export default AiKnowledge
