import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  message,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import {
  assignVariantImage,
  getAProduct,
  resetState,
  updateAProduct,
  uploadProductImage,
} from '../features/product/productSlice'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

const MAX_PRODUCT_IMAGES = 12
const DEFAULT_VARIANT_ATTRIBUTE = 'variante'

const SPEC_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'textarea', label: 'Texto largo' },
  { value: 'number', label: 'Número' },
  { value: 'select', label: 'Lista' },
  { value: 'multiselect', label: 'Multiselección' },
  { value: 'boolean', label: 'Sí / No' },
  { value: 'color', label: 'Color' },
]

const SHIPPING_TYPES = [
  { value: 'standard', label: 'Envío estándar' },
  { value: 'fragile', label: 'Producto frágil' },
  { value: 'refrigerated', label: 'Refrigerado' },
  { value: 'digital', label: 'Producto digital' },
  { value: 'pickup_only', label: 'Solo retiro' },
  { value: 'custom', label: 'Personalizado' },
]

const pageStyles = {
  page: {
    minHeight: '100vh',
    padding: 24,
    background: 'linear-gradient(180deg, #f6f8fb 0%, #eef3f8 42%, #e9eef5 100%)',
  },
  shell: {
    maxWidth: 1540,
    margin: '0 auto',
  },
  hero: {
    borderRadius: 24,
    padding: '24px 28px',
    background:
      'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.96) 48%, rgba(51, 65, 85, 0.92) 100%)',
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.18)',
    color: '#fff',
    marginBottom: 24,
  },
  heroTitle: {
    color: '#fff',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    marginTop: 6,
    marginBottom: 0,
  },
  card: {
    borderRadius: 18,
    border: '1px solid rgba(148, 163, 184, 0.22)',
    boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
  },
  stickyCard: {
    borderRadius: 18,
    border: '1px solid rgba(148, 163, 184, 0.22)',
    boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
    position: 'sticky',
    top: 20,
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 800,
  },
  muted: {
    color: '#64748b',
  },
  variantHint: {
    marginBottom: 16,
    borderRadius: 14,
  },
  softPanel: {
    borderRadius: 16,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    padding: 16,
  },
}

const createClientId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

const normalizeString = (value = '') => String(value || '').trim()

const normalizeNumber = value => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0
}

const formatMoney = value =>
  `$${Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const slugifyKeyPart = value =>
  normalizeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const slugifySlug = value =>
  normalizeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const humanizeKey = value => {
  const clean = normalizeString(value).replace(/_/g, ' ')
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : ''
}

const uniqueStrings = values => {
  const seen = new Set()
  return (Array.isArray(values) ? values : [])
    .map(normalizeString)
    .filter(Boolean)
    .filter(value => {
      const key = value.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const parseValueList = value =>
  uniqueStrings(
    normalizeString(value)
      .split(/[\n,;|]+/g)
      .map(item => item.trim()),
  )

const normalizeAttributes = attributes => {
  if (!attributes) return {}
  if (attributes instanceof Map) return Object.fromEntries(attributes)
  if (Array.isArray(attributes)) return {}
  if (typeof attributes !== 'object') return {}

  return Object.entries(attributes).reduce((acc, [key, value]) => {
    const cleanKey = slugifyKeyPart(key)
    const cleanValue = normalizeString(value)

    if (cleanKey && cleanValue) {
      acc[cleanKey] = cleanValue
    }

    return acc
  }, {})
}

const parseAttributesInput = value => {
  const cleanValue = normalizeString(value)
  if (!cleanValue) return {}

  const tokens = cleanValue
    .split(/[\n;,|]+/g)
    .map(token => normalizeString(token))
    .filter(Boolean)

  return tokens.reduce((acc, token, index) => {
    const separatorMatch = token.match(/[:=]/)

    if (!separatorMatch) {
      const fallbackKey = index === 0 ? DEFAULT_VARIANT_ATTRIBUTE : `atributo_${index + 1}`
      acc[fallbackKey] = token
      return acc
    }

    const separatorIndex = separatorMatch.index
    const rawKey = token.slice(0, separatorIndex)
    const rawValue = token.slice(separatorIndex + 1)
    const cleanKey = slugifyKeyPart(rawKey)
    const cleanTokenValue = normalizeString(rawValue)

    if (cleanKey && cleanTokenValue) {
      acc[cleanKey] = cleanTokenValue
    }

    return acc
  }, {})
}

const serializeAttributes = attributes => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')
}

const ensureVariantAttributes = variant => {
  const attributes = normalizeAttributes(variant?.attributes || variant?.combinacion)
  if (Object.keys(attributes).length > 0) return attributes

  const fallbackName = normalizeString(variant?.nombre)
  if (!fallbackName) return {}

  return {
    [DEFAULT_VARIANT_ATTRIBUTE]: fallbackName,
  }
}

const buildVariantName = attributes => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .map(([key, value]) => `${humanizeKey(key)}: ${value}`)
    .join(' / ')
}

const buildVariantKey = attributes => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${normalizeString(key)}:${normalizeString(value).toLowerCase()}`)
    .join('|')
}

const normalizeSkuForPayload = value => {
  const clean = normalizeString(value).toUpperCase()

  if (!clean) return ''
  if (/^\d+$/.test(clean)) return ''
  if (/^SKU-?\d+$/i.test(clean)) return ''
  if (/^VAR-?\d+$/i.test(clean)) return ''

  return clean
}

const toUploadFile = (image, index = 0) => ({
  uid: image?.public_id || image?.url || `existing-${index}`,
  name: image?.public_id || `image-${index}`,
  status: 'done',
  url: image?.url,
  public_id: image?.public_id || null,
})

const extractImagesFromUploadResponse = response => {
  if (Array.isArray(response?.data)) return response.data
  if (Array.isArray(response?.images)) return response.images
  if (Array.isArray(response)) return response
  return []
}

const resolveVariantImage = (variantImage, productImages = []) => {
  if (!variantImage?.url) return null

  return (
    productImages.find(
      img => img.url === variantImage.url || img.public_id === variantImage.public_id,
    ) || variantImage
  )
}

const mapServerVariantToEditor = (variant, index, productImages = []) => {
  const attributes = ensureVariantAttributes(variant)

  return {
    key: `server-${variant._id || variant.id || buildVariantKey(attributes) || index}`,
    variantId: variant._id || variant.id || null,
    nombre: variant.nombre || buildVariantName(attributes) || `Variante ${index + 1}`,
    attributes,
    attributeText: serializeAttributes(attributes),
    price: normalizeNumber(variant.price),
    stock: normalizeNumber(variant.stock),
    sku: variant.sku || '',
    isActive: variant.isActive !== false,
    assignedImage: resolveVariantImage(variant.image, productImages),
    isNew: false,
    touched: false,
  }
}

const createVariantFromAttributes = ({
  attributes,
  index,
  basePrice = 0,
  stock = 0,
  assignedImage = null,
  isNew = true,
}) => ({
  key: createClientId('variant'),
  variantId: null,
  nombre: buildVariantName(attributes) || `Variante ${index + 1}`,
  attributes: normalizeAttributes(attributes),
  attributeText: serializeAttributes(attributes),
  price: normalizeNumber(basePrice),
  stock: normalizeNumber(stock),
  sku: '',
  isActive: true,
  assignedImage,
  isNew,
  touched: true,
})

const inferVariantDefinitionsFromVariants = variants => {
  const map = new Map()

  variants.forEach(variant => {
    const attributes = ensureVariantAttributes(variant)

    Object.entries(attributes).forEach(([key, value]) => {
      const name = slugifyKeyPart(key)
      const cleanValue = normalizeString(value)
      if (!name) return

      if (!map.has(name)) {
        map.set(name, {
          id: createClientId('attr'),
          name,
          label: humanizeKey(name),
          type: 'select',
          values: [],
          valuesText: '',
        })
      }

      const entry = map.get(name)
      entry.values = uniqueStrings([...entry.values, cleanValue])
      entry.valuesText = entry.values.join(', ')
    })
  })

  return Array.from(map.values())
}

const mergeVariantDefinitions = (serverDefinitions = [], variants = []) => {
  const inferred = inferVariantDefinitionsFromVariants(variants)
  const map = new Map()

  serverDefinitions.forEach(definition => {
    const name = slugifyKeyPart(definition?.name || definition?.label)
    if (!name) return

    const values = uniqueStrings(Array.isArray(definition?.values) ? definition.values : [])

    map.set(name, {
      id: createClientId('attr'),
      name,
      label: normalizeString(definition?.label) || humanizeKey(name),
      type: definition?.type || 'select',
      values,
      valuesText: values.join(', '),
    })
  })

  inferred.forEach(definition => {
    const current = map.get(definition.name)

    if (!current) {
      map.set(definition.name, definition)
      return
    }

    const values = uniqueStrings([...current.values, ...definition.values])
    map.set(definition.name, {
      ...current,
      values,
      valuesText: values.join(', '),
    })
  })

  return Array.from(map.values())
}

const buildVariantDefinitionsForSave = (definitions = [], variants = []) => {
  return mergeVariantDefinitions(definitions, variants)
    .map(definition => {
      const valuesFromText = parseValueList(definition.valuesText)
      const values = uniqueStrings([...(definition.values || []), ...valuesFromText])

      return {
        name: slugifyKeyPart(definition.name || definition.label),
        label: normalizeString(definition.label) || humanizeKey(definition.name),
        type: definition.type || 'select',
        values,
      }
    })
    .filter(definition => definition.name)
}

const generateCombinations = definitions => {
  const normalizedDefinitions = buildVariantDefinitionsForSave(definitions, [])
    .map(definition => ({
      ...definition,
      values: uniqueStrings(definition.values),
    }))
    .filter(definition => definition.name && definition.values.length > 0)

  if (!normalizedDefinitions.length) return []

  return normalizedDefinitions.reduce(
    (combinations, definition) => {
      const values = definition.values.length ? definition.values : ['']
      return combinations.flatMap(combination =>
        values.map(value => ({
          ...combination,
          [definition.name]: value,
        })),
      )
    },
    [{}],
  )
}

const validateVariantDefinitions = definitions => {
  const cleanDefinitions = buildVariantDefinitionsForSave(definitions, [])

  if (!cleanDefinitions.length) {
    return 'Agregá al menos un atributo para generar variantes, por ejemplo Color o Talle.'
  }

  const duplicated = new Set()
  const names = new Set()

  for (const definition of cleanDefinitions) {
    if (names.has(definition.name)) duplicated.add(definition.name)
    names.add(definition.name)

    if (!definition.values.length) {
      return `El atributo ${definition.label || definition.name} necesita al menos un valor.`
    }
  }

  if (duplicated.size) {
    return `Hay atributos duplicados: ${Array.from(duplicated).join(', ')}`
  }

  return null
}

const validateVariantsBeforeSave = variants => {
  if (!Array.isArray(variants) || variants.length === 0) {
    return 'El producto tiene variantes activadas, pero no tiene variantes cargadas.'
  }

  const keys = new Set()
  const skus = new Set()

  for (const variant of variants) {
    const attributes = ensureVariantAttributes(variant)
    const variantKey = buildVariantKey(attributes)
    const cleanSku = normalizeSkuForPayload(variant.sku)
    const cleanName = normalizeString(variant.nombre)

    if (!cleanName && !variantKey) {
      return 'Cada variante necesita un nombre o una combinación de atributos.'
    }

    if (!variantKey) {
      return `La variante "${cleanName || 'sin nombre'}" no tiene atributos válidos.`
    }

    if (keys.has(variantKey)) {
      return `Hay variantes duplicadas con la misma combinación: ${variantKey}`
    }

    keys.add(variantKey)

    if (cleanSku) {
      if (skus.has(cleanSku)) {
        return `Hay variantes con SKU duplicado: ${cleanSku}`
      }

      skus.add(cleanSku)
    }
  }

  return null
}

const buildVariantPayload = (variant, index) => {
  const attributes = ensureVariantAttributes(variant)
  const cleanSku = normalizeSkuForPayload(variant.sku)
  const variantKey =
    buildVariantKey(attributes) || normalizeString(variant.key) || `variant-${index + 1}`
  const nombre =
    normalizeString(variant.nombre) || buildVariantName(attributes) || `Variante ${index + 1}`

  const payload = {
    key: variantKey,
    nombre,
    attributes,
    combinacion: attributes,
    price: normalizeNumber(variant.price),
    stock: normalizeNumber(variant.stock),
    isActive: variant.isActive !== false,
    image: variant.assignedImage?.url
      ? {
          public_id: variant.assignedImage.public_id || '',
          url: variant.assignedImage.url,
        }
      : null,
  }

  if (variant.variantId) {
    payload._id = variant.variantId
    payload.id = variant.variantId
  }

  if (cleanSku) {
    payload.sku = cleanSku
  }

  return payload
}

const getVariantStatus = variant => {
  const attributes = ensureVariantAttributes(variant)

  if (variant.isNew) return { color: 'blue', label: 'Nueva' }
  if (!variant.isActive) return { color: 'default', label: 'Inactiva' }
  if (!buildVariantKey(attributes)) return { color: 'warning', label: 'Incompleta' }
  if (variant.touched) return { color: 'gold', label: 'Editada' }
  return { color: 'success', label: 'Existente' }
}

const getValueFromMapLike = (value, key) => {
  if (!value || !key) return undefined
  if (value instanceof Map) return value.get(key)
  if (typeof value === 'object' && !Array.isArray(value)) return value[key]
  return undefined
}

const normalizeSpecificationValueForEditor = value => {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === undefined || value === null) return ''
  return String(value)
}

const createSpecificationRow = (partial = {}, index = 0) => {
  const key = slugifyKeyPart(partial.key || partial.name || partial.label)
  const type = normalizeString(partial.type || 'text')

  return {
    id: partial.id || createClientId('spec'),
    key,
    label:
      normalizeString(partial.label || partial.name || humanizeKey(key)) || `Atributo ${index + 1}`,
    value: normalizeSpecificationValueForEditor(partial.value),
    unit: normalizeString(partial.unit),
    type: SPEC_TYPES.some(item => item.value === type) ? type : 'text',
    group: normalizeString(partial.group || 'general'),
    visible: partial.visible !== false,
    filterable: partial.filterable === true,
    searchable: partial.searchable === true,
    sortOrder: Number.isFinite(Number(partial.sortOrder)) ? Number(partial.sortOrder) : index,
    isNew: partial.isNew === true,
  }
}

const normalizeSpecSourceRows = product => {
  if (Array.isArray(product?.specifications) && product.specifications.length > 0) {
    return product.specifications.map((spec, index) => createSpecificationRow(spec, index))
  }

  const candidateObjects = [
    product?.productAttributes,
    product?.categoryAttributes,
    product?.atributos,
  ].filter(value => value && typeof value === 'object' && !Array.isArray(value))

  const rows = []
  const seen = new Set()

  candidateObjects.forEach(source => {
    Object.entries(source instanceof Map ? Object.fromEntries(source) : source).forEach(
      ([rawKey, rawValue]) => {
        const key = slugifyKeyPart(rawKey)
        if (!key || seen.has(key)) return
        seen.add(key)
        rows.push(
          createSpecificationRow({ key, label: humanizeKey(key), value: rawValue }, rows.length),
        )
      },
    )
  })

  return rows
}

const castSpecificationValue = row => {
  const raw = normalizeString(row.value)

  if (row.type === 'number') return normalizeNumber(raw)
  if (row.type === 'boolean') return ['true', 'si', 'sí', '1', 'yes'].includes(raw.toLowerCase())
  if (row.type === 'multiselect') return parseValueList(raw)

  return raw
}

const buildSpecificationsPayload = rows => {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const key = slugifyKeyPart(row.key || row.label)
      const label = normalizeString(row.label) || humanizeKey(key)
      const value = castSpecificationValue(row)

      if (!key || !label) return null
      if (value === '' || value === null || value === undefined) return null
      if (Array.isArray(value) && value.length === 0) return null

      return {
        key,
        label,
        value,
        unit: normalizeString(row.unit),
        type: row.type || 'text',
        group: normalizeString(row.group || 'general'),
        visible: row.visible !== false,
        filterable: row.filterable === true,
        searchable: row.searchable === true,
        sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
      }
    })
    .filter(Boolean)
}

const buildProductAttributesPayload = rows => {
  return buildSpecificationsPayload(rows).reduce((acc, spec) => {
    acc[spec.key] = spec.value
    return acc
  }, {})
}

const buildFilterAttributesPayload = rows => {
  return buildSpecificationsPayload(rows)
    .filter(spec => spec.filterable && spec.value !== undefined && spec.value !== null)
    .flatMap(spec => {
      const values = Array.isArray(spec.value) ? spec.value : [spec.value]

      return values
        .map(value => normalizeString(value).toLowerCase())
        .filter(Boolean)
        .map(value => ({
          key: spec.key,
          label: spec.label,
          value,
        }))
    })
}

const validateSpecificationsBeforeSave = rows => {
  const keys = new Set()

  for (const row of rows || []) {
    const key = slugifyKeyPart(row.key || row.label)
    const label = normalizeString(row.label)
    const value = normalizeString(row.value)

    if (!key && !label && !value) continue

    if (!key || !label) {
      return 'Cada campo dinámico necesita nombre interno y etiqueta visible.'
    }

    if (keys.has(key)) {
      return `Hay campos dinámicos duplicados: ${key}`
    }

    keys.add(key)
  }

  return null
}

const normalizeSeoFromProduct = product => ({
  seoSlug: product?.seo?.slug || product?.slug || '',
  shortDescription:
    product?.seo?.shortDescription || product?.shortDescription || product?.summary || '',
  metaTitle: product?.seo?.metaTitle || product?.metaTitle || '',
  metaDescription: product?.seo?.metaDescription || product?.metaDescription || '',
  seoKeywords: Array.isArray(product?.seo?.keywords)
    ? product.seo.keywords.join(', ')
    : Array.isArray(product?.keywords)
      ? product.keywords.join(', ')
      : '',
})

const normalizeLogisticsFromProduct = product => {
  const logistics = product?.logistics || {}
  const dimensions = logistics.dimensionsCm || product?.dimensionsCm || {}

  return {
    weightKg: normalizeNumber(logistics.weightKg ?? product?.weightKg),
    dimensionLength: normalizeNumber(dimensions.length),
    dimensionWidth: normalizeNumber(dimensions.width),
    dimensionHeight: normalizeNumber(dimensions.height),
    shippingType: logistics.shippingType || 'standard',
    warranty: logistics.warranty || product?.warranty || '',
    originCountry: logistics.originCountry || product?.originCountry || '',
  }
}

const buildSeoPayload = values => ({
  slug: slugifySlug(values.seoSlug || values.title),
  shortDescription: normalizeString(values.shortDescription),
  metaTitle: normalizeString(values.metaTitle),
  metaDescription: normalizeString(values.metaDescription),
  keywords: parseValueList(values.seoKeywords).map(item => item.toLowerCase()),
})

const buildLogisticsPayload = values => ({
  weightKg: normalizeNumber(values.weightKg),
  dimensionsCm: {
    length: normalizeNumber(values.dimensionLength),
    width: normalizeNumber(values.dimensionWidth),
    height: normalizeNumber(values.dimensionHeight),
  },
  shippingType: normalizeString(values.shippingType || 'standard'),
  warranty: normalizeString(values.warranty),
  originCountry: normalizeString(values.originCountry),
})

const VariantImageSelector = ({ value, images, onChange }) => {
  const options = images.map(img => ({
    value: img.url,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img
          src={img.url}
          alt={img.public_id || 'imagen'}
          style={{
            width: 34,
            height: 34,
            objectFit: 'cover',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
          }}
        />
        <span
          style={{
            maxWidth: 210,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {img.public_id || img.url}
        </span>
      </div>
    ),
  }))

  return (
    <Select
      value={value || undefined}
      placeholder={images.length ? 'Seleccionar imagen' : 'Sin imágenes disponibles'}
      style={{ width: '100%' }}
      allowClear
      disabled={!images.length}
      options={options}
      onChange={selectedUrl => {
        const selectedImage = images.find(img => img.url === selectedUrl) || null
        onChange(selectedImage)
      }}
    />
  )
}

const AttributeDefinitionEditor = ({ definitions, onChange, onGenerate, disabled }) => {
  const addAttribute = () => {
    onChange([
      ...definitions,
      {
        id: createClientId('attr'),
        name: '',
        label: '',
        type: 'select',
        values: [],
        valuesText: '',
      },
    ])
  }

  const updateAttribute = (id, patch) => {
    onChange(
      definitions.map(definition => {
        if (definition.id !== id) return definition

        const next = { ...definition, ...patch }

        if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
          next.name = slugifyKeyPart(patch.label)
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'valuesText')) {
          next.values = parseValueList(patch.valuesText)
        }

        return next
      }),
    )
  }

  const removeAttribute = id => {
    onChange(definitions.filter(definition => definition.id !== id))
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        style={pageStyles.variantHint}
        message="Generador visual de variantes"
        description="Definí atributos como Color, Talle o Capacidad y sus valores separados por coma. El editor crea las combinaciones faltantes sin borrar las variantes existentes."
      />

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {definitions.length ? (
          definitions.map((definition, index) => (
            <Card
              key={definition.id}
              size="small"
              style={{ borderRadius: 14, borderColor: '#e2e8f0' }}
              title={`Atributo ${index + 1}`}
              extra={
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeAttribute(definition.id)}
                  disabled={disabled}
                />
              }
            >
              <Row gutter={[12, 12]}>
                <Col xs={24} md={8}>
                  <Text type="secondary">Nombre</Text>
                  <Input
                    value={definition.label}
                    placeholder="Color, Talle, Capacidad"
                    onChange={event =>
                      updateAttribute(definition.id, {
                        label: event.target.value,
                      })
                    }
                    disabled={disabled}
                  />
                  {definition.name && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Clave: {definition.name}
                    </Text>
                  )}
                </Col>
                <Col xs={24} md={16}>
                  <Text type="secondary">Valores</Text>
                  <TextArea
                    value={definition.valuesText}
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    placeholder="Rojo, Azul, Verde"
                    onChange={event =>
                      updateAttribute(definition.id, {
                        valuesText: event.target.value,
                      })
                    }
                    disabled={disabled}
                  />
                  <Space wrap size={[4, 4]} style={{ marginTop: 8 }}>
                    {parseValueList(definition.valuesText).map(value => (
                      <Tag key={value} color="processing">
                        {value}
                      </Tag>
                    ))}
                  </Space>
                </Col>
              </Row>
            </Card>
          ))
        ) : (
          <Empty description="Todavía no definiste atributos de variantes">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={addAttribute}
              disabled={disabled}
            >
              Crear atributo
            </Button>
          </Empty>
        )}
      </Space>

      <Space wrap>
        <Button icon={<PlusOutlined />} onClick={addAttribute} disabled={disabled}>
          Agregar atributo
        </Button>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={onGenerate}
          disabled={disabled}
        >
          Generar combinaciones faltantes
        </Button>
      </Space>
    </Space>
  )
}

const EditProduct = () => {
  const { productId } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [form] = Form.useForm()

  const [fileList, setFileList] = useState([])
  const [variants, setVariants] = useState([])
  const [variantDefinitions, setVariantDefinitions] = useState([])
  const [specificationRows, setSpecificationRows] = useState([])
  const [hasVariants, setHasVariants] = useState(false)
  const [editableTags, setEditableTags] = useState([])
  const [inputTag, setInputTag] = useState('')
  const [isInitializing, setIsInitializing] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [productImages, setProductImages] = useState([])
  const [variantTab, setVariantTab] = useState('generator')

  const {
    singleProduct,
    isLoading,
    isError,
    message: errorMessage,
  } = useSelector(state => state.product)

  const normalizedProduct = useMemo(() => {
    if (!singleProduct || typeof singleProduct !== 'object') return null
    return singleProduct?.data && typeof singleProduct.data === 'object'
      ? singleProduct.data
      : singleProduct
  }, [singleProduct])

  const activeVariantsCount = useMemo(
    () => variants.filter(variant => variant.isActive !== false).length,
    [variants],
  )

  const newVariantsCount = useMemo(
    () => variants.filter(variant => variant.isNew).length,
    [variants],
  )

  const totalVariantStock = useMemo(
    () => variants.reduce((total, variant) => total + normalizeNumber(variant.stock), 0),
    [variants],
  )

  const specificationCount = useMemo(
    () => buildSpecificationsPayload(specificationRows).length,
    [specificationRows],
  )

  const variantValidationMessage = useMemo(
    () => (hasVariants ? validateVariantsBeforeSave(variants) : null),
    [hasVariants, variants],
  )

  useEffect(() => {
    if (!productId) {
      setLoadError('ID de producto no proporcionado')
      setIsInitializing(false)
      return undefined
    }

    setIsInitializing(true)
    setLoadError(null)

    dispatch(getAProduct(productId))
      .unwrap()
      .catch(error => {
        setLoadError(error?.message || 'Error al cargar producto')
        setIsInitializing(false)
      })

    return () => {
      dispatch(resetState())
    }
  }, [dispatch, productId])

  useEffect(() => {
    if (!normalizedProduct) {
      if (isError) setIsInitializing(false)
      return
    }

    try {
      const images = Array.isArray(normalizedProduct.images) ? normalizedProduct.images : []
      const productVariants = Array.isArray(normalizedProduct.variants)
        ? normalizedProduct.variants
        : []
      const mappedVariants = productVariants.map((variant, index) =>
        mapServerVariantToEditor(variant, index, images),
      )
      const seoValues = normalizeSeoFromProduct(normalizedProduct)
      const logisticsValues = normalizeLogisticsFromProduct(normalizedProduct)

      form.setFieldsValue({
        title: normalizedProduct.title || '',
        description: normalizedProduct.description || '',
        price: normalizeNumber(normalizedProduct.price),
        stock: normalizeNumber(normalizedProduct.stock),
        categoria: normalizedProduct.categoria || '',
        subcategoria: normalizedProduct.subcategoria || '',
        marca: normalizedProduct.marca || '',
        condicion: normalizedProduct.condicion || 'nuevo',
        material:
          normalizedProduct.material ||
          getValueFromMapLike(normalizedProduct.atributos, 'material') ||
          '',
        color: Array.isArray(normalizedProduct.color)
          ? normalizedProduct.color.join(', ')
          : normalizeString(
              normalizedProduct.color || getValueFromMapLike(normalizedProduct.atributos, 'color'),
            ),
        ...seoValues,
        ...logisticsValues,
      })

      setEditableTags(Array.isArray(normalizedProduct.tags) ? normalizedProduct.tags : [])
      setFileList(images.map((img, index) => toUploadFile(img, index)))
      setProductImages(images)
      setHasVariants(Boolean(normalizedProduct.hasVariants || mappedVariants.length > 0))
      setVariants(mappedVariants)
      setVariantDefinitions(
        mergeVariantDefinitions(normalizedProduct.variantAttributes || [], mappedVariants),
      )
      setSpecificationRows(normalizeSpecSourceRows(normalizedProduct))
      setIsInitializing(false)
    } catch (error) {
      setLoadError('Error al procesar el producto')
      setIsInitializing(false)
    }
  }, [form, isError, normalizedProduct])

  const updateVariant = useCallback((variantKey, patch) => {
    setVariants(prev =>
      prev.map(variant => {
        if (variant.key !== variantKey) return variant

        const next = {
          ...variant,
          ...patch,
          touched: true,
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'attributeText')) {
          next.attributes = parseAttributesInput(patch.attributeText)
          next.nombre = normalizeString(next.nombre) || buildVariantName(next.attributes)
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'attributes')) {
          next.attributes = normalizeAttributes(patch.attributes)
          next.attributeText = serializeAttributes(next.attributes)
          next.nombre = normalizeString(next.nombre) || buildVariantName(next.attributes)
        }

        return next
      }),
    )
  }, [])

  const updateSpecificationRow = useCallback((rowId, patch) => {
    setSpecificationRows(prev =>
      prev.map(row => {
        if (row.id !== rowId) return row

        const next = { ...row, ...patch }

        if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
          next.key = next.key || slugifyKeyPart(patch.label)
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'key')) {
          next.key = slugifyKeyPart(patch.key)
        }

        return next
      }),
    )
  }, [])

  const handleAddSpecificationRow = useCallback(() => {
    setSpecificationRows(prev => [
      ...prev,
      createSpecificationRow({ isNew: true, label: `Atributo ${prev.length + 1}` }, prev.length),
    ])
  }, [])

  const handleDeleteSpecificationRow = useCallback(row => {
    Modal.confirm({
      title: 'Eliminar campo dinámico',
      content: `¿Querés eliminar "${row.label || row.key}" de la ficha técnica?`,
      okText: 'Eliminar',
      okButtonProps: { danger: true },
      cancelText: 'Cancelar',
      onOk: () => {
        setSpecificationRows(prev => prev.filter(item => item.id !== row.id))
      },
    })
  }, [])

  const handleTagAdd = useCallback(() => {
    const cleanTag = normalizeString(inputTag).toLowerCase()
    if (!cleanTag) return

    if (!editableTags.map(tag => normalizeString(tag).toLowerCase()).includes(cleanTag)) {
      setEditableTags(prev => [...prev, cleanTag])
    }

    setInputTag('')
  }, [editableTags, inputTag])

  const handleTagRemove = useCallback(removedTag => {
    setEditableTags(prev => prev.filter(tag => tag !== removedTag))
  }, [])

  const handleMainImagesChange = useCallback(({ fileList: newFileList }) => {
    if (newFileList.length > MAX_PRODUCT_IMAGES) {
      message.warning(`Máximo ${MAX_PRODUCT_IMAGES} imágenes por producto`)
      return
    }

    setFileList(newFileList)
  }, [])

  const handleAssignImageToVariant = useCallback(
    (variantKey, image) => {
      updateVariant(variantKey, {
        assignedImage: image || null,
      })
    },
    [updateVariant],
  )

  const handleToggleVariants = useCallback(
    checked => {
      setHasVariants(checked)

      if (checked && !variants.length) {
        const price = normalizeNumber(form.getFieldValue('price'))
        const attributes = { [DEFAULT_VARIANT_ATTRIBUTE]: 'opcion-1' }
        const firstVariant = createVariantFromAttributes({
          attributes,
          index: 0,
          basePrice: price,
        })
        setVariants([firstVariant])
        setVariantDefinitions(mergeVariantDefinitions([], [firstVariant]))
        setVariantTab('advanced')
      }
    },
    [form, variants.length],
  )

  const handleAddVariant = useCallback(() => {
    const nextIndex = variants.length + 1
    const definitionName =
      slugifyKeyPart(variantDefinitions[0]?.name || variantDefinitions[0]?.label) ||
      DEFAULT_VARIANT_ATTRIBUTE
    const attributes = { [definitionName]: `opcion-${nextIndex}` }
    const newVariant = createVariantFromAttributes({
      attributes,
      index: variants.length,
      basePrice: normalizeNumber(form.getFieldValue('price')),
    })

    setHasVariants(true)
    setVariantTab('advanced')
    setVariants(prev => [...prev, newVariant])
    setVariantDefinitions(prev => mergeVariantDefinitions(prev, [newVariant]))
  }, [form, variantDefinitions, variants.length])

  const handleGenerateVariants = useCallback(() => {
    const definitionError = validateVariantDefinitions(variantDefinitions)

    if (definitionError) {
      message.error(definitionError)
      return
    }

    const combinations = generateCombinations(variantDefinitions)

    if (!combinations.length) {
      message.warning('No hay combinaciones para generar')
      return
    }

    const existingKeys = new Set(
      variants.map(variant => buildVariantKey(ensureVariantAttributes(variant))).filter(Boolean),
    )
    const basePrice = normalizeNumber(form.getFieldValue('price'))
    const missingCombinations = combinations.filter(
      attributes => !existingKeys.has(buildVariantKey(attributes)),
    )

    if (!missingCombinations.length) {
      message.info('Todas las combinaciones ya existen')
      setHasVariants(true)
      setVariantTab('advanced')
      return
    }

    const newRows = missingCombinations.map((attributes, index) =>
      createVariantFromAttributes({
        attributes,
        index: variants.length + index,
        basePrice,
      }),
    )

    setHasVariants(true)
    setVariantTab('advanced')
    setVariants(prev => [...prev, ...newRows])
    message.success(`Se agregaron ${newRows.length} variantes nuevas`)
  }, [form, variantDefinitions, variants])

  const handleDeleteVariant = useCallback(record => {
    Modal.confirm({
      title: 'Eliminar variante',
      content: `¿Querés eliminar la variante "${record.nombre || 'sin nombre'}"?`,
      okText: 'Eliminar',
      okButtonProps: { danger: true },
      cancelText: 'Cancelar',
      onOk: () => {
        setVariants(prev => prev.filter(variant => variant.key !== record.key))
      },
    })
  }, [])

  const handleSyncDefinitionsFromVariants = useCallback(() => {
    const nextDefinitions = mergeVariantDefinitions(variantDefinitions, variants)
    setVariantDefinitions(nextDefinitions)
    message.success('Atributos sincronizados con las variantes actuales')
  }, [variantDefinitions, variants])

  const syncVariantsWithServerProduct = useCallback((serverProduct, localVariants) => {
    const serverVariants = Array.isArray(serverProduct?.variants) ? serverProduct.variants : []

    return localVariants.map(localVariant => {
      const localAttributes = ensureVariantAttributes(localVariant)
      const localKey = buildVariantKey(localAttributes)
      const localSku = normalizeSkuForPayload(localVariant.sku)
      const localName = normalizeString(localVariant.nombre).toLowerCase()

      const matched = serverVariants.find(serverVariant => {
        const serverAttributes = normalizeAttributes(
          serverVariant.attributes || serverVariant.combinacion || {},
        )
        const serverKey = buildVariantKey(serverAttributes)
        const serverSku = normalizeSkuForPayload(serverVariant.sku)
        const serverName = normalizeString(serverVariant.nombre).toLowerCase()

        return (
          (localVariant.variantId &&
            String(serverVariant._id) === String(localVariant.variantId)) ||
          (serverVariant.key && serverVariant.key === localKey) ||
          (serverKey && serverKey === localKey) ||
          (localSku && serverSku && serverSku === localSku) ||
          (localName && serverName && serverName === localName)
        )
      })

      return {
        ...localVariant,
        variantId: matched?._id || localVariant.variantId || null,
        isNew: false,
        touched: false,
      }
    })
  }, [])

  const handleFinish = async values => {
    if (hasVariants) {
      const variantError = validateVariantsBeforeSave(variants)

      if (variantError) {
        message.error(variantError)
        setVariantTab('advanced')
        return
      }
    }

    const specificationError = validateSpecificationsBeforeSave(specificationRows)
    if (specificationError) {
      message.error(specificationError)
      return
    }

    setIsSaving(true)

    try {
      const colorArray = normalizeString(values.color)
        ? normalizeString(values.color)
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
        : []
      const productAttributes = buildProductAttributesPayload(specificationRows)
      const specifications = buildSpecificationsPayload(specificationRows)
      const logistics = buildLogisticsPayload(values)
      const seo = buildSeoPayload(values)

      const payload = {
        title: normalizeString(values.title),
        description: normalizeString(values.description),
        categoria: normalizeString(values.categoria),
        subcategoria: normalizeString(values.subcategoria),
        marca: normalizeString(values.marca),
        condicion: normalizeString(values.condicion || 'nuevo'),
        material: normalizeString(values.material),
        color: colorArray,
        tags: editableTags.map(tag => normalizeString(tag).toLowerCase()).filter(Boolean),
        price: normalizeNumber(values.price),
        stock: hasVariants ? totalVariantStock : normalizeNumber(values.stock),
        hasVariants,
        visibility: normalizedProduct?.visibility || 'visible',
        status: normalizedProduct?.status || 'active',

        seo,
        shortDescription: seo.shortDescription,
        summary: seo.shortDescription,
        logistics,
        productAttributes,
        categoryAttributes: productAttributes,
        specifications,
        filterAttributes: buildFilterAttributesPayload(specificationRows),

        atributos: {
          ...(normalizedProduct?.atributos || {}),
          ...productAttributes,
          color: colorArray.length === 1 ? colorArray[0] : colorArray,
          material: normalizeString(values.material),
        },
      }

      if (hasVariants) {
        payload.variantAttributes = buildVariantDefinitionsForSave(variantDefinitions, variants)
        payload.variants = variants.map(buildVariantPayload)
      } else {
        payload.variantAttributes = []
        payload.variants = []
      }

      const updatedProductResponse = await dispatch(
        updateAProduct({
          productId,
          data: payload,
        }),
      ).unwrap()

      const updatedProduct = updatedProductResponse?.data || updatedProductResponse
      let mergedImages = Array.isArray(updatedProduct?.images) ? [...updatedProduct.images] : []
      const newFiles = fileList.filter(file => Boolean(file.originFileObj))

      if (newFiles.length > 0) {
        for (const file of newFiles) {
          const uploadResponse = await dispatch(
            uploadProductImage({
              productId,
              imageFile: file.originFileObj,
            }),
          ).unwrap()

          const uploadedImages = extractImagesFromUploadResponse(uploadResponse)
          if (uploadedImages.length > 0) {
            mergedImages = uploadedImages
          }
        }
      }

      setProductImages(mergedImages)
      setFileList(mergedImages.map((img, index) => toUploadFile(img, index)))

      if (hasVariants && variants.length > 0) {
        const latestProductResponse = await dispatch(getAProduct(productId)).unwrap()
        const latestProduct = latestProductResponse?.data || latestProductResponse
        const syncedVariants = syncVariantsWithServerProduct(
          latestProduct || updatedProduct,
          variants,
        )

        for (const variant of syncedVariants) {
          if (!variant.variantId || !variant.assignedImage?.url) continue

          const matchingImage = mergedImages.find(
            img =>
              img.url === variant.assignedImage.url ||
              img.public_id === variant.assignedImage.public_id,
          )

          if (!matchingImage) continue

          await dispatch(
            assignVariantImage({
              productId,
              variantId: variant.variantId,
              image: {
                public_id: matchingImage.public_id,
                url: matchingImage.url,
              },
            }),
          ).unwrap()
        }
      }

      const finalProductResponse = await dispatch(getAProduct(productId)).unwrap()
      const finalProduct = finalProductResponse?.data || finalProductResponse
      const finalVariants = Array.isArray(finalProduct?.variants) ? finalProduct.variants : []
      const mappedFinalVariants = finalVariants.map((variant, index) =>
        mapServerVariantToEditor(variant, index, finalProduct?.images || mergedImages),
      )

      setVariants(mappedFinalVariants)
      setVariantDefinitions(
        mergeVariantDefinitions(finalProduct?.variantAttributes || [], mappedFinalVariants),
      )
      setSpecificationRows(normalizeSpecSourceRows(finalProduct))
      message.success('Producto actualizado con éxito')
      navigate('/admin/productlist')
    } catch (error) {
      message.error(error?.message || error || 'Error al actualizar el producto')
    } finally {
      setIsSaving(false)
    }
  }

  const specificationColumns = useMemo(
    () => [
      {
        title: 'Etiqueta visible',
        dataIndex: 'label',
        key: 'label',
        width: 210,
        render: (_, record) => (
          <Input
            value={record.label}
            placeholder="Material, Pantalla, Cilindrada"
            onChange={event => updateSpecificationRow(record.id, { label: event.target.value })}
          />
        ),
      },
      {
        title: 'Clave',
        dataIndex: 'key',
        key: 'key',
        width: 170,
        render: (_, record) => (
          <Input
            value={record.key}
            placeholder="material"
            onChange={event => updateSpecificationRow(record.id, { key: event.target.value })}
          />
        ),
      },
      {
        title: 'Valor',
        dataIndex: 'value',
        key: 'value',
        width: 260,
        render: (_, record) => {
          if (record.type === 'boolean') {
            return (
              <Select
                value={normalizeString(record.value) || 'false'}
                style={{ width: '100%' }}
                onChange={value => updateSpecificationRow(record.id, { value })}
                options={[
                  { value: 'true', label: 'Sí' },
                  { value: 'false', label: 'No' },
                ]}
              />
            )
          }

          if (record.type === 'textarea') {
            return (
              <TextArea
                value={record.value}
                autoSize={{ minRows: 1, maxRows: 3 }}
                onChange={event =>
                  updateSpecificationRow(record.id, {
                    value: event.target.value,
                  })
                }
              />
            )
          }

          if (record.type === 'number') {
            return (
              <InputNumber
                value={normalizeNumber(record.value)}
                style={{ width: '100%' }}
                min={0}
                onChange={value => updateSpecificationRow(record.id, { value })}
              />
            )
          }

          return (
            <Input
              value={record.value}
              placeholder="Valor visible en la ficha técnica"
              onChange={event => updateSpecificationRow(record.id, { value: event.target.value })}
            />
          )
        },
      },
      {
        title: 'Tipo',
        dataIndex: 'type',
        key: 'type',
        width: 160,
        render: (_, record) => (
          <Select
            value={record.type}
            style={{ width: '100%' }}
            options={SPEC_TYPES}
            onChange={value => updateSpecificationRow(record.id, { type: value })}
          />
        ),
      },
      {
        title: 'Grupo',
        dataIndex: 'group',
        key: 'group',
        width: 150,
        render: (_, record) => (
          <Input
            value={record.group}
            placeholder="general"
            onChange={event => updateSpecificationRow(record.id, { group: event.target.value })}
          />
        ),
      },
      {
        title: 'Unidad',
        dataIndex: 'unit',
        key: 'unit',
        width: 110,
        render: (_, record) => (
          <Input
            value={record.unit}
            placeholder="cm, kg, GB"
            onChange={event => updateSpecificationRow(record.id, { unit: event.target.value })}
          />
        ),
      },
      {
        title: 'Visible',
        key: 'visible',
        width: 90,
        align: 'center',
        render: (_, record) => (
          <Switch
            checked={record.visible !== false}
            onChange={checked => updateSpecificationRow(record.id, { visible: checked })}
          />
        ),
      },
      {
        title: 'Filtro',
        key: 'filterable',
        width: 90,
        align: 'center',
        render: (_, record) => (
          <Switch
            checked={record.filterable === true}
            onChange={checked => updateSpecificationRow(record.id, { filterable: checked })}
          />
        ),
      },
      {
        title: '',
        key: 'delete',
        width: 72,
        align: 'center',
        render: (_, record) => (
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteSpecificationRow(record)}
          />
        ),
      },
    ],
    [handleDeleteSpecificationRow, updateSpecificationRow],
  )

  const variantColumns = useMemo(
    () => [
      {
        title: 'Estado',
        key: 'variantStatus',
        width: 112,
        fixed: 'left',
        render: (_, record) => {
          const status = getVariantStatus(record)
          return <Tag color={status.color}>{status.label}</Tag>
        },
      },
      {
        title: 'Variante visible',
        dataIndex: 'nombre',
        key: 'nombre',
        width: 260,
        fixed: 'left',
        render: (_, record) => (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Input
              value={record.nombre}
              placeholder="Ej: Rojo / Talle M"
              onChange={event => updateVariant(record.key, { nombre: event.target.value })}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Es el nombre que verá el admin y puede mostrarse en el storefront.
            </Text>
          </Space>
        ),
      },
      {
        title: (
          <Space size={4}>
            Combinación real
            <Tooltip title="Formato recomendado: color: rojo, talle: M. Esto alimenta attributes, combinacion y variantAttributes para que el storefront muestre la variante.">
              <InfoCircleOutlined style={{ color: '#94a3b8' }} />
            </Tooltip>
          </Space>
        ),
        dataIndex: 'attributeText',
        key: 'attributeText',
        width: 360,
        render: (_, record) => (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <TextArea
              value={record.attributeText}
              autoSize={{ minRows: 1, maxRows: 3 }}
              placeholder="color: rojo, talle: M"
              onChange={event => updateVariant(record.key, { attributeText: event.target.value })}
            />
            <Space wrap size={[4, 4]}>
              {Object.entries(ensureVariantAttributes(record)).map(([key, value]) => (
                <Tag key={`${record.key}-${key}`} color="geekblue">
                  {humanizeKey(key)}: {value}
                </Tag>
              ))}
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
            min={0}
            value={record.price}
            style={{ width: '100%' }}
            prefix="$"
            onChange={value => updateVariant(record.key, { price: normalizeNumber(value) })}
          />
        ),
      },
      {
        title: 'Stock',
        dataIndex: 'stock',
        key: 'stock',
        width: 130,
        render: (_, record) => (
          <InputNumber
            min={0}
            value={record.stock}
            style={{ width: '100%' }}
            onChange={value => updateVariant(record.key, { stock: normalizeNumber(value) })}
          />
        ),
      },
      {
        title: 'SKU',
        dataIndex: 'sku',
        key: 'sku',
        width: 190,
        render: (_, record) => (
          <Input
            value={record.sku}
            placeholder="Opcional"
            onChange={event => updateVariant(record.key, { sku: event.target.value })}
          />
        ),
      },
      {
        title: 'Imagen específica',
        key: 'assignedImage',
        width: 330,
        render: (_, record) => (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <VariantImageSelector
              value={record.assignedImage?.url || null}
              images={productImages}
              onChange={image => handleAssignImageToVariant(record.key, image)}
            />

            {record.assignedImage?.url ? (
              <Space size="small">
                <Image
                  src={record.assignedImage.url}
                  alt={record.nombre}
                  width={48}
                  height={48}
                  style={{ objectFit: 'cover', borderRadius: 10 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Imagen específica
                </Text>
              </Space>
            ) : (
              <Tag>Usa imagen general</Tag>
            )}
          </Space>
        ),
      },
      {
        title: 'Activa',
        key: 'isActive',
        width: 100,
        align: 'center',
        render: (_, record) => (
          <Switch
            checked={record.isActive !== false}
            onChange={checked => updateVariant(record.key, { isActive: checked })}
          />
        ),
      },
      {
        title: '',
        key: 'actions',
        width: 86,
        align: 'center',
        render: (_, record) => (
          <Tooltip title="Eliminar variante">
            <Button
              danger
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteVariant(record)}
            />
          </Tooltip>
        ),
      },
    ],
    [handleAssignImageToVariant, handleDeleteVariant, productImages, updateVariant],
  )

  if (isInitializing || (isLoading && !normalizedProduct)) {
    return (
      <div style={pageStyles.page}>
        <div style={{ padding: 56, textAlign: 'center' }}>
          <Spin size="large" />
          <Text style={{ display: 'block', marginTop: 16, color: '#64748b' }}>
            Cargando producto...
          </Text>
          <Text style={{ display: 'block', marginTop: 8, color: '#94a3b8' }}>ID: {productId}</Text>
        </div>
      </div>
    )
  }

  if (loadError || (isError && !normalizedProduct)) {
    return (
      <div style={pageStyles.page}>
        <div style={pageStyles.shell}>
          <Alert
            message="Error al cargar el producto"
            description={
              <div>
                <p>{loadError || errorMessage || 'No se pudo cargar el producto'}</p>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ID solicitado: {productId}
                </Text>
              </div>
            }
            type="error"
            showIcon
            style={{ marginBottom: 24, borderRadius: 16 }}
          />
          <Button type="primary" onClick={() => navigate('/admin/productlist')}>
            Volver a la lista de productos
          </Button>
        </div>
      </div>
    )
  }

  if (!normalizedProduct) {
    return (
      <div style={pageStyles.page}>
        <div style={pageStyles.shell}>
          <Card style={pageStyles.card}>
            <Empty description="No se encontró el producto">
              <Button type="primary" onClick={() => navigate('/admin/productlist')}>
                Volver a la lista
              </Button>
            </Empty>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div style={pageStyles.page}>
      <div style={pageStyles.shell}>
        <div style={pageStyles.hero}>
          <Row gutter={[20, 20]} align="middle" justify="space-between">
            <Col xs={24} lg={15}>
              <Space direction="vertical" size={4}>
                <Badge
                  count={normalizedProduct?.status || 'active'}
                  style={{ backgroundColor: '#22c55e' }}
                />
                <Title level={2} style={pageStyles.heroTitle}>
                  {normalizedProduct.title
                    ? `Editar ${normalizedProduct.title}`
                    : 'Editor de producto'}
                </Title>
                <Paragraph style={pageStyles.heroSubtitle}>
                  Editor productivo para información comercial, SEO, ficha técnica, logística,
                  galería y variantes sincronizadas con el storefront.
                </Paragraph>
              </Space>
            </Col>

            <Col xs={24} lg={9}>
              <Row gutter={[12, 12]} justify="end">
                <Col>
                  <Card size="small" style={{ minWidth: 128, borderRadius: 14 }}>
                    <Text type="secondary">Variantes</Text>
                    <Title level={4} style={{ margin: 0 }}>
                      {variants.length}
                    </Title>
                  </Card>
                </Col>
                <Col>
                  <Card size="small" style={{ minWidth: 128, borderRadius: 14 }}>
                    <Text type="secondary">Ficha técnica</Text>
                    <Title level={4} style={{ margin: 0 }}>
                      {specificationCount}
                    </Title>
                  </Card>
                </Col>
                <Col>
                  <Card size="small" style={{ minWidth: 128, borderRadius: 14 }}>
                    <Text type="secondary">Stock</Text>
                    <Title level={4} style={{ margin: 0 }}>
                      {hasVariants
                        ? totalVariantStock
                        : normalizeNumber(form.getFieldValue('stock'))}
                    </Title>
                  </Card>
                </Col>
              </Row>
            </Col>
          </Row>
        </div>

        <Form form={form} layout="vertical" onFinish={handleFinish} scrollToFirstError>
          <Row gutter={[24, 24]} align="top">
            <Col xs={24} xl={16}>
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                <Card
                  style={pageStyles.card}
                  title={
                    <span style={pageStyles.sectionTitle}>
                      <InfoCircleOutlined /> Información general
                    </span>
                  }
                  extra={
                    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
                      Cancelar
                    </Button>
                  }
                >
                  <Form.Item
                    name="title"
                    label="Título del producto"
                    rules={[{ required: true, message: 'El título es obligatorio' }]}
                  >
                    <Input placeholder="Ej: Camiseta de algodón premium" size="large" />
                  </Form.Item>

                  <Form.Item
                    name="description"
                    label="Descripción"
                    rules={[
                      {
                        required: true,
                        message: 'La descripción es obligatoria',
                      },
                    ]}
                  >
                    <TextArea
                      rows={5}
                      placeholder="Describe beneficios, características y detalles relevantes para venta."
                      showCount
                      maxLength={2200}
                    />
                  </Form.Item>

                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="marca"
                        label="Marca"
                        rules={[
                          {
                            required: true,
                            message: 'La marca es obligatoria',
                          },
                        ]}
                      >
                        <Input placeholder="Ej: Nike, Samsung, Genérica" />
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={12}>
                      <Form.Item name="material" label="Material">
                        <Input placeholder="Ej: Algodón, acero, cuero" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="condicion"
                        label="Condición"
                        rules={[
                          {
                            required: true,
                            message: 'La condición es obligatoria',
                          },
                        ]}
                      >
                        <Select placeholder="Seleccionar">
                          <Select.Option value="nuevo">Nuevo</Select.Option>
                          <Select.Option value="usado">Usado</Select.Option>
                          <Select.Option value="reacondicionado">Reacondicionado</Select.Option>
                        </Select>
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={12}>
                      <Form.Item name="color" label="Colores disponibles">
                        <Input placeholder="Rojo, Azul, Verde" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item label="Etiquetas">
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Space wrap style={{ minHeight: 32 }}>
                        {editableTags.length ? (
                          editableTags.map((tag, index) => (
                            <Tag
                              key={`${tag}-${index}`}
                              closable
                              onClose={() => handleTagRemove(tag)}
                              color="blue"
                              style={{ borderRadius: 999, paddingInline: 10 }}
                            >
                              {tag}
                            </Tag>
                          ))
                        ) : (
                          <Text type="secondary">Sin etiquetas cargadas</Text>
                        )}
                      </Space>

                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          placeholder="Agregar etiqueta..."
                          value={inputTag}
                          onChange={event => setInputTag(event.target.value)}
                          onPressEnter={event => {
                            event.preventDefault()
                            handleTagAdd()
                          }}
                        />
                        <Button type="primary" onClick={handleTagAdd} icon={<PlusOutlined />}>
                          Agregar
                        </Button>
                      </Space.Compact>
                    </Space>
                  </Form.Item>
                </Card>

                <Card
                  style={pageStyles.card}
                  title={
                    <span style={pageStyles.sectionTitle}>
                      <EditOutlined /> SEO y contenido comercial
                    </span>
                  }
                >
                  <Alert
                    type="info"
                    showIcon
                    style={pageStyles.variantHint}
                    message="Contenido usado por el storefront"
                    description="La descripción corta se muestra en la página de producto; meta title, meta description y keywords quedan disponibles para SEO y buscadores internos."
                  />

                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="seoSlug" label="Slug SEO">
                        <Input placeholder="mi-producto-premium" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="metaTitle" label="Meta title">
                        <Input maxLength={160} showCount placeholder="Título SEO" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item name="shortDescription" label="Descripción corta">
                        <TextArea
                          rows={3}
                          maxLength={500}
                          showCount
                          placeholder="Resumen comercial para mostrar arriba de la ficha técnica."
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item name="metaDescription" label="Meta description">
                        <TextArea
                          rows={3}
                          maxLength={320}
                          showCount
                          placeholder="Descripción para SEO y previews."
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item name="seoKeywords" label="Keywords">
                        <Input placeholder="remera, algodón, premium" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <Card
                  style={pageStyles.card}
                  title={
                    <span style={pageStyles.sectionTitle}>
                      <ThunderboltOutlined /> Ficha técnica y campos dinámicos por rubro
                    </span>
                  }
                  extra={
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={handleAddSpecificationRow}
                    >
                      Agregar campo
                    </Button>
                  }
                >
                  <Alert
                    type="success"
                    showIcon
                    style={pageStyles.variantHint}
                    message="Relación directa con SingleProduct"
                    description="Estos campos se guardan como specifications, productAttributes y categoryAttributes. En el storefront alimentan la ficha técnica, filtros dinámicos y búsqueda por rubro."
                  />

                  <Table
                    dataSource={specificationRows}
                    columns={specificationColumns}
                    rowKey="id"
                    pagination={false}
                    scroll={{ x: 1450 }}
                    locale={{
                      emptyText: (
                        <Empty description="Sin campos dinámicos todavía">
                          <Button type="primary" onClick={handleAddSpecificationRow}>
                            Crear primer campo
                          </Button>
                        </Empty>
                      ),
                    }}
                  />
                </Card>

                <Card
                  style={pageStyles.card}
                  title={
                    <span style={pageStyles.sectionTitle}>
                      <ClusterOutlined /> Variantes
                    </span>
                  }
                  extra={
                    <Space>
                      <Text type="secondary">Usar variantes</Text>
                      <Switch checked={hasVariants} onChange={handleToggleVariants} />
                    </Space>
                  }
                >
                  {!hasVariants ? (
                    <Alert
                      message="Variantes desactivadas"
                      description="El producto se guardará con precio y stock general. Activá variantes para manejar combinaciones como color, talle, capacidad o presentación."
                      type="info"
                      showIcon
                      style={pageStyles.variantHint}
                    />
                  ) : (
                    <>
                      <Alert
                        message="Editor de variantes sincronizado con storefront"
                        description="Las combinaciones se guardan en attributes, combinacion y variantAttributes. Esto permite que las variantes nuevas se muestren también en el frontend después de guardar."
                        type={variantValidationMessage ? 'warning' : 'success'}
                        showIcon
                        style={pageStyles.variantHint}
                      />

                      {variantValidationMessage && (
                        <Alert
                          type="error"
                          showIcon
                          style={pageStyles.variantHint}
                          message="Revisión necesaria antes de guardar"
                          description={variantValidationMessage}
                        />
                      )}

                      <Space
                        style={{
                          width: '100%',
                          justifyContent: 'space-between',
                          marginBottom: 16,
                        }}
                        wrap
                      >
                        <Space wrap>
                          <Tag color="processing">Total: {variants.length}</Tag>
                          <Tag color="success">Activas: {activeVariantsCount}</Tag>
                          <Tag color="blue">Nuevas: {newVariantsCount}</Tag>
                          <Tag color="geekblue">Stock variantes: {totalVariantStock}</Tag>
                        </Space>

                        <Space wrap>
                          <Button
                            icon={<ReloadOutlined />}
                            onClick={handleSyncDefinitionsFromVariants}
                          >
                            Sincronizar atributos
                          </Button>
                          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddVariant}>
                            Agregar variante manual
                          </Button>
                        </Space>
                      </Space>

                      <Tabs activeKey={variantTab} onChange={setVariantTab}>
                        <Tabs.TabPane
                          tab={
                            <span>
                              <ThunderboltOutlined /> Generador
                            </span>
                          }
                          key="generator"
                        >
                          <AttributeDefinitionEditor
                            definitions={variantDefinitions}
                            onChange={setVariantDefinitions}
                            onGenerate={handleGenerateVariants}
                            disabled={isSaving}
                          />
                        </Tabs.TabPane>
                        <Tabs.TabPane
                          tab={
                            <span>
                              <EditOutlined /> Editor avanzado
                            </span>
                          }
                          key="advanced"
                        >
                          <Table
                            dataSource={variants}
                            pagination={false}
                            size="middle"
                            rowKey="key"
                            columns={variantColumns}
                            scroll={{ x: 1610 }}
                            rowClassName={record => (record.isNew ? 'variant-row-new' : '')}
                            locale={{
                              emptyText: (
                                <Empty description="No hay variantes cargadas">
                                  <Button type="primary" onClick={handleAddVariant}>
                                    Crear primera variante
                                  </Button>
                                </Empty>
                              ),
                            }}
                          />
                        </Tabs.TabPane>
                      </Tabs>
                    </>
                  )}
                </Card>
              </Space>
            </Col>

            <Col xs={24} xl={8}>
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                <Card
                  style={pageStyles.stickyCard}
                  title={
                    <span style={pageStyles.sectionTitle}>
                      <SaveOutlined /> Publicación
                    </span>
                  }
                >
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="price"
                        label="Precio base"
                        rules={[
                          {
                            required: true,
                            message: 'El precio es obligatorio',
                          },
                        ]}
                      >
                        <InputNumber style={{ width: '100%' }} prefix="$" min={0} />
                      </Form.Item>
                    </Col>

                    {!hasVariants && (
                      <Col xs={24} sm={12}>
                        <Form.Item
                          name="stock"
                          label="Stock"
                          rules={[
                            {
                              required: true,
                              message: 'El stock es obligatorio',
                            },
                          ]}
                        >
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                    )}
                  </Row>

                  {hasVariants && (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16, borderRadius: 14 }}
                      message="Stock calculado"
                      description={`El stock general se guardará como la suma de variantes: ${totalVariantStock}.`}
                    />
                  )}

                  <Divider />

                  <Form.Item
                    name="categoria"
                    label="Categoría"
                    rules={[
                      {
                        required: true,
                        message: 'La categoría es obligatoria',
                      },
                    ]}
                  >
                    <Input placeholder="Ej: indumentaria" />
                  </Form.Item>

                  <Form.Item
                    name="subcategoria"
                    label="Subcategoría"
                    rules={[
                      {
                        required: true,
                        message: 'La subcategoría es obligatoria',
                      },
                    ]}
                  >
                    <Input placeholder="Ej: remeras" />
                  </Form.Item>

                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={isSaving || isLoading}
                    icon={<SaveOutlined />}
                    style={{ marginTop: 8, height: 46, borderRadius: 12 }}
                  >
                    Guardar cambios
                  </Button>
                </Card>

                <Card
                  style={pageStyles.card}
                  title={
                    <span style={pageStyles.sectionTitle}>
                      <InfoCircleOutlined /> Logística, garantía y origen
                    </span>
                  }
                >
                  <Row gutter={12}>
                    <Col span={12}>
                      <Form.Item name="weightKg" label="Peso kg">
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="shippingType" label="Tipo de envío">
                        <Select options={SHIPPING_TYPES} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="dimensionLength" label="Largo cm">
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="dimensionWidth" label="Ancho cm">
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="dimensionHeight" label="Alto cm">
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item name="warranty" label="Garantía">
                        <Input placeholder="Ej: 6 meses por fallas de fabricación" />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item name="originCountry" label="País de origen">
                        <Input placeholder="Ej: Argentina" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <Card
                  style={pageStyles.card}
                  title={
                    <span style={pageStyles.sectionTitle}>
                      <PictureOutlined /> Galería
                    </span>
                  }
                >
                  <Paragraph style={pageStyles.muted}>
                    Máximo {MAX_PRODUCT_IMAGES} imágenes. Las variantes pueden usar una imagen
                    específica desde esta galería.
                  </Paragraph>

                  <Upload
                    listType="picture-card"
                    fileList={fileList}
                    onChange={handleMainImagesChange}
                    beforeUpload={() => false}
                    multiple
                  >
                    {fileList.length >= MAX_PRODUCT_IMAGES ? null : (
                      <div>
                        <PlusOutlined />
                        <div style={{ marginTop: 8 }}>Subir</div>
                      </div>
                    )}
                  </Upload>
                </Card>
              </Space>
            </Col>
          </Row>
        </Form>
      </div>

      <style>{`
        .variant-row-new td {
          background: #f0fdf4 !important;
        }
      `}</style>
    </div>
  )
}

export default EditProduct
