// 📁 src/services/catalogCategoryService.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / CATEGORY-DRIVEN PRODUCT BUILDER

import CatalogCategory from '../models/catalogCategoryModel.js'

const ALLOWED_ATTRIBUTE_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'boolean',
  'color',
]

const normalizeText = value => String(value || '').trim()

export const normalizeCatalogKey = value => {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const normalizeBoolean = value => value === true || value === 'true'

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeValues = values => {
  const unique = new Map()

  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = normalizeText(rawValue)
    if (!value) continue
    unique.set(value.toLocaleLowerCase('es'), value)
  }

  return [...unique.values()]
}

const mergeValues = (current = [], incoming = []) => {
  return normalizeValues([...current, ...incoming])
}

const toArray = value => (Array.isArray(value) ? value : [])

const collectValuesByAttribute = variants => {
  const valuesByAttribute = new Map()

  for (const variant of Array.isArray(variants) ? variants : []) {
    const attributes =
      variant?.attributes instanceof Map
        ? Object.fromEntries(variant.attributes)
        : variant?.attributes || variant?.combinacion || {}

    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) continue

    for (const [rawName, rawValue] of Object.entries(attributes)) {
      const name = normalizeCatalogKey(rawName)
      const value = normalizeText(rawValue)
      if (!name || !value) continue
      if (!valuesByAttribute.has(name)) valuesByAttribute.set(name, [])
      valuesByAttribute.get(name).push(value)
    }
  }

  return valuesByAttribute
}

export const normalizeCatalogAttributeTemplate = (attribute, index = 0) => {
  const name = normalizeCatalogKey(attribute?.name || attribute?.key || attribute?.label)
  if (!name) return null

  const type = ALLOWED_ATTRIBUTE_TYPES.includes(attribute?.type)
    ? attribute.type
    : 'text'

  return {
    name,
    label: normalizeText(attribute?.label || attribute?.name || attribute?.key || name),
    type,
    values: normalizeValues(attribute?.values || attribute?.options),
    unit: normalizeText(attribute?.unit),
    group: normalizeText(attribute?.group || attribute?.section || 'General'),
    required: normalizeBoolean(attribute?.required),
    visible: attribute?.visible === false || attribute?.showInStorefront === false ? false : true,
    filterable: normalizeBoolean(attribute?.filterable),
    searchable: normalizeBoolean(attribute?.searchable),
    sortOrder: Number.isFinite(Number(attribute?.sortOrder))
      ? Number(attribute.sortOrder)
      : index,
    description: normalizeText(attribute?.description || attribute?.helpText),
  }
}

export const normalizeVariantTemplate = ({ variantAttributes, variants }) => {
  const valuesByAttribute = collectValuesByAttribute(variants)
  const attributes = Array.isArray(variantAttributes) ? variantAttributes : []
  const result = new Map()

  for (const [index, attribute] of attributes.entries()) {
    const normalized = normalizeCatalogAttributeTemplate(attribute, index)
    if (!normalized) continue

    result.set(normalized.name, {
      ...normalized,
      type: ['select', 'color', 'text'].includes(normalized.type) ? normalized.type : 'select',
      values: mergeValues(normalized.values, valuesByAttribute.get(normalized.name)),
    })
  }

  for (const [name, values] of valuesByAttribute.entries()) {
    if (result.has(name)) continue
    result.set(name, {
      name,
      label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
      type: name === 'color' ? 'color' : 'select',
      values: normalizeValues(values),
      unit: '',
      group: 'Variantes',
      required: false,
      visible: true,
      filterable: true,
      searchable: false,
      sortOrder: result.size,
      description: '',
    })
  }

  return [...result.values()].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  )
}

export const normalizeProductTemplate = attributes => {
  return toArray(attributes)
    .map(normalizeCatalogAttributeTemplate)
    .filter(Boolean)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
}

const mergeAttributeTemplates = (current = [], incoming = [], replace = false) => {
  if (replace) return incoming

  const merged = new Map(
    toArray(current).map(attribute => {
      const normalized = normalizeCatalogAttributeTemplate(attribute)
      return normalized ? [normalized.name, normalized] : null
    }).filter(Boolean),
  )

  for (const rawAttribute of incoming) {
    const attribute = normalizeCatalogAttributeTemplate(rawAttribute)
    if (!attribute) continue

    const previous = merged.get(attribute.name)
    merged.set(attribute.name, {
      ...previous,
      ...attribute,
      values: mergeValues(previous?.values, attribute.values),
      required: previous?.required === true || attribute.required === true,
      visible: previous?.visible === false ? false : attribute.visible !== false,
      filterable: previous?.filterable === true || attribute.filterable === true,
      searchable: previous?.searchable === true || attribute.searchable === true,
    })
  }

  return [...merged.values()].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  )
}

const getSubcategoryByKey = (categoryDocument, subcategoryKey) => {
  return categoryDocument.subcategories.find(
    item => item.normalizedName === subcategoryKey,
  )
}

const buildSubcategoryPayload = ({
  subcategoryName,
  subcategoryKey,
  variantAttributes,
  productAttributes,
  productFields,
  specifications,
  requiredAttributes,
}) => ({
  name: subcategoryName,
  normalizedName: subcategoryKey,
  slug: subcategoryKey.replace(/_/g, '-'),
  isActive: true,
  variantAttributes,
  productAttributes,
  productFields,
  specifications,
  requiredAttributes,
})

export const upsertSubcategoryTemplate = async ({
  tenantId,
  category,
  subcategory,
  variantAttributes = [],
  productAttributes = [],
  productFields = [],
  specifications = [],
  requiredAttributes = [],
  variants = [],
  userId = null,
  replace = false,
}) => {
  const categoryName = normalizeText(category)
  const subcategoryName = normalizeText(subcategory)
  const categoryKey = normalizeCatalogKey(categoryName)
  const subcategoryKey = normalizeCatalogKey(subcategoryName)

  if (!tenantId || !categoryKey || !subcategoryKey) return null

  const incomingVariantAttributes = normalizeVariantTemplate({
    variantAttributes,
    variants,
  })
  const incomingProductAttributes = normalizeProductTemplate(productAttributes)
  const incomingProductFields = normalizeProductTemplate(productFields)
  const incomingSpecifications = normalizeProductTemplate(specifications)
  const incomingRequiredAttributes = normalizeProductTemplate(requiredAttributes)

  let categoryDocument = await CatalogCategory.findOne({
    tenantId,
    normalizedName: categoryKey,
  }).setOptions({ tenantId })

  if (!categoryDocument) {
    categoryDocument = new CatalogCategory({
      tenantId,
      name: categoryName,
      normalizedName: categoryKey,
      slug: categoryKey.replace(/_/g, '-'),
      subcategories: [],
      createdBy: userId,
      updatedBy: userId,
    })
  }

  let subcategoryDocument = getSubcategoryByKey(categoryDocument, subcategoryKey)

  if (!subcategoryDocument) {
    categoryDocument.subcategories.push(buildSubcategoryPayload({
      subcategoryName,
      subcategoryKey,
      variantAttributes: incomingVariantAttributes,
      productAttributes: incomingProductAttributes,
      productFields: incomingProductFields,
      specifications: incomingSpecifications,
      requiredAttributes: incomingRequiredAttributes,
    }))
  } else {
    subcategoryDocument.name = subcategoryName
    subcategoryDocument.isActive = true
    subcategoryDocument.variantAttributes = mergeAttributeTemplates(
      subcategoryDocument.variantAttributes,
      incomingVariantAttributes,
      replace,
    )
    subcategoryDocument.productAttributes = mergeAttributeTemplates(
      subcategoryDocument.productAttributes,
      incomingProductAttributes,
      replace,
    )
    subcategoryDocument.productFields = mergeAttributeTemplates(
      subcategoryDocument.productFields,
      incomingProductFields,
      replace,
    )
    subcategoryDocument.specifications = mergeAttributeTemplates(
      subcategoryDocument.specifications,
      incomingSpecifications,
      replace,
    )
    subcategoryDocument.requiredAttributes = mergeAttributeTemplates(
      subcategoryDocument.requiredAttributes,
      incomingRequiredAttributes,
      replace,
    )
  }

  categoryDocument.name = categoryName
  categoryDocument.isActive = true
  categoryDocument.updatedBy = userId

  try {
    return await categoryDocument.save()
  } catch (error) {
    if (error?.code !== 11000 || !categoryDocument.isNew) throw error

    const concurrentDocument = await CatalogCategory.findOne({
      tenantId,
      normalizedName: categoryKey,
    }).setOptions({ tenantId })

    if (!concurrentDocument) throw error

    const concurrentSubcategory = getSubcategoryByKey(concurrentDocument, subcategoryKey)

    if (concurrentSubcategory) {
      concurrentSubcategory.variantAttributes = mergeAttributeTemplates(
        concurrentSubcategory.variantAttributes,
        incomingVariantAttributes,
        replace,
      )
      concurrentSubcategory.productAttributes = mergeAttributeTemplates(
        concurrentSubcategory.productAttributes,
        incomingProductAttributes,
        replace,
      )
      concurrentSubcategory.productFields = mergeAttributeTemplates(
        concurrentSubcategory.productFields,
        incomingProductFields,
        replace,
      )
      concurrentSubcategory.specifications = mergeAttributeTemplates(
        concurrentSubcategory.specifications,
        incomingSpecifications,
        replace,
      )
      concurrentSubcategory.requiredAttributes = mergeAttributeTemplates(
        concurrentSubcategory.requiredAttributes,
        incomingRequiredAttributes,
        replace,
      )
    } else {
      concurrentDocument.subcategories.push(buildSubcategoryPayload({
        subcategoryName,
        subcategoryKey,
        variantAttributes: incomingVariantAttributes,
        productAttributes: incomingProductAttributes,
        productFields: incomingProductFields,
        specifications: incomingSpecifications,
        requiredAttributes: incomingRequiredAttributes,
      }))
    }

    concurrentDocument.updatedBy = userId
    return concurrentDocument.save()
  }
}

// Compatibilidad con controllers existentes.
export const upsertSubcategoryVariantTemplate = upsertSubcategoryTemplate

export const findCatalogCategory = async ({ tenantId, category }) => {
  const normalizedName = normalizeCatalogKey(category)
  if (!tenantId || !normalizedName) return null

  return CatalogCategory.findOne({
    tenantId,
    normalizedName,
    isActive: true,
  })
    .setOptions({ tenantId })
    .lean()
}

export const listCatalogCategories = async tenantId => {
  return CatalogCategory.find({
    tenantId,
    isActive: true,
  })
    .setOptions({ tenantId })
    .sort({ sortOrder: 1, name: 1 })
    .lean()
}
