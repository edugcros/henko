// 📁 src/pages/AddProduct.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Form,
  Input,
  InputNumber,
  Button,
  Card,
  Alert,
  Tag,
  Divider,
  Typography,
  Row,
  Col,
  Select,
  AutoComplete,
  message,
  Upload,
  Empty,
  Switch,
  Table,
  theme,
  Space,
  Badge,
  Popconfirm,
} from 'antd'
import {
  InboxOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  RobotOutlined,
  EyeOutlined,
  TagOutlined,
  DollarOutlined,
  ShoppingOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  PictureOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  FormatPainterOutlined,
  NumberOutlined,
  FileTextOutlined,
  ClusterOutlined,
  ThunderboltOutlined,
  CheckOutlined,
  CloudDownloadOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import useProductAnalyzer from '../hooks/useProductAnalyzer'
import api from '@utils/axiosConfig'
import {
  createProducts,
  uploadProductImage,
  resetState,
  assignVariantImage,
} from '@features/product/productSlice'
import productService from '@features/product/productService'

const { Title, Text, Paragraph } = Typography
const { Dragger } = Upload
const { useToken } = theme

const normalizeString = (value = '') => String(value || '').trim()

const toTitleCase = value => {
  const clean = normalizeString(value).replace(/\s+/g, ' ')

  if (!clean) return ''

  return clean
    .toLocaleLowerCase('es-AR')
    .replace(/(^|[\s\-/([{"'¿¡])([a-záéíóúüñ])/giu, (_, prefix, char) => {
      return `${prefix}${char.toLocaleUpperCase('es-AR')}`
    })
}

const buildTitleCaseOption = value => {
  const label = toTitleCase(value)
  return label ? { value: label, label } : null
}

const slugifyKeyPart = (value = '') =>
  normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

const safeArray = value => (Array.isArray(value) ? value : [])
const MAX_GENERATED_VARIANTS = 200
const MAX_PRODUCT_IMAGES = 12
const MAX_IMAGE_SIZE_MB = 12
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const DYNAMIC_FIELD_TYPES = [
  { value: 'text', label: 'Texto corto' },
  { value: 'textarea', label: 'Texto largo' },
  { value: 'number', label: 'Número' },
  { value: 'select', label: 'Lista' },
  { value: 'multiselect', label: 'Selección múltiple' },
  { value: 'color', label: 'Color' },
  { value: 'boolean', label: 'Sí / No' },
]

const SHIPPING_TYPE_OPTIONS = [
  { value: 'standard', label: 'Envío estándar' },
  { value: 'fragile', label: 'Frágil / embalaje especial' },
  { value: 'refrigerated', label: 'Refrigerado' },
  { value: 'digital', label: 'Digital / sin envío físico' },
  { value: 'pickup_only', label: 'Solo retiro' },
]

const QUICK_VARIANT_PRESETS = [
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

const TECHNICAL_FIELD_PRESETS = [
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

const SEO_POSITIONING_INTENT_OPTIONS = [
  { value: 'commercial', label: 'Comercial / compra' },
  { value: 'informational', label: 'Informativa' },
  { value: 'comparative', label: 'Comparativa' },
  { value: 'local', label: 'Local / cercanía' },
  { value: 'brand', label: 'Marca' },
]

const QUICK_MODE_FIELD_KEYS = [
  'imagenes',
  'titulo',
  'descripcion',
  'categoria',
  'subcategoria',
  'precio',
  'stock',
]

const DEFAULT_DYNAMIC_FIELD_TYPES = new Set(
  DYNAMIC_FIELD_TYPES.map(item => item.value),
)

const buildGeneratedVariantSku = (productTitle, attributes, index) => {
  const titlePart = slugifyKeyPart(productTitle || 'producto')
    .replace(/-/g, '')
    .slice(0, 12)
    .toUpperCase()
  const attributePart = Object.values(attributes || {})
    .map(value =>
      slugifyKeyPart(value).replace(/-/g, '').slice(0, 8).toUpperCase(),
    )
    .filter(Boolean)
    .join('-')

  return [
    titlePart || 'PRODUCTO',
    attributePart,
    String(index + 1).padStart(2, '0'),
  ]
    .filter(Boolean)
    .join('-')
    .slice(0, 64)
}

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

const buildVariantDisplayName = variant => {
  return (
    normalizeString(variant?.nombre) ||
    buildVariantName(variant?.combinacion || variant?.attributes || {}) ||
    'Variante'
  )
}

const getVariantStockTotal = variants =>
  safeArray(variants)
    .filter(variant => variant?.isActive !== false)
    .reduce((total, variant) => total + normalizeNumberValue(variant?.stock), 0)

const getVariantAttributesConfig = (dynamicAttributes, selectedAttributes) => {
  return safeArray(dynamicAttributes)
    .filter(attr => safeArray(selectedAttributes?.[attr.name]).length > 0)
    .map((attr, index) => ({
      name: attr.name,
      label: attr.label || attr.name,
      type: attr.type || 'select',
      values: [
        ...new Set([
          ...safeArray(attr.values),
          ...safeArray(selectedAttributes?.[attr.name]),
        ]),
      ],
      required: attr.required === true,
      sortOrder: index,
    }))
}

const getUploadFileObject = file => file?.originFileObj || file

const isAllowedImageFile = file => {
  const fileObject = getUploadFileObject(file)
  const mimeType = fileObject?.type || file?.type || ''
  const filename = fileObject?.name || file?.name || ''
  const extension = filename.split('.').pop()?.toLowerCase()
  const extensionAllowed = [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'heic',
    'heif',
  ].includes(extension)

  return ALLOWED_IMAGE_TYPES.has(mimeType) || extensionAllowed
}

const sanitizeUploadFiles = files => {
  const uniqueFiles = dedupeByUid(safeArray(files)).filter(file => {
    const fileObject = getUploadFileObject(file)
    if (!fileObject) return false
    return isAllowedImageFile(file)
  })

  return uniqueFiles.slice(0, MAX_PRODUCT_IMAGES)
}

const validateSelectedFiles = files => {
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

const getJobFlag = (job, key) => Boolean(job?.[key] ?? job?.metadata?.[key])

const validateVariantsForSubmit = variants => {
  if (!safeArray(variants).length) {
    return 'Activaste variantes, pero todavía no generaste ninguna combinación.'
  }

  const activeVariants = safeArray(variants).filter(
    variant => variant.isActive !== false,
  )
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

    if (normalizeNumberValue(variant.price) <= 0) {
      return `La variante "${name}" necesita un precio mayor a 0.`
    }

    if (normalizeNumberValue(variant.stock) < 0) {
      return `La variante "${name}" tiene stock inválido.`
    }

    const sku = normalizeSku(variant.sku)
    if (sku) {
      if (variantSkus.has(sku)) {
        return `Hay variantes con SKU duplicado: ${sku}.`
      }

      variantSkus.add(sku)
    }
  }

  return null
}


const validateProductBasicsForSubmit = ({ values = {}, hasVariants = false }) => {
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

  if (normalizeNumberValue(values.precio) <= 0) {
    return 'El precio debe ser mayor a 0.'
  }

  if (!hasVariants && normalizeNumberValue(values.cantidad) <= 0) {
    return 'La cantidad en stock debe ser mayor a 0.'
  }

  return null
}

const parseQuickVariantText = value => {
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

const inferTechnicalFieldType = value => {
  const clean = normalizeString(value)
  if (!clean) return 'text'
  if (/^(si|sí|no|true|false)$/i.test(clean)) return 'boolean'
  if (
    /^-?\d+(?:[.,]\d+)?(?:\s*(cm|mm|m|kg|g|cc|l|ml|w|v|hp|cv))?$/i.test(clean)
  )
    return 'number'
  if (clean.includes(',') || clean.includes(';')) return 'multiselect'
  return clean.length > 90 ? 'textarea' : 'text'
}

const parseTechnicalFieldText = value => {
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
          ? normalizeNumberValue(
              rawValue.replace(/[^0-9.,-]/g, '').replace(',', '.'),
            )
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
        unit: normalizeString(
          rawValue.match(/\b(cm|mm|m|kg|g|cc|l|ml|w|v|hp|cv)\b/i)?.[1] || '',
        ),
        required: false,
        visible: true,
        filterable: ['select', 'multiselect', 'color', 'boolean'].includes(
          type,
        ),
        searchable: true,
        group: 'ficha técnica',
        source: 'quick',
        sortOrder: index,
      })
      values[name] = normalizedValue
    })

  return { fields, values }
}

const mergeVariantAttributeDefinitions = (current = [], incoming = []) => {
  const merged = new Map()

  safeArray(current).forEach((attribute, index) => {
    if (!attribute?.name) return
    merged.set(attribute.name, {
      ...attribute,
      sortOrder: Number.isFinite(Number(attribute.sortOrder))
        ? Number(attribute.sortOrder)
        : index,
    })
  })

  safeArray(incoming).forEach((attribute, index) => {
    if (!attribute?.name) return
    const previous = merged.get(attribute.name)
    merged.set(attribute.name, {
      ...previous,
      ...attribute,
      label:
        attribute.label ||
        previous?.label ||
        normalizeAiFieldLabel(attribute.name),
      values: [
        ...new Set([
          ...safeArray(previous?.values),
          ...safeArray(attribute.values),
        ]),
      ],
      required: previous?.required === true || attribute.required === true,
      sortOrder: Number.isFinite(Number(previous?.sortOrder))
        ? Number(previous.sortOrder)
        : index,
    })
  })

  return [...merged.values()].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  )
}

const mergeSelectedVariantValues = (current = {}, incoming = {}) => {
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

const generateVariantRowsFromSelection = ({
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
    (acc, attribute) =>
      acc * safeArray(selectedAttributes[attribute.name]).length,
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

  const previousByKey = new Map(
    safeArray(previousVariants).map(variant => [variant.key, variant]),
  )

  const variants = buildCombinations().map((combination, index) => {
    const key =
      buildVariantKey(combination) || `variant-${index + 1}-${Date.now()}`
    const previous = previousByKey.get(key)
    const generatedSku = buildGeneratedVariantSku(
      productTitle,
      combination,
      index,
    )

    return {
      key,
      nombre: buildVariantName(combination) || `Variante ${index + 1}`,
      combinacion: combination,
      price: previous?.price ?? Number(basePrice || 0),
      stock: previous?.stock ?? 0,
      sku: previous?.sku || generatedSku,
      isActive: previous?.isActive ?? true,
      imageSourceUid: previous?.imageSourceUid ?? null,
      uiStatus: previous ? 'existing' : 'new',
    }
  })

  return { variants, total }
}

const normalizeDynamicFieldType = value => {
  const clean = normalizeString(value).toLowerCase()

  if (['textarea', 'longtext', 'long_text', 'multiline'].includes(clean))
    return 'textarea'
  if (['number', 'numeric', 'integer', 'float'].includes(clean)) return 'number'
  if (['select', 'dropdown', 'enum', 'list'].includes(clean)) return 'select'
  if (['multiselect', 'multi_select', 'tags', 'array'].includes(clean))
    return 'multiselect'
  if (['color', 'colour'].includes(clean)) return 'color'
  if (['boolean', 'bool', 'switch', 'checkbox'].includes(clean))
    return 'boolean'
  if (['text', 'string', 'input'].includes(clean)) return 'text'

  return DEFAULT_DYNAMIC_FIELD_TYPES.has(clean) ? clean : 'text'
}

const parseDynamicFieldOptions = value => {
  if (Array.isArray(value)) {
    return [
      ...new Set(value.map(item => normalizeString(item)).filter(Boolean)),
    ]
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

const normalizeDynamicFieldDefinition = (field, index = 0) => {
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
    field.name ||
    field.key ||
    field.field ||
    field.code ||
    field.id ||
    field.label ||
    field.title
  const name = slugifyKeyPart(rawName).replace(/-/g, '_')

  if (!name) return null

  return {
    name,
    label: normalizeString(field.label || field.title || field.name || name),
    type: normalizeDynamicFieldType(
      field.type || field.inputType || field.kind,
    ),
    values: parseDynamicFieldOptions(
      field.values || field.options || field.enum || field.allowedValues,
    ),
    unit: normalizeString(field.unit || field.suffix || ''),
    placeholder: normalizeString(field.placeholder || field.help || ''),
    required:
      field.required === true ||
      field.isRequired === true ||
      field.mandatory === true,
    sortOrder: Number.isFinite(Number(field.sortOrder))
      ? Number(field.sortOrder)
      : index,
    source: field.source || 'template',
  }
}

const extractTemplateDynamicFields = templatePayload => {
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
        values: [
          ...new Set([
            ...safeArray(previous?.values),
            ...safeArray(normalized.values),
          ]),
        ],
        required: previous?.required === true || normalized.required === true,
      })
    })
  })

  return Array.from(map.values()).sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  )
}

const normalizeDynamicFieldValues = (fields = [], rawValues = {}) => {
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

const buildSeoPayload = values => {
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
    shortDescription:
      normalizeString(values.shortDescription) ||
      sourceDescription.slice(0, 240),
    metaTitle: normalizeString(values.metaTitle) || title.slice(0, 70),
    metaDescription:
      normalizeString(values.metaDescription) ||
      sourceDescription.slice(0, 160),
    keywords: [
      ...new Set(
        rawKeywords
          .flatMap(item =>
            Array.isArray(item) ? item : String(item || '').split(/[,;|]/g),
          )
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

const buildSeoFormValues = values => {
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

const buildLogisticsPayload = values => {
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

const formatDate = value => {
  if (!value) return ''
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

const getStoredBoolean = (key, fallback = false) => {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key)
  if (value === null) return fallback
  return value === 'true'
}

const dedupeByUid = (files = []) => {
  const map = new Map()
  files.forEach(file => {
    if (file?.uid) map.set(file.uid, file)
  })
  return Array.from(map.values())
}

const revokeBlobUrls = (urls = []) => {
  urls.forEach(url => {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  })
}

const buildPreviewFromFile = file => {
  if (file?.url) return file.url
  if (file?.originFileObj) return URL.createObjectURL(file.originFileObj)
  return null
}

const rebuildPreviews = files =>
  files.map(file => buildPreviewFromFile(file)).filter(Boolean)

const waitForUiReset = () =>
  new Promise(resolve => {
    if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      window.requestAnimationFrame(() => resolve())
      return
    }

    setTimeout(resolve, 0)
  })

const getFirstFilled = (...values) => {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value
    if (value && typeof value === 'object' && Object.keys(value).length)
      return value
    const cleanValue = normalizeString(value)
    if (cleanValue) return value
  }

  return null
}

const normalizeAiFieldLabel = value => {
  const cleanValue = normalizeString(value).replace(/[_-]+/g, ' ')
  return toTitleCase(cleanValue)
}

const AI_FIELD_BLOCKLIST = new Set([
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

      const rawKey =
        item.key || item.name || item.field || item.label || item.title
      const key = slugifyKeyPart(rawKey).replace(/-/g, '_')
      const value =
        item.value ?? item.valor ?? item.answer ?? item.text ?? item.content

      if (!key || value === undefined || value === null || value === '') return

      rows.push({
        key,
        label:
          normalizeString(item.label || item.title || rawKey) ||
          normalizeAiFieldLabel(key),
        value,
        type: normalizeDynamicFieldType(
          item.type ||
            item.inputType ||
            (Array.isArray(value)
              ? 'multiselect'
              : typeof value === 'number'
                ? 'number'
                : 'text'),
        ),
        unit: normalizeString(item.unit || item.suffix || ''),
        group: normalizeString(item.group || item.section || 'ficha técnica'),
        visible: item.visible !== false,
        filterable: item.filterable === true,
        searchable: item.searchable !== false,
        source: item.source || 'ia',
        sortOrder: Number.isFinite(Number(item.sortOrder))
          ? Number(item.sortOrder)
          : index,
        confidence: Number.isFinite(Number(item.confidence))
          ? Number(item.confidence)
          : undefined,
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
    if (!source || typeof source !== 'object' || Array.isArray(source))
      return acc

    Object.entries(source).forEach(([key, value]) => {
      const normalizedKey = slugifyKeyPart(key).replace(/-/g, '_')
      if (!normalizedKey || AI_FIELD_BLOCKLIST.has(normalizedKey)) return
      if (value === undefined || value === null || value === '') return
      acc[normalizedKey] = value
    })

    return acc
  }, {})
}

const buildDynamicFieldsFromAi = analysis => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const map = new Map()

  specs.forEach((spec, index) => {
    const key = slugifyKeyPart(spec.key || spec.name || spec.label).replace(
      /-/g,
      '_',
    )
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
        spec.values ||
          spec.options ||
          (Array.isArray(spec.value) ? spec.value : []),
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
      sortOrder: Number.isFinite(Number(spec.sortOrder))
        ? Number(spec.sortOrder)
        : index,
    })
  })

  Object.entries(attributes).forEach(([key, value], index) => {
    if (map.has(key)) return

    map.set(key, {
      name: key,
      label: normalizeAiFieldLabel(key),
      type: Array.isArray(value)
        ? 'multiselect'
        : typeof value === 'number'
          ? 'number'
          : 'text',
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

  return [...map.values()].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  )
}

const buildDynamicValuesFromAi = (analysis, fields = []) => {
  const specs = normalizeAiSpecificationRows(analysis)
  const attributes = flattenAiAttributes(analysis)
  const values = {}

  specs.forEach(spec => {
    const key = slugifyKeyPart(spec.key || spec.name || spec.label).replace(
      /-/g,
      '_',
    )
    if (!key || AI_FIELD_BLOCKLIST.has(key)) return
    if (spec.value !== undefined && spec.value !== null && spec.value !== '') {
      values[key] = spec.value
    }
  })

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '')
      values[key] = value
  })

  const allowed = new Set(fields.map(field => field.name))
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => allowed.has(key)),
  )
}

const buildSpecificationRows = (fields = [], values = {}) => {
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
        sortOrder: Number.isFinite(Number(field.sortOrder))
          ? Number(field.sortOrder)
          : index,
      }
    })
    .filter(Boolean)
}

const buildFilterAttributesFromSpecifications = specifications => {
  return safeArray(specifications)
    .filter(
      item =>
        item.filterable && item.value !== undefined && item.value !== null,
    )
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

const TECHNICAL_STORAGE_KEYS = new Set([
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

const shouldIncludeTechnicalSheetFromJob = job => {
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

const sanitizeAiOutputForStorage = (value, includeTechnicalSheet) => {
  if (includeTechnicalSheet || !value || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.map(item =>
      sanitizeAiOutputForStorage(item, includeTechnicalSheet),
    )
  }

  return Object.entries(value).reduce((acc, [key, entryValue]) => {
    if (TECHNICAL_STORAGE_KEYS.has(key)) return acc
    acc[key] = sanitizeAiOutputForStorage(entryValue, includeTechnicalSheet)
    return acc
  }, {})
}

const removeEmptyObjectKey = (target, key) => {
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

const enforceTechnicalSheetPersistence = (payload, includeTechnicalSheet) => {
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

  if (!normalizeString(cleanPayload.technicalDescription))
    delete cleanPayload.technicalDescription
  if (!normalizeString(cleanPayload.descripcionTecnica))
    delete cleanPayload.descripcionTecnica
  if (!safeArray(cleanPayload.specifications).length)
    delete cleanPayload.specifications
  if (!safeArray(cleanPayload.filterAttributes).length)
    delete cleanPayload.filterAttributes
  removeEmptyObjectKey(cleanPayload, 'productAttributes')
  removeEmptyObjectKey(cleanPayload, 'categoryAttributes')
  removeEmptyObjectKey(cleanPayload, 'dynamicFields')

  return cleanPayload
}

const getAiReviewReasons = analysis => {
  return [
    ...safeArray(analysis?.reviewReasons),
    ...safeArray(analysis?.reasoningFlags),
  ]
    .map(item => normalizeString(item))
    .filter(Boolean)
}

const getAiVariantSuggestions = analysis => {
  return safeArray(
    analysis?.variantSuggestions ||
      analysis?.variant_suggestions ||
      analysis?.variantes_sugeridas ||
      analysis?.variantes,
  )
}

const normalizeAiAnalysisForForm = analysis => {
  const attrs =
    analysis?.atributos_detectados ||
    analysis?.atributos ||
    analysis?.attributes ||
    {}
  const dynamicFields = buildDynamicFieldsFromAi(analysis)
  const dynamicValues = buildDynamicValuesFromAi(analysis, dynamicFields)
  const variantSuggestions = getAiVariantSuggestions(analysis)
  const hasExplicitVariants = variantSuggestions.length > 0

  const colorValue = getFirstFilled(attrs?.color, analysis?.color)
  const materialValue = getFirstFilled(attrs?.material, analysis?.material)
  const seo = analysis?.seo || {}
  const logistics = analysis?.logistics || {}

  const fields = {
    titulo: normalizeString(analysis?.titulo || analysis?.title || ''),
    descripcion: normalizeString(
      analysis?.descripcion || analysis?.description || '',
    ),
    descripcionTecnica: normalizeString(
      analysis?.descripcion_tecnica ||
        analysis?.technicalDescription ||
        analysis?.technical_description ||
        analysis?.descripcionTecnica ||
        '',
    ),
    categoria: toTitleCase(analysis?.categoria || analysis?.category || ''),
    subcategoria: toTitleCase(
      analysis?.subcategoria || analysis?.subcategory || '',
    ),
    marca: normalizeString(analysis?.marca || analysis?.brand || ''),
    precio:
      analysis?.precio_sugerido || analysis?.precio || analysis?.price || null,
    cantidad: analysis?.cantidad || analysis?.stock || 1,
    condicion: analysis?.condicion || 'nuevo',
    color: Array.isArray(colorValue)
      ? colorValue.join(', ')
      : normalizeString(colorValue),
    material: normalizeString(materialValue),
    shortDescription: normalizeString(
      seo.shortDescription || analysis?.shortDescription || '',
    ),
    metaTitle: normalizeString(seo.metaTitle || analysis?.metaTitle || ''),
    metaDescription: normalizeString(
      seo.metaDescription || analysis?.metaDescription || '',
    ),
    seoKeywords: safeArray(
      seo.keywords || analysis?.keywords || analysis?.tags,
    ),
    weightKg: logistics.weightKg || analysis?.weightKg || null,
    shippingType:
      logistics?.shipping?.type || logistics.shippingType || 'standard',
    warranty: logistics.warranty || analysis?.warranty || '',
    countryOfOrigin:
      logistics.countryOfOrigin ||
      logistics.originCountry ||
      analysis?.countryOfOrigin ||
      '',
    packageLengthCm:
      logistics?.dimensions?.length || logistics?.package?.length || null,
    packageWidthCm:
      logistics?.dimensions?.width || logistics?.package?.width || null,
    packageHeightCm:
      logistics?.dimensions?.height || logistics?.package?.height || null,
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
                  ([key]) =>
                    ![
                      'precio',
                      'stock',
                      'sku',
                      'price',
                      'imagen',
                      'image',
                    ].includes(key),
                ),
              )

        Object.entries(combination).forEach(([key, value]) => {
          const name = slugifyKeyPart(key).replace(/-/g, '_')
          const cleanValue = normalizeString(value)
          if (!name || !cleanValue) return
          if (!selectedAttributes[name]) selectedAttributes[name] = []
          selectedAttributes[name] = [
            ...new Set([...selectedAttributes[name], cleanValue]),
          ]
        })

        return {
          key:
            buildVariantKey(combination) || `ai-variant-${idx}-${Date.now()}`,
          nombre: buildVariantName(combination) || `Variante ${idx + 1}`,
          combinacion: combination,
          price: Number(
            variant?.precio || variant?.price || analysis?.precio_sugerido || 0,
          ),
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
        analysis?.requiresHumanReview ||
        analysis?.needsReview ||
        analysis?.aiNeedsReview,
      ),
      reasons: getAiReviewReasons(analysis),
    },
  }
}

const buildProductPayloadFromAnalysis = ({
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
  const filterAttributes =
    buildFilterAttributesFromSpecifications(specifications)
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
      fields.descripcion ||
      'Descripción generada automáticamente pendiente de revisión.',
    technicalDescription: fields.descripcionTecnica,
    descripcionTecnica: fields.descripcionTecnica,
    categoria: toTitleCase(fields.categoria || 'Sin Categoría'),
    subcategoria: toTitleCase(fields.subcategoria || 'General'),
    marca: normalizeString(fields.marca || 'sin marca'),
    price: Number(fields.precio || 0),
    stock: Number(fields.cantidad || 1),
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
      sku:
        normalizeSku(variant.sku) ||
        buildGeneratedVariantSku(title, variant.combinacion, idx),
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
    aiSource:
      normalizedAnalysis?.source || normalizedAnalysis?.model || 'gemini',
    aiImageHash:
      normalizedAnalysis?.hash ||
      normalizedAnalysis?.imageHash ||
      job?.imageHash ||
      null,
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

const AIAnalysisPanel = ({
  iaResult,
  loading,
  error,
  onReset,
  onApplyAll,
  onApplySafeFields,
  onApplyField,
  onApplySeo,
  onApplyTechnicalFields,
  onApplyDynamicField,
  onApplyTags,
  onApplyVariants,
  confidence = 85,
}) => {
  const { token } = useToken()

  if (loading) {
    return (
      <Card
        className="ai-analysis-card"
        style={{
          marginBottom: 24,
          borderRadius: 20,
          border: `1px solid ${token.colorPrimary}30`,
          background: `linear-gradient(135deg, ${token.colorPrimary}10 0%, ${token.colorBgContainer} 50%, ${token.colorInfoBg || token.colorPrimaryBg} 100%)`,
          boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08)',
        }}
      >
        <div style={{ textAlign: 'center', padding: '26px 0' }}>
          <div className="ai-pulse-animation">
            <RobotOutlined
              style={{ fontSize: 52, color: token.colorPrimary }}
            />
          </div>
          <Text
            strong
            style={{ fontSize: 17, display: 'block', margin: '16px 0 8px' }}
          >
            Analizando imagen con IA
          </Text>
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            Identificando producto, atributos, ficha técnica, SEO y señales de
            revisión.
          </Text>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Error en el análisis de IA"
        description={error}
        action={
          <Button
            htmlType="button"
            size="small"
            danger
            onClick={onReset}
            icon={<ReloadOutlined />}
          >
            Reintentar
          </Button>
        }
        style={{ marginBottom: 24, borderRadius: 16 }}
      />
    )
  }

  if (!iaResult) return null

  const normalized = normalizeAiAnalysisForForm(iaResult)
  const {
    fields,
    dynamicFields,
    dynamicValues,
    hasExplicitVariants,
    variants,
    review,
    tags,
  } = normalized
  const safeConfidence = Number(
    review.confidence || iaResult.confidence || confidence / 100 || 0,
  )
  const confidencePercent = Math.round(
    Math.max(0, Math.min(1, safeConfidence)) * 100,
  )
  const materialPercent = Math.round(
    Math.max(0, Math.min(1, Number(review.materialConfidence || 0))) * 100,
  )
  const pricePercent = Math.round(
    Math.max(0, Math.min(1, Number(review.priceConfidence || 0))) * 100,
  )
  const technicalDescription = fields.descripcionTecnica
  const commercialDescription = fields.descripcion
  const shouldReview = review.requiresHumanReview || confidencePercent < 65

  const formatSuggestedValue = value => {
    if (Array.isArray(value))
      return value
        .map(item => normalizeString(item))
        .filter(Boolean)
        .join(', ')
    if (value === true) return 'Sí'
    if (value === false) return 'No'
    if (value === undefined || value === null || value === '') return ''
    if (typeof value === 'number')
      return Number.isFinite(value) ? String(value) : ''
    return normalizeString(value)
  }

  const hasSuggestedValue = value => {
    if (Array.isArray(value)) return value.some(item => normalizeString(item))
    if (typeof value === 'number') return Number.isFinite(value) && value > 0
    if (typeof value === 'boolean') return true
    return Boolean(normalizeString(value))
  }

  const mainSuggestions = [
    {
      key: 'titulo',
      fieldName: 'titulo',
      label: 'Título del producto',
      value: fields.titulo,
      icon: <FileTextOutlined />,
      help: 'Nombre comercial que se usará como título principal.',
    },
    {
      key: 'descripcion',
      fieldName: 'descripcion',
      label: 'Descripción comercial',
      value: fields.descripcion,
      icon: <FileTextOutlined />,
      long: true,
      help: 'Texto principal visible en la página del producto.',
    },
    {
      key: 'descripcionTecnica',
      fieldName: 'descripcionTecnica',
      label: 'Descripción técnica',
      value: fields.descripcionTecnica,
      icon: <InfoCircleOutlined />,
      long: true,
      help: 'Detalle objetivo para ficha ampliada o especificaciones.',
    },
    {
      key: 'categoria',
      fieldName: 'categoria',
      label: 'Categoría',
      value: fields.categoria,
      icon: <AppstoreOutlined />,
      help: 'Categoría principal detectada por la IA.',
    },
    {
      key: 'subcategoria',
      fieldName: 'subcategoria',
      label: 'Subcategoría',
      value: fields.subcategoria,
      icon: <BranchesOutlined />,
      help: 'Clasificación más específica del producto.',
    },
    {
      key: 'marca',
      fieldName: 'marca',
      label: 'Marca',
      value: fields.marca,
      icon: <ShoppingOutlined />,
      help: 'Solo debería aplicarse si la IA la detectó con evidencia suficiente.',
    },
    {
      key: 'precio',
      fieldName: 'precio',
      label: 'Precio sugerido',
      value: fields.precio
        ? `$${Number(fields.precio).toLocaleString('es-AR')}`
        : '',
      icon: <DollarOutlined />,
      help: `${pricePercent || 0}% de confianza estimada para precio.`,
    },
    {
      key: 'material',
      fieldName: 'material',
      label: 'Material',
      value: fields.material,
      icon: <InfoCircleOutlined />,
      help: `${materialPercent || 0}% de confianza estimada para material.`,
    },
    {
      key: 'color',
      fieldName: 'color',
      label: 'Color principal',
      value: fields.color,
      icon: <FormatPainterOutlined />,
      help: 'Color dominante detectado en la imagen.',
    },
    {
      key: 'cantidad',
      fieldName: 'cantidad',
      label: 'Stock inicial',
      value: fields.cantidad,
      icon: <NumberOutlined />,
      help: 'Cantidad sugerida o valor por defecto para iniciar la publicación.',
    },
    {
      key: 'condicion',
      fieldName: 'condicion',
      label: 'Condición',
      value: fields.condicion,
      icon: <CheckOutlined />,
      help: 'Condición sugerida para el producto.',
    },
  ]

  const seoSuggestions = [
    {
      key: 'slug',
      fieldName: 'slug',
      label: 'Slug URL',
      value: buildSeoPayload({ ...fields, tags }).slug,
      icon: <FileTextOutlined />,
      help: 'URL amigable generada desde el título.',
    },
    {
      key: 'shortDescription',
      fieldName: 'shortDescription',
      label: 'Descripción corta',
      value:
        fields.shortDescription ||
        buildSeoPayload({ ...fields, tags }).shortDescription,
      icon: <FileTextOutlined />,
      long: true,
      help: 'Resumen breve para cards, buscadores y vista rápida.',
    },
    {
      key: 'metaTitle',
      fieldName: 'metaTitle',
      label: 'Meta title',
      value: fields.metaTitle || buildSeoPayload({ ...fields, tags }).metaTitle,
      icon: <FileTextOutlined />,
      help: 'Título SEO sugerido.',
    },
    {
      key: 'metaDescription',
      fieldName: 'metaDescription',
      label: 'Meta description',
      value:
        fields.metaDescription ||
        buildSeoPayload({ ...fields, tags }).metaDescription,
      icon: <FileTextOutlined />,
      long: true,
      help: 'Descripción para buscadores.',
    },
    {
      key: 'seoKeywords',
      fieldName: 'seoKeywords',
      label: 'Keywords SEO',
      value: fields.seoKeywords?.length ? fields.seoKeywords : tags,
      icon: <TagOutlined />,
      help: 'Palabras clave sugeridas por IA o derivadas del producto.',
    },
  ]

  const logisticsSuggestions = [
    {
      key: 'weightKg',
      fieldName: 'weightKg',
      label: 'Peso kg',
      value: fields.weightKg,
      icon: <ShoppingOutlined />,
      help: 'Peso estimado o informado para logística.',
    },
    {
      key: 'shippingType',
      fieldName: 'shippingType',
      label: 'Tipo de envío',
      value: fields.shippingType,
      icon: <ShoppingOutlined />,
      help: 'Tipo de logística sugerida.',
    },
    {
      key: 'packageLengthCm',
      fieldName: 'packageLengthCm',
      label: 'Largo cm',
      value: fields.packageLengthCm,
      icon: <NumberOutlined />,
      help: 'Medida del paquete si la IA o el contexto la sugieren.',
    },
    {
      key: 'packageWidthCm',
      fieldName: 'packageWidthCm',
      label: 'Ancho cm',
      value: fields.packageWidthCm,
      icon: <NumberOutlined />,
      help: 'Medida del paquete si la IA o el contexto la sugieren.',
    },
    {
      key: 'packageHeightCm',
      fieldName: 'packageHeightCm',
      label: 'Alto cm',
      value: fields.packageHeightCm,
      icon: <NumberOutlined />,
      help: 'Medida del paquete si la IA o el contexto la sugieren.',
    },
    {
      key: 'warranty',
      fieldName: 'warranty',
      label: 'Garantía',
      value: fields.warranty,
      icon: <InfoCircleOutlined />,
      help: 'Garantía sugerida o detectada. Revisar si no está explícita.',
    },
    {
      key: 'countryOfOrigin',
      fieldName: 'countryOfOrigin',
      label: 'País de origen',
      value: fields.countryOfOrigin,
      icon: <InfoCircleOutlined />,
      help: 'Origen sugerido o detectado. No aplicar si no está confirmado.',
    },
  ]

  const suggestionSections = [
    {
      key: 'main',
      title: 'Campos principales detectados',
      description:
        'Aplicá cada dato solo si coincide con lo que ves en la imagen y con tu catálogo.',
      items: mainSuggestions,
    },
    {
      key: 'seo',
      title: 'SEO y contenido comercial sugerido',
      description:
        'Podés aplicar campo por campo o usar el botón “Generar SEO con IA”.',
      items: seoSuggestions,
    },
    {
      key: 'logistics',
      title: 'Logística, garantía y origen sugeridos',
      description:
        'Estos datos conviene confirmarlos antes de publicar si no vienen de una fuente confiable.',
      items: logisticsSuggestions,
    },
  ]

  const SuggestionCard = ({ item }) => {
    const displayValue = formatSuggestedValue(item.value)
    const available = hasSuggestedValue(item.value)

    return (
      <Card
        size="small"
        style={{
          borderRadius: 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          height: '100%',
        }}
        styles={{ body: { padding: 14 } }}
      >
        <Space direction="vertical" size={7} style={{ width: '100%' }}>
          <Space size={7} align="center">
            <span style={{ color: token.colorPrimary }}>{item.icon}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {item.label}
            </Text>
          </Space>

          {item.long ? (
            <Paragraph
              ellipsis={
                available
                  ? { rows: 3, expandable: true, symbol: 'Ver más' }
                  : false
              }
              style={{ margin: 0, fontWeight: 700, whiteSpace: 'pre-line' }}
            >
              {available ? displayValue : 'Sin sugerencia disponible'}
            </Paragraph>
          ) : (
            <Text
              strong
              ellipsis={{ tooltip: available ? displayValue : undefined }}
              style={{ fontSize: 14 }}
            >
              {available ? displayValue : 'Sin sugerencia disponible'}
            </Text>
          )}

          {item.help && (
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.35 }}>
              {item.help}
            </Text>
          )}

          <Button
            htmlType="button"
            size="small"
            type={available ? 'primary' : 'default'}
            ghost={available}
            icon={<CheckCircleOutlined />}
            disabled={!available}
            onClick={() => onApplyField?.(item.fieldName)}
            style={{ alignSelf: 'flex-start', borderRadius: 999 }}
          >
            Completar este campo
          </Button>
        </Space>
      </Card>
    )
  }

  return (
    <Card
      className="ai-analysis-card"
      style={{
        marginBottom: 24,
        borderRadius: 22,
        border: `1px solid ${shouldReview ? token.colorWarningBorder : token.colorSuccessBorder}`,
        background: `linear-gradient(135deg, ${shouldReview ? token.colorWarningBg : token.colorSuccessBg} 0%, ${token.colorBgContainer} 48%, ${token.colorBgContainer} 100%)`,
        boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
      }}
      title={
        <Row gutter={[12, 12]} align="middle" justify="space-between">
          <Col>
            <Space size={10} wrap>
              <RobotOutlined
                style={{ fontSize: 20, color: token.colorPrimary }}
              />
              <span>Revisión inteligente de la IA</span>
              <Tag
                color={shouldReview ? 'warning' : 'success'}
                style={{ borderRadius: 999 }}
              >
                {confidencePercent}% confianza
              </Tag>
              {shouldReview && (
                <Tag color="orange">Revisar antes de publicar</Tag>
              )}
            </Space>
          </Col>
          <Col>
            <Button
              htmlType="button"
              size="small"
              icon={<ReloadOutlined />}
              onClick={onReset}
            >
              Reanalizar
            </Button>
          </Col>
        </Row>
      }
    >
      <Alert
        type={shouldReview ? 'warning' : 'success'}
        showIcon
        style={{ marginBottom: 18, borderRadius: 14 }}
        message={
          shouldReview
            ? 'La IA completó el producto, pero algunos datos conviene revisarlos.'
            : 'La IA detectó una propuesta consistente para completar el producto.'
        }
        description="Usá esta revisión como guía: cada dato sugerido tiene botón para aplicarlo al campo correcto. Podés aplicar todo, solo lo seguro o elegir campo por campo."
      />

      <Space wrap style={{ marginBottom: 18 }}>
        <Button
          htmlType="button"
          type="primary"
          icon={<CheckCircleOutlined />}
          onClick={onApplyAll}
        >
          Aplicar todo al formulario
        </Button>
        <Button
          htmlType="button"
          icon={<CheckOutlined />}
          onClick={onApplySafeFields}
        >
          Aplicar solo campos seguros
        </Button>
        <Button
          htmlType="button"
          icon={<ThunderboltOutlined />}
          onClick={onApplySeo}
        >
          Generar SEO con IA
        </Button>
        <Button
          htmlType="button"
          icon={<AppstoreOutlined />}
          onClick={onApplyTechnicalFields}
          disabled={!dynamicFields.length}
        >
          Aplicar ficha técnica
        </Button>
        <Button
          htmlType="button"
          icon={<TagOutlined />}
          onClick={onApplyTags}
          disabled={!tags.length}
        >
          Aplicar tags
        </Button>
        {hasExplicitVariants && (
          <Button
            htmlType="button"
            icon={<ClusterOutlined />}
            onClick={onApplyVariants}
            disabled={!variants.length}
          >
            Aplicar variantes
          </Button>
        )}
      </Space>

      {suggestionSections.map(section => (
        <div
          key={section.key}
          style={{ marginTop: section.key === 'main' ? 0 : 20 }}
        >
          <Divider orientation="left" plain>
            {section.title}
          </Divider>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {section.description}
          </Text>
          <Row gutter={[14, 14]}>
            {section.items.map(item => (
              <Col xs={24} sm={12} lg={8} key={item.key}>
                <SuggestionCard item={item} />
              </Col>
            ))}
          </Row>
        </div>
      ))}

      <Row gutter={[14, 14]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <div
            style={{
              padding: 14,
              borderRadius: 16,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Text type="secondary">Confianza material</Text>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
              {materialPercent || '—'}%
            </div>
          </div>
        </Col>
        <Col xs={24} md={8}>
          <div
            style={{
              padding: 14,
              borderRadius: 16,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Text type="secondary">Confianza precio</Text>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
              {pricePercent || '—'}%
            </div>
          </div>
        </Col>
        <Col xs={24} md={8}>
          <div
            style={{
              padding: 14,
              borderRadius: 16,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Text type="secondary">Ficha técnica</Text>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
              {dynamicFields.length}
            </div>
          </div>
        </Col>
      </Row>

      {(commercialDescription || technicalDescription) && (
        <div style={{ marginTop: 18 }}>
          <Divider orientation="left" plain>
            Contenido generado
          </Divider>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {commercialDescription && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 16,
                  background: token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Space
                  style={{ width: '100%', justifyContent: 'space-between' }}
                  align="center"
                >
                  <Text strong>Descripción comercial</Text>
                  <Button
                    htmlType="button"
                    size="small"
                    type="link"
                    onClick={() => onApplyField?.('descripcion')}
                  >
                    Usar descripción
                  </Button>
                </Space>
                <Paragraph
                  style={{
                    marginTop: 8,
                    marginBottom: 0,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {commercialDescription}
                </Paragraph>
              </div>
            )}
            {technicalDescription && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 16,
                  background: token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Space
                  style={{ width: '100%', justifyContent: 'space-between' }}
                  align="center"
                >
                  <Text strong>Descripción técnica precisa</Text>
                  <Button
                    htmlType="button"
                    size="small"
                    type="link"
                    onClick={() => onApplyField?.('descripcionTecnica')}
                  >
                    Usar técnica
                  </Button>
                </Space>
                <Paragraph
                  style={{
                    marginTop: 8,
                    marginBottom: 0,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {technicalDescription}
                </Paragraph>
              </div>
            )}
          </Space>
        </div>
      )}

      {dynamicFields.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Divider orientation="left" plain>
            Ficha técnica sugerida
          </Divider>
          <Row gutter={[8, 8]}>
            {dynamicFields.slice(0, 16).map(field => {
              const value = dynamicValues[field.name]
              return (
                <Col xs={24} sm={12} key={field.name}>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: token.colorFillAlter,
                      border: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {field.label}
                    </Text>
                    <br />
                    <Text strong>
                      {Array.isArray(value)
                        ? value.join(', ')
                        : normalizeString(value) || 'Pendiente'}
                    </Text>
                    <Space size={4} wrap style={{ marginTop: 6 }}>
                      {field.source && <Tag>{field.source}</Tag>}
                      {field.filterable && <Tag color="blue">Filtro</Tag>}
                      <Button
                        htmlType="button"
                        type="link"
                        size="small"
                        style={{ padding: 0 }}
                        onClick={() => onApplyDynamicField?.(field)}
                      >
                        Usar campo
                      </Button>
                    </Space>
                  </div>
                </Col>
              )
            })}
          </Row>
        </div>
      )}

      {hasExplicitVariants && variants.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Divider orientation="left" plain>
            Variantes sugeridas
          </Divider>
          <Space wrap>
            {variants.map((variant, idx) => (
              <Tag
                key={variant.key || idx}
                color="purple"
                style={{ padding: '5px 12px', borderRadius: 999 }}
              >
                {variant.nombre}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      {tags.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Divider orientation="left" plain>
            Tags sugeridos
          </Divider>
          <Space wrap>
            {tags.map(tag => (
              <Tag key={tag} color="blue" style={{ borderRadius: 999 }}>
                {tag}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      {review.reasons.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <Divider orientation="left" plain>
            Señales de revisión
          </Divider>
          <Space wrap>
            {review.reasons.map(reason => (
              <Tag key={reason} color="orange" style={{ borderRadius: 999 }}>
                {reason}
              </Tag>
            ))}
          </Space>
        </div>
      )}
    </Card>
  )
}

const ImagePreviewGrid = ({ previews, fileList, onRemove, onAddMore }) => {
  const { token } = useToken()

  if (!previews.length) {
    return (
      <Empty
        image={
          <PictureOutlined
            style={{ fontSize: 64, color: token.colorTextDisabled }}
          />
        }
        description="No hay imágenes seleccionadas"
        style={{ padding: 40 }}
      />
    )
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        Imágenes seleccionadas ({previews.length})
      </Text>

      <Row gutter={[12, 12]}>
        {previews.map((src, i) => (
          <Col key={`${src}-${i}`} xs={12} sm={8} md={6} lg={4}>
            <div
              style={{
                position: 'relative',
                borderRadius: 12,
                overflow: 'hidden',
                border: `2px solid ${token.colorBorder}`,
                transition: 'all 0.3s ease',
              }}
              className="image-preview-item"
            >
              <img
                src={src}
                alt={`preview-${i}`}
                style={{
                  width: '100%',
                  height: 120,
                  objectFit: 'cover',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.3s ease',
                }}
                className="image-preview-overlay"
              >
                <Button
                  htmlType="button"
                  type="primary"
                  shape="circle"
                  icon={<EyeOutlined />}
                  size="small"
                  onClick={() => window.open(src, '_blank')}
                  style={{ marginRight: 8 }}
                />
                <Button
                  htmlType="button"
                  danger
                  shape="circle"
                  icon={<DeleteOutlined />}
                  size="small"
                  onClick={() => onRemove(fileList[i])}
                />
              </div>

              {i === 0 && (
                <Tag
                  color="gold"
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    margin: 0,
                  }}
                >
                  Principal
                </Tag>
              )}
            </div>
          </Col>
        ))}

        <Col xs={12} sm={8} md={6} lg={4}>
          <Upload
            showUploadList={false}
            beforeUpload={() => false}
            onChange={onAddMore}
            fileList={fileList}
            multiple
          >
            <div
              style={{
                height: 120,
                border: `2px dashed ${token.colorBorder}`,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}
              className="add-more-images"
            >
              <div style={{ textAlign: 'center' }}>
                <PlusOutlined
                  style={{ fontSize: 24, color: token.colorTextSecondary }}
                />
                <Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block' }}
                >
                  Agregar más
                </Text>
              </div>
            </div>
          </Upload>
        </Col>
      </Row>
    </div>
  )
}

const DynamicProductField = ({ field }) => {
  const rules = field.required
    ? [
        {
          required: true,
          message: `${field.label || field.name} es obligatorio`,
        },
      ]
    : []

  const commonProps = {
    size: 'large',
    placeholder: field.placeholder || `Completar ${field.label || field.name}`,
  }

  if (field.type === 'textarea') {
    return (
      <ProductField
        name={['dynamicFields', field.name]}
        label={field.label || field.name}
        rules={rules}
      >
        <Input.TextArea rows={3} showCount maxLength={800} {...commonProps} />
      </ProductField>
    )
  }

  if (field.type === 'number') {
    return (
      <ProductField
        name={['dynamicFields', field.name]}
        label={field.label || field.name}
        rules={rules}
      >
        <InputNumber
          {...commonProps}
          style={{ width: '100%' }}
          min={0}
          addonAfter={field.unit || undefined}
        />
      </ProductField>
    )
  }

  if (field.type === 'select') {
    return (
      <ProductField
        name={['dynamicFields', field.name]}
        label={field.label || field.name}
        rules={rules}
      >
        <Select
          {...commonProps}
          allowClear
          showSearch
          options={safeArray(field.values).map(value => ({
            value,
            label: value,
          }))}
        />
      </ProductField>
    )
  }

  if (field.type === 'multiselect') {
    return (
      <ProductField
        name={['dynamicFields', field.name]}
        label={field.label || field.name}
        rules={rules}
      >
        <Select
          {...commonProps}
          mode="tags"
          allowClear
          tokenSeparators={[',']}
          options={safeArray(field.values).map(value => ({
            value,
            label: value,
          }))}
        />
      </ProductField>
    )
  }

  if (field.type === 'boolean') {
    return (
      <ProductField
        name={['dynamicFields', field.name]}
        label={field.label || field.name}
        valuePropName="checked"
        rules={rules}
      >
        <Switch checkedChildren="Sí" unCheckedChildren="No" />
      </ProductField>
    )
  }

  if (field.type === 'color') {
    return (
      <ProductField
        name={['dynamicFields', field.name]}
        label={field.label || field.name}
        rules={rules}
      >
        <Select
          {...commonProps}
          mode="tags"
          allowClear
          tokenSeparators={[',']}
          options={safeArray(field.values).map(value => ({
            value,
            label: value,
          }))}
        />
      </ProductField>
    )
  }

  return (
    <ProductField
      name={['dynamicFields', field.name]}
      label={field.label || field.name}
      rules={rules}
    >
      <Input {...commonProps} />
    </ProductField>
  )
}

const VariantImageSelector = ({ variant, localImages, onAssign }) => {
  return (
    <Select
      value={variant.imageSourceUid || undefined}
      placeholder="Seleccionar imagen"
      style={{ width: '100%' }}
      onChange={value => onAssign(variant.key, value || null)}
      allowClear
      options={localImages.map(img => ({
        value: img.uid,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={img.preview}
              alt={img.name}
              style={{
                width: 32,
                height: 32,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid #eee',
              }}
            />
            <span>{img.name}</span>
          </div>
        ),
      }))}
    />
  )
}

const normalizeNamePath = name => (Array.isArray(name) ? name : [name]).filter(Boolean)

const buildNestedFieldPatch = (name, value) => {
  const path = normalizeNamePath(name)

  if (!path.length) return {}

  return path.reduceRight((acc, key, index) => {
    return index === path.length - 1 ? { [key]: value } : { [key]: acc }
  }, value)
}

const setFormFieldValue = (form, name, value) => {
  if (!name || !form) return

  if (typeof form.setFieldValue === 'function') {
    form.setFieldValue(name, value)
    return
  }

  form.setFieldsValue(buildNestedFieldPatch(name, value))
}

const extractInputValue = (eventOrValue, valuePropName = 'value') => {
  if (valuePropName === 'checked') {
    return typeof eventOrValue === 'boolean'
      ? eventOrValue
      : Boolean(eventOrValue?.target?.checked)
  }

  if (eventOrValue?.target) return eventOrValue.target.value

  return eventOrValue
}

const getRequiredMessage = (rules = [], label = 'Este campo') => {
  const requiredRule = safeArray(rules).find(rule => rule?.required)

  return requiredRule?.message || `${label} es obligatorio`
}

const isEmptyFieldValue = value => {
  if (Array.isArray(value)) return value.length === 0
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return normalizeString(value) === ''
  return false
}

const ProductFormDirtyContext = React.createContext(() => {})
const ProductFormMutationContext = React.createContext({
  version: 0,
  notifyMutation: () => {},
})

const ProductField = React.memo(function ProductField({
  children,
  className = '',
  style,
  name,
  label,
  rules = [],
  extra,
  help,
  required,
  initialValue,
  valuePropName = 'value',
}) {
  const form = Form.useFormInstance()
  const markFormDirty = React.useContext(ProductFormDirtyContext)
  const { version: formMutationVersion, notifyMutation } = React.useContext(
    ProductFormMutationContext,
  )
  const [fieldValue, setFieldValue] = useState(() => {
    const currentValue = form.getFieldValue(name)
    return currentValue === undefined ? initialValue : currentValue
  })
  const [fieldError, setFieldError] = useState('')
  const requiredByRule = required || safeArray(rules).some(rule => rule?.required)
  const namePath = normalizeNamePath(name)
  const nameKey = namePath.join('__')
  const fieldId = namePath.join('_')
  const stableClassName = ['stable-form-field', className].filter(Boolean).join(' ')

  useEffect(() => {
    if (initialValue === undefined) return

    const currentValue = form.getFieldValue(name)
    if (currentValue === undefined) {
      setFormFieldValue(form, name, initialValue)
      setFieldValue(initialValue)
      notifyMutation()
    }
  }, [form, initialValue, nameKey, notifyMutation])

  useEffect(() => {
    const currentValue = form.getFieldValue(name)
    setFieldValue(currentValue === undefined ? initialValue : currentValue)
  }, [formMutationVersion, nameKey])

  const validateField = useCallback(
    nextValue => {
      const currentValue = nextValue !== undefined ? nextValue : form.getFieldValue(name)

      if (requiredByRule && isEmptyFieldValue(currentValue)) {
        const messageText = getRequiredMessage(rules, label)
        setFieldError(messageText)
        return false
      }

      setFieldError('')
      return true
    },
    [form, label, name, requiredByRule, rules],
  )

  const child = React.Children.only(children)
  const originalOnChange = child.props.onChange
  const originalOnBlur = child.props.onBlur
  const originalOnFocus = child.props.onFocus
  const controlledProps = {
    id: child.props.id || fieldId,
    [valuePropName]: valuePropName === 'checked' ? Boolean(fieldValue) : fieldValue,
    onChange: (...args) => {
      const nextValue = extractInputValue(args[0], valuePropName)
      setFieldValue(nextValue)
      setFormFieldValue(form, name, nextValue)
      markFormDirty()
      if (fieldError) validateField(nextValue)
      originalOnChange?.(...args)
    },
    onBlur: (...args) => {
      validateField()
      originalOnBlur?.(...args)
    },
    onFocus: (...args) => {
      originalOnFocus?.(...args)
    },
    status: fieldError ? 'error' : child.props.status,
  }

  return (
    <div
      className={stableClassName}
      style={{
        marginBottom: 18,
        minHeight: 86,
        overflowAnchor: 'none',
        ...style,
      }}
      data-field-name={fieldId}
    >
      {label && (
        <label htmlFor={fieldId} className="stable-form-field-label">
          {label}
          {requiredByRule && <span className="stable-form-field-required">*</span>}
        </label>
      )}

      {React.cloneElement(child, controlledProps)}

      <div className="stable-form-field-message" aria-live="polite">
        {fieldError || help || extra || ' '}
      </div>
    </div>
  )
})


export default function AddProduct() {
  const [form] = Form.useForm()
  const dispatch = useDispatch()
  const { token } = useToken()

  const {
    iaResult,
    analyzeImage,
    resetIa,
    loading: loadingIa,
    error: errorIa,
  } = useProductAnalyzer()

  const [hasVariants, setHasVariants] = useState(false)
  const [variants, setVariants] = useState([])
  const [editableTags, setEditableTags] = useState([])
  const [fileList, setFileList] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [inputTagValue, setInputTagValue] = useState('')
  const [inputVisible, setInputVisible] = useState(false)
  const [dynamicAttributes, setDynamicAttributes] = useState([])
  const [selectedAttributes, setSelectedAttributes] = useState({})
  const [newAttributeName, setNewAttributeName] = useState('')
  const [newAttributeType, setNewAttributeType] = useState('select')
  const [quickVariantText, setQuickVariantText] = useState('')
  const [technicalQuickText, setTechnicalQuickText] = useState('')
  const [bulkVariantPrice, setBulkVariantPrice] = useState(null)
  const [bulkVariantStock, setBulkVariantStock] = useState(null)
  const [dynamicProductFields, setDynamicProductFields] = useState([])
  const [useTechnicalSheet, setUseTechnicalSheet] = useState(false)
  const [customFieldName, setCustomFieldName] = useState('')
  const [customFieldType, setCustomFieldType] = useState('text')
  const [customFieldRequired, setCustomFieldRequired] = useState(false)
  const [catalogCategories, setCatalogCategories] = useState([])
  const [catalogTemplate, setCatalogTemplate] = useState(null)
  const [loadingCatalogTemplate, setLoadingCatalogTemplate] = useState(false)
  const [savingCatalogTemplate, setSavingCatalogTemplate] = useState(false)
  const [agentQueue, setAgentQueue] = useState([])
  const [selectedAgentJobId, setSelectedAgentJobId] = useState(null)
  const [loadingAgentQueue, setLoadingAgentQueue] = useState(false)
  const [importingAgentImage, setImportingAgentImage] = useState(false)
  const [deletingAgentImage, setDeletingAgentImage] = useState(false)
  const [autoAgentEnabled, setAutoAgentEnabled] = useState(() =>
    getStoredBoolean('addProduct.agentAutoMode', false),
  )
  const [autoAgentRunning, setAutoAgentRunning] = useState(false)
  const [currentAgentJob, setCurrentAgentJob] = useState(null)
  const [publishProduct, setPublishProduct] = useState(true)
  const [savingProduct, setSavingProduct] = useState(false)
  const [formHasChanges, setFormHasChanges] = useState(false)
  const [committedClassification, setCommittedClassification] = useState({
    categoria: '',
    subcategoria: '',
  })

  const inputRef = useRef(null)
  const autoAgentRef = useRef(false)
  const autoAgentFailedJobsRef = useRef(new Set())
  const imagePreviewsRef = useRef([])
  const lastAnalyzedImageSignatureRef = useRef('')
  const categoryConfigDebounceRef = useRef(null)
  const categoryConfigRequestIdRef = useRef(0)
  const categoryConfigCacheRef = useRef(new Map())

  const markFormAsChanged = useCallback(() => {
    setFormHasChanges(current => (current ? current : true))
  }, [])

  const buildImageSignature = useCallback(file => {
    if (!file) return ''

    return [
      file.name || file.uid || '',
      Number(file.size || 0),
      Number(file.lastModified || 0),
      file.type || file.mimeType || '',
    ].join('|')
  }, [])

  const [formMutationVersion, setFormMutationVersion] = useState(0)

  const notifyFormMutation = useCallback(() => {
    setFormMutationVersion(version => version + 1)
  }, [])

  const setProductFormValues = useCallback(
    values => {
      form.setFieldsValue(values)
      setFormHasChanges(true)
      notifyFormMutation()
    },
    [form, notifyFormMutation],
  )

  const setProductFormFieldValue = useCallback(
    (name, value) => {
      setFormFieldValue(form, name, value)
      setFormHasChanges(true)
      notifyFormMutation()
    },
    [form, notifyFormMutation],
  )

  const user = useSelector(state => state.user.user)
  const tenantId = user?.tenantId?._id || user?.tenantId || null
  const {
    isLoading,
    isError,
    message: productMessage,
  } = useSelector(state => state.product)
  const selectedCategory = Form.useWatch('categoria', form)
  const selectedSubcategory = Form.useWatch('subcategoria', form)
  const watchedTitle = Form.useWatch('titulo', form)
  const watchedDescription = Form.useWatch('descripcion', form)
  const watchedPrice = Form.useWatch('precio', form)
  const watchedStock = Form.useWatch('cantidad', form)
  const watchedBrand = Form.useWatch('marca', form)

  const productReadiness = useMemo(() => {
    const checks = [
      {
        key: 'imagenes',
        label: 'Imagen',
        done: fileList.length > 0,
        required: true,
      },
      {
        key: 'titulo',
        label: 'Título',
        done: Boolean(normalizeString(watchedTitle)),
        required: true,
      },
      {
        key: 'descripcion',
        label: 'Descripción',
        done: Boolean(normalizeString(watchedDescription)),
        required: true,
      },
      {
        key: 'categoria',
        label: 'Categoría',
        done: Boolean(normalizeString(selectedCategory)),
        required: true,
      },
      {
        key: 'subcategoria',
        label: 'Subcategoría',
        done: Boolean(normalizeString(selectedSubcategory)),
        required: true,
      },
      {
        key: 'precio',
        label: 'Precio',
        done: Number(watchedPrice || 0) > 0,
        required: true,
      },
      {
        key: 'stock',
        label: hasVariants ? 'Stock por variantes' : 'Stock',
        done: hasVariants
          ? variants.some(variant => Number(variant.stock || 0) > 0)
          : Number(watchedStock || 0) > 0,
        required: true,
      },
      {
        key: 'marca',
        label: 'Marca',
        done: Boolean(normalizeString(watchedBrand)),
        required: false,
      },
      {
        key: 'ficha',
        label: 'Ficha técnica',
        done: !useTechnicalSheet || dynamicProductFields.length > 0,
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
  }, [
    dynamicProductFields.length,
    fileList.length,
    hasVariants,
    selectedCategory,
    selectedSubcategory,
    useTechnicalSheet,
    variants,
    watchedBrand,
    watchedDescription,
    watchedPrice,
    watchedStock,
    watchedTitle,
  ])

  const categoryOptions = useMemo(
    () =>
      catalogCategories
        .map(category => buildTitleCaseOption(category?.name))
        .filter(Boolean),
    [catalogCategories],
  )

  const subcategoryOptions = useMemo(() => {
    const category = catalogCategories.find(
      item =>
        normalizeString(item.name).toLowerCase() ===
        normalizeString(selectedCategory).toLowerCase(),
    )

    return safeArray(category?.subcategories)
      .map(subcategory => buildTitleCaseOption(subcategory?.name))
      .filter(Boolean)
  }, [catalogCategories, selectedCategory])

  const localImages = useMemo(() => {
    return fileList.map((file, index) => ({
      uid: file.uid,
      name: file.name || `Imagen ${index + 1}`,
      preview: imagePreviews[index] || file.url || '',
    }))
  }, [fileList, imagePreviews])

  const configuredVariantAttributes = useMemo(
    () =>
      dynamicAttributes.filter(
        attribute => safeArray(selectedAttributes[attribute.name]).length > 0,
      ),
    [dynamicAttributes, selectedAttributes],
  )

  const variantCombinationCount = useMemo(() => {
    if (configuredVariantAttributes.length === 0) return 0

    return configuredVariantAttributes.reduce(
      (total, attribute) =>
        total * safeArray(selectedAttributes[attribute.name]).length,
      1,
    )
  }, [configuredVariantAttributes, selectedAttributes])

  const canGenerateVariants =
    variantCombinationCount > 0 &&
    variantCombinationCount <= MAX_GENERATED_VARIANTS

  const agentQueueStats = useMemo(() => {
    return agentQueue.reduce(
      (acc, job) => {
        acc.total += 1
        acc[job.status] = (acc[job.status] || 0) + 1
        if (job.metadata?.autoSaveProduct) acc.autoSave += 1
        return acc
      },
      { total: 0, pending: 0, scheduled: 0, autoSave: 0 },
    )
  }, [agentQueue])

  const selectedAgentJob = useMemo(
    () => agentQueue.find(job => job._id === selectedAgentJobId) || null,
    [agentQueue, selectedAgentJobId],
  )

  const hasUserWorkspace = useMemo(() => {
    return (
      fileList.length > 0 ||
      variants.length > 0 ||
      editableTags.length > 0 ||
      Boolean(currentAgentJob) ||
      formHasChanges
    )
  }, [
    currentAgentJob,
    editableTags.length,
    fileList.length,
    formHasChanges,
    variants.length,
  ])

  const normalizeTitleCaseFormField = useCallback(
    fieldName => {
      const currentValue = form.getFieldValue(fieldName)
      const normalizedValue = toTitleCase(currentValue)

      if (normalizedValue && normalizedValue !== currentValue) {
        setProductFormValues({ [fieldName]: normalizedValue })
      }
    },
    [form],
  )

  const commitClassificationFromForm = useCallback(
    (patch = {}) => {
      const currentCategory =
        patch.categoria !== undefined
          ? patch.categoria
          : form.getFieldValue('categoria')
      const currentSubcategory =
        patch.subcategoria !== undefined
          ? patch.subcategoria
          : form.getFieldValue('subcategoria')

      const categoria = toTitleCase(currentCategory)
      const subcategoria = toTitleCase(currentSubcategory)

      const valuesToPatch = {}
      if (categoria && categoria !== currentCategory)
        valuesToPatch.categoria = categoria
      if (subcategoria && subcategoria !== currentSubcategory) {
        valuesToPatch.subcategoria = subcategoria
      }
      if (Object.keys(valuesToPatch).length) setProductFormValues(valuesToPatch)

      setCommittedClassification(prev => {
        if (prev.categoria === categoria && prev.subcategoria === subcategoria)
          return prev
        return { categoria, subcategoria }
      })
    },
    [form, setProductFormValues],
  )

  useEffect(() => {
    imagePreviewsRef.current = imagePreviews
  }, [imagePreviews])

  useEffect(() => {
    return () => {
      dispatch(resetState())
      revokeBlobUrls(imagePreviewsRef.current)
    }
  }, [dispatch])

  useEffect(() => {
    if (inputVisible) {
      inputRef.current?.focus()
    }
  }, [inputVisible])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        'addProduct.agentAutoMode',
        String(autoAgentEnabled),
      )
    }
  }, [autoAgentEnabled])

  useEffect(() => {
    let mounted = true

    productService
      .getCategories()
      .then(response => {
        if (!mounted) return
        setCatalogCategories(safeArray(response?.data))
      })
      .catch(error => {
        if (mounted) {
          message.warning(
            error?.message || 'No se pudo cargar el catálogo de categorías',
          )
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const category = normalizeString(committedClassification.categoria)
    const subcategory = normalizeString(committedClassification.subcategoria)

    if (categoryConfigDebounceRef.current) {
      clearTimeout(categoryConfigDebounceRef.current)
      categoryConfigDebounceRef.current = null
    }

    if (!category || !subcategory) {
      setCatalogTemplate(null)
      setLoadingCatalogTemplate(false)
      return
    }

    const requestKey = `${slugifyKeyPart(category)}|${slugifyKeyPart(subcategory)}`
    const requestId = ++categoryConfigRequestIdRef.current
    const applyTemplateResponse = response => {
      const template = response?.data?.selectedSubcategory || null
      const templateAttributes = safeArray(
        template?.variantAttributes || response?.data?.variantAttributes,
      )
      const templateProductFields = extractTemplateDynamicFields(response?.data)

      setCatalogTemplate(template)

      if (useTechnicalSheet && templateProductFields.length > 0) {
        setDynamicProductFields(current => {
          const merged = new Map(current.map(field => [field.name, field]))

          templateProductFields.forEach(field => {
            const previous = merged.get(field.name)
            merged.set(field.name, {
              ...previous,
              ...field,
              values: [
                ...new Set([
                  ...safeArray(previous?.values),
                  ...safeArray(field.values),
                ]),
              ],
              required: previous?.required === true || field.required === true,
            })
          })

          return [...merged.values()]
        })
      }

      if (templateAttributes.length === 0) {
        return
      }

      setDynamicAttributes(current => {
        const merged = new Map(
          current.map(attribute => [attribute.name, attribute]),
        )

        templateAttributes.forEach(attribute => {
          const name = normalizeString(attribute.name)
            .toLowerCase()
            .replace(/\s+/g, '_')

          if (!name) return

          const previous = merged.get(name)
          const values = [
            ...new Set([
              ...safeArray(previous?.values),
              ...safeArray(attribute.values),
            ]),
          ]

          merged.set(name, {
            ...previous,
            name,
            label: attribute.label || previous?.label || name,
            type: attribute.type || previous?.type || 'select',
            values,
            required: attribute.required === true,
          })
        })

        return [...merged.values()]
      })
    }

    const cachedResponse = categoryConfigCacheRef.current.get(requestKey)
    if (cachedResponse) {
      setLoadingCatalogTemplate(false)
      applyTemplateResponse(cachedResponse)
      return
    }

    const doLoad = async () => {
      setLoadingCatalogTemplate(true)

      try {
        const response = await productService.getCategoryConfig(
          category,
          subcategory,
        )

        if (requestId !== categoryConfigRequestIdRef.current) return

        categoryConfigCacheRef.current.set(requestKey, response)
        applyTemplateResponse(response)
      } catch (error) {
        if (requestId === categoryConfigRequestIdRef.current) {
          setCatalogTemplate(null)
          message.warning(
            error?.message ||
              'No se pudo cargar la plantilla de la subcategoría',
          )
        }
      } finally {
        if (requestId === categoryConfigRequestIdRef.current) {
          setLoadingCatalogTemplate(false)
        }
      }
    }

    categoryConfigDebounceRef.current = setTimeout(() => {
      doLoad()
    }, 250)

    return () => {
      if (categoryConfigDebounceRef.current) {
        clearTimeout(categoryConfigDebounceRef.current)
        categoryConfigDebounceRef.current = null
      }
      categoryConfigRequestIdRef.current = requestId
    }
  }, [committedClassification, useTechnicalSheet])

  const fetchAgentQueue = useCallback(
    async ({ silent = false, preserveSelection = false } = {}) => {
      if (!silent) setLoadingAgentQueue(true)
      try {
        const { data } = await api.get('/product-analysis', {
          params: {
            limit: 25,
            sort: 'createdAt',
          },
        })

        const items = (Array.isArray(data?.items) ? data.items : []).filter(
          item =>
            ['pending', 'scheduled'].includes(item.status) &&
            item.metadata?.autoAnalyze === false,
        )
        setAgentQueue(items)
        if (!preserveSelection) {
          setSelectedAgentJobId(current =>
            current && items.some(item => item._id === current)
              ? current
              : items[0]?._id || null,
          )
        }
      } catch (error) {
        if (!silent) {
          message.error(
            error?.response?.data?.message ||
              'No se pudo cargar la cola del agente',
          )
        }
      } finally {
        if (!silent) setLoadingAgentQueue(false)
      }
    },
    [],
  )

  useEffect(() => {
    fetchAgentQueue()
  }, [fetchAgentQueue])

  const normalizedAiDraft = useMemo(() => {
    return iaResult && typeof iaResult === 'object'
      ? normalizeAiAnalysisForForm(iaResult)
      : null
  }, [iaResult])

  const mergeDynamicProductFields = useCallback(fields => {
    const incomingFields = safeArray(fields)
    if (!incomingFields.length) return

    setDynamicProductFields(prev => {
      const merged = new Map(prev.map(field => [field.name, field]))

      incomingFields.forEach(field => {
        if (!field?.name) return
        const previous = merged.get(field.name)
        merged.set(field.name, {
          ...previous,
          ...field,
          values: [
            ...new Set([
              ...safeArray(previous?.values),
              ...safeArray(field.values),
            ]),
          ],
          required: previous?.required === true || field.required === true,
        })
      })

      return [...merged.values()].sort(
        (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
      )
    })
  }, [])

  const mergeDynamicFieldValues = useCallback(
    values => {
      const currentValues = form.getFieldValue('dynamicFields') || {}
      setProductFormValues({
        dynamicFields: {
          ...currentValues,
          ...(values || {}),
        },
      })
    },
    [form, setProductFormValues],
  )

  const applyTechnicalPreset = useCallback(
    preset => {
      const fields = safeArray(preset?.fields)
      if (!fields.length) return

      setUseTechnicalSheet(true)
      mergeDynamicProductFields(fields)
      message.success(`${preset.label} aplicado a la ficha técnica`)
    },
    [mergeDynamicProductFields],
  )

  const applyTechnicalQuickFields = useCallback(() => {
    const parsed = parseTechnicalFieldText(technicalQuickText)

    if (!parsed.fields.length) {
      message.warning('Usá el formato: Campo: valor | Campo 2: valor')
      return
    }

    setUseTechnicalSheet(true)
    mergeDynamicProductFields(parsed.fields)
    mergeDynamicFieldValues(parsed.values)
    setTechnicalQuickText('')
    message.success(
      `${parsed.fields.length} campo${parsed.fields.length === 1 ? '' : 's'} técnico${parsed.fields.length === 1 ? '' : 's'} creado${parsed.fields.length === 1 ? '' : 's'}`,
    )
  }, [mergeDynamicFieldValues, mergeDynamicProductFields, technicalQuickText])

  const generateTechnicalDescriptionFromCurrentValues = useCallback(() => {
    const values = form.getFieldsValue(true) || {}
    const title = normalizeString(
      values.titulo || normalizedAiDraft?.fields?.titulo,
    )
    const category = toTitleCase(
      values.categoria || normalizedAiDraft?.fields?.categoria,
    )
    const subcategory = toTitleCase(
      values.subcategoria || normalizedAiDraft?.fields?.subcategoria,
    )
    const brand = normalizeString(
      values.marca || normalizedAiDraft?.fields?.marca,
    )
    const material = normalizeString(
      values.material || normalizedAiDraft?.fields?.material,
    )
    const color = normalizeString(
      values.color || normalizedAiDraft?.fields?.color,
    )
    const currentDynamicValues = values.dynamicFields || {}
    const specificationRows = buildSpecificationRows(
      dynamicProductFields,
      currentDynamicValues,
    )

    if (
      !title &&
      !specificationRows.length &&
      !normalizedAiDraft?.fields?.descripcionTecnica
    ) {
      message.warning(
        'Completá datos del producto o agregá campos técnicos antes de crear la descripción técnica',
      )
      return
    }

    const specsText = specificationRows
      .slice(0, 10)
      .map(
        item =>
          `${item.label}: ${Array.isArray(item.value) ? item.value.join(', ') : item.value}${item.unit ? ` ${item.unit}` : ''}`,
      )
      .join('; ')

    const description =
      normalizeString(values.descripcionTecnica) ||
      normalizeString(normalizedAiDraft?.fields?.descripcionTecnica) ||
      [
        title ? `${title}${brand ? ` de ${brand}` : ''}` : 'Producto',
        category || subcategory
          ? `clasificado en ${[category, subcategory].filter(Boolean).join(' / ')}`
          : '',
        material ? `material principal: ${material}` : '',
        color ? `color o terminación visible: ${color}` : '',
        specsText ? `datos técnicos relevantes: ${specsText}` : '',
        'La información técnica debe considerarse verificable únicamente cuando esté confirmada por la imagen, la marca o la ficha del fabricante.',
      ]
        .filter(Boolean)
        .join('. ')

    setUseTechnicalSheet(true)
    setProductFormValues({ descripcionTecnica: description })
    message.success('Descripción técnica creada para la ficha')
  }, [dynamicProductFields, form, normalizedAiDraft, setProductFormValues])

  const applyAiDynamicField = useCallback(
    field => {
      if (!normalizedAiDraft || !field?.name) return

      setUseTechnicalSheet(true)
      mergeDynamicProductFields([field])
      mergeDynamicFieldValues({
        [field.name]: normalizedAiDraft.dynamicValues?.[field.name],
      })
      message.success(`Campo aplicado: ${field.label || field.name}`)
    },
    [mergeDynamicFieldValues, mergeDynamicProductFields, normalizedAiDraft],
  )

  const applyAiTechnicalFields = useCallback(() => {
    if (!normalizedAiDraft) return

    if (!normalizedAiDraft.dynamicFields.length) {
      message.info(
        'La IA no devolvió campos de ficha técnica para este producto',
      )
      return
    }

    setUseTechnicalSheet(true)
    mergeDynamicProductFields(normalizedAiDraft.dynamicFields)
    mergeDynamicFieldValues(normalizedAiDraft.dynamicValues)
    message.success('Ficha técnica aplicada al formulario')
  }, [mergeDynamicFieldValues, mergeDynamicProductFields, normalizedAiDraft])

  const applyAiTags = useCallback(() => {
    if (!normalizedAiDraft) return

    setEditableTags(prev => [
      ...new Set(
        [...safeArray(prev), ...safeArray(normalizedAiDraft.tags)]
          .map(tag => normalizeString(tag).toLowerCase())
          .filter(Boolean),
      ),
    ])
    message.success('Tags aplicados')
  }, [normalizedAiDraft])

  const applyAiVariants = useCallback(() => {
    if (!normalizedAiDraft?.hasExplicitVariants) {
      message.info('La IA no detectó variantes vendibles explícitas')
      return
    }

    setHasVariants(true)
    setDynamicAttributes(current =>
      mergeVariantAttributeDefinitions(
        current,
        normalizedAiDraft.variantAttributes,
      ),
    )
    setSelectedAttributes(current =>
      mergeSelectedVariantValues(current, normalizedAiDraft.selectedAttributes),
    )
    setVariants(current => {
      const mergedAttributes = mergeVariantAttributeDefinitions(
        dynamicAttributes,
        normalizedAiDraft.variantAttributes,
      )
      const mergedSelected = mergeSelectedVariantValues(
        selectedAttributes,
        normalizedAiDraft.selectedAttributes,
      )

      const generated = generateVariantRowsFromSelection({
        attributes: mergedAttributes,
        selectedAttributes: mergedSelected,
        previousVariants: current.length ? current : normalizedAiDraft.variants,
        basePrice:
          form.getFieldValue('precio') || normalizedAiDraft.fields.precio,
        productTitle:
          form.getFieldValue('titulo') || normalizedAiDraft.fields.titulo,
      })

      return generated.variants.length
        ? generated.variants
        : normalizedAiDraft.variants
    })
    message.success(`${normalizedAiDraft.variants.length} variantes aplicadas`)
  }, [dynamicAttributes, form, normalizedAiDraft, selectedAttributes])

  const applyQuickVariantsFromText = useCallback(() => {
    const parsedAttributes = parseQuickVariantText(quickVariantText)

    if (!parsedAttributes.length) {
      message.warning('Usá el formato: Color: Negro, Blanco | Medida: 1L, 2L')
      return
    }

    const incomingSelected = parsedAttributes.reduce((acc, attribute) => {
      acc[attribute.name] = attribute.values
      return acc
    }, {})

    const mergedAttributes = mergeVariantAttributeDefinitions(
      dynamicAttributes,
      parsedAttributes,
    )
    const mergedSelected = mergeSelectedVariantValues(
      selectedAttributes,
      incomingSelected,
    )

    const generated = generateVariantRowsFromSelection({
      attributes: mergedAttributes,
      selectedAttributes: mergedSelected,
      previousVariants: variants,
      basePrice: form.getFieldValue('precio') || 0,
      productTitle: form.getFieldValue('titulo') || '',
    })

    if (generated.error) {
      message.error(generated.error)
      return
    }

    setHasVariants(true)
    setDynamicAttributes(mergedAttributes)
    setSelectedAttributes(mergedSelected)
    setVariants(generated.variants)
    setQuickVariantText('')

    message.success(
      `${generated.variants.length} variantes generadas rápidamente`,
    )
  }, [dynamicAttributes, form, quickVariantText, selectedAttributes, variants])

  const applyVariantPreset = useCallback(
    preset => {
      const presetAttributes = safeArray(preset?.attributes)

      if (!presetAttributes.length) return

      const incomingSelected = presetAttributes.reduce((acc, attribute) => {
        acc[attribute.name] = safeArray(attribute.values)
        return acc
      }, {})

      const mergedAttributes = mergeVariantAttributeDefinitions(
        dynamicAttributes,
        presetAttributes,
      )
      const mergedSelected = mergeSelectedVariantValues(
        selectedAttributes,
        incomingSelected,
      )

      const generated = generateVariantRowsFromSelection({
        attributes: mergedAttributes,
        selectedAttributes: mergedSelected,
        previousVariants: variants,
        basePrice: form.getFieldValue('precio') || 0,
        productTitle: form.getFieldValue('titulo') || '',
      })

      if (generated.error) {
        message.error(generated.error)
        return
      }

      setHasVariants(true)
      setDynamicAttributes(mergedAttributes)
      setSelectedAttributes(mergedSelected)
      setVariants(generated.variants)
      message.success(
        `${preset.label} aplicado · ${generated.variants.length} variantes listas`,
      )
    },
    [dynamicAttributes, form, selectedAttributes, variants],
  )

  const applyBulkVariantValues = useCallback(() => {
    const shouldUpdatePrice =
      Number.isFinite(Number(bulkVariantPrice)) && Number(bulkVariantPrice) > 0
    const shouldUpdateStock =
      Number.isFinite(Number(bulkVariantStock)) && Number(bulkVariantStock) >= 0

    if (!shouldUpdatePrice && !shouldUpdateStock) {
      message.info('Ingresá precio o stock para aplicar a las variantes')
      return
    }

    setVariants(prev =>
      prev.map(variant => ({
        ...variant,
        price: shouldUpdatePrice ? Number(bulkVariantPrice) : variant.price,
        stock: shouldUpdateStock ? Number(bulkVariantStock) : variant.stock,
      })),
    )

    message.success('Valores aplicados a todas las variantes')
  }, [bulkVariantPrice, bulkVariantStock])

  const generateSeoFromCurrentValues = useCallback(() => {
    const values = form.getFieldsValue(true) || {}
    const aiFields = normalizedAiDraft?.fields || {}
    const baseValues = {
      ...aiFields,
      ...values,
      titulo:
        normalizeString(values.titulo) || normalizeString(aiFields.titulo),
      descripcion:
        normalizeString(values.descripcion) ||
        normalizeString(aiFields.descripcion) ||
        (useTechnicalSheet
          ? normalizeString(values.descripcionTecnica) ||
            normalizeString(aiFields.descripcionTecnica)
          : ''),
      descripcionTecnica: useTechnicalSheet
        ? normalizeString(values.descripcionTecnica) ||
          normalizeString(aiFields.descripcionTecnica)
        : '',
      marca: normalizeString(values.marca) || normalizeString(aiFields.marca),
      categoria: toTitleCase(values.categoria || aiFields.categoria),
      subcategoria: toTitleCase(values.subcategoria || aiFields.subcategoria),
      material:
        normalizeString(values.material) || normalizeString(aiFields.material),
      color: normalizeString(values.color) || normalizeString(aiFields.color),
      tags: editableTags,
    }

    if (!baseValues.titulo && !baseValues.descripcion) {
      message.warning(
        'Completá o aplicá primero el título y la descripción para generar SEO',
      )
      return
    }

    setProductFormValues(buildSeoFormValues(baseValues))
    message.success('SEO generado desde los datos actuales del producto')
  }, [editableTags, form, normalizedAiDraft, setProductFormValues, useTechnicalSheet])

  const generateSeoPositioningFromCurrentValues = useCallback(() => {
    const values = form.getFieldsValue(true) || {}
    const title = normalizeString(
      values.titulo || normalizedAiDraft?.fields?.titulo,
    )
    const category = toTitleCase(
      values.categoria || normalizedAiDraft?.fields?.categoria,
    )
    const subcategory = toTitleCase(
      values.subcategoria || normalizedAiDraft?.fields?.subcategoria,
    )
    const brand = normalizeString(
      values.marca || normalizedAiDraft?.fields?.marca,
    )
    const material = normalizeString(
      values.material || normalizedAiDraft?.fields?.material,
    )
    const color = normalizeString(
      values.color || normalizedAiDraft?.fields?.color,
    )

    if (!title && !subcategory && !category) {
      message.warning(
        'Completá título, categoría o subcategoría para crear posicionamiento SEO',
      )
      return
    }

    const focusKeyword =
      normalizeString(values.seoFocusKeyword) ||
      [brand, title || subcategory || category]
        .filter(Boolean)
        .join(' ')
        .slice(0, 90)

    const audience =
      normalizeString(values.seoTargetAudience) ||
      `Personas que buscan ${subcategory || category || title} con información clara antes de comprar.`

    const contentAngle =
      normalizeString(values.seoContentAngle) ||
      `Destacar características visibles, uso recomendado, calidad percibida y datos verificables sin prometer información no confirmada.`

    const positioning =
      normalizeString(values.seoPositioning) ||
      `${title || subcategory || category} se posiciona para búsquedas de intención comercial relacionadas con ${focusKeyword}. El contenido debe resolver dudas de compra, diferenciar el producto por sus atributos visibles y reforzar confianza con descripción clara, ficha técnica opcional, imágenes y datos de disponibilidad.`

    const faq = safeArray(values.seoFaq).length
      ? values.seoFaq
      : [
          `¿Qué características tiene ${title || 'este producto'}?`,
          `¿Para qué tipo de uso se recomienda ${title || 'este producto'}?`,
          `¿Qué debo revisar antes de comprar ${title || 'este producto'}?`,
        ]

    const contentPillars = [
      focusKeyword,
      subcategory,
      category,
      brand,
      material,
      color,
    ]
      .map(item => normalizeString(item).toLowerCase())
      .filter(Boolean)

    setProductFormValues({
      ...buildSeoFormValues({
        ...values,
        titulo: title,
        categoria: category,
        subcategoria: subcategory,
        marca: brand,
        material,
        color,
        tags: editableTags,
        seoFocusKeyword: focusKeyword,
        seoSearchIntent: values.seoSearchIntent || 'commercial',
        seoPositioning: positioning,
        seoTargetAudience: audience,
        seoContentAngle: contentAngle,
        seoFaq: faq,
        seoContentPillars: contentPillars,
      }),
    })

    message.success('Posicionamiento SEO creado')
  }, [editableTags, form, normalizedAiDraft, setProductFormValues])

  const applyAiSeo = useCallback(() => {
    generateSeoFromCurrentValues()
  }, [generateSeoFromCurrentValues])

  const applyAiField = useCallback(
    fieldName => {
      if (!normalizedAiDraft) return

      const { fields } = normalizedAiDraft

      const seoFromAi = buildSeoFormValues({
        ...fields,
        tags: normalizedAiDraft.tags,
      })

      const patches = {
        titulo: { titulo: fields.titulo },
        descripcion: { descripcion: fields.descripcion },
        descripcionTecnica: { descripcionTecnica: fields.descripcionTecnica },
        categoria: { categoria: toTitleCase(fields.categoria) },
        subcategoria: { subcategoria: toTitleCase(fields.subcategoria) },
        classification: {
          categoria: toTitleCase(fields.categoria),
          subcategoria: toTitleCase(fields.subcategoria),
        },
        marca: { marca: fields.marca },
        precio: { precio: fields.precio },
        cantidad: { cantidad: fields.cantidad },
        condicion: { condicion: fields.condicion },
        material: { material: fields.material },
        color: { color: fields.color },
        slug: { slug: fields.slug || seoFromAi.slug },
        shortDescription: {
          shortDescription:
            fields.shortDescription || seoFromAi.shortDescription,
        },
        metaTitle: { metaTitle: fields.metaTitle || seoFromAi.metaTitle },
        metaDescription: {
          metaDescription: fields.metaDescription || seoFromAi.metaDescription,
        },
        seoKeywords: {
          seoKeywords: fields.seoKeywords?.length
            ? fields.seoKeywords
            : seoFromAi.seoKeywords,
        },
        weightKg: { weightKg: fields.weightKg },
        shippingType: { shippingType: fields.shippingType },
        warranty: { warranty: fields.warranty },
        countryOfOrigin: { countryOfOrigin: fields.countryOfOrigin },
        packageLengthCm: { packageLengthCm: fields.packageLengthCm },
        packageWidthCm: { packageWidthCm: fields.packageWidthCm },
        packageHeightCm: { packageHeightCm: fields.packageHeightCm },
        logistics: {
          weightKg: fields.weightKg,
          shippingType: fields.shippingType,
          warranty: fields.warranty,
          countryOfOrigin: fields.countryOfOrigin,
          packageLengthCm: fields.packageLengthCm,
          packageWidthCm: fields.packageWidthCm,
          packageHeightCm: fields.packageHeightCm,
        },
      }

      const patch = patches[fieldName] || {}
      const cleanPatch = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => {
          return value !== undefined && value !== null && value !== ''
        }),
      )

      if (!Object.keys(cleanPatch).length) {
        message.info('Ese dato no está disponible en el análisis IA')
        return
      }

      if (fieldName === 'descripcionTecnica') {
        setUseTechnicalSheet(true)
      }

      setProductFormValues(cleanPatch)

      if (cleanPatch.categoria || cleanPatch.subcategoria) {
        commitClassificationFromForm(cleanPatch)
      }

      message.success('Campo aplicado al formulario')
    },
    [
      commitClassificationFromForm,
      form,
      normalizedAiDraft,
      setProductFormValues,
    ],
  )

  const applyAiSafeFields = useCallback(() => {
    if (!normalizedAiDraft) return

    const { fields, review } = normalizedAiDraft
    const patch = {
      titulo: fields.titulo,
      descripcion: fields.descripcion,
      descripcionTecnica: useTechnicalSheet
        ? fields.descripcionTecnica
        : undefined,
      categoria: fields.categoria,
      subcategoria: fields.subcategoria,
      marca: fields.marca,
      color: fields.color,
      material:
        Number(review.materialConfidence || 0) >= 0.45
          ? fields.material
          : undefined,
      precio:
        Number(review.priceConfidence || 0) >= 0.55 ? fields.precio : undefined,
      cantidad: fields.cantidad,
      condicion: fields.condicion,
    }

    setProductFormValues(
      Object.fromEntries(
        Object.entries(patch).filter(
          ([, value]) => value !== undefined && value !== null && value !== '',
        ),
      ),
    )

    if (useTechnicalSheet) {
      applyAiTechnicalFields()
    }

    applyAiTags()
    generateSeoFromCurrentValues()
    message.success('Campos seguros aplicados')
  }, [
    applyAiTags,
    applyAiTechnicalFields,
    form,
    generateSeoFromCurrentValues,
    setProductFormValues,
    normalizedAiDraft,
    useTechnicalSheet,
  ])

  const applyAiAll = useCallback(() => {
    if (!normalizedAiDraft) return

    const { fields } = normalizedAiDraft
    setProductFormValues({
      titulo: fields.titulo,
      descripcion: fields.descripcion,
      descripcionTecnica: useTechnicalSheet
        ? fields.descripcionTecnica
        : undefined,
      categoria: fields.categoria,
      subcategoria: fields.subcategoria,
      marca: fields.marca,
      precio: fields.precio,
      cantidad: fields.cantidad,
      condicion: fields.condicion,
      color: fields.color,
      material: fields.material,
      weightKg: fields.weightKg,
      shippingType: fields.shippingType,
      warranty: fields.warranty,
      countryOfOrigin: fields.countryOfOrigin,
      packageLengthCm: fields.packageLengthCm,
      packageWidthCm: fields.packageWidthCm,
      packageHeightCm: fields.packageHeightCm,
    })

    if (useTechnicalSheet) {
      applyAiTechnicalFields()
    }

    applyAiTags()
    if (normalizedAiDraft.hasExplicitVariants) applyAiVariants()
    window.setTimeout(generateSeoFromCurrentValues, 0)
    message.success(
      useTechnicalSheet
        ? 'Análisis IA aplicado al producto'
        : 'Análisis IA aplicado sin generar ficha técnica',
    )
  }, [
    applyAiTags,
    applyAiTechnicalFields,
    applyAiVariants,
    form,
    generateSeoFromCurrentValues,
    setProductFormValues,
    normalizedAiDraft,
    useTechnicalSheet,
  ])

  const handleAddCustomAttribute = useCallback(() => {
    const label = normalizeString(newAttributeName)
    const normalizedName = slugifyKeyPart(label).replace(/-/g, '_')

    if (!normalizedName) {
      message.warning('Escribí el nombre del atributo')
      return
    }

    setDynamicAttributes(prev => {
      if (prev.some(attr => attr.name === normalizedName)) {
        message.warning('Ese atributo ya existe')
        return prev
      }

      return [
        ...prev,
        {
          name: normalizedName,
          label,
          type: newAttributeType,
          values: [],
        },
      ]
    })
    setNewAttributeName('')
    setNewAttributeType('select')
  }, [newAttributeName, newAttributeType])

  const handleAddDynamicProductField = useCallback(() => {
    const label = normalizeString(customFieldName)
    const name = slugifyKeyPart(label).replace(/-/g, '_')

    if (!name) {
      message.warning('Escribí el nombre del campo')
      return
    }

    setUseTechnicalSheet(true)

    setDynamicProductFields(prev => {
      if (prev.some(field => field.name === name)) {
        message.warning('Ese campo dinámico ya existe')
        return prev
      }

      return [
        ...prev,
        {
          name,
          label,
          type: customFieldType,
          values: [],
          required: customFieldRequired,
          sortOrder: prev.length,
          source: 'custom',
        },
      ]
    })

    setCustomFieldName('')
    setCustomFieldType('text')
    setCustomFieldRequired(false)
  }, [customFieldName, customFieldRequired, customFieldType])

  const handleRemoveDynamicProductField = useCallback(
    fieldName => {
      setDynamicProductFields(prev =>
        prev.filter(field => field.name !== fieldName),
      )
      const currentValues = form.getFieldValue('dynamicFields') || {}
      const nextValues = { ...currentValues }
      delete nextValues[fieldName]
      setProductFormValues({ dynamicFields: nextValues })
    },
    [form, setProductFormValues],
  )

  const handleAttributeValuesChange = useCallback((attrName, values) => {
    const normalizedValues = [
      ...new Set(
        safeArray(values)
          .map(value => normalizeString(value))
          .filter(Boolean),
      ),
    ]

    setSelectedAttributes(prev => ({
      ...prev,
      [attrName]: normalizedValues,
    }))

    setDynamicAttributes(prev =>
      prev.map(attribute =>
        attribute.name === attrName
          ? {
              ...attribute,
              values: [
                ...new Set([
                  ...safeArray(attribute.values),
                  ...normalizedValues,
                ]),
              ],
            }
          : attribute,
      ),
    )
  }, [])

  const handleRemoveVariantAttribute = useCallback(attrName => {
    setDynamicAttributes(prev =>
      prev.filter(attribute => attribute.name !== attrName),
    )
    setSelectedAttributes(prev => {
      const next = { ...prev }
      delete next[attrName]
      return next
    })
    setVariants([])
  }, [])

  const handleSaveCatalogTemplate = useCallback(async () => {
    const category = toTitleCase(form.getFieldValue('categoria'))
    const subcategory = toTitleCase(form.getFieldValue('subcategoria'))

    if (!category || !subcategory) {
      message.warning(
        'Completá categoría y subcategoría antes de guardar la plantilla',
      )
      return
    }

    if (dynamicAttributes.length === 0) {
      message.warning('Agregá al menos un atributo de variante')
      return
    }

    setSavingCatalogTemplate(true)

    try {
      const response = await productService.saveCategoryConfig({
        category,
        subcategory,
        variantAttributes: dynamicAttributes.map((attribute, index) => ({
          name: attribute.name,
          label: attribute.label,
          type: attribute.type || 'select',
          values: [
            ...new Set([
              ...safeArray(attribute.values),
              ...safeArray(selectedAttributes[attribute.name]),
            ]),
          ],
          required: attribute.required === true,
          sortOrder: index,
        })),
      })

      const savedCategory = response?.data
      const savedSubcategory = safeArray(savedCategory?.subcategories).find(
        item =>
          normalizeString(item.name).toLowerCase() ===
          subcategory.toLowerCase(),
      )

      setCatalogTemplate(savedSubcategory || { name: subcategory })
      message.success(`Plantilla de "${subcategory}" guardada`)

      const categoriesResponse = await productService.getCategories()
      setCatalogCategories(safeArray(categoriesResponse?.data))
    } catch (error) {
      message.error(error?.message || 'No se pudo guardar la plantilla')
    } finally {
      setSavingCatalogTemplate(false)
    }
  }, [dynamicAttributes, form, selectedAttributes])

  const generateVariantsFromAttributes = useCallback(() => {
    const generated = generateVariantRowsFromSelection({
      attributes: dynamicAttributes,
      selectedAttributes,
      previousVariants: variants,
      basePrice: form.getFieldValue('precio') || 0,
      productTitle: form.getFieldValue('titulo') || '',
    })

    if (generated.error) {
      message.error(generated.error)
      return
    }

    setVariants(generated.variants)

    const createdCount = generated.variants.filter(
      variant => variant.uiStatus === 'new',
    ).length

    message.success(
      createdCount
        ? `${generated.variants.length} variantes listas · ${createdCount} nuevas`
        : `${generated.variants.length} variantes actualizadas`,
    )
  }, [dynamicAttributes, form, selectedAttributes, variants])

  const handleUploadChange = useCallback(
    async ({ fileList: newFileList }) => {
      const validationError = validateSelectedFiles(newFileList)
      if (validationError) {
        message.error(validationError)
        return
      }

      const uniqueFiles = sanitizeUploadFiles(newFileList)

      revokeBlobUrls(imagePreviews)
      setFileList(uniqueFiles)
      setImagePreviews(rebuildPreviews(uniqueFiles))

      if (safeArray(newFileList).length > MAX_PRODUCT_IMAGES) {
        message.warning(
          `Solo se conservaron las primeras ${MAX_PRODUCT_IMAGES} imágenes.`,
        )
      }

      if (uniqueFiles.length > 0 && !iaResult && !loadingIa) {
        const fileToAnalyze = uniqueFiles[0]?.originFileObj || uniqueFiles[0]

        if (fileToAnalyze) {
          const signature = buildImageSignature(fileToAnalyze)
          const shouldAnalyze =
            signature && signature !== lastAnalyzedImageSignatureRef.current

          if (shouldAnalyze) {
            lastAnalyzedImageSignatureRef.current = signature

            const analysis = await analyzeImage(fileToAnalyze)

            if (!analysis) {
              lastAnalyzedImageSignatureRef.current = ''
            }
          }
        }
      }
    },
    [analyzeImage, buildImageSignature, iaResult, imagePreviews, loadingIa],
  )

  const handleReanalyzeImage = useCallback(async () => {
    const uploadFile = safeArray(fileList).find(file =>
      Boolean(file?.originFileObj),
    )
    const imageFile = uploadFile?.originFileObj

    if (!imageFile) {
      message.warning(
        'Para reanalizar necesitás tener una imagen cargada localmente en el formulario.',
      )
      return
    }

    try {
      resetIa()
      lastAnalyzedImageSignatureRef.current = ''
      await analyzeImage(imageFile)
      message.success('Imagen reanalizada con IA')
    } catch (error) {
      message.error(error?.message || 'No se pudo reanalizar la imagen')
    }
  }, [analyzeImage, fileList, resetIa])

  const resetProductWorkspace = useCallback(() => {
    form.resetFields()
    notifyFormMutation()
    revokeBlobUrls(imagePreviews)
    setFileList([])
    setImagePreviews([])
    setEditableTags([])
    setVariants([])
    setHasVariants(false)
    setDynamicAttributes([])
    setDynamicProductFields([])
    setUseTechnicalSheet(false)
    setQuickVariantText('')
    setTechnicalQuickText('')
    setSelectedAttributes({})
    setInputTagValue('')
    setInputVisible(false)
    setCurrentAgentJob(null)
    setPublishProduct(true)
    setFormHasChanges(false)
    lastAnalyzedImageSignatureRef.current = ''
    resetIa()
    dispatch(resetState())
  }, [dispatch, form, imagePreviews, notifyFormMutation, resetIa])

  const handleImportAgentImage = useCallback(async () => {
    if (!selectedAgentJobId) {
      message.warning('No hay imágenes pendientes del agente')
      return
    }

    const selectedJob = selectedAgentJob

    if (selectedJob?.status === 'scheduled') {
      message.warning(
        'La imagen todavía está programada. Va a estar disponible en el horario indicado.',
      )
      return
    }

    if (hasUserWorkspace) {
      message.warning(
        'Hay un producto en edición. Guardalo, descartalo o limpiá el formulario antes de cargar otra imagen.',
      )
      return
    }

    setImportingAgentImage(true)
    try {
      await api.post(
        `/product-analysis/${selectedAgentJobId}/import-to-add-product`,
      )

      resetProductWorkspace()
      await waitForUiReset()

      const response = await api.get(
        `/product-analysis/${selectedAgentJobId}/image-file`,
        {
          responseType: 'blob',
        },
      )

      const blob = response.data
      const filename =
        selectedJob?.originalFilename || `agent-image-${Date.now()}.jpg`
      const mimeType =
        blob?.type || selectedJob?.metadata?.mimeType || 'image/jpeg'
      const imageFile = new File([blob], filename, { type: mimeType })
      const uploadFile = {
        uid: `agent-${selectedAgentJobId}-${Date.now()}`,
        name: filename,
        status: 'done',
        originFileObj: imageFile,
        type: mimeType,
        size: imageFile.size,
      }

      const merged = dedupeByUid([uploadFile])
      setFileList(merged)
      setImagePreviews(rebuildPreviews(merged))

      setCurrentAgentJob(selectedJob)

      setAgentQueue(current =>
        current.filter(job => job._id !== selectedAgentJobId),
      )
      setSelectedAgentJobId(null)

      await analyzeImage(imageFile)

      message.success('Imagen del agente cargada en AddProduct')
    } catch (error) {
      message.error(
        error?.response?.data?.message ||
          'No se pudo importar la imagen del agente',
      )
    } finally {
      setImportingAgentImage(false)
    }
  }, [
    agentQueue,
    analyzeImage,
    hasUserWorkspace,
    resetProductWorkspace,
    selectedAgentJobId,
    selectedAgentJob,
  ])

  const handleDeleteAgentImage = useCallback(async () => {
    if (!selectedAgentJobId) return

    const previousQueue = agentQueue
    setAgentQueue(current =>
      current.filter(job => job._id !== selectedAgentJobId),
    )
    setSelectedAgentJobId(null)
    setDeletingAgentImage(true)

    try {
      await api.delete(`/product-analysis/${selectedAgentJobId}`)
      message.success('Imagen y análisis eliminados permanentemente')
    } catch (error) {
      setAgentQueue(previousQueue)
      setSelectedAgentJobId(selectedAgentJobId)
      message.error(
        error?.response?.data?.message || 'No se pudo eliminar la imagen',
      )
    } finally {
      setDeletingAgentImage(false)
    }
  }, [agentQueue, selectedAgentJobId])

  const processAgentJobAutomatically = useCallback(
    async job => {
      await api.post(`/product-analysis/${job._id}/import-to-add-product`)

      resetProductWorkspace()
      await waitForUiReset()

      const response = await api.get(
        `/product-analysis/${job._id}/image-file`,
        {
          responseType: 'blob',
        },
      )

      const blob = response.data
      const filename = job.originalFilename || `agent-image-${Date.now()}.jpg`
      const mimeType = blob?.type || job.metadata?.mimeType || 'image/jpeg'
      const imageFile = new File([blob], filename, { type: mimeType })
      const analysis = await analyzeImage(imageFile)

      if (!analysis) {
        throw new Error('La IA no devolvió análisis para la imagen')
      }

      const productPayload = buildProductPayloadFromAnalysis({
        analysis,
        job,
        user,
        publish: getJobFlag(job, 'autoPublishProduct'),
        automationMode: 'agent-autosave',
        includeTechnicalSheet: shouldIncludeTechnicalSheetFromJob(job),
      })

      const created = await dispatch(createProducts(productPayload)).unwrap()
      const createdPayload = created?.data || created
      const productId = createdPayload?._id

      if (!productId) {
        throw new Error('No se pudo obtener el ID del producto creado')
      }

      await dispatch(
        uploadProductImage({
          productId,
          imageFile,
        }),
      ).unwrap()

      await api.post(`/product-analysis/${job._id}/complete-add-product`, {
        productId,
      })

      return productId
    },
    [analyzeImage, dispatch, resetProductWorkspace, user],
  )

  const processAutoAgentQueue = useCallback(async () => {
    if (!autoAgentEnabled || autoAgentRef.current || hasUserWorkspace) return

    const jobsToProcess = agentQueue.filter(
      job =>
        job.status === 'pending' &&
        job.metadata?.autoSaveProduct === true &&
        !autoAgentFailedJobsRef.current.has(job._id),
    )

    if (!jobsToProcess.length) return

    autoAgentRef.current = true
    setAutoAgentRunning(true)

    try {
      for (const job of jobsToProcess) {
        try {
          await processAgentJobAutomatically(job)
          setAgentQueue(current => current.filter(item => item._id !== job._id))
          message.success(
            `Producto creado automáticamente: ${job.originalFilename || job._id}`,
          )
        } catch (error) {
          autoAgentFailedJobsRef.current.add(job._id)
          message.error(
            error?.response?.data?.message ||
              error?.message ||
              `No se pudo guardar automáticamente ${job.originalFilename || job._id}`,
          )
        } finally {
          resetProductWorkspace()
          await waitForUiReset()
        }
      }

      await fetchAgentQueue()
    } finally {
      autoAgentRef.current = false
      setAutoAgentRunning(false)
    }
  }, [
    agentQueue,
    autoAgentEnabled,
    fetchAgentQueue,
    hasUserWorkspace,
    processAgentJobAutomatically,
    resetProductWorkspace,
  ])

  useEffect(() => {
    processAutoAgentQueue()
  }, [processAutoAgentQueue])

  const handleAddMoreImages = useCallback(
    ({ fileList: incomingFiles }) => {
      const validationError = validateSelectedFiles(incomingFiles)
      if (validationError) {
        message.error(validationError)
        return
      }

      setFileList(prevList => {
        const merged = sanitizeUploadFiles([...prevList, ...incomingFiles])
        revokeBlobUrls(imagePreviews)
        setImagePreviews(rebuildPreviews(merged))

        if (
          prevList.length + safeArray(incomingFiles).length >
          MAX_PRODUCT_IMAGES
        ) {
          message.warning(`Máximo ${MAX_PRODUCT_IMAGES} imágenes por producto.`)
        }

        return merged
      })
    },
    [imagePreviews],
  )

  const handleRemove = useCallback(
    file => {
      const updated = fileList.filter(item => item.uid !== file.uid)

      revokeBlobUrls(imagePreviews)
      setFileList(updated)
      setImagePreviews(rebuildPreviews(updated))

      setVariants(prev =>
        prev.map(variant =>
          variant.imageSourceUid === file.uid
            ? { ...variant, imageSourceUid: null }
            : variant,
        ),
      )

      if (!updated.length) {
        resetIa()
        setDynamicAttributes([])
        setSelectedAttributes({})
        setVariants([])
      }
    },
    [fileList, imagePreviews, resetIa],
  )

  const handleCloseTag = useCallback(removedTag => {
    setEditableTags(prev => prev.filter(tag => tag !== removedTag))
  }, [])

  const handleInputConfirm = useCallback(() => {
    const value = normalizeString(inputTagValue)
    if (value && !editableTags.includes(value)) {
      setEditableTags(prev => [...prev, value])
    }
    setInputVisible(false)
    setInputTagValue('')
  }, [editableTags, inputTagValue])

  const handleAssignVariantImage = useCallback((variantKey, imageSourceUid) => {
    setVariants(prev =>
      prev.map(variant =>
        variant.key === variantKey
          ? { ...variant, imageSourceUid: imageSourceUid || null }
          : variant,
      ),
    )
  }, [])

  const handleFinish = async submittedValues => {
    const values = {
      ...(form.getFieldsValue(true) || {}),
      ...(submittedValues || {}),
    }
    if (!fileList.length) {
      message.error('Debes subir al menos una imagen')
      return
    }

    const fileValidationError = validateSelectedFiles(fileList)
    if (fileValidationError) {
      message.error(fileValidationError)
      return
    }

    if (!tenantId) {
      message.error('Tenant no disponible')
      return
    }

    const basicsError = validateProductBasicsForSubmit({ values, hasVariants })
    if (basicsError) {
      message.error(basicsError)
      return
    }

    if (hasVariants) {
      const variantError = validateVariantsForSubmit(variants)

      if (variantError) {
        message.error(variantError)
        return
      }
    }

    setSavingProduct(true)

    try {
      const colorArray = normalizeString(values.color)
        ? values.color
            .split(',')
            .map(color => color.trim().toLowerCase())
            .filter(Boolean)
        : []

      const variantAttributesConfig = hasVariants
        ? getVariantAttributesConfig(dynamicAttributes, selectedAttributes)
        : []
      const dynamicFieldValues = useTechnicalSheet
        ? normalizeDynamicFieldValues(
            dynamicProductFields,
            values.dynamicFields || {},
          )
        : {}

      const specificationRows = useTechnicalSheet
        ? buildSpecificationRows(dynamicProductFields, dynamicFieldValues)
        : []

      const filterAttributes = useTechnicalSheet
        ? buildFilterAttributesFromSpecifications(specificationRows)
        : []
      const seoPayload = buildSeoPayload(values)
      const logisticsPayload = buildLogisticsPayload(values)

      const payloadVariants = hasVariants
        ? variants.map((variant, idx) => {
            const combination = variant.combinacion || {}
            const key = buildVariantKey(combination) || `variant-${idx + 1}`
            const sku =
              normalizeSku(variant.sku) ||
              buildGeneratedVariantSku(values.titulo, combination, idx)

            return {
              key,
              nombre: buildVariantName(combination) || `Variante ${idx + 1}`,
              sku,
              attributes: combination,
              combinacion: combination,
              price: normalizeNumberValue(variant.price),
              stock: normalizeNumberValue(variant.stock),
              isActive: variant.isActive !== false,
            }
          })
        : []

      const normalizedIaResult =
        iaResult && typeof iaResult === 'object'
          ? {
              ...iaResult,
              appliedAt: new Date().toISOString(),
              appliedBy: user?._id || user?.id || null,
              sourceContext: 'admin-add-product',
            }
          : null

      const productPayload = {
        title: normalizeString(values.titulo),
        description: normalizeString(values.descripcion),
        technicalDescription: useTechnicalSheet
          ? normalizeString(values.descripcionTecnica)
          : undefined,
        descripcionTecnica: useTechnicalSheet
          ? normalizeString(values.descripcionTecnica)
          : undefined,
        categoria: toTitleCase(values.categoria),
        subcategoria: toTitleCase(values.subcategoria),
        marca: normalizeString(values.marca),
        price: Number(values.precio || 0),
        stock: hasVariants
          ? getVariantStockTotal(variants)
          : normalizeNumberValue(values.cantidad || 0),
        condicion: values.condicion,

        color: colorArray,
        material: normalizeString(values.material),

        atributos: {
          ...dynamicFieldValues,
          color: colorArray.length === 1 ? colorArray[0] : colorArray,
          material: normalizeString(values.material),
        },
        productAttributes: dynamicFieldValues,
        categoryAttributes: dynamicFieldValues,
        specifications: specificationRows,
        filterAttributes,
        dynamicFields: dynamicFieldValues,

        hasVariants,
        variantAttributes: variantAttributesConfig,
        variants: payloadVariants,
        tags: editableTags.map(tag => tag.toLowerCase().trim()),

        slug: seoPayload.slug,
        shortDescription: seoPayload.shortDescription,
        metaTitle: seoPayload.metaTitle,
        metaDescription: seoPayload.metaDescription,
        keywords: seoPayload.keywords,
        seoFocusKeyword: seoPayload.focusKeyword,
        seoSearchIntent: seoPayload.searchIntent,
        seoPositioning: seoPayload.positioning,
        seoTargetAudience: seoPayload.targetAudience,
        seoContentAngle: seoPayload.contentAngle,
        seoFaq: seoPayload.faq,
        seoContentPillars: seoPayload.contentPillars,
        seo: seoPayload,

        weightKg: logisticsPayload.weightKg,
        dimensions: logisticsPayload.dimensions,
        package: logisticsPayload.package,
        shipping: logisticsPayload.shipping,
        warranty: logisticsPayload.warranty,
        countryOfOrigin: logisticsPayload.countryOfOrigin,
        logistics: logisticsPayload,

        iaGenerated: Boolean(normalizedIaResult),
        aiOriginalOutput: normalizedIaResult
          ? JSON.stringify(normalizedIaResult)
          : null,
        aiConfidence: normalizedIaResult?.confidence ?? null,
        aiSource: normalizedIaResult?.source || 'gemini',
        aiImageHash: normalizedIaResult?.hash || null,
        aiNeedsReview:
          normalizedIaResult?.needsReview === true ||
          normalizedIaResult?.requiresHumanReview === true ||
          false,
        aiAgentJobId: currentAgentJob?._id || null,
        aiAgentScheduledAt:
          currentAgentJob?.scheduledAt ||
          currentAgentJob?.metadata?.addProductAt ||
          null,
        aiAutomationMode: currentAgentJob ? 'agent-assisted' : 'manual',

        status: publishProduct ? 'active' : 'draft',
        visibility: publishProduct ? 'visible' : 'hidden',
      }

      const payloadForCreate = enforceTechnicalSheetPersistence(
        productPayload,
        useTechnicalSheet,
      )
      const created = await dispatch(createProducts(payloadForCreate)).unwrap()
      const createdPayload = created?.data || created
      const productId = createdPayload?._id

      if (!productId) {
        throw new Error('No se pudo obtener el ID del producto creado')
      }

      const uploadedByUid = new Map()

      for (const file of fileList) {
        if (!file?.originFileObj) continue

        const uploadResult = await dispatch(
          uploadProductImage({
            productId,
            imageFile: file.originFileObj,
          }),
        ).unwrap()

        const imagesArray = Array.isArray(uploadResult?.data)
          ? uploadResult.data
          : Array.isArray(uploadResult)
            ? uploadResult
            : []

        const uploadedImage = imagesArray[imagesArray.length - 1]

        if (uploadedImage?.url) {
          uploadedByUid.set(file.uid, uploadedImage)
        }
      }

      if (hasVariants && variants.length > 0) {
        const createdVariants = safeArray(createdPayload?.variants)

        for (const localVariant of variants) {
          if (!localVariant.imageSourceUid) continue

          const selectedUploadedImage = uploadedByUid.get(
            localVariant.imageSourceUid,
          )
          if (!selectedUploadedImage?.url) continue

          const createdVariant = createdVariants.find(
            variant =>
              variant.key === localVariant.key ||
              buildVariantKey(variant.attributes || {}) === localVariant.key,
          )

          if (!createdVariant?._id) continue

          await dispatch(
            assignVariantImage({
              productId,
              variantId: createdVariant._id,
              image: {
                public_id: selectedUploadedImage.public_id,
                url: selectedUploadedImage.url,
              },
            }),
          ).unwrap()
        }
      }

      if (currentAgentJob?._id) {
        await api.post(
          `/product-analysis/${currentAgentJob._id}/complete-add-product`,
          {
            productId,
          },
        )
      }

      message.success(
        hasVariants
          ? `Producto creado correctamente con ${variants.length} variantes`
          : 'Producto creado correctamente',
      )

      resetProductWorkspace()
      await waitForUiReset()
      await fetchAgentQueue()
    } catch (error) {
      message.error(error?.message || 'Error al crear producto')
    } finally {
      setSavingProduct(false)
    }
  }

  return (
    <div
      className="add-product-stable-page"
      style={{
        minHeight: '100vh',
        overflowAnchor: 'none',
        overflowX: 'hidden',
        background: token.colorBgLayout,
        padding: '24px',
      }}
    >
      <Row justify="center">
        <Col
          xs={24}
          md={22}
          lg={20}
          xl={18}
          xxl={14}
          style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}
        >
          <div
            style={{
              marginBottom: 28,
              padding: '28px 28px 24px',
              borderRadius: 24,
              background: `linear-gradient(135deg, ${token.colorPrimary}14 0%, ${token.colorBgContainer} 52%, ${token.colorInfoBg || token.colorPrimaryBg} 100%)`,
              border: `1px solid ${token.colorBorderSecondary}`,
              boxShadow: '0 18px 45px rgba(15, 23, 42, 0.06)',
            }}
          >
            <Row gutter={[24, 20]} align="middle" justify="space-between">
              <Col xs={24} lg={15}>
                <Space direction="vertical" size={8}>
                  <Space wrap size={10}>
                    <Tag
                      color="processing"
                      style={{ borderRadius: 999, padding: '3px 12px' }}
                    >
                      AddProduct IA
                    </Tag>
                    <Tag
                      color="success"
                      style={{ borderRadius: 999, padding: '3px 12px' }}
                    >
                      Multi-tenant
                    </Tag>
                    {hasVariants && (
                      <Tag
                        color="blue"
                        style={{ borderRadius: 999, padding: '3px 12px' }}
                      >
                        {variants.length} variantes
                      </Tag>
                    )}
                  </Space>

                  <Title
                    level={2}
                    style={{ margin: 0, letterSpacing: '-0.04em' }}
                  >
                    <ThunderboltOutlined
                      style={{ color: token.colorPrimary, marginRight: 12 }}
                    />
                    Crear producto con IA guiada
                  </Title>

                  <Text type="secondary" style={{ fontSize: 15 }}>
                    Subí imágenes, revisá la propuesta de IA, completá ficha
                    técnica, variantes, logística y publicá con control total.
                  </Text>
                </Space>
              </Col>

              <Col xs={24} lg={9}>
                <Row gutter={[12, 12]}>
                  <Col span={8}>
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        background: token.colorBgContainer,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        textAlign: 'center',
                      }}
                    >
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Imágenes
                      </Text>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>
                        {fileList.length}
                      </div>
                    </div>
                  </Col>

                  <Col span={8}>
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        background: token.colorBgContainer,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        textAlign: 'center',
                      }}
                    >
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Variantes
                      </Text>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>
                        {variants.length}
                      </div>
                    </div>
                  </Col>

                  <Col span={8}>
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        background: token.colorBgContainer,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        textAlign: 'center',
                      }}
                    >
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        IA
                      </Text>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>
                        {iaResult ? 'OK' : '—'}
                      </div>
                    </div>
                  </Col>
                </Row>
              </Col>
            </Row>
          </div>

          <ProductFormDirtyContext.Provider value={markFormAsChanged}>
            <ProductFormMutationContext.Provider
              value={{ version: formMutationVersion, notifyMutation: notifyFormMutation }}
            >
              <Form
                form={form}
                layout="vertical"
                scrollToFirstError={false}
                onKeyDown={event => {
              if (
                event.key === 'Enter' &&
                event.target instanceof HTMLInputElement
              ) {
                event.preventDefault()
              }
            }}
            onFinish={() => handleFinish(form.getFieldsValue(true))}
          >
            <Row gutter={[24, 24]} align="top">
              <Col xs={24} xl={15}>
                <Card
                  title={
                    <Space size={10}>
                      <PictureOutlined style={{ color: token.colorPrimary }} />
                      <span>Imágenes del producto</span>
                      <Tag color="red" style={{ borderRadius: 999 }}>
                        Requerido
                      </Tag>
                    </Space>
                  }
                  style={{
                    marginBottom: 24,
                    borderRadius: 20,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                  }}
                  styles={{ body: { padding: 24 } }}
                >
                  <div
                    style={{
                      marginBottom: 20,
                      padding: 20,
                      borderRadius: 18,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      background: `linear-gradient(135deg, ${token.colorFillAlter}, ${token.colorBgContainer})`,
                    }}
                  >
                    <Row gutter={[18, 18]} align="middle">
                      <Col xs={24} lg={8}>
                        <Space direction="vertical" size={6}>
                          <Space wrap>
                            <Tag
                              color="processing"
                              style={{ borderRadius: 999 }}
                            >
                              Agente
                            </Tag>
                            <Tag
                              color={autoAgentEnabled ? 'success' : 'default'}
                              style={{ borderRadius: 999 }}
                            >
                              {autoAgentEnabled ? 'Auto activo' : 'Manual'}
                            </Tag>
                            {autoAgentRunning && (
                              <Tag color="blue" style={{ borderRadius: 999 }}>
                                Procesando
                              </Tag>
                            )}
                          </Space>

                          <Text strong style={{ fontSize: 15 }}>
                            Bandeja inteligente
                          </Text>

                          <Text
                            type="secondary"
                            style={{ fontSize: 13, lineHeight: 1.55 }}
                          >
                            Importá imágenes del agente, programalas o dejá que
                            AutoSave cree productos con IA cuando el modo
                            automático esté activo.
                          </Text>
                        </Space>
                      </Col>

                      <Col xs={24} lg={7}>
                        <Row gutter={[10, 10]}>
                          {[
                            {
                              label: 'Pendientes',
                              value: agentQueueStats.pending,
                            },
                            {
                              label: 'Programadas',
                              value: agentQueueStats.scheduled,
                            },
                            {
                              label: 'AutoSave',
                              value: agentQueueStats.autoSave,
                            },
                          ].map(metric => (
                            <Col span={8} key={metric.label}>
                              <div
                                style={{
                                  padding: '12px 8px',
                                  borderRadius: 14,
                                  background: token.colorBgContainer,
                                  border: `1px solid ${token.colorBorderSecondary}`,
                                  textAlign: 'center',
                                }}
                              >
                                <Text
                                  type="secondary"
                                  style={{ fontSize: 11, display: 'block' }}
                                >
                                  {metric.label}
                                </Text>
                                <Text strong style={{ fontSize: 18 }}>
                                  {metric.value}
                                </Text>
                              </div>
                            </Col>
                          ))}
                        </Row>
                      </Col>

                      <Col xs={24} lg={9}>
                        <Space
                          direction="vertical"
                          size={10}
                          style={{ width: '100%' }}
                        >
                          <Space
                            wrap
                            style={{
                              justifyContent: 'flex-end',
                              width: '100%',
                            }}
                          >
                            <Switch
                              checked={autoAgentEnabled}
                              onChange={setAutoAgentEnabled}
                              checkedChildren="Auto"
                              unCheckedChildren="Manual"
                              loading={autoAgentRunning}
                            />

                            <Button
                              htmlType="button"
                              icon={<ReloadOutlined />}
                              onClick={fetchAgentQueue}
                              loading={loadingAgentQueue || autoAgentRunning}
                            >
                              Actualizar
                            </Button>
                          </Space>

                          <Select
                            loading={loadingAgentQueue}
                            value={selectedAgentJobId}
                            placeholder="Sin imágenes disponibles"
                            style={{ width: '100%' }}
                            onChange={setSelectedAgentJobId}
                            options={agentQueue.map(job => ({
                              value: job._id,
                              label:
                                job.status === 'scheduled'
                                  ? `${job.originalFilename || job._id} - ${formatDate(job.scheduledAt)}`
                                  : `${job.originalFilename || job._id}${job.metadata?.autoSaveProduct ? ' - AutoSave' : ''}`,
                            }))}
                          />

                          <Space
                            wrap
                            style={{
                              justifyContent: 'flex-end',
                              width: '100%',
                            }}
                          >
                            <Button
                              htmlType="button"
                              type="primary"
                              icon={<CloudDownloadOutlined />}
                              onClick={handleImportAgentImage}
                              loading={importingAgentImage}
                              disabled={
                                !selectedAgentJobId ||
                                selectedAgentJob?.status === 'scheduled'
                              }
                            >
                              Cargar ahora
                            </Button>

                            <Popconfirm
                              title="Eliminar imagen"
                              description="La imagen se quitará de la bandeja del agente."
                              okText="Eliminar"
                              cancelText="Cancelar"
                              okButtonProps={{ danger: true }}
                              onConfirm={handleDeleteAgentImage}
                              disabled={!selectedAgentJobId}
                            >
                              <Button
                                htmlType="button"
                                danger
                                icon={<DeleteOutlined />}
                                loading={deletingAgentImage}
                                disabled={!selectedAgentJobId}
                              >
                                Eliminar
                              </Button>
                            </Popconfirm>
                          </Space>
                        </Space>
                      </Col>
                    </Row>

                    {selectedAgentJob && (
                      <Alert
                        type={
                          selectedAgentJob.status === 'scheduled'
                            ? 'warning'
                            : 'success'
                        }
                        showIcon
                        style={{
                          marginTop: 16,
                          borderRadius: 14,
                        }}
                        message={
                          selectedAgentJob.status === 'scheduled'
                            ? `Programada para ${formatDate(selectedAgentJob.scheduledAt)}`
                            : 'Disponible para AddProduct'
                        }
                        description={
                          selectedAgentJob.metadata?.autoSaveProduct
                            ? 'Esta imagen está marcada para AutoSave: con Auto activo, AddProduct la analiza con IA y crea el producto sin tocar el formulario.'
                            : 'Esta imagen requiere revisión manual: se carga al formulario, dispara la IA y queda lista para revisar antes de guardar.'
                        }
                      />
                    )}
                  </div>

                  {!fileList.length ? (
                    <Dragger
                      multiple
                      beforeUpload={() => false}
                      fileList={fileList}
                      onChange={handleUploadChange}
                      onRemove={handleRemove}
                      showUploadList={false}
                      style={{
                        borderRadius: 20,
                        padding: 44,
                        background: `linear-gradient(135deg, ${token.colorBgContainer}, ${token.colorFillAlter})`,
                        border: `2px dashed ${token.colorPrimaryBorder || token.colorBorder}`,
                      }}
                    >
                      <div style={{ textAlign: 'center' }}>
                        <div
                          style={{
                            width: 88,
                            height: 88,
                            borderRadius: 24,
                            background: `${token.colorPrimary}14`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 18px',
                            border: `1px solid ${token.colorPrimaryBorder || token.colorBorder}`,
                          }}
                        >
                          <InboxOutlined
                            style={{ fontSize: 40, color: token.colorPrimary }}
                          />
                        </div>

                        <Text strong style={{ fontSize: 17, display: 'block' }}>
                          Arrastrá imágenes o importalas desde el agente
                        </Text>

                        <Text
                          type="secondary"
                          style={{ display: 'block', marginTop: 6 }}
                        >
                          Las imágenes cargadas disparan el análisis visual con
                          IA.
                        </Text>

                        <Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            display: 'block',
                            marginTop: 10,
                          }}
                        >
                          JPG, PNG, WEBP, HEIC/HEIF · máximo{' '}
                          {MAX_PRODUCT_IMAGES} imágenes · alta calidad mejora la
                          precisión
                        </Text>
                      </div>
                    </Dragger>
                  ) : (
                    <ImagePreviewGrid
                      previews={imagePreviews}
                      fileList={fileList}
                      onRemove={handleRemove}
                      onAddMore={handleAddMoreImages}
                    />
                  )}
                </Card>

                <AIAnalysisPanel
                  iaResult={iaResult}
                  loading={loadingIa}
                  error={errorIa}
                  onReset={handleReanalyzeImage}
                  onApplyAll={applyAiAll}
                  onApplySafeFields={applyAiSafeFields}
                  onApplyField={applyAiField}
                  onApplySeo={applyAiSeo}
                  onApplyTechnicalFields={applyAiTechnicalFields}
                  onApplyDynamicField={applyAiDynamicField}
                  onApplyTags={applyAiTags}
                  onApplyVariants={applyAiVariants}
                />

                <Card
                  title={
                    <Space size={10}>
                      <ShoppingOutlined style={{ color: token.colorPrimary }} />
                      <span>Información del producto</span>
                    </Space>
                  }
                  style={{
                    marginBottom: 24,
                    borderRadius: 20,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                  }}
                  styles={{ body: { padding: 24 } }}
                >
                  <Row gutter={[18, 18]}>
                    <Col xs={24}>
                      <ProductField
                        name="titulo"
                        label="Título del producto"
                        rules={[
                          {
                            required: true,
                            message: 'El título es obligatorio',
                          },
                        ]}
                      >
                        <Input
                          size="large"
                          placeholder="Nombre comercial claro del producto"
                          prefix={
                            <FileTextOutlined
                              style={{ color: token.colorTextSecondary }}
                            />
                          }
                          showCount
                          maxLength={120}
                        />
                      </ProductField>
                    </Col>

                    <Col xs={24}>
                      <ProductField
                        name="descripcion"
                        label="Descripción comercial"
                        rules={[
                          {
                            required: true,
                            message: 'La descripción comercial es obligatoria',
                          },
                        ]}
                        extra="Texto visible para el cliente: claro, vendedor y útil, sin prometer datos no confirmados."
                      >
                        <Input.TextArea
                          rows={6}
                          placeholder="Explicá qué es el producto, qué se observa, para qué puede servir y qué detalles ayudan a decidir la compra."
                          showCount
                          maxLength={3600}
                        />
                      </ProductField>
                    </Col>

                    <Col xs={24}>
                      <ProductField
                        name="descripcionTecnica"
                        label="Descripción técnica precisa"
                        extra="Detalle objetivo para ficha ampliada: estructura, partes visibles, terminación, textura, presentación, materialidad y límites de lo que se puede confirmar."
                      >
                        <Input.TextArea
                          rows={7}
                          disabled={!useTechnicalSheet}
                          placeholder={
                            useTechnicalSheet
                              ? 'Detallá características observables y técnicas del producto sin inventar medidas, compatibilidades, garantía u origen si no están confirmados.'
                              : 'Activá la ficha técnica para guardar una descripción técnica.'
                          }
                          showCount
                          maxLength={4200}
                        />
                      </ProductField>
                    </Col>

                    <Col xs={24} md={12}>
                      <ProductField
                        name="categoria"
                        label="Categoría"
                        rules={[
                          {
                            required: true,
                            message: 'La categoría es obligatoria',
                          },
                        ]}
                      >
                        <AutoComplete
                          allowClear
                          options={categoryOptions}
                          filterOption={(inputValue, option) =>
                            String(option?.value || '')
                              .toLowerCase()
                              .includes(inputValue.toLowerCase())
                          }
                          getPopupContainer={() => document.body}
                          onSelect={value => {
                            commitClassificationFromForm({ categoria: value })
                          }}
                          onBlur={() => {
                            normalizeTitleCaseFormField('categoria')
                            commitClassificationFromForm()
                          }}
                        >
                          <Input
                            size="large"
                            placeholder="Escribí o elegí una categoría"
                            prefix={
                              <AppstoreOutlined
                                style={{ color: token.colorTextSecondary }}
                              />
                            }
                          />
                        </AutoComplete>
                      </ProductField>
                    </Col>

                    <Col xs={24} md={12}>
                      <ProductField
                        name="subcategoria"
                        label="Subcategoría"
                        rules={[
                          {
                            required: true,
                            message: 'La subcategoría es obligatoria',
                          },
                        ]}
                      >
                        <AutoComplete
                          allowClear
                          options={subcategoryOptions}
                          filterOption={(inputValue, option) =>
                            String(option?.value || '')
                              .toLowerCase()
                              .includes(inputValue.toLowerCase())
                          }
                          getPopupContainer={() => document.body}
                          onSelect={value => {
                            commitClassificationFromForm({
                              subcategoria: value,
                            })
                          }}
                          onBlur={() => {
                            normalizeTitleCaseFormField('subcategoria')
                            commitClassificationFromForm()
                          }}
                        >
                          <Input
                            size="large"
                            placeholder="Escribí o elegí una subcategoría"
                            prefix={
                              <BranchesOutlined
                                style={{ color: token.colorTextSecondary }}
                              />
                            }
                          />
                        </AutoComplete>
                      </ProductField>
                    </Col>

                    <Col xs={24} md={12}>
                      <ProductField
                        name="marca"
                        label="Marca"
                        rules={[
                          {
                            required: true,
                            message: 'La marca es obligatoria',
                          },
                        ]}
                      >
                        <Input
                          size="large"
                          placeholder="Marca visible o declarada"
                          prefix={
                            <ShoppingOutlined
                              style={{ color: token.colorTextSecondary }}
                            />
                          }
                        />
                      </ProductField>
                    </Col>

                    <Col xs={24} md={12}>
                      <ProductField name="material" label="Material">
                        <Input
                          size="large"
                          placeholder="Material principal visible o declarado"
                          prefix={
                            <InfoCircleOutlined
                              style={{ color: token.colorTextSecondary }}
                            />
                          }
                        />
                      </ProductField>
                    </Col>

                    <Col xs={24}>
                      <ProductField name="color" label="Color general">
                        <Input
                          size="large"
                          placeholder="Color dominante o combinación principal"
                          prefix={
                            <FormatPainterOutlined
                              style={{ color: token.colorTextSecondary }}
                            />
                          }
                        />
                      </ProductField>
                    </Col>
                  </Row>
                </Card>

                <Card
                  title={
                    <Space size={10}>
                      <AppstoreOutlined style={{ color: token.colorPrimary }} />
                      <span>Ficha técnica inteligente</span>
                      {dynamicProductFields.length > 0 && (
                        <Tag color="processing" style={{ borderRadius: 999 }}>
                          {dynamicProductFields.length} campos
                        </Tag>
                      )}
                      {!useTechnicalSheet && (
                        <Tag color="default" style={{ borderRadius: 999 }}>
                          Opcional
                        </Tag>
                      )}
                    </Space>
                  }
                  extra={
                    <Switch
                      checked={useTechnicalSheet}
                      onChange={checked => {
                        setUseTechnicalSheet(checked)
                        if (!checked) {
                          setProductFormValues({
                            descripcionTecnica: undefined,
                            dynamicFields: {},
                          })
                          message.info(
                            'Ficha técnica desactivada para este producto',
                          )
                        }
                      }}
                      checkedChildren="Usar"
                      unCheckedChildren="Omitir"
                    />
                  }
                  style={{
                    marginBottom: 24,
                    borderRadius: 20,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                  }}
                  styles={{ body: { padding: 24 } }}
                >
                  {!useTechnicalSheet ? (
                    <div
                      style={{
                        padding: 20,
                        borderRadius: 16,
                        background: token.colorFillAlter,
                        border: `1px dashed ${token.colorBorder}`,
                      }}
                    >
                      <Space
                        direction="vertical"
                        size={12}
                        style={{ width: '100%' }}
                      >
                        <Alert
                          type="info"
                          showIcon
                          style={{ borderRadius: 14 }}
                          message="La ficha técnica es opcional"
                          description="Para productos simples podés omitirla y avanzar más rápido. Activala solo cuando ayude al cliente a comparar, filtrar o entender detalles técnicos."
                        />

                        <Space wrap>
                          <Button
                            htmlType="button"
                            type="primary"
                            icon={<ThunderboltOutlined />}
                            disabled={!normalizedAiDraft?.dynamicFields?.length}
                            onClick={applyAiTechnicalFields}
                          >
                            Generar ficha con IA
                          </Button>
                          <Button
                            htmlType="button"
                            icon={<PlusOutlined />}
                            onClick={() => setUseTechnicalSheet(true)}
                          >
                            Crear ficha manual
                          </Button>
                        </Space>

                        {normalizedAiDraft?.dynamicFields?.length > 0 && (
                          <Text type="secondary">
                            La IA encontró{' '}
                            {normalizedAiDraft.dynamicFields.length} datos
                            posibles. Podés aplicarlos y luego quitar los que no
                            correspondan.
                          </Text>
                        )}
                      </Space>
                    </div>
                  ) : (
                    <>
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 20, borderRadius: 14 }}
                        message={
                          catalogTemplate
                            ? `Campos aplicados desde la plantilla de ${catalogTemplate.name || 'la subcategoría'}`
                            : 'Estos campos alimentan la ficha técnica, los filtros del catálogo y la información que verá el cliente.'
                        }
                        description="Agregá solo datos que ayuden a entender, comparar o filtrar este producto. La IA puede sugerir campos y vos podés corregirlos."
                      />

                      <Card
                        size="small"
                        title="Constructor técnico rápido"
                        style={{ marginBottom: 20, borderRadius: 16 }}
                        styles={{ body: { padding: 16 } }}
                      >
                        <Space
                          direction="vertical"
                          size={14}
                          style={{ width: '100%' }}
                        >
                          <Alert
                            type="success"
                            showIcon
                            style={{ borderRadius: 12 }}
                            message="La ficha técnica incluye descripción técnica"
                            description="Si desactivás esta sección, no se guardan estos campos ni la descripción técnica en la DB."
                          />

                          <Space wrap size={[8, 8]}>
                            {TECHNICAL_FIELD_PRESETS.map(preset => (
                              <Button
                                htmlType="button"
                                key={preset.key}
                                size="small"
                                onClick={() => applyTechnicalPreset(preset)}
                                style={{ borderRadius: 999 }}
                              >
                                {preset.label} · {preset.helper}
                              </Button>
                            ))}
                          </Space>

                          <Input.TextArea
                            value={technicalQuickText}
                            onChange={event =>
                              setTechnicalQuickText(event.target.value)
                            }
                            rows={2}
                            placeholder="Ej: Cilindrada: 700 cc | Transmisión: 6 velocidades | Peso: 220 kg | Uso recomendado: adventure touring"
                          />

                          <Space wrap>
                            <Button
                              htmlType="button"
                              type="primary"
                              icon={<ThunderboltOutlined />}
                              onClick={applyTechnicalQuickFields}
                            >
                              Crear campos técnicos rápidos
                            </Button>
                            <Button
                              htmlType="button"
                              icon={<FileTextOutlined />}
                              onClick={
                                generateTechnicalDescriptionFromCurrentValues
                              }
                            >
                              Crear descripción técnica
                            </Button>
                          </Space>
                        </Space>
                      </Card>

                      <Row gutter={[16, 16]}>
                        {dynamicProductFields.length ? (
                          dynamicProductFields.map(field => (
                            <Col
                              xs={24}
                              md={field.type === 'textarea' ? 24 : 12}
                              key={field.name}
                            >
                              <Space
                                direction="vertical"
                                size={4}
                                style={{ width: '100%' }}
                              >
                                <DynamicProductField field={field} />
                                <Space size={6} wrap>
                                  {field.required && (
                                    <Tag color="red">Obligatorio</Tag>
                                  )}
                                  {field.source && <Tag>{field.source}</Tag>}
                                  <Button
                                    htmlType="button"
                                    size="small"
                                    type="link"
                                    danger
                                    onClick={() =>
                                      handleRemoveDynamicProductField(
                                        field.name,
                                      )
                                    }
                                  >
                                    Quitar
                                  </Button>
                                </Space>
                              </Space>
                            </Col>
                          ))
                        ) : (
                          <Col span={24}>
                            <Empty
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                              description="No hay campos en la ficha técnica. Podés generarla con IA o agregar campos manualmente."
                            />
                          </Col>
                        )}
                      </Row>

                      <Divider orientation="left" plain>
                        Agregar campo propio
                      </Divider>

                      <Row gutter={[12, 12]} align="bottom">
                        <Col xs={24} md={9}>
                          <Text strong>Nombre del campo</Text>
                          <Input
                            value={customFieldName}
                            onChange={event =>
                              setCustomFieldName(event.target.value)
                            }
                            onPressEnter={handleAddDynamicProductField}
                            placeholder="Nombre de atributo técnico, medida o característica"
                            style={{ marginTop: 8 }}
                          />
                        </Col>
                        <Col xs={24} md={6}>
                          <Text strong>Tipo</Text>
                          <Select
                            value={customFieldType}
                            onChange={setCustomFieldType}
                            options={DYNAMIC_FIELD_TYPES}
                            style={{ width: '100%', marginTop: 8 }}
                          />
                        </Col>
                        <Col xs={12} md={5}>
                          <Text strong>Obligatorio</Text>
                          <div style={{ marginTop: 8 }}>
                            <Switch
                              checked={customFieldRequired}
                              onChange={setCustomFieldRequired}
                              checkedChildren="Sí"
                              unCheckedChildren="No"
                            />
                          </div>
                        </Col>
                        <Col xs={12} md={4}>
                          <Button
                            htmlType="button"
                            block
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={handleAddDynamicProductField}
                          >
                            Agregar
                          </Button>
                        </Col>
                      </Row>
                    </>
                  )}
                </Card>

                <Card
                  title={
                    <Space size={10}>
                      <ClusterOutlined style={{ color: token.colorPrimary }} />
                      <span>Opciones vendibles del producto</span>
                      {dynamicAttributes.length > 0 && (
                        <Tag color="success" style={{ borderRadius: 999 }}>
                          {dynamicAttributes.length} atributos detectados
                        </Tag>
                      )}
                    </Space>
                  }
                  extra={
                    <Switch
                      checked={hasVariants}
                      onChange={checked => {
                        setHasVariants(checked)
                        if (!checked) {
                          setVariants([])
                          setSelectedAttributes({})
                        }
                      }}
                      checkedChildren="SÍ"
                      unCheckedChildren="NO"
                    />
                  }
                  style={{
                    marginBottom: 24,
                    borderRadius: 20,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                  }}
                  styles={{ body: { padding: 24 } }}
                >
                  {hasVariants ? (
                    <>
                      <Alert
                        message={
                          catalogTemplate
                            ? `Plantilla de "${catalogTemplate.name}" aplicada. Elegí los valores disponibles para este producto.`
                            : 'Usá variantes solo cuando el cliente pueda elegir opciones vendibles como color, medida, presentación, capacidad o modelo.'
                        }
                        description={
                          loadingCatalogTemplate
                            ? 'Consultando la configuración de la subcategoría...'
                            : catalogTemplate
                              ? 'Los atributos pertenecen a la subcategoría; precio, stock y SKU siguen siendo propios de cada producto.'
                              : undefined
                        }
                        type="info"
                        showIcon
                        style={{ marginBottom: 20, borderRadius: 14 }}
                      />

                      <div
                        style={{
                          marginBottom: 20,
                          padding: 16,
                          borderRadius: 16,
                          background: token.colorFillAlter,
                          border: `1px solid ${token.colorBorderSecondary}`,
                        }}
                      >
                        <Row gutter={[12, 12]} align="middle">
                          <Col xs={24} lg={15}>
                            <Text strong>Creación rápida de variantes</Text>
                            <Text
                              type="secondary"
                              style={{ display: 'block', marginTop: 4 }}
                            >
                              Pegá opciones en una línea y generá combinaciones
                              sin cargar campo por campo.
                            </Text>
                            <Space wrap size={[8, 8]} style={{ marginTop: 10 }}>
                              {QUICK_VARIANT_PRESETS.map(preset => (
                                <Button
                                  htmlType="button"
                                  key={preset.key}
                                  size="small"
                                  onClick={() => applyVariantPreset(preset)}
                                  style={{ borderRadius: 999 }}
                                >
                                  {preset.label} · {preset.helper}
                                </Button>
                              ))}
                            </Space>

                            <Input.TextArea
                              value={quickVariantText}
                              onChange={event =>
                                setQuickVariantText(event.target.value)
                              }
                              rows={2}
                              placeholder="Ej: Color: Negro, Blanco | Medida: 500ml, 1L | Presentación: Unidad, Pack"
                              style={{ marginTop: 10 }}
                            />
                          </Col>
                          <Col xs={24} lg={9}>
                            <Space
                              direction="vertical"
                              size={10}
                              style={{ width: '100%' }}
                            >
                              <Button
                                htmlType="button"
                                block
                                type="primary"
                                icon={<ThunderboltOutlined />}
                                onClick={applyQuickVariantsFromText}
                              >
                                Crear variantes rápidas
                              </Button>
                              <Button
                                htmlType="button"
                                block
                                icon={<ReloadOutlined />}
                                onClick={generateVariantsFromAttributes}
                                disabled={!canGenerateVariants}
                              >
                                Regenerar combinaciones actuales
                              </Button>
                              {normalizedAiDraft?.hasExplicitVariants && (
                                <Button
                                  htmlType="button"
                                  block
                                  icon={<RobotOutlined />}
                                  onClick={applyAiVariants}
                                >
                                  Usar variantes detectadas por IA
                                </Button>
                              )}
                            </Space>
                          </Col>
                        </Row>
                      </div>

                      <div style={{ marginBottom: 20 }}>
                        <Row gutter={[12, 12]} align="bottom">
                          <Col xs={24} md={12}>
                            <Text strong>1. Crear atributo</Text>
                            <Input
                              value={newAttributeName}
                              onChange={event =>
                                setNewAttributeName(event.target.value)
                              }
                              onPressEnter={handleAddCustomAttribute}
                              placeholder="Nombre de la opción vendible"
                              style={{ marginTop: 8 }}
                            />
                          </Col>
                          <Col xs={18} md={8}>
                            <Text strong>Tipo</Text>
                            <Select
                              value={newAttributeType}
                              onChange={setNewAttributeType}
                              style={{ width: '100%', marginTop: 8 }}
                              options={[
                                { value: 'select', label: 'Lista de opciones' },
                                { value: 'color', label: 'Color' },
                                { value: 'text', label: 'Texto' },
                              ]}
                            />
                          </Col>
                          <Col xs={24} md={4}>
                            <Button
                              htmlType="button"
                              block
                              type="primary"
                              onClick={handleAddCustomAttribute}
                              icon={<PlusOutlined />}
                              aria-label="Agregar atributo"
                            >
                              Agregar
                            </Button>
                          </Col>
                        </Row>
                      </div>

                      <Divider orientation="left" plain>
                        2. Definir valores
                      </Divider>

                      {dynamicAttributes.length > 0 ? (
                        <Space
                          direction="vertical"
                          size={12}
                          style={{ width: '100%' }}
                        >
                          {dynamicAttributes.map((attr, index) => (
                            <div
                              key={attr.name}
                              style={{
                                padding: 16,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: 8,
                                background: token.colorBgContainer,
                              }}
                            >
                              <Row gutter={[12, 12]} align="middle">
                                <Col xs={24} md={7}>
                                  <Space>
                                    <Badge
                                      count={index + 1}
                                      color={token.colorPrimary}
                                    />
                                    <div>
                                      <Text strong>{attr.label}</Text>
                                      <br />
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 12 }}
                                      >
                                        Atributo
                                      </Text>
                                    </div>
                                  </Space>
                                </Col>
                                <Col xs={20} md={15}>
                                  <Select
                                    mode="tags"
                                    placeholder={`Valores para ${attr.label}, separados por coma`}
                                    value={selectedAttributes[attr.name] || []}
                                    onChange={values =>
                                      handleAttributeValuesChange(
                                        attr.name,
                                        values,
                                      )
                                    }
                                    tokenSeparators={[',']}
                                    allowClear
                                    style={{ width: '100%' }}
                                    options={safeArray(attr.values).map(
                                      value => ({
                                        value,
                                        label: value,
                                      }),
                                    )}
                                  />
                                </Col>
                                <Col
                                  xs={4}
                                  md={2}
                                  style={{ textAlign: 'right' }}
                                >
                                  <Button
                                    htmlType="button"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() =>
                                      handleRemoveVariantAttribute(attr.name)
                                    }
                                    aria-label={`Eliminar atributo ${attr.label}`}
                                  />
                                </Col>
                              </Row>
                            </div>
                          ))}
                        </Space>
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="Todavía no hay opciones vendibles. Creá una opción solo si el cliente debe elegir entre alternativas."
                        />
                      )}

                      <div
                        style={{
                          marginTop: 18,
                          padding: 16,
                          borderRadius: 8,
                          background: token.colorFillAlter,
                          border: `1px solid ${token.colorBorderSecondary}`,
                        }}
                      >
                        <Row
                          gutter={[12, 12]}
                          align="middle"
                          justify="space-between"
                        >
                          <Col flex="auto">
                            <Text strong>3. Generar variantes</Text>
                            <br />
                            <Text type="secondary">
                              {variantCombinationCount > 0
                                ? `${configuredVariantAttributes.length} atributos producirán ${variantCombinationCount} variantes individuales.`
                                : 'Agregá uno o más valores para calcular las combinaciones.'}
                            </Text>
                          </Col>
                          <Col>
                            <Space wrap>
                              <Button
                                htmlType="button"
                                onClick={handleSaveCatalogTemplate}
                                icon={<SaveOutlined />}
                                loading={savingCatalogTemplate}
                                disabled={dynamicAttributes.length === 0}
                              >
                                Guardar plantilla
                              </Button>
                              <Button
                                htmlType="button"
                                type="primary"
                                onClick={generateVariantsFromAttributes}
                                icon={<ReloadOutlined />}
                                disabled={!canGenerateVariants}
                              >
                                Generar {variantCombinationCount || 0} variantes
                              </Button>
                            </Space>
                          </Col>
                        </Row>
                        {variantCombinationCount > MAX_GENERATED_VARIANTS && (
                          <Alert
                            type="error"
                            showIcon
                            style={{ marginTop: 12 }}
                            message={`Reducí los valores: el máximo es ${MAX_GENERATED_VARIANTS} variantes.`}
                          />
                        )}
                      </div>

                      {variants.length > 0 && (
                        <>
                          <Divider orientation="left">
                            <Space>
                              <AppstoreOutlined />
                              <span>
                                {variants.length} variantes configuradas
                              </span>
                            </Space>
                          </Divider>

                          <div
                            style={{
                              marginBottom: 16,
                              padding: 14,
                              borderRadius: 16,
                              background: token.colorFillAlter,
                              border: `1px solid ${token.colorBorderSecondary}`,
                            }}
                          >
                            <Row gutter={[12, 12]} align="middle">
                              <Col xs={24} md={8}>
                                <Text strong>Aplicar precio a todas</Text>
                                <InputNumber
                                  value={bulkVariantPrice}
                                  onChange={setBulkVariantPrice}
                                  min={0}
                                  precision={2}
                                  prefix="$"
                                  placeholder="Precio común"
                                  style={{ width: '100%', marginTop: 8 }}
                                />
                              </Col>
                              <Col xs={24} md={8}>
                                <Text strong>Aplicar stock a todas</Text>
                                <InputNumber
                                  value={bulkVariantStock}
                                  onChange={setBulkVariantStock}
                                  min={0}
                                  precision={0}
                                  placeholder="Stock común"
                                  style={{ width: '100%', marginTop: 8 }}
                                />
                              </Col>
                              <Col xs={24} md={8}>
                                <Button
                                  htmlType="button"
                                  block
                                  icon={<CheckOutlined />}
                                  onClick={applyBulkVariantValues}
                                  style={{ marginTop: 28 }}
                                >
                                  Aplicar a variantes
                                </Button>
                              </Col>
                            </Row>
                          </div>

                          <Table
                            dataSource={variants}
                            pagination={false}
                            size="middle"
                            scroll={{ x: 1280 }}
                            rowKey="key"
                            bordered={false}
                            style={{
                              borderRadius: 16,
                              overflow: 'hidden',
                            }}
                            columns={[
                              {
                                title: 'Variante',
                                dataIndex: 'nombre',
                                key: 'nombre',
                                width: 260,
                                fixed: 'left',
                                render: (_, record) => (
                                  <Space direction="vertical" size={6}>
                                    <Space wrap size={[4, 6]}>
                                      {Object.entries(record.combinacion).map(
                                        ([attribute, value]) => (
                                          <Tag
                                            key={`${record.key}-${attribute}`}
                                            color="blue"
                                            style={{
                                              margin: 0,
                                              borderRadius: 4,
                                            }}
                                          >
                                            {dynamicAttributes.find(
                                              item => item.name === attribute,
                                            )?.label || attribute}
                                            : {value}
                                          </Tag>
                                        ),
                                      )}
                                    </Space>
                                    <Space size={6} wrap>
                                      {record.uiStatus === 'new' && (
                                        <Tag
                                          color="success"
                                          style={{ borderRadius: 999 }}
                                        >
                                          Nueva
                                        </Tag>
                                      )}
                                      {record.isActive === false && (
                                        <Tag
                                          color="default"
                                          style={{ borderRadius: 999 }}
                                        >
                                          Inactiva
                                        </Tag>
                                      )}
                                    </Space>
                                  </Space>
                                ),
                              },
                              {
                                title: 'Precio',
                                dataIndex: 'price',
                                key: 'price',
                                width: 150,
                                render: (_, record) => (
                                  <InputNumber
                                    prefix="$"
                                    style={{ width: '100%' }}
                                    min={0}
                                    value={record.price}
                                    onChange={val => {
                                      setVariants(prev =>
                                        prev.map(variant =>
                                          variant.key === record.key
                                            ? {
                                                ...variant,
                                                price: Number(val || 0),
                                              }
                                            : variant,
                                        ),
                                      )
                                    }}
                                  />
                                ),
                              },
                              {
                                title: 'Stock',
                                dataIndex: 'stock',
                                key: 'stock',
                                width: 120,
                                render: (_, record) => (
                                  <InputNumber
                                    min={0}
                                    style={{ width: '100%' }}
                                    value={record.stock}
                                    onChange={val => {
                                      setVariants(prev =>
                                        prev.map(variant =>
                                          variant.key === record.key
                                            ? {
                                                ...variant,
                                                stock: Number(val || 0),
                                              }
                                            : variant,
                                        ),
                                      )
                                    }}
                                  />
                                ),
                              },
                              {
                                title: 'SKU opcional',
                                dataIndex: 'sku',
                                key: 'sku',
                                width: 180,
                                render: (_, record) => (
                                  <Input
                                    placeholder="Ej: FOX-BOTA-42"
                                    value={record.sku}
                                    onChange={e => {
                                      setVariants(prev =>
                                        prev.map(variant =>
                                          variant.key === record.key
                                            ? {
                                                ...variant,
                                                sku: e.target.value,
                                              }
                                            : variant,
                                        ),
                                      )
                                    }}
                                  />
                                ),
                              },
                              {
                                title: 'Imagen de variante',
                                key: 'image',
                                width: 330,
                                render: (_, record) => (
                                  <VariantImageSelector
                                    variant={record}
                                    localImages={localImages}
                                    onAssign={handleAssignVariantImage}
                                  />
                                ),
                              },
                              {
                                title: 'Preview',
                                key: 'preview',
                                width: 110,
                                render: (_, record) => {
                                  const selectedLocal = localImages.find(
                                    img => img.uid === record.imageSourceUid,
                                  )

                                  return selectedLocal?.preview ? (
                                    <img
                                      src={selectedLocal.preview}
                                      alt={record.nombre}
                                      style={{
                                        width: 64,
                                        height: 64,
                                        objectFit: 'cover',
                                        borderRadius: 14,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        boxShadow:
                                          '0 8px 18px rgba(15,23,42,.08)',
                                      }}
                                    />
                                  ) : (
                                    <Tag style={{ borderRadius: 999 }}>
                                      Sin imagen
                                    </Tag>
                                  )
                                },
                              },
                              {
                                title: 'Activo',
                                key: 'active',
                                width: 90,
                                align: 'center',
                                render: (_, record) => (
                                  <Switch
                                    checked={record.isActive !== false}
                                    onChange={checked => {
                                      setVariants(prev =>
                                        prev.map(variant =>
                                          variant.key === record.key
                                            ? { ...variant, isActive: checked }
                                            : variant,
                                        ),
                                      )
                                    }}
                                    size="small"
                                  />
                                ),
                              },
                              {
                                title: '',
                                key: 'delete',
                                width: 60,
                                render: (_, record) => (
                                  <Button
                                    htmlType="button"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => {
                                      setVariants(prev =>
                                        prev.filter(
                                          variant => variant.key !== record.key,
                                        ),
                                      )
                                    }}
                                    size="small"
                                  />
                                ),
                              },
                            ]}
                          />

                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginTop: 18, borderRadius: 14 }}
                            message="Si una variante no tiene imagen asignada, se mostrará la imagen general del producto."
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        padding: 28,
                        textAlign: 'center',
                        borderRadius: 16,
                        background: token.colorFillAlter,
                        border: `1px dashed ${token.colorBorder}`,
                      }}
                    >
                      <Space direction="vertical" size={12} align="center">
                        <Text type="secondary">
                          Este producto no tiene opciones vendibles. Activá
                          variantes solo si el cliente debe elegir una
                          alternativa específica antes de comprar.
                        </Text>
                        <Space wrap>
                          <Button
                            htmlType="button"
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => setHasVariants(true)}
                          >
                            Crear variantes
                          </Button>
                          {dynamicAttributes.length > 0 && (
                            <Button
                              htmlType="button"
                              icon={<ReloadOutlined />}
                              onClick={() => setHasVariants(true)}
                            >
                              Usar plantilla detectada
                            </Button>
                          )}
                          {normalizedAiDraft?.hasExplicitVariants && (
                            <Button
                              htmlType="button"
                              icon={<RobotOutlined />}
                              onClick={applyAiVariants}
                            >
                              Usar variantes de IA
                            </Button>
                          )}
                        </Space>
                      </Space>
                    </div>
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={9}>
                <div className="add-product-side-panel">
                  <Card
                    title={
                      <Space size={10}>
                        <CheckCircleOutlined
                          style={{ color: token.colorPrimary }}
                        />
                        <span>Estado de carga</span>
                      </Space>
                    }
                    style={{
                      marginBottom: 24,
                      borderRadius: 20,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                    }}
                    styles={{ body: { padding: 20 } }}
                  >
                    <Space
                      direction="vertical"
                      size={14}
                      style={{ width: '100%' }}
                    >
                      <div
                        style={{
                          padding: 16,
                          borderRadius: 16,
                          background: productReadiness.isReady
                            ? token.colorSuccessBg
                            : token.colorFillAlter,
                          border: `1px solid ${
                            productReadiness.isReady
                              ? token.colorSuccessBorder
                              : token.colorBorderSecondary
                          }`,
                        }}
                      >
                        <Space
                          align="center"
                          style={{
                            width: '100%',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <Text strong>
                              {productReadiness.isReady
                                ? 'Listo para publicar'
                                : 'Completá lo esencial'}
                            </Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {productReadiness.doneRequired}/
                              {productReadiness.requiredChecks.length} datos
                              obligatorios
                            </Text>
                          </div>
                          <div
                            style={{
                              minWidth: 54,
                              height: 54,
                              borderRadius: 18,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 900,
                              color: productReadiness.isReady
                                ? token.colorSuccess
                                : token.colorPrimary,
                              background: token.colorBgContainer,
                              border: `1px solid ${token.colorBorderSecondary}`,
                            }}
                          >
                            {productReadiness.percent}%
                          </div>
                        </Space>
                      </div>

                      <Space wrap size={[6, 6]}>
                        {productReadiness.checks.map(check => (
                          <Tag
                            key={check.key}
                            color={
                              check.done
                                ? 'success'
                                : check.required
                                  ? 'warning'
                                  : 'default'
                            }
                            style={{ borderRadius: 999, marginInlineEnd: 0 }}
                          >
                            {check.done ? '✓' : '•'} {check.label}
                          </Tag>
                        ))}
                      </Space>

                      <Alert
                        type={productReadiness.isReady ? 'success' : 'info'}
                        showIcon
                        style={{ borderRadius: 14 }}
                        message={
                          productReadiness.isReady
                            ? 'Ya podés publicar o guardar como borrador.'
                            : 'El flujo rápido solo exige imagen, título, descripción, categoría, precio y stock.'
                        }
                      />
                    </Space>
                  </Card>
                  <Card
                    title={
                      <Space size={10}>
                        <DollarOutlined style={{ color: token.colorPrimary }} />
                        <span>Precio y disponibilidad</span>
                      </Space>
                    }
                    style={{
                      marginBottom: 24,
                      borderRadius: 20,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                    }}
                    styles={{ body: { padding: 24 } }}
                  >
                    <Row gutter={[16, 16]}>
                      <Col xs={24}>
                        <ProductField
                          name="precio"
                          label={
                            hasVariants ? 'Precio base de referencia' : 'Precio'
                          }
                          rules={[
                            {
                              required: true,
                              message: 'El precio es obligatorio',
                            },
                          ]}
                        >
                          <InputNumber
                            size="large"
                            style={{ width: '100%' }}
                            min={0}
                            precision={2}
                            prefix="$"
                            placeholder="0.00"
                            onChange={value => {
                              if (hasVariants && variants.length > 0) {
                                setVariants(prev =>
                                  prev.map(variant => ({
                                    ...variant,
                                    price:
                                      Number(variant.price || 0) === 0
                                        ? Number(value || 0)
                                        : variant.price,
                                  })),
                                )
                              }
                            }}
                          />
                        </ProductField>
                      </Col>

                      {!hasVariants && (
                        <Col xs={24}>
                          <ProductField
                            name="cantidad"
                            label="Cantidad en stock"
                            rules={[
                              {
                                required: true,
                                message: 'La cantidad es obligatoria',
                              },
                            ]}
                          >
                            <InputNumber
                              size="large"
                              style={{ width: '100%' }}
                              min={1}
                              placeholder="1"
                              prefix={
                                <NumberOutlined
                                  style={{ color: token.colorTextSecondary }}
                                />
                              }
                            />
                          </ProductField>
                        </Col>
                      )}

                      <Col xs={24}>
                        <ProductField
                          name="condicion"
                          label="Condición"
                          rules={[
                            {
                              required: true,
                              message: 'La condición es obligatoria',
                            },
                          ]}
                        >
                          <Select
                            size="large"
                            placeholder="Seleccioná la condición"
                          >
                            <Select.Option value="nuevo">
                              <Tag color="success">Nuevo</Tag>
                            </Select.Option>
                            <Select.Option value="usado">
                              <Tag color="warning">Usado</Tag>
                            </Select.Option>
                            <Select.Option value="reacondicionado">
                              <Tag color="processing">Reacondicionado</Tag>
                            </Select.Option>
                          </Select>
                        </ProductField>
                      </Col>
                    </Row>

                    {hasVariants && (
                      <Alert
                        message="El stock y la imagen se gestionan por variante."
                        type="info"
                        showIcon
                        style={{ marginTop: 8, borderRadius: 14 }}
                      />
                    )}
                  </Card>

                  <Card
                    title={
                      <Space size={10}>
                        <FileTextOutlined
                          style={{ color: token.colorPrimary }}
                        />
                        <span>SEO y contenido comercial</span>
                      </Space>
                    }
                    style={{
                      marginBottom: 24,
                      borderRadius: 20,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                    }}
                    styles={{ body: { padding: 24 } }}
                  >
                    <Space
                      direction="vertical"
                      size={12}
                      style={{ width: '100%' }}
                    >
                      <Button
                        htmlType="button"
                        block
                        icon={<ThunderboltOutlined />}
                        onClick={generateSeoFromCurrentValues}
                      >
                        Generar SEO desde el producto
                      </Button>

                      <Button
                        htmlType="button"
                        block
                        type="primary"
                        ghost
                        icon={<AppstoreOutlined />}
                        onClick={generateSeoPositioningFromCurrentValues}
                      >
                        Crear posicionamiento SEO
                      </Button>

                      <Divider orientation="left" plain>
                        Posicionamiento SEO
                      </Divider>

                      <ProductField
                        name="seoFocusKeyword"
                        label="Keyword principal"
                      >
                        <Input placeholder="Ej: Moto Morini X-Cape 700" />
                      </ProductField>

                      <ProductField
                        name="seoSearchIntent"
                        label="Intención de búsqueda"
                        initialValue="commercial"
                      >
                        <Select options={SEO_POSITIONING_INTENT_OPTIONS} />
                      </ProductField>

                      <ProductField
                        name="seoPositioning"
                        label="Posicionamiento SEO"
                      >
                        <Input.TextArea
                          rows={4}
                          maxLength={900}
                          showCount
                          placeholder="Definí cómo debe posicionarse este producto en buscadores, qué intención resuelve y qué lo diferencia."
                        />
                      </ProductField>

                      <ProductField
                        name="seoTargetAudience"
                        label="Audiencia objetivo"
                      >
                        <Input placeholder="Ej: usuarios que buscan una motocicleta adventure para ruta y uso mixto" />
                      </ProductField>

                      <ProductField
                        name="seoContentAngle"
                        label="Enfoque de contenido"
                      >
                        <Input.TextArea
                          rows={2}
                          maxLength={420}
                          showCount
                          placeholder="Qué destacar en la descripción, fichas, contenido y FAQs."
                        />
                      </ProductField>

                      <ProductField name="seoFaq" label="Preguntas frecuentes SEO">
                        <Select
                          mode="tags"
                          tokenSeparators={[',']}
                          placeholder="Ej: ¿Qué motor tiene?, ¿Para qué uso sirve?, ¿Qué revisar antes de comprar?"
                        />
                      </ProductField>

                      <ProductField
                        name="seoContentPillars"
                        label="Pilares de contenido"
                      >
                        <Select
                          mode="tags"
                          tokenSeparators={[',']}
                          placeholder="marca, modelo, categoría, material, uso, beneficio"
                        />
                      </ProductField>

                      <Divider orientation="left" plain>
                        SEO básico
                      </Divider>

                      <ProductField name="slug" label="Slug URL">
                        <Input placeholder="nombre-producto-claro" />
                      </ProductField>

                      <ProductField
                        name="shortDescription"
                        label="Descripción corta"
                      >
                        <Input.TextArea
                          rows={2}
                          maxLength={260}
                          showCount
                          placeholder="Resumen comercial breve para cards, SEO y vistas rápidas."
                        />
                      </ProductField>

                      <ProductField name="metaTitle" label="Meta title">
                        <Input
                          maxLength={70}
                          showCount
                          placeholder="Título SEO"
                        />
                      </ProductField>

                      <ProductField
                        name="metaDescription"
                        label="Meta description"
                      >
                        <Input.TextArea
                          rows={2}
                          maxLength={160}
                          showCount
                          placeholder="Descripción SEO para buscadores."
                        />
                      </ProductField>

                      <ProductField name="seoKeywords" label="Keywords">
                        <Select
                          mode="tags"
                          tokenSeparators={[',']}
                          placeholder="marca, categoría, material, uso"
                        />
                      </ProductField>
                    </Space>
                  </Card>

                  <Card
                    title={
                      <Space size={10}>
                        <ShoppingOutlined
                          style={{ color: token.colorPrimary }}
                        />
                        <span>Logística, garantía y origen</span>
                      </Space>
                    }
                    style={{
                      marginBottom: 24,
                      borderRadius: 20,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                    }}
                    styles={{ body: { padding: 24 } }}
                  >
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12}>
                        <ProductField name="weightKg" label="Peso kg">
                          <InputNumber
                            min={0}
                            precision={3}
                            style={{ width: '100%' }}
                            placeholder="0.500"
                          />
                        </ProductField>
                      </Col>
                      <Col xs={24} sm={12}>
                        <ProductField
                          name="shippingType"
                          label="Tipo de envío"
                          initialValue="standard"
                        >
                          <Select options={SHIPPING_TYPE_OPTIONS} />
                        </ProductField>
                      </Col>
                      <Col xs={8}>
                        <ProductField name="packageLengthCm" label="Largo cm">
                          <InputNumber
                            min={0}
                            precision={1}
                            style={{ width: '100%' }}
                          />
                        </ProductField>
                      </Col>
                      <Col xs={8}>
                        <ProductField name="packageWidthCm" label="Ancho cm">
                          <InputNumber
                            min={0}
                            precision={1}
                            style={{ width: '100%' }}
                          />
                        </ProductField>
                      </Col>
                      <Col xs={8}>
                        <ProductField name="packageHeightCm" label="Alto cm">
                          <InputNumber
                            min={0}
                            precision={1}
                            style={{ width: '100%' }}
                          />
                        </ProductField>
                      </Col>
                      <Col xs={24}>
                        <ProductField name="warranty" label="Garantía">
                          <Input placeholder="Ej: 6 meses por defecto de fabricación" />
                        </ProductField>
                      </Col>
                      <Col xs={24}>
                        <ProductField
                          name="countryOfOrigin"
                          label="País de origen"
                        >
                          <Input placeholder="Ej: Argentina, Brasil, China" />
                        </ProductField>
                      </Col>
                    </Row>
                  </Card>

                  <Card
                    title={
                      <Space size={10}>
                        <TagOutlined style={{ color: token.colorPrimary }} />
                        <span>Tags y etiquetas</span>
                      </Space>
                    }
                    style={{
                      marginBottom: 24,
                      borderRadius: 20,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      boxShadow: '0 12px 32px rgba(15, 23, 42, 0.05)',
                    }}
                    styles={{ body: { padding: 24 } }}
                  >
                    <div style={{ marginBottom: 16 }}>
                      {editableTags.map(tag => (
                        <Tag
                          key={tag}
                          closable
                          onClose={() => handleCloseTag(tag)}
                          color="blue"
                          style={{
                            padding: '5px 12px',
                            fontSize: 13,
                            margin: '0 8px 8px 0',
                            borderRadius: 999,
                          }}
                        >
                          {tag}
                        </Tag>
                      ))}

                      {inputVisible ? (
                        <Input
                          ref={inputRef}
                          type="text"
                          size="small"
                          style={{ width: 140 }}
                          value={inputTagValue}
                          onChange={e => setInputTagValue(e.target.value)}
                          onBlur={handleInputConfirm}
                          onPressEnter={handleInputConfirm}
                        />
                      ) : (
                        <Tag
                          onClick={() => setInputVisible(true)}
                          icon={<PlusOutlined />}
                          style={{
                            padding: '5px 12px',
                            fontSize: 13,
                            cursor: 'pointer',
                            borderStyle: 'dashed',
                            borderRadius: 999,
                          }}
                        >
                          Agregar tag
                        </Tag>
                      )}
                    </div>

                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Los tags mejoran búsqueda, filtros y recomendaciones.
                    </Text>
                  </Card>

                  <Card
                    style={{
                      borderRadius: 20,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
                    }}
                    styles={{ body: { padding: 20 } }}
                  >
                    <Space
                      direction="vertical"
                      size={14}
                      style={{ width: '100%' }}
                    >
                      {isError && (
                        <Alert
                          type="error"
                          message={productMessage || 'Error guardando producto'}
                          showIcon
                          style={{ borderRadius: 14 }}
                        />
                      )}

                      <div
                        style={{
                          padding: 14,
                          borderRadius: 14,
                          background: token.colorFillAlter,
                          border: `1px solid ${token.colorBorderSecondary}`,
                        }}
                      >
                        <Space
                          align="center"
                          style={{
                            width: '100%',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <Text strong>
                              {publishProduct
                                ? 'Publicar visible'
                                : 'Guardar borrador'}
                            </Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {publishProduct
                                ? 'El producto queda activo en el comercio al finalizar.'
                                : 'El producto queda oculto para revisión interna.'}
                            </Text>
                          </div>
                          <Switch
                            checked={publishProduct}
                            onChange={setPublishProduct}
                            checkedChildren="ON"
                            unCheckedChildren="OFF"
                          />
                        </Space>
                      </div>

                      <Button
                        htmlType="submit"
                        type="primary"
                        size="large"
                        block
                        loading={isLoading || savingProduct}
                        icon={<CheckCircleOutlined />}
                        style={{
                          height: 52,
                          fontSize: 16,
                          fontWeight: 800,
                          borderRadius: 14,
                          boxShadow: `0 14px 28px ${token.colorPrimary}30`,
                        }}
                      >
                        {isLoading || savingProduct
                          ? 'Guardando...'
                          : publishProduct
                            ? hasVariants
                              ? `Publicar con ${variants.length} variantes`
                              : 'Publicar producto'
                            : hasVariants
                              ? `Guardar borrador con ${variants.length} variantes`
                              : 'Guardar como borrador'}
                      </Button>

                      <Text
                        type="secondary"
                        style={{
                          fontSize: 12,
                          textAlign: 'center',
                          display: 'block',
                        }}
                      >
                        Se validará tenant, imágenes, variantes y metadatos IA
                        antes de publicar.
                      </Text>
                    </Space>
                  </Card>
                </div>
              </Col>
            </Row>
              </Form>
            </ProductFormMutationContext.Provider>
          </ProductFormDirtyContext.Provider>
        </Col>
      </Row>

      <style>{`
        html,
        body,
        #root,
        main,
        .add-product-stable-page {
          overflow-anchor: none !important;
          scroll-behavior: auto !important;
        }

        .add-product-stable-page,
        .add-product-stable-page * {
          overflow-anchor: none;
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.7; }
        }

        @keyframes loading {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }

        .ai-pulse-animation {
          animation: pulse 2s infinite;
        }

        .image-preview-item:hover .image-preview-overlay {
          opacity: 1 !important;
        }

        .image-preview-item:hover {
          border-color: ${token.colorPrimary} !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }

        .add-more-images:hover {
          border-color: ${token.colorPrimary} !important;
          background: ${token.colorPrimary}08;
        }

        .agent-metric {
          min-height: 58px;
          padding: 8px 10px;
          border: 1px solid ${token.colorBorder};
          border-radius: 8px;
          background: ${token.colorBgContainer};
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
        }

        .stable-form-field,
        .ant-card,
        .ant-row,
        .ai-analysis-card {
          overflow-anchor: none;
        }


        .stable-form-field {
          overflow-anchor: none !important;
        }

        .stable-form-field-label {
          display: block;
          margin-bottom: 6px;
          color: ${token.colorText};
          font-size: 14px;
          font-weight: 600;
          line-height: 1.35;
        }

        .stable-form-field-required {
          margin-left: 4px;
          color: ${token.colorError};
        }

        .stable-form-field-message {
          min-height: 20px;
          margin-top: 6px;
          color: ${token.colorError};
          font-size: 12px;
          line-height: 1.35;
          transition: none !important;
        }

        .add-product-side-panel {
          position: relative;
        }

        .ai-analysis-card {
          transition: all 0.3s ease;
        }

        .ai-analysis-card:hover {
          box-shadow: 0 8px 32px ${token.colorPrimary}25 !important;
        }
      `}</style>
    </div>
  )
}
