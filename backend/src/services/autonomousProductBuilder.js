// 📁 src/services/autonomousProductBuilder.js
//
// Convierte la salida completa (no recortada) de aiVisionService en un
// documento de Product listo para Product.create(), sin intervención
// humana. Es la contraparte de servidor de la lógica que hoy vive en
// admin/src/pages/AddProduct.js (normalizeAiAnalysisForForm /
// buildProductPayloadFromAnalysis), portada para que el agente pueda
// producir el mismo resultado a las 4am sin que nadie tenga la pestaña
// de AddProduct abierta.

const normalizeString = value => String(value ?? '').trim()

const safeArray = value => (Array.isArray(value) ? value : [])

const toTitleCase = value => {
  const clean = normalizeString(value).replace(/\s+/g, ' ')
  if (!clean) return ''

  return clean
    .toLocaleLowerCase('es-AR')
    .replace(/(^|[\s\-/([{"'¿¡])([a-záéíóúüñ])/giu, (_, prefix, char) => {
      return `${prefix}${char.toLocaleUpperCase('es-AR')}`
    })
}

const slugifyKeyPart = (value = '') =>
  normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')

const buildVariantKey = (attributes = {}) =>
  Object.entries(attributes)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${slugifyKeyPart(key)}:${slugifyKeyPart(value)}`)
    .join('|')

const buildVariantName = (attributes = {}) =>
  Object.entries(attributes)
    .filter(([, value]) => normalizeString(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ')

const normalizeNumberValue = value => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const normalizeSku = value => {
  const clean = normalizeString(value).toUpperCase()

  if (!clean) return ''
  if (/^\d+$/.test(clean)) return ''
  if (/^SKU-?\d+$/i.test(clean)) return ''
  if (/^VAR-?\d+$/i.test(clean)) return ''

  return clean
}

const buildGeneratedVariantSku = (productTitle, attributes, index) => {
  const titlePart = slugifyKeyPart(productTitle || 'producto')
    .replace(/-/g, '')
    .slice(0, 12)
    .toUpperCase()
  const attributePart = Object.values(attributes || {})
    .map(value => slugifyKeyPart(value).replace(/-/g, '').slice(0, 8).toUpperCase())
    .filter(Boolean)
    .join('-')

  return [titlePart || 'PRODUCTO', attributePart, String(index + 1).padStart(2, '0')]
    .filter(Boolean)
    .join('-')
    .slice(0, 64)
}

const getFirstFilled = (...values) => {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value
    if (value && typeof value === 'object' && Object.keys(value).length) return value
    const cleanValue = normalizeString(value)
    if (cleanValue) return value
  }
  return null
}

const normalizeAiFieldLabel = value => {
  const cleanValue = normalizeString(value).replace(/[_-]+/g, ' ')
  return toTitleCase(cleanValue)
}

const DYNAMIC_FIELD_TYPE_VALUES = new Set([
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'color',
  'boolean',
])

const normalizeDynamicFieldType = value => {
  const clean = normalizeString(value).toLowerCase()

  if (['textarea', 'longtext', 'long_text', 'multiline'].includes(clean)) return 'textarea'
  if (['number', 'numeric', 'integer', 'float'].includes(clean)) return 'number'
  if (['select', 'dropdown', 'enum', 'list'].includes(clean)) return 'select'
  if (['multiselect', 'multi_select', 'tags', 'array'].includes(clean)) return 'multiselect'
  if (['color', 'colour'].includes(clean)) return 'color'
  if (['boolean', 'bool', 'switch', 'checkbox'].includes(clean)) return 'boolean'
  if (['text', 'string', 'input'].includes(clean)) return 'text'

  return DYNAMIC_FIELD_TYPE_VALUES.has(clean) ? clean : 'text'
}

const AI_FIELD_BLOCKLIST = new Set([
  'titulo', 'title', 'descripcion', 'description',
  'descripcion_tecnica', 'technical_description', 'technicaldescription',
  'categoria', 'category', 'subcategoria', 'subcategory',
  'marca', 'brand', 'precio', 'price', 'precio_sugerido', 'suggestedprice',
  'color', 'material', 'tags', 'confidence', 'hash', 'source', 'reasoningflags',
])

const normalizeAiSpecificationRows = analysis => {
  const candidates = [
    analysis?.specifications,
    analysis?.specs,
    analysis?.fichaTecnica,
    analysis?.ficha_tecnica,
    analysis?.technicalSpecifications,
    analysis?.technical_specifications,
  ]

  const rows = []

  candidates.forEach(candidate => {
    if (!candidate) return

    const entries = Array.isArray(candidate)
      ? candidate
      : typeof candidate === 'object'
        ? Object.entries(candidate).map(([key, value]) => ({ key, value }))
        : []

    entries.forEach((item, index) => {
      if (!item) return

      if (typeof item === 'string') {
        const key = slugifyKeyPart(item).replace(/-/g, '_')
        if (!key) return
        rows.push({
          key,
          label: normalizeAiFieldLabel(item),
          value: item,
          type: 'text',
          source: 'ia',
          sortOrder: index,
        })
        return
      }

      const rawKey = item.key || item.name || item.field || item.label || item.title
      const key = slugifyKeyPart(rawKey).replace(/-/g, '_')
      const value = item.value ?? item.valor ?? item.answer ?? item.text ?? item.content

      if (!key || value === undefined || value === null || value === '') return

      rows.push({
        key,
        label: normalizeString(item.label || item.title || rawKey) || normalizeAiFieldLabel(key),
        value,
        type: normalizeDynamicFieldType(
          item.type ||
            item.inputType ||
            (Array.isArray(value) ? 'multiselect' : typeof value === 'number' ? 'number' : 'text'),
        ),
        unit: normalizeString(item.unit || item.suffix || ''),
        group: normalizeString(item.group || item.section || 'ficha técnica'),
        visible: item.visible !== false,
        filterable: item.filterable === true,
        searchable: item.searchable !== false,
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
      })
    })
  })

  return rows
}

const flattenAiAttributes = analysis => {
  const sources = [
    analysis?.atributos_detectados,
    analysis?.atributos,
    analysis?.attributes,
    analysis?.productAttributes,
    analysis?.categoryAttributes,
    analysis?.dynamicFields,
    analysis?.detectedAttributes,
  ]

  return sources.reduce((acc, source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return acc

    Object.entries(source).forEach(([key, value]) => {
      const normalizedKey = slugifyKeyPart(key).replace(/-/g, '_')
      if (!normalizedKey || AI_FIELD_BLOCKLIST.has(normalizedKey)) return
      if (value === undefined || value === null || value === '') return
      acc[normalizedKey] = value
    })

    return acc
  }, {})
}

const buildSpecificationsFromAi = analysis => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const map = new Map()

  specs.forEach(spec => {
    if (!spec.key || AI_FIELD_BLOCKLIST.has(spec.key)) return

    map.set(spec.key, {
      key: spec.key,
      label: spec.label,
      value: spec.value,
      unit: spec.unit,
      type: spec.type,
      group: spec.group,
      visible: spec.visible,
      filterable: spec.filterable,
      searchable: spec.searchable,
      sortOrder: spec.sortOrder,
    })
  })

  Object.entries(attributes).forEach(([key, value], index) => {
    if (map.has(key)) return

    map.set(key, {
      key,
      label: normalizeAiFieldLabel(key),
      value,
      unit: '',
      type: Array.isArray(value) ? 'multiselect' : typeof value === 'number' ? 'number' : 'text',
      group: 'atributos detectados',
      visible: true,
      filterable: Array.isArray(value),
      searchable: true,
      sortOrder: specs.length + index,
    })
  })

  return [...map.values()].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
}

const buildAttributesMapFromAi = analysis => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const values = {}

  specs.forEach(spec => {
    if (!spec.key || AI_FIELD_BLOCKLIST.has(spec.key)) return
    if (spec.value !== undefined && spec.value !== null && spec.value !== '') {
      values[spec.key] = spec.value
    }
  })

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') values[key] = value
  })

  return values
}

const getAiVariantSuggestions = analysis => {
  return safeArray(
    analysis?.variantSuggestions ||
      analysis?.variant_suggestions ||
      analysis?.variantes_sugeridas ||
      analysis?.variantes,
  )
}

const buildVariantsFromAi = (analysis, { fallbackPrice = 0 } = {}) => {
  const suggestions = getAiVariantSuggestions(analysis)

  return suggestions.map((variant, idx) => {
    const combination =
      typeof variant === 'string'
        ? { opcion: variant }
        : Object.fromEntries(
          Object.entries(variant || {}).filter(
            ([key]) => !['precio', 'stock', 'sku', 'price', 'imagen', 'image'].includes(key),
          ),
        )

    return {
      key: buildVariantKey(combination) || `ai-variant-${idx}`,
      nombre: buildVariantName(combination) || `Variante ${idx + 1}`,
      combinacion: combination,
      price: Number(variant?.precio || variant?.price || fallbackPrice || 0),
      stock: Number(variant?.stock || 0),
      sku: variant?.sku || '',
      isActive: true,
    }
  })
}

const collectSelectedAttributesFromVariants = variants => {
  const selected = {}

  variants.forEach(variant => {
    Object.entries(variant.combinacion || {}).forEach(([key, value]) => {
      const name = slugifyKeyPart(key).replace(/-/g, '_')
      const cleanValue = normalizeString(value)
      if (!name || !cleanValue) return
      if (!selected[name]) selected[name] = []
      if (!selected[name].includes(cleanValue)) selected[name].push(cleanValue)
    })
  })

  return selected
}

const buildVariantAttributesFromVariants = variants => {
  const selected = collectSelectedAttributesFromVariants(variants)

  return Object.entries(selected).map(([name, values], index) => ({
    name,
    label: normalizeAiFieldLabel(name),
    type: name.includes('color') ? 'color' : 'select',
    values,
    sortOrder: index,
  }))
}

const buildSeoFromAi = ({ analysis, title, description, slugFallback, tags = [] }) => {
  const seo = analysis?.seo || {}
  const sourceDescription = normalizeString(description)

  const keywordCandidates = [
    analysis?.marca || analysis?.brand,
    analysis?.categoria || analysis?.category,
    analysis?.subcategoria || analysis?.subcategory,
    analysis?.material,
    analysis?.color,
    ...tags,
  ]

  const rawKeywords = Array.isArray(seo.keywords) ? seo.keywords : []

  return {
    slug: slugifyKeyPart(seo.slug || slugFallback || title).replace(/_/g, '-') || undefined,
    shortDescription:
      normalizeString(seo.shortDescription) || sourceDescription.slice(0, 240),
    metaTitle: normalizeString(seo.metaTitle) || normalizeString(title).slice(0, 70),
    metaDescription:
      normalizeString(seo.metaDescription) || sourceDescription.slice(0, 160),
    keywords: [
      ...new Set(
        [...rawKeywords, ...keywordCandidates]
          .flatMap(item => (Array.isArray(item) ? item : String(item || '').split(/[,;|]/g)))
          .map(item => normalizeString(item).toLowerCase())
          .filter(Boolean),
      ),
    ].slice(0, 18),
  }
}

const buildLogisticsFromAi = analysis => {
  const logistics = analysis?.logistics || {}
  const dimensions = logistics.dimensions || logistics.package || {}

  return {
    weightKg: normalizeNumberValue(logistics.weightKg),
    dimensionsCm: {
      length: normalizeNumberValue(dimensions.length),
      width: normalizeNumberValue(dimensions.width),
      height: normalizeNumberValue(dimensions.height),
    },
    shippingType: normalizeString(logistics?.shipping?.type || logistics.shippingType || 'standard'),
    warranty: normalizeString(logistics.warranty),
    originCountry: normalizeString(logistics.countryOfOrigin || logistics.originCountry),
  }
}

const buildDynamicFieldDefsFromAi = analysis => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const map = new Map()

  specs.forEach((spec, index) => {
    if (!spec.key || AI_FIELD_BLOCKLIST.has(spec.key)) return

    map.set(spec.key, {
      name: spec.key,
      label: spec.label,
      type: spec.type,
      values: Array.isArray(spec.value)
        ? spec.value.map(item => normalizeString(item)).filter(Boolean)
        : [],
      unit: spec.unit || '',
      placeholder: 'Dato detectado por IA',
      required: false,
      visible: spec.visible !== false,
      filterable:
        spec.filterable === true ||
        ['select', 'multiselect', 'color', 'boolean'].includes(spec.type),
      searchable: spec.searchable !== false,
      group: spec.group || 'ficha técnica',
      source: 'ia',
      sortOrder: Number.isFinite(Number(spec.sortOrder)) ? Number(spec.sortOrder) : index,
    })
  })

  Object.entries(attributes).forEach(([key, value], index) => {
    if (map.has(key)) return

    map.set(key, {
      name: key,
      label: normalizeAiFieldLabel(key),
      type: Array.isArray(value) ? 'multiselect' : typeof value === 'number' ? 'number' : 'text',
      values: Array.isArray(value)
        ? value.map(item => normalizeString(item)).filter(Boolean)
        : [],
      unit: '',
      placeholder: 'Dato complementario detectado por IA',
      required: false,
      visible: true,
      filterable: Array.isArray(value),
      searchable: true,
      group: 'atributos detectados',
      source: 'ia',
      sortOrder: specs.length + index,
    })
  })

  return [...map.values()].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
}

const buildDynamicValuesForFields = (analysis, fields) => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const values = {}

  specs.forEach(spec => {
    if (!spec.key || AI_FIELD_BLOCKLIST.has(spec.key)) return
    if (spec.value !== undefined && spec.value !== null && spec.value !== '') {
      values[spec.key] = spec.value
    }
  })

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') values[key] = value
  })

  const allowed = new Set(fields.map(field => field.name))
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)))
}

const buildFormFieldsFromAi = (analysis, dynamicValues) => {
  const attrs =
    analysis?.atributos_detectados || analysis?.atributos || analysis?.attributes || {}
  const colorValue = getFirstFilled(attrs?.color, analysis?.color)
  const materialValue = getFirstFilled(attrs?.material, analysis?.material)
  const seo = analysis?.seo || {}
  const logistics = analysis?.logistics || {}

  return {
    titulo: normalizeString(analysis?.titulo || analysis?.title || ''),
    descripcion: normalizeString(analysis?.descripcion || analysis?.description || ''),
    descripcionTecnica: normalizeString(
      analysis?.descripcion_tecnica ||
        analysis?.technicalDescription ||
        analysis?.technical_description ||
        analysis?.descripcionTecnica ||
        '',
    ),
    categoria: toTitleCase(analysis?.categoria || analysis?.category || ''),
    subcategoria: toTitleCase(analysis?.subcategoria || analysis?.subcategory || ''),
    marca: normalizeString(analysis?.marca || analysis?.brand || ''),
    precio: analysis?.precio_sugerido || analysis?.precio || analysis?.price || null,
    cantidad: analysis?.cantidad || analysis?.stock || 1,
    condicion: analysis?.condicion || 'nuevo',
    color: Array.isArray(colorValue) ? colorValue.join(', ') : normalizeString(colorValue),
    material: normalizeString(materialValue),
    shortDescription: normalizeString(seo.shortDescription || analysis?.shortDescription || ''),
    metaTitle: normalizeString(seo.metaTitle || analysis?.metaTitle || ''),
    metaDescription: normalizeString(seo.metaDescription || analysis?.metaDescription || ''),
    seoKeywords: safeArray(seo.keywords || analysis?.keywords || analysis?.tags),
    weightKg: logistics.weightKg || analysis?.weightKg || null,
    shippingType: logistics?.shipping?.type || logistics.shippingType || 'standard',
    warranty: logistics.warranty || analysis?.warranty || '',
    countryOfOrigin:
      logistics.countryOfOrigin || logistics.originCountry || analysis?.countryOfOrigin || '',
    packageLengthCm: logistics?.dimensions?.length || logistics?.package?.length || null,
    packageWidthCm: logistics?.dimensions?.width || logistics?.package?.width || null,
    packageHeightCm: logistics?.dimensions?.height || logistics?.package?.height || null,
    dynamicFields: dynamicValues,
  }
}

const buildAiReviewReasons = analysis => {
  return [...safeArray(analysis?.reviewReasons), ...safeArray(analysis?.reasoningFlags)]
    .map(item => normalizeString(item))
    .filter(Boolean)
}

/**
 * Motor único de normalización: transforma la salida cruda de la IA en la
 * misma estructura "lista para formulario" que antes calculaba
 * admin/src/pages/AddProduct.js por su cuenta (normalizeAiAnalysisForForm).
 *
 * Se calcula acá, una sola vez, para que tanto el camino 100% automático
 * (agente → AddProduct autopilot, sin humano) como el camino manual (un
 * admin completando AddProduct a mano) usen exactamente el mismo motor de
 * extracción — nada de dos implementaciones que se puedan desincronizar.
 */
export const buildNormalizedDraftFromAnalysis = analysis => {
  const dynamicFields = buildDynamicFieldDefsFromAi(analysis)
  const dynamicValues = buildDynamicValuesForFields(analysis, dynamicFields)
  const fields = buildFormFieldsFromAi(analysis, dynamicValues)

  const aiVariants = buildVariantsFromAi(analysis, { fallbackPrice: Number(fields.precio) || 0 })
  const hasExplicitVariants = aiVariants.length > 0
  const selectedAttributes = collectSelectedAttributesFromVariants(aiVariants)
  const variantAttributes = hasExplicitVariants
    ? buildVariantAttributesFromVariants(aiVariants)
    : []
  const variants = aiVariants.map(variant => ({
    key: variant.key,
    nombre: variant.nombre,
    combinacion: variant.combinacion,
    price: variant.price,
    stock: variant.stock,
    sku: variant.sku,
    isActive: variant.isActive,
    imageSourceUid: null,
    uiStatus: 'ai',
  }))

  const tags = [
    ...new Set(safeArray(analysis?.tags).map(tag => normalizeString(tag).toLowerCase()).filter(Boolean)),
  ]

  return {
    fields,
    dynamicFields,
    dynamicValues,
    hasExplicitVariants,
    variantAttributes,
    selectedAttributes,
    variants,
    tags,
    review: {
      confidence: Number(analysis?.confidence || 0),
      materialConfidence: Number(analysis?.material_confidence || 0),
      priceConfidence: Number(analysis?.price_confidence || 0),
      requiresHumanReview: Boolean(
        analysis?.requiresHumanReview || analysis?.needsReview || analysis?.aiNeedsReview,
      ),
      reasons: buildAiReviewReasons(analysis),
    },
  }
}

/**
 * Construye un documento de Product completo (forma nativa del schema, no
 * la forma "payload de formulario" de AddProduct) a partir de la salida
 * CRUDA de aiVisionService — sin recortar por sanitizeAnalysis — para que
 * el agente autónomo pueda crear el producto sin ayuda humana.
 */
export const buildAutonomousProductPayload = ({ analysis, job, tenantId }) => {
  const title =
    toTitleCase(analysis?.titulo || analysis?.title) ||
    normalizeString(job?.originalFilename).replace(/\.[^/.]+$/, '') ||
    'Producto sin título'

  const description =
    normalizeString(analysis?.descripcion || analysis?.description) ||
    'Descripción generada automáticamente por el agente IA, pendiente de revisión.'

  const price = Number(
    analysis?.precio_sugerido ??
      analysis?.suggestedPrice ??
      analysis?.price ??
      analysis?.suggestedPriceRange?.min ??
      0,
  )

  const category = toTitleCase(analysis?.categoria || analysis?.category) || 'Sin Categoría'
  const subcategory = toTitleCase(analysis?.subcategoria || analysis?.subcategory) || 'General'
  const brand = normalizeString(analysis?.marca || analysis?.brand) || 'Sin marca'
  const material = normalizeString(getFirstFilled(analysis?.material) || '')
  const colorValue = getFirstFilled(analysis?.color, analysis?.mainColor)
  const colorArray = Array.isArray(colorValue)
    ? colorValue.map(c => normalizeString(c).toLowerCase()).filter(Boolean)
    : normalizeString(colorValue)
      ? [normalizeString(colorValue).toLowerCase()]
      : []

  const tags = [
    ...new Set(safeArray(analysis?.tags).map(tag => normalizeString(tag).toLowerCase()).filter(Boolean)),
  ]

  const specifications = buildSpecificationsFromAi(analysis)
  const dynamicValues = buildAttributesMapFromAi(analysis)

  const aiVariants = buildVariantsFromAi(analysis, { fallbackPrice: price })
  const hasVariants = aiVariants.length > 0
  const variantAttributes = hasVariants ? buildVariantAttributesFromVariants(aiVariants) : []
  const variants = aiVariants.map((variant, idx) => ({
    key: variant.key,
    attributes: variant.combinacion,
    price: normalizeNumberValue(variant.price || price),
    stock: normalizeNumberValue(variant.stock),
    sku: normalizeSku(variant.sku) || buildGeneratedVariantSku(title, variant.combinacion, idx),
    isActive: variant.isActive !== false,
  }))

  const safeJobSuffix = String(job?._id || Date.now()).slice(-8)
  const slug = `${slugifyKeyPart(title) || 'producto'}-${safeJobSuffix}`

  const seo = buildSeoFromAi({ analysis, title, description, slugFallback: slug, tags })
  const logistics = buildLogisticsFromAi(analysis)

  return {
    tenantId,

    title,
    slug,
    description,
    technicalDescription: normalizeString(
      analysis?.descripcion_tecnica || analysis?.technicalDescription || analysis?.technical_description,
    ),

    categoria: category,
    subcategoria: subcategory,
    marca: brand,

    atributos: {
      ...dynamicValues,
      ...(colorArray.length ? { color: colorArray.length === 1 ? colorArray[0] : colorArray } : {}),
      ...(material ? { material } : {}),
    },
    productAttributes: dynamicValues,
    categoryAttributes: dynamicValues,
    specifications,

    hasVariants,
    variantAttributes,
    variants,

    price,
    stock: hasVariants ? 0 : Number(analysis?.cantidad || analysis?.stock || 1),
    color: colorArray,
    material,

    tags,
    seo,
    logistics,

    images: [
      {
        public_id: job?.imagePublicId || `product-analysis/${tenantId}/${job?.imageHash || job?._id}`,
        url: job?.imageUrl,
        alt: title,
        isMain: true,
        order: 0,
      },
    ],

    iaGenerated: true,
    aiOriginalOutput: analysis,
    aiConfidence: typeof analysis?.confidence === 'number' ? analysis.confidence : null,
    aiSource: analysis?.source || analysis?.model || 'gemini',
    aiImageHash: analysis?.hash || analysis?.imageHash || job?.imageHash || null,
    aiNeedsReview: Boolean(analysis?.needsReview || analysis?.requiresHumanReview),
    aiAgentJobId: job?._id || null,
    aiAgentScheduledAt: job?.scheduledAt || job?.metadata?.AddProductAt || null,
    aiAutomationMode: 'agent-autosave',

    status: 'draft',
    visibility: 'hidden',
    createdBy: job?.createdBy || null,
  }
}
