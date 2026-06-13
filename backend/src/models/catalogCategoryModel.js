import mongoose from 'mongoose'

import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

const ALLOWED_ATTRIBUTE_TYPES = ['select', 'color', 'text']

const normalizeText = value => String(value || '').trim()

const normalizeKey = value => {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const normalizeSlug = value => normalizeKey(value).replace(/_/g, '-')

const normalizeValues = values => {
  const seen = new Set()

  return (Array.isArray(values) ? values : [])
    .map(normalizeText)
    .filter(value => {
      const key = value.toLocaleLowerCase('es')
      if (!value || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const variantAttributeTemplateSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ALLOWED_ATTRIBUTE_TYPES,
      default: 'select',
    },
    values: {
      type: [String],
      default: [],
    },
    required: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    _id: false,
  },
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
    },
    slug: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    variantAttributes: {
      type: [variantAttributeTemplateSchema],
      default: [],
    },
  },
  {
    _id: true,
    timestamps: true,
  },
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
    },
    slug: {
      type: String,
      required: true,
      trim: true,
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
    minimize: false,
  },
)

catalogCategorySchema.index(
  { tenantId: 1, normalizedName: 1 },
  { unique: true, name: 'uniq_catalog_category_per_tenant' },
)

catalogCategorySchema.pre('validate', function normalizeCatalogCategory(next) {
  try {
    this.name = normalizeText(this.name)
    this.normalizedName = normalizeKey(this.name)
    this.slug = normalizeSlug(this.name)

    const subcategoryNames = new Set()

    for (const subcategory of this.subcategories || []) {
      subcategory.name = normalizeText(subcategory.name)
      subcategory.normalizedName = normalizeKey(subcategory.name)
      subcategory.slug = normalizeSlug(subcategory.name)

      if (!subcategory.normalizedName) {
        throw new Error('Cada subcategoría debe tener un nombre válido')
      }

      if (subcategoryNames.has(subcategory.normalizedName)) {
        throw new Error(`La subcategoría "${subcategory.name}" está duplicada`)
      }
      subcategoryNames.add(subcategory.normalizedName)

      const attributeNames = new Set()

      for (const [index, attribute] of (subcategory.variantAttributes || []).entries()) {
        attribute.name = normalizeKey(attribute.name || attribute.label)
        attribute.label = normalizeText(attribute.label || attribute.name)
        attribute.values = normalizeValues(attribute.values)
        attribute.sortOrder = Number.isFinite(Number(attribute.sortOrder))
          ? Number(attribute.sortOrder)
          : index

        if (!ALLOWED_ATTRIBUTE_TYPES.includes(attribute.type)) {
          attribute.type = 'select'
        }

        if (!attribute.name || !attribute.label) {
          throw new Error('Los atributos de variante requieren nombre y etiqueta')
        }

        if (attributeNames.has(attribute.name)) {
          throw new Error(
            `El atributo "${attribute.label}" está duplicado en "${subcategory.name}"`,
          )
        }
        attributeNames.add(attribute.name)
      }
    }

    next()
  } catch (error) {
    next(error)
  }
})

catalogCategorySchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const CatalogCategory =
  mongoose.models.CatalogCategory ||
  mongoose.model('CatalogCategory', catalogCategorySchema)

export default CatalogCategory
