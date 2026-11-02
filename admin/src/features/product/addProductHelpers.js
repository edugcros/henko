// 📁 src/features/product/addProductHelpers.js
//
// Las funciones puras y las constantes de AddProduct: validaciones, armado del
// payload, normalización del análisis de la IA, variantes, SEO, logística y el
// progreso de la carga. Salieron de AddProduct.js tal cual, para que el
// componente no tuviera 8.800 líneas; AddProduct.js reexporta las que ya
// exportaba.

export const SECTION_IDS = {
  imagenes: 'add-product-section-imagenes',
  informacion: 'add-product-section-informacion',
  ficha: 'add-product-section-ficha',
  variantes: 'add-product-section-variantes',
  precio: 'add-product-section-precio',
  publicar: 'add-product-section-publicar',
}

export const normalizeString = (value = '') => String(value || '').trim()

export const toTitleCase = value => {
  const clean = normalizeString(value).replace(/\s+/g, ' ')

  if (!clean) return ''

  return clean
    .toLocaleLowerCase('es-AR')
    .replace(/(^|[\s\-/([{"'¿¡])([a-záéíóúüñ])/giu, (_, prefix, char) => {
      return `${prefix}${char.toLocaleUpperCase('es-AR')}`
    })
}

export const buildTitleCaseOption = value => {
  const label = toTitleCase(value)
  return label ? { value: label, label } : null
}

export const slugifyKeyPart = (value = '') =>
  normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')

export const buildVariantKey = (attributes = {}) =>
  Object.entries(attributes)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${slugifyKeyPart(key)}:${slugifyKeyPart(value)}`)
    .join('|')

export const buildVariantName = (attributes = {}) =>
  Object.entries(attributes)
    .filter(([, value]) => normalizeString(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ')

export const safeArray = value => (Array.isArray(value) ? value : [])
export const MAX_GENERATED_VARIANTS = 200
export const MAX_PRODUCT_IMAGES = 12
export const MAX_IMAGE_SIZE_MB = 12
export const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

export const MAX_VIDEO_SIZE_MB = 60
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024
export const MAX_VIDEO_DURATION_SECONDS = 60
export const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

export const DYNAMIC_FIELD_TYPES = [
  { value: 'text', label: 'Texto corto' },
  { value: 'textarea', label: 'Texto largo' },
  { value: 'number', label: 'Número' },
  { value: 'select', label: 'Lista' },
  { value: 'multiselect', label: 'Selección múltiple' },
  { value: 'color', label: 'Color' },
  { value: 'boolean', label: 'Sí / No' },
]

export const SHIPPING_TYPE_OPTIONS = [
  { value: 'standard', label: 'Envío estándar' },
  { value: 'fragile', label: 'Frágil / embalaje especial' },
  { value: 'refrigerated', label: 'Refrigerado' },
  { value: 'digital', label: 'Digital / sin envío físico' },
  { value: 'pickup_only', label: 'Solo retiro' },
]

export const QUICK_VARIANT_PRESETS = [
  {
    key: 'color-basic',
    label: 'Color',
    helper: 'Negro / Blanco',
    attributes: [
      {
        name: 'color',
        label: 'Color',
        type: 'color',
        values: ['Negro', 'Blanco'],
        source: 'preset',
      },
    ],
  },
  {
    key: 'size-basic',
    label: 'Tamaño',
    helper: 'Chico / Mediano / Grande',
    attributes: [
      {
        name: 'tamano',
        label: 'Tamaño',
        type: 'select',
        values: ['Chico', 'Mediano', 'Grande'],
        source: 'preset',
      },
    ],
  },
  {
    key: 'presentation-basic',
    label: 'Presentación',
    helper: 'Unidad / Pack',
    attributes: [
      {
        name: 'presentacion',
        label: 'Presentación',
        type: 'select',
        values: ['Unidad', 'Pack'],
        source: 'preset',
      },
    ],
  },
]

export const TECHNICAL_FIELD_PRESETS = [
  {
    key: 'dimensions',
    label: 'Medidas',
    helper: 'Alto / Ancho / Profundidad',
    fields: [
      {
        name: 'alto',
        label: 'Alto',
        type: 'number',
        unit: 'cm',
        group: 'medidas',
        source: 'preset',
      },
      {
        name: 'ancho',
        label: 'Ancho',
        type: 'number',
        unit: 'cm',
        group: 'medidas',
        source: 'preset',
      },
      {
        name: 'profundidad',
        label: 'Profundidad',
        type: 'number',
        unit: 'cm',
        group: 'medidas',
        source: 'preset',
      },
    ],
  },
  {
    key: 'motor',
    label: 'Motorización',
    helper: 'Cilindrada / Potencia / Transmisión',
    fields: [
      {
        name: 'cilindrada',
        label: 'Cilindrada',
        type: 'text',
        unit: 'cc',
        group: 'motorización',
        source: 'preset',
      },
      {
        name: 'potencia',
        label: 'Potencia',
        type: 'text',
        group: 'motorización',
        source: 'preset',
      },
      {
        name: 'transmision',
        label: 'Transmisión',
        type: 'text',
        group: 'motorización',
        source: 'preset',
      },
    ],
  },
  {
    key: 'materials',
    label: 'Materiales',
    helper: 'Material / Terminación / Uso',
    fields: [
      {
        name: 'material_principal',
        label: 'Material principal',
        type: 'text',
        group: 'materiales',
        source: 'preset',
      },
      {
        name: 'terminacion',
        label: 'Terminación',
        type: 'text',
        group: 'materiales',
        source: 'preset',
      },
      {
        name: 'uso_recomendado',
        label: 'Uso recomendado',
        type: 'text',
        group: 'uso',
        source: 'preset',
      },
    ],
  },
  {
    key: 'compatibility',
    label: 'Compatibilidad',
    helper: 'Modelo / Año / Compatibilidad',
    fields: [
      {
        name: 'modelo_compatible',
        label: 'Modelo compatible',
        type: 'text',
        group: 'compatibilidad',
        source: 'preset',
      },
      {
        name: 'anio_compatible',
        label: 'Año compatible',
        type: 'text',
        group: 'compatibilidad',
        source: 'preset',
      },
      {
        name: 'observaciones_tecnicas',
        label: 'Observaciones técnicas',
        type: 'textarea',
        group: 'compatibilidad',
        source: 'preset',
      },
    ],
  },
]

export const SEO_POSITIONING_INTENT_OPTIONS = [
  { value: 'commercial', label: 'Comercial / compra' },
  { value: 'informational', label: 'Informativa' },
  { value: 'comparative', label: 'Comparativa' },
  { value: 'local', label: 'Local / cercanía' },
  { value: 'brand', label: 'Marca' },
]

export const DEFAULT_DYNAMIC_FIELD_TYPES = new Set(DYNAMIC_FIELD_TYPES.map(item => item.value))

export const buildGeneratedVariantSku = (productTitle, attributes, index) => {
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

export const normalizeNumberValue = value => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

// Como normalizeNumberValue, pero preserva "no informado" como null —
// costoUnitario (Bloque 8.5) nunca debe convertirse en 0 por defecto, un 0
// se leería como "no cuesta nada", no como "sin dato".
export const normalizeOptionalNumberValue = value => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export const normalizeSku = value => {
  const clean = normalizeString(value).toUpperCase()

  if (!clean) return ''
  if (/^\d+$/.test(clean)) return ''
  if (/^SKU-?\d+$/i.test(clean)) return ''
  if (/^VAR-?\d+$/i.test(clean)) return ''

  return clean
}

export const buildVariantDisplayName = variant => {
  return (
    normalizeString(variant?.nombre) ||
    buildVariantName(variant?.combinacion || variant?.attributes || {}) ||
    'Variante'
  )
}

export const getVariantStockTotal = variants =>
  safeArray(variants)
    .filter(variant => variant?.isActive !== false)
    .reduce((total, variant) => total + normalizeNumberValue(variant?.stock), 0)

export const getVariantAttributesConfig = (dynamicAttributes, selectedAttributes) => {
  return safeArray(dynamicAttributes)
    .filter(attr => safeArray(selectedAttributes?.[attr.name]).length > 0)
    .map((attr, index) => ({
      name: attr.name,
      label: attr.label || attr.name,
      type: attr.type || 'select',
      values: [
        ...new Set([...safeArray(attr.values), ...safeArray(selectedAttributes?.[attr.name])]),
      ],
      required: attr.required === true,
      sortOrder: index,
    }))
}

export const getUploadFileObject = file => file?.originFileObj || file

export const isAllowedImageFile = file => {
  const fileObject = getUploadFileObject(file)
  const mimeType = fileObject?.type || file?.type || ''
  const filename = fileObject?.name || file?.name || ''
  const extension = filename.split('.').pop()?.toLowerCase()
  const extensionAllowed = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(extension)

  return ALLOWED_IMAGE_TYPES.has(mimeType) || extensionAllowed
}

export const sanitizeUploadFiles = files => {
  const uniqueFiles = dedupeByUid(safeArray(files)).filter(file => {
    const fileObject = getUploadFileObject(file)
    if (!fileObject) return false
    return isAllowedImageFile(file)
  })

  return uniqueFiles.slice(0, MAX_PRODUCT_IMAGES)
}

export const validateSelectedFiles = files => {
  const invalidType = safeArray(files).find(file => !isAllowedImageFile(file))
  if (invalidType) {
    return `El archivo ${invalidType.name || 'seleccionado'} no tiene un formato de imagen permitido.`
  }

  const tooLarge = safeArray(files).find(file => {
    const fileObject = getUploadFileObject(file)
    return Number(fileObject?.size || file?.size || 0) > MAX_IMAGE_SIZE_BYTES
  })

  if (tooLarge) {
    return `El archivo ${tooLarge.name || 'seleccionado'} supera ${MAX_IMAGE_SIZE_MB}MB.`
  }

  if (safeArray(files).length > MAX_PRODUCT_IMAGES) {
    return `Podés cargar hasta ${MAX_PRODUCT_IMAGES} imágenes por producto.`
  }

  return null
}

export const isAllowedVideoFile = file => {
  const fileObject = getUploadFileObject(file)
  const mimeType = fileObject?.type || file?.type || ''
  const filename = fileObject?.name || file?.name || ''
  const extension = filename.split('.').pop()?.toLowerCase()
  const extensionAllowed = ['mp4', 'webm', 'mov'].includes(extension)

  return ALLOWED_VIDEO_TYPES.has(mimeType) || extensionAllowed
}

export const validateSelectedVideoFile = file => {
  if (!file) return null

  if (!isAllowedVideoFile(file)) {
    return 'El formato de video no está permitido (mp4, webm, mov).'
  }

  const fileObject = getUploadFileObject(file)
  const size = Number(fileObject?.size || file?.size || 0)

  if (size > MAX_VIDEO_SIZE_BYTES) {
    return `El video supera ${MAX_VIDEO_SIZE_MB}MB.`
  }

  return null
}

export const getVideoDuration = file =>
  new Promise(resolve => {
    const fileObject = getUploadFileObject(file)
    if (!fileObject) return resolve(0)

    const url = URL.createObjectURL(fileObject)
    const videoEl = document.createElement('video')
    videoEl.preload = 'metadata'
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(videoEl.duration || 0)
    }
    videoEl.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    videoEl.src = url
  })

export const getJobFlag = (job, key) => Boolean(job?.[key] ?? job?.metadata?.[key])

// `publish`: guardar como borrador solo pide variantes bien formadas (sin
// combinaciones ni SKU repetidos). Publicar pide además lo mismo que el
// backend (getPublishBlockers en productCtrl): precio en cada variante activa
// y al menos una con stock. El stock negativo no se valida porque no puede
// llegar: normalizeNumberValue lo lleva a 0 (había un chequeo inalcanzable).
export const validateVariantsForSubmit = (variants, { publish = true } = {}) => {
  if (!safeArray(variants).length) {
    return 'Activaste variantes, pero todavía no generaste ninguna combinación.'
  }

  const activeVariants = safeArray(variants).filter(variant => variant.isActive !== false)
  if (!activeVariants.length) {
    return 'El producto necesita al menos una variante activa.'
  }

  const variantKeys = new Set()
  const variantSkus = new Set()

  for (const variant of activeVariants) {
    const combination = variant?.combinacion || variant?.attributes || {}
    const variantKey = buildVariantKey(combination)
    const name = buildVariantDisplayName(variant)

    if (!variantKey) {
      return `La variante "${name}" no tiene una combinación válida.`
    }

    if (variantKeys.has(variantKey)) {
      return `Hay variantes duplicadas con la misma combinación: ${name}.`
    }

    variantKeys.add(variantKey)

    if (publish && normalizeNumberValue(variant.price) <= 0) {
      return `La variante "${name}" necesita un precio mayor a 0.`
    }

    const sku = normalizeSku(variant.sku)
    if (sku) {
      if (variantSkus.has(sku)) {
        return `Hay variantes con SKU duplicado: ${sku}.`
      }

      variantSkus.add(sku)
    }
  }

  if (publish && !activeVariants.some(variant => normalizeNumberValue(variant.stock) > 0)) {
    return 'Al menos una variante activa necesita stock mayor a 0.'
  }

  return null
}

// Los campos obligatorios los exige el modelo para cualquier producto, también
// un borrador. Precio y stock recién para publicar: un borrador se puede
// guardar sin stock. Misma regla y mismos textos que getPublishBlockers.
export const validateProductBasicsForSubmit = ({
  values = {},
  hasVariants = false,
  publish = true,
}) => {
  const requiredFields = [
    ['titulo', 'El título es obligatorio'],
    ['descripcion', 'La descripción comercial es obligatoria'],
    ['categoria', 'La categoría es obligatoria'],
    ['subcategoria', 'La subcategoría es obligatoria'],
    ['marca', 'La marca es obligatoria'],
    ['condicion', 'La condición es obligatoria'],
  ]

  for (const [fieldName, errorMessage] of requiredFields) {
    if (!normalizeString(values[fieldName])) return errorMessage
  }

  if (!publish) return null

  if (normalizeNumberValue(values.precio) <= 0) {
    return 'El precio debe ser mayor a 0.'
  }

  if (!hasVariants && normalizeNumberValue(values.cantidad) <= 0) {
    return 'La cantidad en stock debe ser mayor a 0.'
  }

  return null
}

export const parseQuickVariantText = value => {
  const clean = normalizeString(value)

  if (!clean) return []

  return clean
    .split(/[|\n]+/g)
    .map(part => normalizeString(part))
    .filter(Boolean)
    .map((part, index) => {
      const separatorIndex = part.search(/[:=]/)

      if (separatorIndex === -1) {
        return null
      }

      const rawLabel = normalizeString(part.slice(0, separatorIndex))
      const rawValues = normalizeString(part.slice(separatorIndex + 1))
      const name = slugifyKeyPart(rawLabel).replace(/-/g, '_')
      const values = [
        ...new Set(
          rawValues
            .split(/[,;]+/g)
            .map(item => normalizeString(item).replace(/\s+/g, ' '))
            .filter(Boolean),
        ),
      ]

      if (!name || !values.length) return null

      return {
        name,
        label: toTitleCase(rawLabel),
        type: name.includes('color') ? 'color' : 'select',
        values,
        required: false,
        sortOrder: index,
        source: 'quick',
      }
    })
    .filter(Boolean)
}

export const inferTechnicalFieldType = value => {
  const clean = normalizeString(value)
  if (!clean) return 'text'
  if (/^(si|sí|no|true|false)$/i.test(clean)) return 'boolean'
  if (/^-?\d+(?:[.,]\d+)?(?:\s*(cm|mm|m|kg|g|cc|l|ml|w|v|hp|cv))?$/i.test(clean)) return 'number'
  if (clean.includes(',') || clean.includes(';')) return 'multiselect'
  return clean.length > 90 ? 'textarea' : 'text'
}

export const parseTechnicalFieldText = value => {
  const clean = normalizeString(value)

  if (!clean) return { fields: [], values: {} }

  const fields = []
  const values = {}

  clean
    .split(/[|\n]+/g)
    .map(part => normalizeString(part))
    .filter(Boolean)
    .forEach((part, index) => {
      const separatorIndex = part.search(/[:=]/)
      if (separatorIndex === -1) return

      const rawLabel = normalizeString(part.slice(0, separatorIndex))
      const rawValue = normalizeString(part.slice(separatorIndex + 1))
      const name = slugifyKeyPart(rawLabel).replace(/-/g, '_')

      if (!name || !rawValue) return

      const type = inferTechnicalFieldType(rawValue)
      const normalizedValue = ['multiselect', 'color'].includes(type)
        ? rawValue
            .split(/[,;]+/g)
            .map(item => normalizeString(item))
            .filter(Boolean)
        : type === 'number'
          ? normalizeNumberValue(rawValue.replace(/[^0-9.,-]/g, '').replace(',', '.'))
          : /^(si|sí|true)$/i.test(rawValue)
            ? true
            : /^(no|false)$/i.test(rawValue)
              ? false
              : rawValue

      fields.push({
        name,
        label: toTitleCase(rawLabel),
        type,
        values: Array.isArray(normalizedValue) ? normalizedValue : [],
        unit: normalizeString(rawValue.match(/\b(cm|mm|m|kg|g|cc|l|ml|w|v|hp|cv)\b/i)?.[1] || ''),
        required: false,
        visible: true,
        filterable: ['select', 'multiselect', 'color', 'boolean'].includes(type),
        searchable: true,
        group: 'ficha técnica',
        source: 'quick',
        sortOrder: index,
      })
      values[name] = normalizedValue
    })

  return { fields, values }
}

export const mergeVariantAttributeDefinitions = (current = [], incoming = []) => {
  const merged = new Map()

  safeArray(current).forEach((attribute, index) => {
    if (!attribute?.name) return
    merged.set(attribute.name, {
      ...attribute,
      sortOrder: Number.isFinite(Number(attribute.sortOrder)) ? Number(attribute.sortOrder) : index,
    })
  })

  safeArray(incoming).forEach((attribute, index) => {
    if (!attribute?.name) return
    const previous = merged.get(attribute.name)
    merged.set(attribute.name, {
      ...previous,
      ...attribute,
      label: attribute.label || previous?.label || normalizeAiFieldLabel(attribute.name),
      values: [...new Set([...safeArray(previous?.values), ...safeArray(attribute.values)])],
      required: previous?.required === true || attribute.required === true,
      sortOrder: Number.isFinite(Number(previous?.sortOrder)) ? Number(previous.sortOrder) : index,
    })
  })

  return [...merged.values()].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
}

export const mergeSelectedVariantValues = (current = {}, incoming = {}) => {
  const next = { ...(current || {}) }

  Object.entries(incoming || {}).forEach(([key, values]) => {
    const cleanValues = safeArray(values)
      .map(value => normalizeString(value))
      .filter(Boolean)

    if (!key || !cleanValues.length) return

    next[key] = [...new Set([...safeArray(next[key]), ...cleanValues])]
  })

  return next
}

export const generateVariantRowsFromSelection = ({
  attributes = [],
  selectedAttributes = {},
  previousVariants = [],
  basePrice = 0,
  productTitle = '',
}) => {
  const activeAttrs = safeArray(attributes).filter(
    attribute => safeArray(selectedAttributes?.[attribute.name]).length > 0,
  )

  if (!activeAttrs.length) {
    return {
      error: 'Agregá valores a por lo menos una opción vendible.',
      variants: [],
    }
  }

  const total = activeAttrs.reduce(
    (acc, attribute) => acc * safeArray(selectedAttributes[attribute.name]).length,
    1,
  )

  if (total > MAX_GENERATED_VARIANTS) {
    return {
      error: `La selección produciría ${total} variantes. El máximo permitido es ${MAX_GENERATED_VARIANTS}.`,
      variants: [],
      total,
    }
  }

  const buildCombinations = (index = 0, current = {}) => {
    if (index === activeAttrs.length) return [current]

    const attr = activeAttrs[index]
    const values = selectedAttributes[attr.name] || []

    return values.flatMap(value =>
      buildCombinations(index + 1, {
        ...current,
        [attr.name]: value,
      }),
    )
  }

  const previousByKey = new Map(safeArray(previousVariants).map(variant => [variant.key, variant]))

  const variants = buildCombinations().map((combination, index) => {
    const key = buildVariantKey(combination) || `variant-${index + 1}-${Date.now()}`
    const previous = previousByKey.get(key)
    const generatedSku = buildGeneratedVariantSku(productTitle, combination, index)

    return {
      key,
      nombre: buildVariantName(combination) || `Variante ${index + 1}`,
      combinacion: combination,
      price: previous?.price ?? Number(basePrice || 0),
      costoUnitario: previous?.costoUnitario ?? null,
      stock: previous?.stock ?? 0,
      sku: previous?.sku || generatedSku,
      isActive: previous?.isActive ?? true,
      imageSourceUid: previous?.imageSourceUid ?? null,
      uiStatus: previous ? 'existing' : 'new',
    }
  })

  return { variants, total }
}

export const normalizeDynamicFieldType = value => {
  const clean = normalizeString(value).toLowerCase()

  if (['textarea', 'longtext', 'long_text', 'multiline'].includes(clean)) return 'textarea'
  if (['number', 'numeric', 'integer', 'float'].includes(clean)) return 'number'
  if (['select', 'dropdown', 'enum', 'list'].includes(clean)) return 'select'
  if (['multiselect', 'multi_select', 'tags', 'array'].includes(clean)) return 'multiselect'
  if (['color', 'colour'].includes(clean)) return 'color'
  if (['boolean', 'bool', 'switch', 'checkbox'].includes(clean)) return 'boolean'
  if (['text', 'string', 'input'].includes(clean)) return 'text'

  return DEFAULT_DYNAMIC_FIELD_TYPES.has(clean) ? clean : 'text'
}

export const parseDynamicFieldOptions = value => {
  if (Array.isArray(value)) {
    return [...new Set(value.map(item => normalizeString(item)).filter(Boolean))]
  }

  if (typeof value === 'string') {
    return [
      ...new Set(
        value
          .split(/[,;|\n]+/g)
          .map(item => normalizeString(item))
          .filter(Boolean),
      ),
    ]
  }

  return []
}

export const normalizeDynamicFieldDefinition = (field, index = 0) => {
  if (!field) return null

  if (typeof field === 'string') {
    const name = slugifyKeyPart(field).replace(/-/g, '_')
    if (!name) return null

    return {
      name,
      label: field,
      type: 'text',
      values: [],
      required: false,
      sortOrder: index,
      source: 'template',
    }
  }

  const rawName =
    field.name || field.key || field.field || field.code || field.id || field.label || field.title
  const name = slugifyKeyPart(rawName).replace(/-/g, '_')

  if (!name) return null

  return {
    name,
    label: normalizeString(field.label || field.title || field.name || name),
    type: normalizeDynamicFieldType(field.type || field.inputType || field.kind),
    values: parseDynamicFieldOptions(
      field.values || field.options || field.enum || field.allowedValues,
    ),
    unit: normalizeString(field.unit || field.suffix || ''),
    placeholder: normalizeString(field.placeholder || field.help || ''),
    required: field.required === true || field.isRequired === true || field.mandatory === true,
    sortOrder: Number.isFinite(Number(field.sortOrder)) ? Number(field.sortOrder) : index,
    source: field.source || 'template',
  }
}

export const extractTemplateDynamicFields = templatePayload => {
  const candidates = [
    templatePayload?.productAttributes,
    templatePayload?.productFields,
    templatePayload?.categoryAttributes,
    templatePayload?.attributes,
    templatePayload?.atributos,
    templatePayload?.specifications,
    templatePayload?.specs,
    templatePayload?.fields,
    templatePayload?.requiredAttributes,
    templatePayload?.selectedSubcategory?.productAttributes,
    templatePayload?.selectedSubcategory?.productFields,
    templatePayload?.selectedSubcategory?.categoryAttributes,
    templatePayload?.selectedSubcategory?.attributes,
    templatePayload?.selectedSubcategory?.atributos,
    templatePayload?.selectedSubcategory?.specifications,
    templatePayload?.selectedSubcategory?.specs,
    templatePayload?.selectedSubcategory?.fields,
    templatePayload?.selectedSubcategory?.requiredAttributes,
  ]

  const map = new Map()

  candidates.forEach(candidate => {
    if (!candidate) return

    const entries = Array.isArray(candidate)
      ? candidate
      : typeof candidate === 'object'
        ? Object.entries(candidate).map(([key, value]) =>
            typeof value === 'object' && value !== null
              ? { name: key, ...value }
              : {
                  name: key,
                  type: typeof value === 'number' ? 'number' : 'text',
                },
          )
        : []

    entries.forEach((item, index) => {
      const normalized = normalizeDynamicFieldDefinition(item, index)
      if (!normalized) return

      const previous = map.get(normalized.name)
      map.set(normalized.name, {
        ...previous,
        ...normalized,
        values: [...new Set([...safeArray(previous?.values), ...safeArray(normalized.values)])],
        required: previous?.required === true || normalized.required === true,
      })
    })
  })

  return Array.from(map.values()).sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  )
}

export const normalizeDynamicFieldValues = (fields = [], rawValues = {}) => {
  const result = {}

  safeArray(fields).forEach(field => {
    const rawValue = rawValues?.[field.name]

    if (field.type === 'boolean') {
      if (rawValue !== undefined) result[field.name] = Boolean(rawValue)
      return
    }

    if (field.type === 'number') {
      if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
        result[field.name] = normalizeNumberValue(rawValue)
      }
      return
    }

    if (field.type === 'multiselect') {
      const values = safeArray(rawValue)
        .map(item => normalizeString(item))
        .filter(Boolean)
      if (values.length) result[field.name] = values
      return
    }

    const cleanValue = normalizeString(rawValue)
    if (cleanValue) result[field.name] = cleanValue
  })

  return result
}

export const buildSeoPayload = values => {
  const title = normalizeString(values.titulo || values.title)
  const description = normalizeString(values.descripcion || values.description)
  const technicalDescription = normalizeString(
    values.descripcionTecnica || values.technicalDescription,
  )
  const sourceDescription = description || technicalDescription
  const keywordCandidates = [
    values.marca,
    values.categoria,
    values.subcategoria,
    values.material,
    values.color,
    ...(Array.isArray(values.tags) ? values.tags : []),
  ]
  const rawKeywords = Array.isArray(values.seoKeywords)
    ? [...values.seoKeywords, ...keywordCandidates]
    : [
        ...normalizeString(values.seoKeywords)
          .split(/[,;|\n]+/g)
          .map(item => normalizeString(item)),
        ...keywordCandidates,
      ]

  const slug =
    slugifyKeyPart(values.slug || title)
      .replace(/_/g, '-')
      .replace(/-+/g, '-') || undefined

  const seoFaq = Array.isArray(values.seoFaq)
    ? values.seoFaq
    : normalizeString(values.seoFaq)
        .split(/[\n|]+/g)
        .map(item => normalizeString(item))
        .filter(Boolean)

  const seoContentPillars = Array.isArray(values.seoContentPillars)
    ? values.seoContentPillars
    : normalizeString(values.seoContentPillars)
        .split(/[,;|\n]+/g)
        .map(item => normalizeString(item))
        .filter(Boolean)

  return {
    slug,
    shortDescription: normalizeString(values.shortDescription) || sourceDescription.slice(0, 240),
    metaTitle: normalizeString(values.metaTitle) || title.slice(0, 70),
    metaDescription: normalizeString(values.metaDescription) || sourceDescription.slice(0, 160),
    keywords: [
      ...new Set(
        rawKeywords
          .flatMap(item => (Array.isArray(item) ? item : String(item || '').split(/[,;|]/g)))
          .map(item => normalizeString(item).toLowerCase())
          .filter(Boolean),
      ),
    ].slice(0, 18),
    focusKeyword: normalizeString(values.seoFocusKeyword),
    searchIntent: normalizeString(values.seoSearchIntent || 'commercial'),
    positioning: normalizeString(values.seoPositioning),
    targetAudience: normalizeString(values.seoTargetAudience),
    contentAngle: normalizeString(values.seoContentAngle),
    faq: seoFaq,
    contentPillars: seoContentPillars,
  }
}

export const buildSeoFormValues = values => {
  const seoPayload = buildSeoPayload(values)

  return {
    slug: seoPayload.slug,
    shortDescription: seoPayload.shortDescription,
    metaTitle: seoPayload.metaTitle,
    metaDescription: seoPayload.metaDescription,
    seoKeywords: seoPayload.keywords,
    seoFocusKeyword: seoPayload.focusKeyword,
    seoSearchIntent: seoPayload.searchIntent,
    seoPositioning: seoPayload.positioning,
    seoTargetAudience: seoPayload.targetAudience,
    seoContentAngle: seoPayload.contentAngle,
    seoFaq: seoPayload.faq,
    seoContentPillars: seoPayload.contentPillars,
  }
}

export const buildLogisticsPayload = values => {
  const dimensions = {
    length: normalizeNumberValue(values.packageLengthCm),
    width: normalizeNumberValue(values.packageWidthCm),
    height: normalizeNumberValue(values.packageHeightCm),
    unit: 'cm',
  }

  return {
    weightKg: normalizeNumberValue(values.weightKg),
    dimensions,
    package: dimensions,
    shipping: {
      type: normalizeString(values.shippingType || 'standard'),
      requiresShipping: values.shippingType !== 'digital',
    },
    warranty: normalizeString(values.warranty),
    countryOfOrigin: normalizeString(values.countryOfOrigin),
  }
}

export const WATCHER_ONLINE_THRESHOLD_MS = 3 * 60 * 1000

export const getStoredBoolean = (key, fallback = false) => {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key)
  if (value === null) return fallback
  return value === 'true'
}

export const dedupeByUid = (files = []) => {
  const map = new Map()
  files.forEach(file => {
    if (file?.uid) map.set(file.uid, file)
  })
  return Array.from(map.values())
}

export const revokeBlobUrls = (urls = []) => {
  urls.forEach(url => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  })
}

export const buildPreviewFromFile = file => {
  if (file?.url) return file.url
  if (file?.originFileObj) return URL.createObjectURL(file.originFileObj)
  return null
}

export const rebuildPreviews = files =>
  files.map(file => buildPreviewFromFile(file)).filter(Boolean)

export const waitForUiReset = () =>
  new Promise(resolve => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
      return
    }

    setTimeout(resolve, 0)
  })

export const getFirstFilled = (...values) => {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value
    if (value && typeof value === 'object' && Object.keys(value).length) return value
    const cleanValue = normalizeString(value)
    if (cleanValue) return value
  }

  return null
}

export const normalizeAiFieldLabel = value => {
  const cleanValue = normalizeString(value).replace(/[_-]+/g, ' ')
  return toTitleCase(cleanValue)
}

export const AI_FIELD_BLOCKLIST = new Set([
  'titulo',
  'title',
  'descripcion',
  'description',
  'descripcion_tecnica',
  'technical_description',
  'technicaldescription',
  'categoria',
  'category',
  'subcategoria',
  'subcategory',
  'marca',
  'brand',
  'precio',
  'price',
  'precio_sugerido',
  'suggestedprice',
  'color',
  'material',
  'tags',
  'confidence',
  'hash',
  'source',
  'reasoningflags',
])

export const normalizeAiSpecificationRows = analysis => {
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
        source: item.source || 'ia',
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined,
      })
    })
  })

  return rows
}

export const flattenAiAttributes = analysis => {
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

export const buildDynamicFieldsFromAi = analysis => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const map = new Map()

  specs.forEach((spec, index) => {
    const key = slugifyKeyPart(spec.key || spec.name || spec.label).replace(/-/g, '_')
    if (!key || AI_FIELD_BLOCKLIST.has(key)) return

    map.set(key, {
      name: key,
      label: normalizeString(spec.label) || normalizeAiFieldLabel(key),
      type: normalizeDynamicFieldType(
        spec.type ||
          (Array.isArray(spec.value)
            ? 'multiselect'
            : typeof spec.value === 'number'
              ? 'number'
              : 'text'),
      ),
      values: parseDynamicFieldOptions(
        spec.values || spec.options || (Array.isArray(spec.value) ? spec.value : []),
      ),
      unit: normalizeString(spec.unit || ''),
      placeholder: normalizeString(spec.placeholder || 'Dato detectado por IA'),
      required: spec.required === true,
      visible: spec.visible !== false,
      filterable:
        spec.filterable === true ||
        ['select', 'multiselect', 'color', 'boolean'].includes(
          normalizeDynamicFieldType(spec.type),
        ),
      searchable: spec.searchable !== false,
      group: normalizeString(spec.group || 'ficha técnica'),
      source: spec.source || 'ia',
      confidence: spec.confidence,
      sortOrder: Number.isFinite(Number(spec.sortOrder)) ? Number(spec.sortOrder) : index,
    })
  })

  Object.entries(attributes).forEach(([key, value], index) => {
    if (map.has(key)) return

    map.set(key, {
      name: key,
      label: normalizeAiFieldLabel(key),
      type: Array.isArray(value) ? 'multiselect' : typeof value === 'number' ? 'number' : 'text',
      values: Array.isArray(value) ? value.map(item => normalizeString(item)).filter(Boolean) : [],
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

export const buildDynamicValuesFromAi = (analysis, fields = []) => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const values = {}

  specs.forEach(spec => {
    const key = slugifyKeyPart(spec.key || spec.name || spec.label).replace(/-/g, '_')
    if (!key || AI_FIELD_BLOCKLIST.has(key)) return
    if (spec.value !== undefined && spec.value !== null && spec.value !== '') {
      values[key] = spec.value
    }
  })

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') values[key] = value
  })

  const allowed = new Set(fields.map(field => field.name))
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)))
}

export const buildSpecificationRows = (fields = [], values = {}) => {
  return safeArray(fields)
    .map((field, index) => {
      const value = values?.[field.name]
      const isEmpty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)

      if (isEmpty) return null

      return {
        key: field.name,
        label: field.label || normalizeAiFieldLabel(field.name),
        value,
        unit: field.unit || '',
        type: field.type || 'text',
        group: field.group || 'ficha técnica',
        visible: field.visible !== false,
        filterable: field.filterable === true,
        searchable: field.searchable !== false,
        source: field.source || 'manual',
        sortOrder: Number.isFinite(Number(field.sortOrder)) ? Number(field.sortOrder) : index,
      }
    })
    .filter(Boolean)
}

export const buildFilterAttributesFromSpecifications = specifications => {
  return safeArray(specifications)
    .filter(item => item.filterable && item.value !== undefined && item.value !== null)
    .flatMap(item => {
      const values = Array.isArray(item.value) ? item.value : [item.value]
      return values
        .map(value => normalizeString(value).toLowerCase())
        .filter(Boolean)
        .map(value => ({
          key: item.key,
          label: item.label,
          value,
        }))
    })
}

export const TECHNICAL_STORAGE_KEYS = new Set([
  'technicalDescription',
  'descripcionTecnica',
  'descripcion_tecnica',
  'technical_description',
  'technicalSpecifications',
  'technical_specifications',
  'fichaTecnica',
  'ficha_tecnica',
  'specifications',
  'specs',
  'productAttributes',
  'categoryAttributes',
  'dynamicFields',
  'filterAttributes',
])

export const shouldIncludeTechnicalSheetFromJob = job => {
  return Boolean(
    job?.useTechnicalSheet ||
    job?.useTechnicalData ||
    job?.includeTechnicalSheet ||
    job?.includeTechnicalData ||
    job?.metadata?.useTechnicalSheet ||
    job?.metadata?.useTechnicalData ||
    job?.metadata?.includeTechnicalSheet ||
    job?.metadata?.includeTechnicalData,
  )
}

export const sanitizeAiOutputForStorage = (value, includeTechnicalSheet) => {
  if (includeTechnicalSheet || !value || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.map(item => sanitizeAiOutputForStorage(item, includeTechnicalSheet))
  }

  return Object.entries(value).reduce((acc, [key, entryValue]) => {
    if (TECHNICAL_STORAGE_KEYS.has(key)) return acc
    acc[key] = sanitizeAiOutputForStorage(entryValue, includeTechnicalSheet)
    return acc
  }, {})
}

export const removeEmptyObjectKey = (target, key) => {
  if (!target || typeof target !== 'object') return
  const value = target[key]
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    delete target[key]
  }
}

export const enforceTechnicalSheetPersistence = (payload, includeTechnicalSheet) => {
  const cleanPayload = { ...(payload || {}) }

  if (cleanPayload.aiOriginalOutput) {
    try {
      const parsedAiOutput =
        typeof cleanPayload.aiOriginalOutput === 'string'
          ? JSON.parse(cleanPayload.aiOriginalOutput)
          : cleanPayload.aiOriginalOutput

      cleanPayload.aiOriginalOutput = JSON.stringify(
        sanitizeAiOutputForStorage(parsedAiOutput, includeTechnicalSheet),
      )
    } catch {
      if (!includeTechnicalSheet) cleanPayload.aiOriginalOutput = null
    }
  }

  if (!includeTechnicalSheet) {
    delete cleanPayload.technicalDescription
    delete cleanPayload.descripcionTecnica
    delete cleanPayload.productAttributes
    delete cleanPayload.categoryAttributes
    delete cleanPayload.specifications
    delete cleanPayload.filterAttributes
    delete cleanPayload.dynamicFields

    cleanPayload.hasTechnicalSheet = false
    cleanPayload.technicalSheetEnabled = false
    cleanPayload.showTechnicalSheet = false

    if (cleanPayload.atributos && typeof cleanPayload.atributos === 'object') {
      const safeAtributos = {}
      ;['color', 'material'].forEach(key => {
        if (
          cleanPayload.atributos[key] !== undefined &&
          cleanPayload.atributos[key] !== null &&
          cleanPayload.atributos[key] !== ''
        ) {
          safeAtributos[key] = cleanPayload.atributos[key]
        }
      })
      cleanPayload.atributos = safeAtributos
      removeEmptyObjectKey(cleanPayload, 'atributos')
    }

    return cleanPayload
  }

  cleanPayload.hasTechnicalSheet = true
  cleanPayload.technicalSheetEnabled = true
  cleanPayload.showTechnicalSheet = true

  if (!normalizeString(cleanPayload.technicalDescription)) delete cleanPayload.technicalDescription
  if (!normalizeString(cleanPayload.descripcionTecnica)) delete cleanPayload.descripcionTecnica
  if (!safeArray(cleanPayload.specifications).length) delete cleanPayload.specifications
  if (!safeArray(cleanPayload.filterAttributes).length) delete cleanPayload.filterAttributes
  removeEmptyObjectKey(cleanPayload, 'productAttributes')
  removeEmptyObjectKey(cleanPayload, 'categoryAttributes')
  removeEmptyObjectKey(cleanPayload, 'dynamicFields')

  return cleanPayload
}

export const getAiReviewReasons = analysis => {
  return [...safeArray(analysis?.reviewReasons), ...safeArray(analysis?.reasoningFlags)]
    .map(item => normalizeString(item))
    .filter(Boolean)
}

export const getAiVariantSuggestions = analysis => {
  return safeArray(
    analysis?.variantSuggestions ||
      analysis?.variant_suggestions ||
      analysis?.variantes_sugeridas ||
      analysis?.variantes,
  )
}

export const NORMALIZED_TEXT_FIELD_KEYS = [
  'titulo',
  'descripcion',
  'descripcionTecnica',
  'categoria',
  'subcategoria',
  'marca',
  'condicion',
  'color',
  'material',
  'shortDescription',
  'metaTitle',
  'metaDescription',
  'warranty',
  'countryOfOrigin',
  'shippingType',
]

// Si un campo de texto llega como objeto (p.ej. {value, confidence} del
// modelo, o un fragmento de JSON mal ubicado) lo desenvolvemos antes de
// escribirlo en un <Input>; sin esto, cualquier forma inesperada del
// payload del backend termina mostrando JSON crudo en el formulario.
export const coerceAiValueToDisplayText = value => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') {
    return normalizeString(value)
  }
  if (Array.isArray(value)) {
    return value
      .map(item => coerceAiValueToDisplayText(item))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof value === 'object') {
    const unwrapped = value.value ?? value.text ?? value.label ?? value.description
    return unwrapped !== undefined ? coerceAiValueToDisplayText(unwrapped) : ''
  }
  return normalizeString(value)
}

export const sanitizeNormalizedAiFields = fields => {
  if (!fields || typeof fields !== 'object') return fields

  const safeFields = { ...fields }

  NORMALIZED_TEXT_FIELD_KEYS.forEach(key => {
    if (key in safeFields) {
      safeFields[key] = coerceAiValueToDisplayText(safeFields[key])
    }
  })

  return safeFields
}

// dynamicValues debería ser {nombreDeCampo: valorPlano}, pero a veces llega
// con la fila de especificación completa como valor — el objeto entero
// {key,label,value,unit,type,...} o esa misma forma serializada como JSON
// string — en vez de solo el dato. Sin desenvolver esto acá, ese JSON crudo
// termina tanto en la vista previa de "Ficha técnica sugerida" como
// guardado en el producto al aplicar el campo. Preserva el tipo nativo del
// valor (number sigue number, array sigue array) en vez de forzarlo a texto.
export const unwrapDynamicFieldValue = rawValue => {
  let value = rawValue

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          value = parsed
        }
      } catch {
        return rawValue
      }
    } else {
      return rawValue
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    return value.value
  }

  return value
}

export const sanitizeDynamicValuesMap = values => {
  if (!values || typeof values !== 'object') return values

  return Object.fromEntries(
    Object.entries(values).map(([key, rawValue]) => [key, unwrapDynamicFieldValue(rawValue)]),
  )
}

export const normalizeAiAnalysisForForm = analysis => {
  // El normalizador es el del backend (buildNormalizedDraftFromAnalysis en
  // autonomousProductBuilder.js): /product/analyze-visual y el import de un
  // análisis de la cola lo mandan en `normalized`, y se usa tal cual. Hasta el
  // PR 11 solo lo mandaba el import, así que una foto analizada en el momento
  // se normalizaba con el cálculo de abajo, una copia que podía divergir.
  //
  // Ese cálculo queda solo de respaldo: una respuesta sin `normalized` (un
  // backend todavía sin desplegar, o un normalizador que falló y devolvió el
  // análisis igual). Se puede quitar cuando ya no haga falta.
  if (
    analysis?.normalized &&
    typeof analysis.normalized === 'object' &&
    analysis.normalized.fields
  ) {
    return {
      ...analysis.normalized,
      fields: sanitizeNormalizedAiFields(analysis.normalized.fields),
      dynamicValues: sanitizeDynamicValuesMap(analysis.normalized.dynamicValues),
    }
  }

  const attrs = analysis?.atributos_detectados || analysis?.atributos || analysis?.attributes || {}
  const dynamicFields = buildDynamicFieldsFromAi(analysis)
  const dynamicValues = sanitizeDynamicValuesMap(buildDynamicValuesFromAi(analysis, dynamicFields))
  const variantSuggestions = getAiVariantSuggestions(analysis)
  const hasExplicitVariants = variantSuggestions.length > 0

  const colorValue = getFirstFilled(attrs?.color, analysis?.color)
  const materialValue = getFirstFilled(attrs?.material, analysis?.material)
  const seo = analysis?.seo || {}
  const logistics = analysis?.logistics || {}

  const fields = {
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
    // Vacío a propósito: la IA no conoce el inventario y la visión nunca lo
    // devuelve, así que esto caía en 1 SIEMPRE. El campo queda para que lo
    // cargue el comercio (es obligatorio para guardar).
    cantidad: null,
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

  const variantAttributes = []
  const selectedAttributes = {}
  const variants = hasExplicitVariants
    ? variantSuggestions.map((variant, idx) => {
        const combination =
          typeof variant === 'string'
            ? { opcion: variant }
            : Object.fromEntries(
                Object.entries(variant || {}).filter(
                  ([key]) => !['precio', 'stock', 'sku', 'price', 'imagen', 'image'].includes(key),
                ),
              )

        Object.entries(combination).forEach(([key, value]) => {
          const name = slugifyKeyPart(key).replace(/-/g, '_')
          const cleanValue = normalizeString(value)
          if (!name || !cleanValue) return
          if (!selectedAttributes[name]) selectedAttributes[name] = []
          selectedAttributes[name] = [...new Set([...selectedAttributes[name], cleanValue])]
        })

        return {
          key: buildVariantKey(combination) || `ai-variant-${idx}-${Date.now()}`,
          nombre: buildVariantName(combination) || `Variante ${idx + 1}`,
          combinacion: combination,
          price: Number(variant?.precio || variant?.price || analysis?.precio_sugerido || 0),
          // La IA nunca sugiere costo (ver aiVisionService.js) — siempre
          // arranca sin informar, el comercio lo carga a mano si quiere.
          costoUnitario: null,
          stock: Number(variant?.stock || 0),
          sku: variant?.sku || '',
          isActive: true,
          imageSourceUid: null,
          uiStatus: 'ai',
        }
      })
    : []

  Object.entries(selectedAttributes).forEach(([name, values], index) => {
    variantAttributes.push({
      name,
      label: normalizeAiFieldLabel(name),
      type: name.includes('color') ? 'color' : 'select',
      values,
      required: false,
      sortOrder: index,
      source: 'ia',
    })
  })

  return {
    fields,
    dynamicFields,
    dynamicValues,
    hasExplicitVariants,
    variantAttributes,
    selectedAttributes,
    variants,
    tags: [
      ...new Set(
        safeArray(analysis?.tags)
          .map(tag => normalizeString(tag).toLowerCase())
          .filter(Boolean),
      ),
    ],
    review: {
      confidence: Number(analysis?.confidence || 0),
      materialConfidence: Number(analysis?.material_confidence || 0),
      priceConfidence: Number(analysis?.price_confidence || 0),
      requiresHumanReview: Boolean(
        analysis?.requiresHumanReview || analysis?.needsReview || analysis?.aiNeedsReview,
      ),
      reasons: getAiReviewReasons(analysis),
    },
  }
}

export const buildProductPayloadFromAnalysis = ({
  analysis,
  job,
  user,
  publish = false,
  automationMode = 'agent-assisted',
  includeTechnicalSheet = false,
}) => {
  const normalizedAnalysisForForm = normalizeAiAnalysisForForm(analysis || {})
  const { fields, dynamicFields, dynamicValues } = normalizedAnalysisForForm
  const specifications = buildSpecificationRows(dynamicFields, dynamicValues)
  const filterAttributes = buildFilterAttributesFromSpecifications(specifications)
  const colorArray = normalizeString(fields.color)
    ? fields.color
        .split(',')
        .map(color => color.trim().toLowerCase())
        .filter(Boolean)
    : []
  const title =
    fields.titulo ||
    normalizeString(job?.originalFilename).replace(/\.[^/.]+$/, '') ||
    'Producto sin título'
  const normalizedAnalysis = {
    ...(analysis || {}),
    appliedAt: new Date().toISOString(),
    appliedBy: user?._id || user?.id || null,
    sourceContext: 'admin-add-product',
    agentJobId: job?._id || null,
    agentScheduledAt: job?.scheduledAt || job?.metadata?.addProductAt || null,
    automationMode,
  }
  const seoPayload = buildSeoPayload({
    titulo: title,
    descripcion: fields.descripcion,
    shortDescription: fields.shortDescription,
    metaTitle: fields.metaTitle,
    metaDescription: fields.metaDescription,
    seoKeywords: fields.seoKeywords,
  })
  const logisticsPayload = buildLogisticsPayload(fields)

  const payload = {
    title,
    description:
      fields.descripcion || 'Descripción generada automáticamente pendiente de revisión.',
    technicalDescription: fields.descripcionTecnica,
    descripcionTecnica: fields.descripcionTecnica,
    categoria: toTitleCase(fields.categoria || 'Sin Categoría'),
    subcategoria: toTitleCase(fields.subcategoria || 'General'),
    marca: normalizeString(fields.marca || 'sin marca'),
    price: Number(fields.precio || 0),
    // Sin una cantidad cargada, cero: nunca una unidad que nadie contó.
    stock: Math.max(0, Math.trunc(Number(fields.cantidad) || 0)),
    condicion: fields.condicion || 'nuevo',
    color: colorArray,
    material: fields.material,
    atributos: {
      ...dynamicValues,
      color: colorArray.length === 1 ? colorArray[0] : colorArray,
      material: fields.material,
    },
    productAttributes: dynamicValues,
    categoryAttributes: dynamicValues,
    specifications,
    filterAttributes,
    dynamicFields: dynamicValues,
    hasVariants: normalizedAnalysisForForm.hasExplicitVariants,
    variantAttributes: normalizedAnalysisForForm.variantAttributes,
    variants: normalizedAnalysisForForm.variants.map((variant, idx) => ({
      key: variant.key,
      nombre: variant.nombre,
      sku: normalizeSku(variant.sku) || buildGeneratedVariantSku(title, variant.combinacion, idx),
      attributes: variant.combinacion,
      combinacion: variant.combinacion,
      price: normalizeNumberValue(variant.price || fields.precio),
      stock: normalizeNumberValue(variant.stock),
      isActive: variant.isActive !== false,
    })),
    tags: normalizedAnalysisForForm.tags,
    slug: seoPayload.slug,
    shortDescription: seoPayload.shortDescription,
    metaTitle: seoPayload.metaTitle,
    metaDescription: seoPayload.metaDescription,
    keywords: seoPayload.keywords,
    seo: seoPayload,
    weightKg: logisticsPayload.weightKg,
    dimensions: logisticsPayload.dimensions,
    package: logisticsPayload.package,
    shipping: logisticsPayload.shipping,
    warranty: logisticsPayload.warranty,
    countryOfOrigin: logisticsPayload.countryOfOrigin,
    logistics: logisticsPayload,
    iaGenerated: true,
    aiOriginalOutput: JSON.stringify(normalizedAnalysis),
    aiConfidence: normalizedAnalysis?.confidence ?? null,
    aiSource: normalizedAnalysis?.source || normalizedAnalysis?.model || null,
    aiImageHash:
      normalizedAnalysis?.hash || normalizedAnalysis?.imageHash || job?.imageHash || null,
    aiNeedsReview:
      normalizedAnalysis?.needsReview === true ||
      normalizedAnalysis?.requiresHumanReview === true ||
      normalizedAnalysisForForm.review.requiresHumanReview,
    aiAgentJobId: job?._id || null,
    aiAgentScheduledAt: job?.scheduledAt || job?.metadata?.addProductAt || null,
    aiAutomationMode: automationMode,
    status: publish ? 'active' : 'draft',
    visibility: publish ? 'visible' : 'hidden',
  }

  return enforceTechnicalSheetPersistence(payload, includeTechnicalSheet)
}

export const newClientRequestId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `alta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

/**
 * Un alta de producto que se puede reintentar sin duplicar nada.
 *
 * El alta son varios pedidos: crear el producto, subir cada imagen, el video,
 * asignar la imagen de cada variante, cerrar el análisis y publicar. Antes, si
 * fallaba uno, volver a guardar creaba OTRO producto (otro slug, otro SKU) y
 * el primero quedaba publicado y sin fotos.
 *
 * Ahora:
 * - el producto se crea como borrador y se publica al final, así lo que falla
 *   a mitad de camino no llega a la tienda;
 * - el intento recuerda el producto creado y los pasos terminados, y un
 *   reintento sigue desde el paso que falló;
 * - `clientRequestId` viaja en el alta: si la respuesta se perdió, el backend
 *   devuelve el producto que ya creó en vez de crear otro.
 */
export const createProductAttempt = (clientRequestId = newClientRequestId()) => ({
  clientRequestId,
  productId: null,
  product: null,
  uploads: new Map(),
  done: new Set(),
})

export const runProductAttempt = async ({
  attempt,
  createDraft,
  steps = [],
  publish = null,
  finalSteps = [],
}) => {
  if (!attempt.productId) {
    const created = await createDraft(attempt.clientRequestId)
    const product = created?.data || created

    if (!product?._id) {
      throw new Error('No se pudo obtener el ID del producto creado')
    }

    attempt.productId = product._id
    attempt.product = product
  }

  for (const step of steps) {
    if (attempt.done.has(step.key)) continue
    await step.run(attempt)
    attempt.done.add(step.key)
  }

  if (publish && !attempt.done.has('publish')) {
    await publish(attempt.productId)
    attempt.done.add('publish')
  }

  for (const step of finalSteps) {
    if (attempt.done.has(step.key)) continue
    await step.run(attempt)
    attempt.done.add(step.key)
  }

  return attempt
}

/**
 * Los trabajos de AutoSave que la cola de revisión tiene que preparar.
 *
 * Entran los 'pending' y también los 'completed': un trabajo subido con
 * análisis automático, o uno programado cuando llega su hora, ya viene
 * analizado y queda 'completed'. Antes solo entraban los 'pending', así que
 * esos no los procesaba nadie: la carga automática del formulario excluye
 * los de AutoSave.
 *
 * Importar un 'completed' no le cambia el estado (sigue disponible para
 * aprobar), así que al refrescar la bandeja vuelve: `queuedIds` son los que ya
 * están en la cola de revisión, para no prepararlos dos veces.
 */
export const selectJobsForReviewQueue = (agentQueue, { failedIds, queuedIds }) =>
  safeArray(agentQueue).filter(
    job =>
      ['pending', 'completed'].includes(job?.status) &&
      job.metadata?.autoSaveProduct === true &&
      !failedIds.has(job._id) &&
      !queuedIds.has(job._id),
  )

/**
 * El análisis de un trabajo de la bandeja: el que trae el import si ya estaba
 * analizado, o uno nuevo. `analyze` solo se llama si hace falta: cada llamada
 * es un análisis de IA que se paga.
 */
export const resolveJobAnalysis = async (importResponse, analyze) =>
  importResponse?.data?.analysis || analyze()

export const describeProductAttemptFailure = (attempt, error, fallback) => {
  const reason = error?.response?.data?.message || error?.message || fallback

  if (!attempt?.productId) return reason

  return `El producto quedó guardado como borrador, pero falló un paso: ${reason}. Volvé a guardar para terminarlo: no se va a duplicar. Si cambiaste datos, editalos después desde Editar producto.`
}

/**
 * Confianza general de la IA en porcentaje, o null si el análisis no la trae.
 *
 * Se calculaba con `||` y un 85 por defecto: si la IA decía 0 (o no decía
 * nada), el panel mostraba «85% confianza» y no pedía revisión. 0 es un valor
 * real; sin dato no se inventa uno.
 */
export const resolveAiConfidencePercent = iaResult => {
  const raw = iaResult?.confidence ?? iaResult?.confianza

  if (raw === null || raw === undefined || raw === '') return null

  const number = Number(raw)
  if (!Number.isFinite(number)) return null

  const ratio = number > 1 && number <= 100 ? number / 100 : number
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100)
}

export const normalizeNamePath = name => (Array.isArray(name) ? name : [name]).filter(Boolean)

export const buildNestedFieldPatch = (name, value) => {
  const path = normalizeNamePath(name)

  if (!path.length) return {}

  return path.reduceRight((acc, key, index) => {
    return index === path.length - 1 ? { [key]: value } : { [key]: acc }
  }, value)
}

export const setFormFieldValue = (form, name, value) => {
  if (!name || !form) return

  if (typeof form.setFieldValue === 'function') {
    form.setFieldValue(name, value)
    return
  }

  form.setFieldsValue(buildNestedFieldPatch(name, value))
}

export const extractInputValue = (eventOrValue, valuePropName = 'value') => {
  if (valuePropName === 'checked') {
    return typeof eventOrValue === 'boolean' ? eventOrValue : Boolean(eventOrValue?.target?.checked)
  }

  if (eventOrValue?.target) return eventOrValue.target.value

  return eventOrValue
}

export const getRequiredMessage = (rules = [], label = 'Este campo') => {
  const requiredRule = safeArray(rules).find(rule => rule?.required)

  return requiredRule?.message || `${label} es obligatorio`
}

export const isEmptyFieldValue = value => {
  if (Array.isArray(value)) return value.length === 0
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return normalizeString(value) === ''
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Progreso de la carga
//
// Qué falta para poder publicar, y en qué paso está la persona. Son funciones puras para poder
// probarlas: viven afuera del componente.
// ─────────────────────────────────────────────────────────────────────────────

export const buildProductReadiness = ({
  imageCount = 0,
  title,
  description,
  category,
  subcategory,
  price,
  stock,
  brand,
  hasVariants = false,
  variants = [],
  useTechnicalSheet = false,
  technicalFieldCount = 0,
}) => {
  const checks = [
    {
      key: 'images',
      label: 'Imagen',
      done: imageCount > 0,
      required: true,
    },
    {
      key: 'title',
      label: 'Título',
      done: Boolean(normalizeString(title)),
      required: true,
    },
    {
      key: 'description',
      label: 'Descripción',
      done: Boolean(normalizeString(description)),
      required: true,
    },
    {
      key: 'categoria',
      label: 'Categoría',
      done: Boolean(normalizeString(category)),
      required: true,
    },
    {
      key: 'subcategoria',
      label: 'Subcategoría',
      done: Boolean(normalizeString(subcategory)),
      required: true,
    },
    {
      key: 'price',
      label: 'Precio',
      done: Number(price || 0) > 0,
      required: true,
    },
    {
      key: 'stock',
      label: hasVariants ? 'Stock por variantes' : 'Stock',
      done: hasVariants
        ? variants.some(variant => variant.isActive !== false && Number(variant.stock || 0) > 0)
        : Number(stock || 0) > 0,
      required: true,
    },
    {
      key: 'marca',
      label: 'Marca',
      done: Boolean(normalizeString(brand)),
      // Obligatoria: el modelo la exige y el guardado ya la pedía. La barra
      // decía que no, y llegaba al 100% con un producto que no se guardaba.
      required: true,
    },
    {
      key: 'ficha',
      label: 'Ficha técnica',
      done: !useTechnicalSheet || technicalFieldCount > 0,
      required: false,
    },
    {
      key: 'variantes',
      label: 'Variantes',
      done: !hasVariants || variants.length > 0,
      required: false,
    },
  ]

  const requiredChecks = checks.filter(check => check.required)
  const doneRequired = requiredChecks.filter(check => check.done).length
  const percent = Math.round((doneRequired / requiredChecks.length) * 100)

  return {
    checks,
    requiredChecks,
    doneRequired,
    percent,
    isReady: doneRequired === requiredChecks.length,
  }
}

// Los pasos de la barra de arriba. Cada uno mira las verificaciones de buildProductReadiness POR SU
// CLAVE. Acá se buscaban 'imagenes', 'titulo', 'descripcion' y 'precio', que no existen (las claves
// son 'images', 'title', 'description' y 'price'): el paso «Imágenes» quedaba siempre pendiente aunque
// ya hubiera fotos, y «Información» y «Precio» ignoraban el título, la descripción y el precio.
export const buildWizardSteps = ({ readiness, useTechnicalSheet, hasVariants }) => {
  const checkByKey = key => readiness.checks.find(check => check.key === key)
  const statusFor = keys => {
    const relevant = keys.map(checkByKey).filter(Boolean)
    if (!relevant.length) return 'wait'
    return relevant.every(check => check.done) ? 'finish' : 'process'
  }

  return [
    {
      key: 'imagenes',
      title: 'Imágenes',
      sectionId: SECTION_IDS.imagenes,
      status: statusFor(['images']),
    },
    {
      key: 'informacion',
      title: 'Información',
      sectionId: SECTION_IDS.informacion,
      status: statusFor(['title', 'description', 'categoria', 'subcategoria']),
    },
    {
      key: 'ficha',
      title: 'Ficha técnica',
      sectionId: SECTION_IDS.ficha,
      optional: true,
      status: useTechnicalSheet ? statusFor(['ficha']) : 'wait',
    },
    {
      key: 'variantes',
      title: 'Variantes',
      sectionId: SECTION_IDS.variantes,
      optional: true,
      status: hasVariants ? statusFor(['variantes']) : 'wait',
    },
    {
      key: 'precio',
      title: 'Precio y SEO',
      sectionId: SECTION_IDS.precio,
      status: statusFor(['price', 'stock']),
    },
    {
      key: 'publicar',
      title: 'Publicar',
      sectionId: SECTION_IDS.publicar,
      status: readiness.isReady ? 'finish' : 'wait',
    },
  ]
}

// El paso en el que está la persona: el primero obligatorio que todavía no se terminó.
export const getWizardCurrentStep = steps => {
  const index = steps.findIndex(step => !step.optional && step.status !== 'finish')

  return index === -1 ? steps.length - 1 : index
}
