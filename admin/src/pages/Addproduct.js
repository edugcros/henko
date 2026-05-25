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
  message,
  Upload,
  Empty,
  Switch,
  Table,
  theme,
  Space,
  Badge,
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
} from '@ant-design/icons'
import { useDispatch, useSelector } from 'react-redux'
import useProductAnalyzer from '../hooks/useProductAnalyzer'
import {
  createProducts,
  uploadProductImage,
  resetState,
  assignVariantImage,
} from '@features/product/productSlice'

const { Title, Text, Paragraph } = Typography
const { Dragger } = Upload
const { useToken } = theme

const normalizeString = (value = '') => String(value || '').trim()

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
  files
    .map(file => buildPreviewFromFile(file))
    .filter(Boolean)

const AIAnalysisPanel = ({ iaResult, loading, error, onReset, confidence = 85 }) => {
  const { token } = useToken()

  if (loading) {
    return (
      <Card
        style={{
          marginBottom: 24,
          borderRadius: 12,
          border: `1px solid ${token.colorPrimary}30`,
          background: `linear-gradient(135deg, ${token.colorPrimary}08 0%, transparent 100%)`,
        }}
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div className="ai-pulse-animation">
            <RobotOutlined style={{ fontSize: 48, color: token.colorPrimary }} />
          </div>
          <Text strong style={{ fontSize: 16, display: 'block', margin: '16px 0 8px' }}>
            Analizando imagen con IA
          </Text>
          <div style={{ width: 200, margin: '0 auto' }}>
            <div
              style={{
                height: 8,
                background: token.colorPrimaryBorder,
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: token.colorPrimary,
                  width: '60%',
                  animation: 'loading 1.5s infinite ease-in-out',
                }}
              />
            </div>
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            Detectando producto, categoría y atributos...
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
          <Button size="small" danger onClick={onReset} icon={<ReloadOutlined />}>
            Reintentar
          </Button>
        }
        style={{ marginBottom: 24, borderRadius: 8 }}
      />
    )
  }

  if (!iaResult) return null

  const suggestedVariants = iaResult.variantes_sugeridas || iaResult.variantes || []
  const detectedAttributes = iaResult.atributos_detectados || iaResult.atributos || {}

  const detectedFields = [
    { key: 'titulo', label: 'Título', icon: <FileTextOutlined />, value: iaResult.titulo },
    { key: 'categoria', label: 'Categoría', icon: <AppstoreOutlined />, value: iaResult.categoria },
    { key: 'subcategoria', label: 'Subcategoría', icon: <BranchesOutlined />, value: iaResult.subcategoria },
    { key: 'marca', label: 'Marca', icon: <ShoppingOutlined />, value: iaResult.marca },
    { key: 'precio', label: 'Precio Sugerido', icon: <DollarOutlined />, value: iaResult.precio_sugerido },
    { key: 'color', label: 'Color', icon: <FormatPainterOutlined />, value: detectedAttributes.color },
    { key: 'material', label: 'Material', icon: <InfoCircleOutlined />, value: detectedAttributes.material },
    { key: 'talla', label: 'Talla/Talle', icon: <CheckOutlined />, value: detectedAttributes.talla || detectedAttributes.talle },
    { key: 'sexo', label: 'Sexo/Género', icon: <CheckOutlined />, value: detectedAttributes.sexo || detectedAttributes.genero },
  ].filter(field => field.value)

  const hasTags = safeArray(iaResult.tags).length > 0
  const hasSuggestedVariants = safeArray(suggestedVariants).length > 0

  return (
    <Card
      style={{
        marginBottom: 24,
        borderRadius: 12,
        border: `1px solid ${token.colorPrimary}40`,
        background: `linear-gradient(135deg, ${token.colorPrimary}10 0%, ${token.colorSuccess}05 100%)`,
        boxShadow: `0 4px 20px ${token.colorPrimary}20`,
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RobotOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
          <span>Análisis de IA Completado</span>
          <Tag color="success" style={{ marginLeft: 8 }}>
            {confidence}% confianza
          </Tag>
          {hasSuggestedVariants && (
            <Badge count={suggestedVariants.length} style={{ backgroundColor: token.colorSuccess }}>
              <Tag color="processing">Variantes detectadas</Tag>
            </Badge>
          )}
        </div>
      }
    >
      <Row gutter={[16, 16]}>
        {detectedFields.map(field => (
          <Col xs={24} sm={12} md={8} key={field.key}>
            <Card
              size="small"
              styles={{ body: { padding: 12 } }}
              style={{
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorder}`,
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <span style={{ color: token.colorPrimary }}>{field.icon}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {field.label}
                </Text>
              </div>
              <Text strong style={{ fontSize: 14 }} ellipsis={{ tooltip: true }}>
                {Array.isArray(field.value) ? field.value.join(', ') : field.value}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      {hasSuggestedVariants && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <ClusterOutlined style={{ color: token.colorPrimary }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Variantes sugeridas por IA
            </Text>
          </div>
          <Space wrap>
            {suggestedVariants.map((variant, idx) => (
              <Tag key={idx} color="purple" style={{ padding: '4px 12px' }}>
                {typeof variant === 'string'
                  ? variant
                  : Object.entries(variant).map(([k, v]) => `${k}:${v}`).join(' / ')}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      {hasTags && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <TagOutlined style={{ color: token.colorPrimary }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Tags detectados
            </Text>
          </div>
          <div>
            {iaResult.tags.map((tag, idx) => (
              <Tag key={idx} color="blue" style={{ margin: '0 4px 4px 0' }}>
                {tag}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {iaResult.descripcion && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <FileTextOutlined style={{ color: token.colorPrimary }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Descripción generada
            </Text>
          </div>
          <Paragraph
            ellipsis={{ rows: 2, expandable: true, symbol: 'Ver más' }}
            style={{
              background: token.colorBgContainer,
              padding: 12,
              borderRadius: 8,
              margin: 0,
              border: `1px solid ${token.colorBorder}`,
            }}
          >
            {iaResult.descripcion}
          </Paragraph>
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
        image={<PictureOutlined style={{ fontSize: 64, color: token.colorTextDisabled }} />}
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
                  type="primary"
                  shape="circle"
                  icon={<EyeOutlined />}
                  size="small"
                  onClick={() => window.open(src, '_blank')}
                  style={{ marginRight: 8 }}
                />
                <Button
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
                <PlusOutlined style={{ fontSize: 24, color: token.colorTextSecondary }} />
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
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

const VariantImageSelector = ({ variant, localImages, onAssign }) => {
  return (
    <Select
      value={variant.imageSourceUid || undefined}
      placeholder="Seleccionar imagen"
      style={{ width: '100%' }}
      onChange={(value) => onAssign(variant.key, value || null)}
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

  const inputRef = useRef(null)

  const user = useSelector(state => state.user.user)
  const tenantId = user?.tenantId?._id || user?.tenantId || null
  const { isLoading, isError, message: productMessage } = useSelector(state => state.product)

  const localImages = useMemo(() => {
    return fileList.map((file, index) => ({
      uid: file.uid,
      name: file.name || `Imagen ${index + 1}`,
      preview: imagePreviews[index] || file.url || '',
    }))
  }, [fileList, imagePreviews])

  const canGenerateVariants = useMemo(() => {
    return Object.values(selectedAttributes).some(values => Array.isArray(values) && values.length > 0)
  }, [selectedAttributes])

  useEffect(() => {
    return () => {
      dispatch(resetState())
      revokeBlobUrls(imagePreviews)
    }
  }, [dispatch, imagePreviews])

  useEffect(() => {
    if (inputVisible) {
      inputRef.current?.focus()
    }
  }, [inputVisible])

  useEffect(() => {
    if (!iaResult) return

    const detectedAttrs = iaResult.atributos_detectados || iaResult.atributos || {}
    const suggestedVariants = iaResult.variantes_sugeridas || iaResult.variantes || []

    const attrsFromIA = []

    if (suggestedVariants.length > 0 && typeof suggestedVariants[0] === 'object') {
      const firstVariant = suggestedVariants[0]
      Object.keys(firstVariant).forEach(key => {
        if (!['precio', 'stock', 'sku', 'price'].includes(key)) {
          attrsFromIA.push({
            name: key,
            label: key.charAt(0).toUpperCase() + key.slice(1),
            type: 'select',
            values: [...new Set(suggestedVariants.map(v => v[key]).filter(Boolean))],
          })
        }
      })
    }

    Object.entries(detectedAttrs).forEach(([key, value]) => {
      if (
        !attrsFromIA.find(attr => attr.name === key) &&
        !['material', 'color', 'descripcion'].includes(key)
      ) {
        attrsFromIA.push({
          name: key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          type: 'select',
          values: Array.isArray(value) ? value : [value],
        })
      }
    })

    if (attrsFromIA.length === 0) {
      if (detectedAttrs.talla || detectedAttrs.talle || iaResult.categoria?.toLowerCase().includes('ropa')) {
        attrsFromIA.push({ name: 'talla', label: 'Talla/Talle', type: 'select', values: [] })
      }
      if (detectedAttrs.color || iaResult.categoria?.toLowerCase().includes('moda')) {
        attrsFromIA.push({ name: 'color', label: 'Color', type: 'color', values: [] })
      }
      if (detectedAttrs.sexo || detectedAttrs.genero) {
        attrsFromIA.push({
          name: 'sexo',
          label: 'Sexo/Género',
          type: 'select',
          values: ['Hombre', 'Mujer', 'Unisex'],
        })
      }
    }

    setDynamicAttributes(attrsFromIA)

    form.setFieldsValue({
      titulo: iaResult.titulo || iaResult.title || '',
      descripcion: iaResult.descripcion || iaResult.description || '',
      categoria: iaResult.categoria || '',
      subcategoria: iaResult.subcategoria || '',
      marca: iaResult.marca || iaResult.brand || '',
      precio: iaResult.precio_sugerido || iaResult.precio || iaResult.price || undefined,
      cantidad: iaResult.cantidad || iaResult.stock || 1,
      condicion: iaResult.condicion || 'nuevo',
      color: Array.isArray(detectedAttrs.color)
        ? detectedAttrs.color.join(', ')
        : detectedAttrs.color || '',
      material: detectedAttrs.material || '',
    })

    if (suggestedVariants.length > 0 || attrsFromIA.length > 0) {
      setHasVariants(true)

      if (suggestedVariants.length > 0) {
        const preloadedVariants = suggestedVariants.map((variant, idx) => {
          const combination =
            typeof variant === 'string'
              ? { variante: variant }
              : Object.fromEntries(
                  Object.entries(variant).filter(([key]) => !['precio', 'stock', 'sku', 'price'].includes(key))
                )

          return {
            key: buildVariantKey(combination) || `v-${idx}-${Date.now()}`,
            nombre: buildVariantName(combination) || `Variante ${idx + 1}`,
            combinacion: combination,
            price: Number(variant.precio || variant.price || iaResult.precio_sugerido || 0),
            stock: Number(variant.stock || 0),
            sku: variant.sku || '',
            isActive: true,
            imageSourceUid: null,
          }
        })

        setVariants(preloadedVariants)

        const usedAttrs = {}
        if (typeof suggestedVariants[0] === 'object') {
          Object.keys(suggestedVariants[0]).forEach(key => {
            if (!['precio', 'stock', 'sku', 'price'].includes(key)) {
              usedAttrs[key] = [...new Set(suggestedVariants.map(item => item[key]).filter(Boolean))]
            }
          })
        }
        setSelectedAttributes(usedAttrs)
      }
    }

    const cleanTags = safeArray(iaResult.tags)
      .map(tag => String(tag).trim())
      .filter(Boolean)

    setEditableTags([...new Set(cleanTags)])
    message.success(`Campos autocompletados por IA${attrsFromIA.length > 0 ? ` • ${attrsFromIA.length} atributos detectados` : ''}`)
  }, [iaResult, form])

  const handleAddCustomAttribute = useCallback(() => {
    const name = window.prompt('Nombre del atributo (ej: material, estilo, lado, talle):')
    if (!name) return

    const label = window.prompt('Etiqueta visible (ej: Material):') || name
    const normalizedName = name.toLowerCase().trim().replace(/\s+/g, '_')

    setDynamicAttributes(prev => {
      if (prev.some(attr => attr.name === normalizedName)) {
        message.warning('Ese atributo ya existe')
        return prev
      }

      return [
        ...prev,
        {
          name: normalizedName,
          label: label.trim(),
          type: 'select',
          values: [],
        },
      ]
    })
  }, [])

  const handleAttributeValuesChange = useCallback((attrName, values) => {
    setSelectedAttributes(prev => ({
      ...prev,
      [attrName]: safeArray(values).filter(Boolean),
    }))
  }, [])

  const generateVariantsFromAttributes = useCallback(() => {
    const activeAttrs = dynamicAttributes.filter(
      attr => Array.isArray(selectedAttributes[attr.name]) && selectedAttributes[attr.name].length > 0
    )

    if (activeAttrs.length === 0) {
      message.warning('Selecciona al menos un atributo con valores')
      return
    }

    const generateCombinations = (attrs, index = 0, current = {}) => {
      if (index === attrs.length) return [current]

      const attr = attrs[index]
      const values = selectedAttributes[attr.name] || []
      const result = []

      values.forEach(value => {
        result.push(
          ...generateCombinations(attrs, index + 1, {
            ...current,
            [attr.name]: value,
          })
        )
      })

      return result
    }

    const combinations = generateCombinations(activeAttrs)
    const basePrice = Number(form.getFieldValue('precio') || 0)
    const previousByKey = new Map(variants.map(variant => [variant.key, variant]))

    const newVariants = combinations.map((combination, idx) => {
      const key = buildVariantKey(combination) || `v-${idx}-${Date.now()}`
      const previous = previousByKey.get(key)

      return {
        key,
        nombre: buildVariantName(combination),
        combinacion: combination,
        price: previous?.price ?? basePrice,
        stock: previous?.stock ?? 0,
        sku: previous?.sku ?? '',
        isActive: previous?.isActive ?? true,
        imageSourceUid: previous?.imageSourceUid ?? null,
      }
    })

    setVariants(newVariants)
    message.success(`${newVariants.length} variantes generadas`)
  }, [dynamicAttributes, form, selectedAttributes, variants])

  const handleUploadChange = useCallback(({ fileList: newFileList }) => {
    const uniqueFiles = dedupeByUid(newFileList)

    revokeBlobUrls(imagePreviews)
    setFileList(uniqueFiles)
    setImagePreviews(rebuildPreviews(uniqueFiles))

    if (uniqueFiles.length > 0 && !iaResult && !loadingIa) {
      const fileToAnalyze = uniqueFiles[0]?.originFileObj
      if (fileToAnalyze) analyzeImage(fileToAnalyze)
    }
  }, [analyzeImage, iaResult, imagePreviews, loadingIa])

  const handleAddMoreImages = useCallback(({ fileList: incomingFiles }) => {
    setFileList(prevList => {
      const merged = dedupeByUid([...prevList, ...incomingFiles])
      revokeBlobUrls(imagePreviews)
      setImagePreviews(rebuildPreviews(merged))
      return merged
    })
  }, [imagePreviews])

  const handleRemove = useCallback((file) => {
    const updated = fileList.filter(item => item.uid !== file.uid)

    revokeBlobUrls(imagePreviews)
    setFileList(updated)
    setImagePreviews(rebuildPreviews(updated))

    setVariants(prev =>
      prev.map(variant =>
        variant.imageSourceUid === file.uid
          ? { ...variant, imageSourceUid: null }
          : variant
      )
    )

    if (!updated.length) {
      resetIa()
      setDynamicAttributes([])
      setSelectedAttributes({})
      setVariants([])
    }
  }, [fileList, imagePreviews, resetIa])

  const handleCloseTag = useCallback((removedTag) => {
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
          : variant
      )
    )
  }, [])


  const handleFinish = async (values) => {
    if (!fileList.length) {
      message.error('Debes subir al menos una imagen')
      return
    }

    if (!tenantId) {
      message.error('Tenant no disponible')
      return
    }

    if (hasVariants) {
      const invalidVariants = variants.filter(
        variant =>
          variant.isActive !== false &&
          (!normalizeString(variant.sku) || Number(variant.stock) < 0 || Number(variant.price) < 0)
      )

      if (invalidVariants.length > 0) {
        message.error(`Hay ${invalidVariants.length} variantes con datos incompletos`)
        return
      }
    }

    try {
      const colorArray = normalizeString(values.color)
        ? values.color.split(',').map(color => color.trim().toLowerCase()).filter(Boolean)
        : []

      const variantAttributesConfig = hasVariants
        ? dynamicAttributes
            .filter(attr => Array.isArray(selectedAttributes[attr.name]) && selectedAttributes[attr.name].length > 0)
            .map(attr => ({
              name: attr.name,
              label: attr.label,
              type: attr.type || 'select',
            }))
        : []

      const payloadVariants = hasVariants
        ? variants.map((variant, idx) => ({
            key: buildVariantKey(variant.combinacion) || `variant-${idx + 1}`,
            sku: normalizeString(variant.sku) || `SKU-${idx + 1}`,
            attributes: variant.combinacion,
            price: Number(variant.price || 0),
            stock: Number(variant.stock || 0),
            isActive: variant.isActive !== false,
          }))
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
        categoria: normalizeString(values.categoria).toLowerCase(),
        subcategoria: normalizeString(values.subcategoria),
        marca: normalizeString(values.marca),
        price: Number(values.precio || 0),
        stock: hasVariants ? 0 : Number(values.cantidad || 0),
        condicion: values.condicion,

        color: colorArray,
        material: normalizeString(values.material),

        atributos: {
          color: colorArray.length === 1 ? colorArray[0] : colorArray,
          material: normalizeString(values.material),
        },

        hasVariants,
        variantAttributes: variantAttributesConfig,
        variants: payloadVariants,
        tags: editableTags.map(tag => tag.toLowerCase().trim()),

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

        status: 'active',
        visibility: 'visible',
      }

      console.log('[CREATE PRODUCT PAYLOAD COMPLETO]', productPayload)

console.log('[CREATE PRODUCT PAYLOAD AI]', {
  iaResultExists: Boolean(iaResult),
  iaResultType: typeof iaResult,
  iaGenerated: productPayload.iaGenerated,
  hasAiOriginalOutput: Boolean(productPayload.aiOriginalOutput),
  aiOriginalOutputType: typeof productPayload.aiOriginalOutput,
  aiOriginalOutputPreview:
    typeof productPayload.aiOriginalOutput === 'string'
      ? productPayload.aiOriginalOutput.slice(0, 200)
      : productPayload.aiOriginalOutput,
  aiConfidence: productPayload.aiConfidence,
  aiSource: productPayload.aiSource,
  aiImageHash: productPayload.aiImageHash,
})

      const created = await dispatch(createProducts(productPayload)).unwrap()
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
          })
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

          const selectedUploadedImage = uploadedByUid.get(localVariant.imageSourceUid)
          if (!selectedUploadedImage?.url) continue

          const createdVariant = createdVariants.find(variant =>
            variant.key === localVariant.key ||
            buildVariantKey(variant.attributes || {}) === localVariant.key
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
            })
          ).unwrap()
        }
      }

      message.success(
        hasVariants
          ? `Producto creado correctamente con ${variants.length} variantes`
          : 'Producto creado correctamente'
      )

      form.resetFields()
      revokeBlobUrls(imagePreviews)
      setFileList([])
      setImagePreviews([])
      setEditableTags([])
      setVariants([])
      setHasVariants(false)
      setDynamicAttributes([])
      setSelectedAttributes({})
      setInputTagValue('')
      setInputVisible(false)
      resetIa()
    } catch (error) {
      console.error('Error al crear producto:', error)
      message.error(error?.message || 'Error al crear producto')
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: token.colorBgLayout,
        padding: '24px',
      }}
    >
      <Row justify="center">
        <Col xs={24} xl={20} xxl={16}>
          <div style={{ marginBottom: 24, textAlign: 'center' }}>
            <Title level={2} style={{ margin: 0 }}>
              <ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 12 }} />
              Agregar Producto
            </Title>
            <Text type="secondary">
              Sube imágenes, crea variantes y asigna una imagen específica a cada una
            </Text>
          </div>

          <Form form={form} layout="vertical" onFinish={handleFinish}>
            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PictureOutlined />
                  <span>Imágenes del Producto</span>
                  <Tag color="red">Requerido</Tag>
                </div>
              }
              style={{ marginBottom: 24, borderRadius: 12 }}
            >
              {!fileList.length ? (
                <Dragger
                  multiple
                  beforeUpload={() => false}
                  fileList={fileList}
                  onChange={handleUploadChange}
                  onRemove={handleRemove}
                  showUploadList={false}
                  style={{
                    borderRadius: 12,
                    padding: 40,
                    background: token.colorBgContainer,
                    border: `2px dashed ${token.colorBorder}`,
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: '50%',
                        background: `${token.colorPrimary}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px',
                      }}
                    >
                      <InboxOutlined style={{ fontSize: 36, color: token.colorPrimary }} />
                    </div>
                    <Text strong style={{ fontSize: 16, display: 'block' }}>
                      Arrastra imágenes aquí
                    </Text>
                    <Text type="secondary">o haz clic para seleccionar archivos</Text>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                      Soporta JPG, PNG y WEBP
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
              onReset={resetIa}
            />

            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShoppingOutlined />
                  <span>Información del Producto</span>
                </div>
              }
              style={{ marginBottom: 24, borderRadius: 12 }}
            >
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <Form.Item
                    name="titulo"
                    label="Título del producto"
                    rules={[{ required: true, message: 'El título es obligatorio' }]}
                  >
                    <Input
                      size="large"
                      placeholder="Ej: Zapatillas Nike Air Max 90"
                      prefix={<FileTextOutlined style={{ color: token.colorTextSecondary }} />}
                      showCount
                      maxLength={120}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24}>
                  <Form.Item
                    name="descripcion"
                    label="Descripción"
                    rules={[{ required: true, message: 'La descripción es obligatoria' }]}
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder="Describe el producto con detalle..."
                      showCount
                      maxLength={2000}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    name="categoria"
                    label="Categoría"
                    rules={[{ required: true, message: 'La categoría es obligatoria' }]}
                  >
                    <Input
                      size="large"
                      placeholder="Ej: calzado deportivo"
                      prefix={<BranchesOutlined style={{ color: token.colorTextSecondary }} />}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    name="subcategoria"
                    label="Subcategoría"
                    rules={[{ required: true, message: 'La subcategoría es obligatoria' }]}
                  >
                    <Input
                      size="large"
                      placeholder="Ej: running"
                      prefix={<BranchesOutlined style={{ color: token.colorTextSecondary }} />}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    name="marca"
                    label="Marca"
                    rules={[{ required: true, message: 'La marca es obligatoria' }]}
                  >
                    <Input
                      size="large"
                      placeholder="Ej: Nike"
                      prefix={<ShoppingOutlined style={{ color: token.colorTextSecondary }} />}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item name="material" label="Material">
                    <Input
                      size="large"
                      placeholder="Ej: cuero, malla, aluminio"
                      prefix={<InfoCircleOutlined style={{ color: token.colorTextSecondary }} />}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item name="color" label="Color general">
                    <Input
                      size="large"
                      placeholder="Ej: Negro, Rojo, Azul"
                      prefix={<FormatPainterOutlined style={{ color: token.colorTextSecondary }} />}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ClusterOutlined />
                  <span>Variantes del Producto</span>
                  {dynamicAttributes.length > 0 && (
                    <Tag color="success">{dynamicAttributes.length} atributos detectados</Tag>
                  )}
                </div>
              }
              extra={
                <Switch
                  checked={hasVariants}
                  onChange={(checked) => {
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
              style={{ marginBottom: 24, borderRadius: 12 }}
            >
              {hasVariants ? (
                <>
                  <Alert
                    message="Configura atributos, genera combinaciones y asigna una imagen específica por variante."
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />

                  {dynamicAttributes.length > 0 ? (
                    <>
                      <Row gutter={16} style={{ marginBottom: 16 }}>
                        {dynamicAttributes.map(attr => (
                          <Col span={12} key={attr.name}>
                            <Form.Item
                              label={
                                <Space>
                                  {attr.label}
                                  {attr.values.length > 0 && (
                                    <Tag size="small" color="blue">
                                      {attr.values.length} sugeridos
                                    </Tag>
                                  )}
                                </Space>
                              }
                            >
                              <Select
                                mode="tags"
                                placeholder={`Selecciona o escribe ${attr.label.toLowerCase()}`}
                                value={selectedAttributes[attr.name] || []}
                                onChange={(values) => handleAttributeValuesChange(attr.name, values)}
                                tokenSeparators={[',']}
                                allowClear
                                options={attr.values.map(value => ({ value, label: value }))}
                              />
                            </Form.Item>
                          </Col>
                        ))}
                      </Row>

                      <Button
                        type="dashed"
                        onClick={handleAddCustomAttribute}
                        icon={<PlusOutlined />}
                        style={{ marginBottom: 16, marginRight: 8 }}
                      >
                        Agregar atributo personalizado
                      </Button>

                      <Button
                        type="primary"
                        onClick={generateVariantsFromAttributes}
                        icon={<ReloadOutlined />}
                        disabled={!canGenerateVariants}
                        style={{ marginBottom: 16 }}
                      >
                        Generar combinaciones
                      </Button>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <Text type="secondary">La IA no detectó atributos específicos.</Text>
                      <br />
                      <Button
                        type="primary"
                        onClick={handleAddCustomAttribute}
                        icon={<PlusOutlined />}
                        style={{ marginTop: 8 }}
                      >
                        Agregar atributo manualmente
                      </Button>
                    </div>
                  )}

                  {variants.length > 0 && (
                    <>
                      <Divider orientation="left">
                        <AppstoreOutlined /> {variants.length} variantes configuradas
                      </Divider>

                      <Table
                        dataSource={variants}
                        pagination={false}
                        size="middle"
                        scroll={{ x: 1200 }}
                        rowKey="key"
                        columns={[
                          {
                            title: 'Combinación',
                            dataIndex: 'nombre',
                            key: 'nombre',
                            width: 240,
                            render: (_, record) => (
                              <div>
                                <Tag color="blue" style={{ fontSize: 13, padding: '4px 8px' }}>
                                  {record.nombre}
                                </Tag>
                                <br />
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {Object.entries(record.combinacion).map(([k, v]) => `${k}:${v}`).join(', ')}
                                </Text>
                              </div>
                            ),
                          },
                          {
                            title: 'Precio ($)',
                            dataIndex: 'price',
                            key: 'price',
                            width: 150,
                            render: (_, record) => (
                              <InputNumber
                                prefix="$"
                                style={{ width: '100%' }}
                                min={0}
                                value={record.price}
                                onChange={(val) => {
                                  setVariants(prev =>
                                    prev.map(variant =>
                                      variant.key === record.key
                                        ? { ...variant, price: Number(val || 0) }
                                        : variant
                                    )
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
                                onChange={(val) => {
                                  setVariants(prev =>
                                    prev.map(variant =>
                                      variant.key === record.key
                                        ? { ...variant, stock: Number(val || 0) }
                                        : variant
                                    )
                                  )
                                }}
                              />
                            ),
                          },
                          {
                            title: 'SKU',
                            dataIndex: 'sku',
                            key: 'sku',
                            width: 180,
                            render: (_, record) => (
                              <Input
                                placeholder="Código único"
                                value={record.sku}
                                onChange={(e) => {
                                  setVariants(prev =>
                                    prev.map(variant =>
                                      variant.key === record.key
                                        ? { ...variant, sku: e.target.value }
                                        : variant
                                    )
                                  )
                                }}
                              />
                            ),
                          },
                          {
                            title: 'Imagen de variante',
                            key: 'image',
                            width: 320,
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
                            width: 100,
                            render: (_, record) => {
                              const selectedLocal = localImages.find(img => img.uid === record.imageSourceUid)
                              return selectedLocal?.preview ? (
                                <img
                                  src={selectedLocal.preview}
                                  alt={record.nombre}
                                  style={{
                                    width: 56,
                                    height: 56,
                                    objectFit: 'cover',
                                    borderRadius: 8,
                                    border: '1px solid #eee',
                                  }}
                                />
                              ) : (
                                <Tag>Sin imagen</Tag>
                              )
                            },
                          },
                          {
                            title: 'Activo',
                            key: 'active',
                            width: 80,
                            align: 'center',
                            render: (_, record) => (
                              <Switch
                                checked={record.isActive !== false}
                                onChange={(checked) => {
                                  setVariants(prev =>
                                    prev.map(variant =>
                                      variant.key === record.key
                                        ? { ...variant, isActive: checked }
                                        : variant
                                    )
                                  )
                                }}
                                size="small"
                              />
                            ),
                          },
                          {
                            title: '',
                            key: 'delete',
                            width: 50,
                            render: (_, record) => (
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => {
                                  setVariants(prev => prev.filter(variant => variant.key !== record.key))
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
                        style={{ marginTop: 16 }}
                        message="Si una variante no tiene imagen asignada, en la tienda se mostrará la imagen general del producto."
                      />
                    </>
                  )}
                </>
              ) : (
                <Text type="secondary">Este producto no tiene variaciones.</Text>
              )}
            </Card>

            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DollarOutlined />
                  <span>Precio y Disponibilidad</span>
                  {hasVariants && <Tag color="blue">Gestión por variantes</Tag>}
                </div>
              }
              style={{ marginBottom: 24, borderRadius: 12 }}
            >
              <Row gutter={[16, 16]}>
                <Col xs={24} md={hasVariants ? 12 : 8}>
                  <Form.Item
                    name="precio"
                    label={hasVariants ? 'Precio Base (referencia)' : 'Precio'}
                    rules={[{ required: true, message: 'El precio es obligatorio' }]}
                  >
                    <InputNumber
                      size="large"
                      style={{ width: '100%' }}
                      min={0}
                      precision={2}
                      prefix="$"
                      placeholder="0.00"
                      onChange={(value) => {
                        if (hasVariants && variants.length > 0) {
                          setVariants(prev =>
                            prev.map(variant => ({
                              ...variant,
                              price: Number(variant.price || 0) === 0 ? Number(value || 0) : variant.price,
                            }))
                          )
                        }
                      }}
                    />
                  </Form.Item>
                </Col>

                {!hasVariants && (
                  <Col xs={24} md={8}>
                    <Form.Item
                      name="cantidad"
                      label="Cantidad en Stock"
                      rules={[{ required: true, message: 'La cantidad es obligatoria' }]}
                    >
                      <InputNumber
                        size="large"
                        style={{ width: '100%' }}
                        min={1}
                        placeholder="1"
                        prefix={<NumberOutlined style={{ color: token.colorTextSecondary }} />}
                      />
                    </Form.Item>
                  </Col>
                )}

                <Col xs={24} md={hasVariants ? 12 : 8}>
                  <Form.Item
                    name="condicion"
                    label="Condición"
                    rules={[{ required: true, message: 'La condición es obligatoria' }]}
                  >
                    <Select size="large" placeholder="Selecciona la condición">
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
                  </Form.Item>
                </Col>
              </Row>

              {hasVariants && (
                <Alert
                  message="El stock y la imagen se gestionan por variante. Si falta imagen de variante, se usa la imagen general."
                  type="info"
                  showIcon
                  style={{ marginTop: 16 }}
                />
              )}
            </Card>

            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TagOutlined />
                  <span>Tags y Etiquetas</span>
                </div>
              }
              style={{ marginBottom: 24, borderRadius: 12 }}
            >
              <div style={{ marginBottom: 16 }}>
                {editableTags.map(tag => (
                  <Tag
                    key={tag}
                    closable
                    onClose={() => handleCloseTag(tag)}
                    color="blue"
                    style={{ padding: '4px 12px', fontSize: 14, margin: '0 8px 8px 0' }}
                  >
                    {tag}
                  </Tag>
                ))}

                {inputVisible ? (
                  <Input
                    ref={inputRef}
                    type="text"
                    size="small"
                    style={{ width: 120 }}
                    value={inputTagValue}
                    onChange={(e) => setInputTagValue(e.target.value)}
                    onBlur={handleInputConfirm}
                    onPressEnter={handleInputConfirm}
                  />
                ) : (
                  <Tag
                    onClick={() => setInputVisible(true)}
                    icon={<PlusOutlined />}
                    style={{
                      padding: '4px 12px',
                      fontSize: 14,
                      cursor: 'pointer',
                      borderStyle: 'dashed',
                    }}
                  >
                    Agregar Tag
                  </Tag>
                )}
              </div>

              <Text type="secondary" style={{ fontSize: 12 }}>
                Los tags ayudan a encontrar el producto más fácilmente.
              </Text>
            </Card>

            <Card style={{ borderRadius: 12 }}>
              <Row gutter={16} align="middle">
                <Col xs={24} md={16}>
                  {isError && (
                    <Alert
                      type="error"
                      message={productMessage || 'Error guardando producto'}
                      showIcon
                    />
                  )}
                </Col>

                <Col xs={24} md={8}>
                  <Button
                    htmlType="submit"
                    type="primary"
                    size="large"
                    block
                    loading={isLoading}
                    icon={<CheckCircleOutlined />}
                    style={{ height: 48, fontSize: 16, borderRadius: 8 }}
                  >
                    {isLoading
                      ? 'Guardando...'
                      : hasVariants
                        ? `Guardar con ${variants.length} Variantes`
                        : 'Guardar Producto'}
                  </Button>
                </Col>
              </Row>
            </Card>
          </Form>
        </Col>
      </Row>

      <style>{`
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