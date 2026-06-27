// 📁 src/models/catalogCategoryModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / CATEGORY-DRIVEN COMMERCE / VARIANTES / ATRIBUTOS DINÁMICOS

import mongoose from 'mongoose'

import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

const ATTRIBUTE_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'boolean',
  'color',
]

const normalizeText = value => (typeof value === 'string' ? value.trim() : value)

const catalogAttributeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ATTRIBUTE_TYPES,
      default: 'text',
    },
    values: {
      type: [String],
      default: [],
    },
    unit: {
      type: String,
      trim: true,
      default: '',
    },
    group: {
      type: String,
      trim: true,
      default: 'General',
    },
    required: {
      type: Boolean,
      default: false,
    },
    visible: {
      type: Boolean,
      default: true,
    },
    filterable: {
      type: Boolean,
      default: false,
    },
    searchable: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { _id: false },
)

const subcategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    variantAttributes: {
      type: [catalogAttributeSchema],
      default: [],
    },
    productAttributes: {
      type: [catalogAttributeSchema],
      default: [],
    },
    productFields: {
      type: [catalogAttributeSchema],
      default: [],
    },
    specifications: {
      type: [catalogAttributeSchema],
      default: [],
    },
    requiredAttributes: {
      type: [catalogAttributeSchema],
      default: [],
    },
    seoTemplate: {
      metaTitlePattern: { type: String, trim: true, default: '' },
      metaDescriptionPattern: { type: String, trim: true, default: '' },
      keywordHints: { type: [String], default: [] },
    },
    logisticsTemplate: {
      shippingType: {
        type: String,
        enum: ['standard', 'fragile', 'refrigerated', 'digital', 'pickup_only', 'custom', ''],
        default: '',
      },
      warranty: { type: String, trim: true, default: '' },
      originCountry: { type: String, trim: true, default: '' },
    },
  },
  { _id: true, timestamps: true },
)

const catalogCategorySchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    subcategories: {
      type: [subcategorySchema],
      default: [],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

const normalizeValues = values => {
  const unique = new Map()

  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = String(rawValue || '').trim()
    if (!value) continue
    unique.set(value.toLocaleLowerCase('es'), value)
  }

  return [...unique.values()]
}

catalogAttributeSchema.pre('validate', function normalizeAttribute(next) {
  this.name = String(this.name || '').trim().toLowerCase()
  this.label = normalizeText(this.label) || this.name
  this.type = ATTRIBUTE_TYPES.includes(this.type) ? this.type : 'text'
  this.values = normalizeValues(this.values)
  this.unit = normalizeText(this.unit) || ''
  this.group = normalizeText(this.group) || 'General'
  next()
})

subcategorySchema.pre('validate', function normalizeSubcategory(next) {
  this.name = normalizeText(this.name)
  this.normalizedName = String(this.normalizedName || '').trim().toLowerCase()
  this.slug = String(this.slug || this.normalizedName).trim().toLowerCase()
  next()
})

catalogCategorySchema.pre('validate', function normalizeCategory(next) {
  this.name = normalizeText(this.name)
  this.normalizedName = String(this.normalizedName || '').trim().toLowerCase()
  this.slug = String(this.slug || this.normalizedName).trim().toLowerCase()
  next()
})

catalogCategorySchema.index({ tenantId: 1, normalizedName: 1 }, { unique: true })
catalogCategorySchema.index({ tenantId: 1, isActive: 1, sortOrder: 1, name: 1 })
catalogCategorySchema.index({ tenantId: 1, 'subcategories.normalizedName': 1 })

catalogCategorySchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const CatalogCategory =
  mongoose.models.CatalogCategory || mongoose.model('CatalogCategory', catalogCategorySchema)

export default CatalogCategory
