import CatalogCategory from '../models/catalogCategoryModel.js'

const ALLOWED_ATTRIBUTE_TYPES = ['select', 'color', 'text']

const normalizeText = value => String(value || '').trim()

export const normalizeCatalogKey = value => {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
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

export const normalizeVariantTemplate = ({ variantAttributes, variants }) => {
  const valuesByAttribute = collectValuesByAttribute(variants)
  const attributes = Array.isArray(variantAttributes) ? variantAttributes : []
  const result = new Map()

  for (const [index, attribute] of attributes.entries()) {
    const name = normalizeCatalogKey(attribute?.name || attribute?.label)
    if (!name) continue

    result.set(name, {
      name,
      label: normalizeText(attribute?.label || attribute?.name || name),
      type: ALLOWED_ATTRIBUTE_TYPES.includes(attribute?.type)
        ? attribute.type
        : 'select',
      values: mergeValues(attribute?.values, valuesByAttribute.get(name)),
      required: attribute?.required === true,
      sortOrder: Number.isFinite(Number(attribute?.sortOrder))
        ? Number(attribute.sortOrder)
        : index,
    })
  }

  for (const [name, values] of valuesByAttribute.entries()) {
    if (result.has(name)) continue
    result.set(name, {
      name,
      label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
      type: name === 'color' ? 'color' : 'select',
      values: normalizeValues(values),
      required: false,
      sortOrder: result.size,
    })
  }

  return [...result.values()]
}

const mergeAttributeTemplates = (current = [], incoming = [], replace = false) => {
  if (replace) return incoming

  const merged = new Map(
    current.map(attribute => [
      normalizeCatalogKey(attribute.name),
      {
        name: attribute.name,
        label: attribute.label,
        type: attribute.type,
        values: normalizeValues(attribute.values),
        required: attribute.required === true,
        sortOrder: attribute.sortOrder,
      },
    ]),
  )

  for (const attribute of incoming) {
    const previous = merged.get(attribute.name)
    merged.set(attribute.name, {
      ...previous,
      ...attribute,
      values: mergeValues(previous?.values, attribute.values),
      required: replace ? attribute.required === true : previous?.required === true,
    })
  }

  return [...merged.values()].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  )
}

export const upsertSubcategoryVariantTemplate = async ({
  tenantId,
  category,
  subcategory,
  variantAttributes = [],
  variants = [],
  userId = null,
  replace = false,
}) => {
  const categoryName = normalizeText(category)
  const subcategoryName = normalizeText(subcategory)
  const categoryKey = normalizeCatalogKey(categoryName)
  const subcategoryKey = normalizeCatalogKey(subcategoryName)

  if (!tenantId || !categoryKey || !subcategoryKey) return null

  const incomingAttributes = normalizeVariantTemplate({
    variantAttributes,
    variants,
  })

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

  let subcategoryDocument = categoryDocument.subcategories.find(
    item => item.normalizedName === subcategoryKey,
  )

  if (!subcategoryDocument) {
    categoryDocument.subcategories.push({
      name: subcategoryName,
      normalizedName: subcategoryKey,
      slug: subcategoryKey.replace(/_/g, '-'),
      variantAttributes: incomingAttributes,
    })
  } else {
    subcategoryDocument.name = subcategoryName
    subcategoryDocument.isActive = true
    subcategoryDocument.variantAttributes = mergeAttributeTemplates(
      subcategoryDocument.variantAttributes,
      incomingAttributes,
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

    const concurrentSubcategory = concurrentDocument.subcategories.find(
      item => item.normalizedName === subcategoryKey,
    )

    if (concurrentSubcategory) {
      concurrentSubcategory.variantAttributes = mergeAttributeTemplates(
        concurrentSubcategory.variantAttributes,
        incomingAttributes,
        replace,
      )
    } else {
      concurrentDocument.subcategories.push({
        name: subcategoryName,
        normalizedName: subcategoryKey,
        slug: subcategoryKey.replace(/_/g, '-'),
        variantAttributes: incomingAttributes,
      })
    }

    concurrentDocument.updatedBy = userId
    return concurrentDocument.save()
  }
}

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
