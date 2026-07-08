// 📁 src/models/productAnalysisJobModel.js
import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

export const PRODUCT_ANALYSIS_JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  IMPORTED: 'imported',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
})

export const PRODUCT_ANALYSIS_JOB_SOURCE = Object.freeze({
  MANUAL_UPLOAD: 'manual-upload',
  LOCAL_FOLDER_AGENT: 'local-folder-agent',
  API_IMPORT: 'api-import',
})

const JOB_STATUSES = Object.values(PRODUCT_ANALYSIS_JOB_STATUS)
const JOB_SOURCES = Object.values(PRODUCT_ANALYSIS_JOB_SOURCE)

const cleanString = value => {
  if (typeof value !== 'string') return value
  const clean = value.trim()
  return clean || undefined
}

const cleanLowerString = value => {
  const clean = cleanString(value)
  return typeof clean === 'string' ? clean.toLowerCase() : clean
}

const clampConfidence = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return value
  return Math.max(0, Math.min(1, number))
}

const metadataSchema = new mongoose.Schema(
  {
    mimeType: { type: String, trim: true, maxlength: 120 },
    size: { type: Number, min: 0 },
    uploadedFromIp: { type: String, trim: true, maxlength: 120 },
    userAgent: { type: String, trim: true, maxlength: 600 },
    sourcePath: { type: String, trim: true, maxlength: 1200 },
    sku: { type: String, trim: true, maxlength: 180 },
    autoAnalyze: { type: Boolean, default: true },
    autoSaveProduct: { type: Boolean, default: false },
    autoPublishProduct: { type: Boolean, default: false },
    addProductAt: { type: Date, default: null },
    importBatchId: { type: String, trim: true, maxlength: 180 },
    originalUrl: { type: String, trim: true, maxlength: 2200 },
  },
  { _id: false, minimize: false },
)

const suggestedPriceRangeSchema = new mongoose.Schema(
  {
    min: { type: Number, min: 0, default: null },
    max: { type: Number, min: 0, default: null },
    currency: { type: String, trim: true, uppercase: true, default: 'ARS', maxlength: 12 },
  },
  { _id: false },
)

const analysisSchema = new mongoose.Schema(
  {
    // Campos legacy/es-AR
    titulo: { type: String, trim: true, maxlength: 180 },
    categoria: { type: String, trim: true, maxlength: 140 },
    subcategoria: { type: String, trim: true, maxlength: 140 },
    marca: { type: String, trim: true, maxlength: 140, default: null },
    descripcion: { type: String, trim: true, maxlength: 3000 },
    precio_sugerido: { type: Number, min: 0, default: null },
    moneda: { type: String, trim: true, uppercase: true, default: 'ARS', maxlength: 12 },
    atributos: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Campos normalizados/compatibles con frontend y Product model
    title: { type: String, trim: true, maxlength: 180 },
    category: { type: String, trim: true, maxlength: 140 },
    subcategory: { type: String, trim: true, maxlength: 140 },
    brand: { type: String, trim: true, maxlength: 140, default: null },
    material: { type: String, trim: true, maxlength: 140, default: null },
    color: { type: String, trim: true, maxlength: 140, default: null },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    tags: { type: [String], default: [] },
    description: { type: String, trim: true, maxlength: 3000 },
    seoTitle: { type: String, trim: true, maxlength: 180 },
    seoDescription: { type: String, trim: true, maxlength: 300 },
    suggestedPrice: { type: Number, min: 0, default: null },
    suggestedPriceRange: { type: suggestedPriceRangeSchema, default: () => ({}) },

    price_confidence: { type: Number, min: 0, max: 1, set: clampConfidence, default: 0 },
    price_reasoning: { type: String, trim: true, maxlength: 700, default: null },
    material_confidence: { type: Number, min: 0, max: 1, set: clampConfidence, default: 0 },
    hasVariants: { type: Boolean, default: false },
    confidence: { type: Number, min: 0, max: 1, set: clampConfidence, default: 0 },
    reasoningFlags: { type: [String], default: [] },
    needsReview: { type: Boolean, default: true, index: true },
    requiresHumanReview: { type: Boolean, default: false },
    warnings: { type: [String], default: [] },

    hash: { type: String, trim: true, lowercase: true, default: null },
    source: { type: String, trim: true, maxlength: 120, default: null },
    tenantId: { type: String, trim: true, default: null },
    aiProcessed: { type: Boolean, default: false },
  },
  { _id: false, minimize: false },
)

const errorSchema = new mongoose.Schema(
  {
    message: { type: String, trim: true, maxlength: 1200 },
    stack: { type: String, trim: true },
    code: { type: String, trim: true, maxlength: 120 },
    retryable: { type: Boolean, default: false },
  },
  { _id: false },
)

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
      enum: JOB_SOURCES,
      default: PRODUCT_ANALYSIS_JOB_SOURCE.MANUAL_UPLOAD,
      index: true,
    },

    originalFilename: { type: String, trim: true, maxlength: 260 },
    imageUrl: { type: String, required: true, trim: true, maxlength: 2200 },
    imagePublicId: { type: String, trim: true, default: '', maxlength: 1200 },
    imageHash: { type: String, trim: true, lowercase: true, index: true, set: cleanLowerString },

    metadata: { type: metadataSchema, default: () => ({}) },

    status: {
      type: String,
      enum: JOB_STATUSES,
      default: PRODUCT_ANALYSIS_JOB_STATUS.PENDING,
      index: true,
    },

    isHidden: { type: Boolean, default: false, index: true },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    hideReason: { type: String, trim: true, default: '', maxlength: 600 },

    scheduledAt: { type: Date, default: null, index: true },
    processingLock: { type: String, trim: true, default: null, select: false },
    processingStartedAt: { type: Date, default: null },
    processingLeaseExpiresAt: { type: Date, default: null, index: true },

    autoCreateProduct: { type: Boolean, default: false, index: true },
    autoPublishProduct: { type: Boolean, default: false },

    analysis: { type: analysisSchema, default: null },
    error: { type: errorSchema, default: null },

    startedAt: Date,
    processedAt: Date,
    failedAt: Date,
    approvedAt: Date,
    rejectedAt: Date,
    deletedAt: Date,
    importedAt: Date,

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    rejectionReason: { type: String, trim: true, default: '', maxlength: 1000 },
    createdProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    minimize: false,
  },
)

productAnalysisJobSchema.pre('validate', function normalize(next) {
  this.imageHash = cleanLowerString(this.imageHash)
  this.imagePublicId = cleanString(this.imagePublicId) || ''
  this.originalFilename = cleanString(this.originalFilename)

  if (this.analysis) {
    if (!this.analysis.title && this.analysis.titulo) this.analysis.title = this.analysis.titulo
    if (!this.analysis.titulo && this.analysis.title) this.analysis.titulo = this.analysis.title
    if (!this.analysis.category && this.analysis.categoria) this.analysis.category = this.analysis.categoria
    if (!this.analysis.categoria && this.analysis.category) this.analysis.categoria = this.analysis.category
    if (!this.analysis.subcategory && this.analysis.subcategoria) this.analysis.subcategory = this.analysis.subcategoria
    if (!this.analysis.subcategoria && this.analysis.subcategory) this.analysis.subcategoria = this.analysis.subcategory
    if (!this.analysis.brand && this.analysis.marca) this.analysis.brand = this.analysis.marca
    if (!this.analysis.marca && this.analysis.brand) this.analysis.marca = this.analysis.brand
    if (!this.analysis.description && this.analysis.descripcion) this.analysis.description = this.analysis.descripcion
    if (!this.analysis.descripcion && this.analysis.description) this.analysis.descripcion = this.analysis.description
    if (this.analysis.suggestedPrice == null && this.analysis.precio_sugerido != null) {
      this.analysis.suggestedPrice = this.analysis.precio_sugerido
    }
    if (this.analysis.precio_sugerido == null && this.analysis.suggestedPrice != null) {
      this.analysis.precio_sugerido = this.analysis.suggestedPrice
    }
  }

  next()
})

productAnalysisJobSchema.index(
  { tenantId: 1, imageHash: 1 },
  {
    unique: true,
    partialFilterExpression: { imageHash: { $exists: true } },
  },
)
productAnalysisJobSchema.index({ tenantId: 1, status: 1, createdAt: -1 })
productAnalysisJobSchema.index({ tenantId: 1, source: 1, createdAt: -1 })
productAnalysisJobSchema.index({ tenantId: 1, status: 1, scheduledAt: 1 })
productAnalysisJobSchema.index({ tenantId: 1, isHidden: 1, createdAt: -1 })
productAnalysisJobSchema.index({ tenantId: 1, createdProductId: 1 })
productAnalysisJobSchema.index({ status: 1, processingLeaseExpiresAt: 1 })

productAnalysisJobSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const ProductAnalysisJob =
  mongoose.models.ProductAnalysisJob ||
  mongoose.model('ProductAnalysisJob', productAnalysisJobSchema)

export default ProductAnalysisJob
