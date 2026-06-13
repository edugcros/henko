// src/models/productAnalysisJobModel.js
import mongoose from 'mongoose'

const productAnalysisJobSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    source: {
      type: String,
      enum: ['manual-upload', 'local-folder-agent', 'api-import'],
      default: 'manual-upload',
      index: true,
    },

    originalFilename: {
      type: String,
      trim: true,
    },

    imageUrl: {
      type: String,
      required: true,
    },

    imagePublicId: {
      type: String,
      trim: true,
      default: '',
    },

    imageHash: {
      type: String,
      index: true,
    },

    metadata: {
      mimeType: String,
      size: Number,
      uploadedFromIp: String,
      userAgent: String,
      sourcePath: String,
      sku: String,
      autoAnalyze: Boolean,
      autoSaveProduct: Boolean,
      addProductAt: Date,
    },

    status: {
      type: String,
      enum: ['pending', 'scheduled', 'imported', 'processing', 'completed', 'failed', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    isHidden: {
      type: Boolean,
      default: false,
      index: true,
    },

    hiddenAt: {
      type: Date,
      default: null,
    },

    hiddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    hideReason: {
      type: String,
      trim: true,
      default: '',
    },

    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },

    autoCreateProduct: {
      type: Boolean,
      default: false,
      index: true,
    },

    autoPublishProduct: {
      type: Boolean,
      default: false,
    },

    analysis: {
      titulo: String,
      categoria: String,
      subcategoria: String,
      marca: String,
      descripcion: String,
      title: String,
      category: String,
      subcategory: String,
      brand: String,
      material: String,
      color: String,
      attributes: mongoose.Schema.Types.Mixed,
      tags: [String],
      description: String,
      seoTitle: String,
      seoDescription: String,
      suggestedPrice: Number,
      suggestedPriceRange: {
        min: Number,
        max: Number,
        currency: {
          type: String,
          default: 'ARS',
        },
      },
      confidence: Number,
      warnings: [String],
    },

    error: {
      message: String,
      stack: String,
      code: String,
      retryable: {
        type: Boolean,
        default: false,
      },
    },

    startedAt: Date,
    processedAt: Date,
    failedAt: Date,
    approvedAt: Date,
    rejectedAt: Date,
    deletedAt: Date,
    importedAt: Date,

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    importedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },

    createdProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

productAnalysisJobSchema.index(
  { tenantId: 1, imageHash: 1 },
  { unique: true, partialFilterExpression: { imageHash: { $exists: true } } },
)
productAnalysisJobSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
productAnalysisJobSchema.index({ tenantId: 1, source: 1, createdAt: -1 })

export default mongoose.model('ProductAnalysisJob', productAnalysisJobSchema)
