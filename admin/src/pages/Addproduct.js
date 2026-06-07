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
  files
    .map(file => buildPreviewFromFile(file))
    .filter(Boolean)

const waitForUiReset = () =>
  new Promise(resolve => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
      return
    }

    setTimeout(resolve, 0)
  })

const buildProductPayloadFromAnalysis = ({
  analysis,
  job,
  user,
  publish = false,
  automationMode = 'agent-assisted',
}) => {
  const detectedAttrs = analysis?.atributos_detectados || analysis?.atributos || {}
  const colorValue = Array.isArray(detectedAttrs.color)
    ? detectedAttrs.color.join(', ')
    : detectedAttrs.color || analysis?.color || ''
  const colorArray = normalizeString(colorValue)
    ? String(colorValue).split(',').map(color => color.trim().toLowerCase()).filter(Boolean)
    : []
  const title =
    normalizeString(analysis?.titulo || analysis?.title) ||
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

  return {
    title,
    description:
      normalizeString(analysis?.descripcion || analysis?.description) ||
      'Descripción generada automáticamente pendiente de revisión.',
    categoria: normalizeString(analysis?.categoria || analysis?.category || 'sin categoria').toLowerCase(),
    subcategoria: normalizeString(analysis?.subcategoria || analysis?.subcategory || 'general'),
    marca: normalizeString(analysis?.marca || analysis?.brand || 'sin marca'),
    price: Number(analysis?.precio_sugerido || analysis?.suggestedPrice || analysis?.precio || analysis?.price || 0),
    stock: Number(analysis?.cantidad || analysis?.stock || 1),
    condicion: analysis?.condicion || 'nuevo',
    color: colorArray,
    material: normalizeString(detectedAttrs.material || analysis?.material),
    atributos: {
      ...(detectedAttrs && typeof detectedAttrs === 'object' ? detectedAttrs : {}),
      color: colorArray.length === 1 ? colorArray[0] : colorArray,
      material: normalizeString(detectedAttrs.material || analysis?.material),
    },
    hasVariants: false,
    variantAttributes: [],
    variants: [],
    tags: safeArray(analysis?.tags).map(tag => String(tag).toLowerCase().trim()).filter(Boolean),
    iaGenerated: true,
    aiOriginalOutput: JSON.stringify(normalizedAnalysis),
    aiConfidence: normalizedAnalysis?.confidence ?? null,
    aiSource: normalizedAnalysis?.source || normalizedAnalysis?.model || 'gemini',
    aiImageHash: normalizedAnalysis?.hash || normalizedAnalysis?.imageHash || job?.imageHash || null,
    aiNeedsReview: normalizedAnalysis?.needsReview === true || normalizedAnalysis?.requiresHumanReview === true,
    aiAgentJobId: job?._id || null,
    aiAgentScheduledAt: job?.scheduledAt || job?.metadata?.addProductAt || null,
    aiAutomationMode: automationMode,
    status: publish ? 'active' : 'draft',
    visibility: publish ? 'visible' : 'hidden',
  }
}

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
  const [agentQueue, setAgentQueue] = useState([])
  const [selectedAgentJobId, setSelectedAgentJobId] = useState(null)
  const [loadingAgentQueue, setLoadingAgentQueue] = useState(false)
  const [importingAgentImage, setImportingAgentImage] = useState(false)
  const [deletingAgentImage, setDeletingAgentImage] = useState(false)
  const [autoAgentEnabled, setAutoAgentEnabled] = useState(() =>
    getStoredBoolean('addProduct.agentAutoMode', false)
  )
  const [autoAgentRunning, setAutoAgentRunning] = useState(false)
  const [currentAgentJob, setCurrentAgentJob] = useState(null)

  const inputRef = useRef(null)
  const autoAgentRef = useRef(false)
  const autoAgentFailedJobsRef = useRef(new Set())

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
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('addProduct.agentAutoMode', String(autoAgentEnabled))
    }
  }, [autoAgentEnabled])

  const fetchAgentQueue = useCallback(async () => {
    setLoadingAgentQueue(true)
    try {
      await api.post('/product-analysis/process-due')
      const { data } = await api.get('/product-analysis', {
        params: {
          limit: 25,
          sort: 'createdAt',
        },
      })

      const items = (Array.isArray(data?.items) ? data.items : [])
        .filter(item =>
          ['pending', 'scheduled'].includes(item.status) &&
          item.metadata?.autoAnalyze === false
        )
      setAgentQueue(items)
      setSelectedAgentJobId(current =>
        current && items.some(item => item._id === current) ? current : items[0]?._id || null
      )
    } catch (error) {
      message.error(error?.response?.data?.message || 'No se pudo cargar la cola del agente')
    } finally {
      setLoadingAgentQueue(false)
    }
  }, [])

  useEffect(() => {
    fetchAgentQueue()
  }, [fetchAgentQueue])

  useEffect(() => {
    const interval = setInterval(fetchAgentQueue, 30000)
    return () => clearInterval(interval)
  }, [fetchAgentQueue])

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
      precio: iaResult.precio_sugerido || iaResult.precio || iaResult.price ,
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

  const handleImportAgentImage = useCallback(async () => {
    if (!selectedAgentJobId) {
      message.warning('No hay imágenes pendientes del agente')
      return
    }

    const selectedJob = selectedAgentJob

    if (selectedJob?.status === 'scheduled') {
      message.warning('La imagen todavía está programada. Va a estar disponible en el horario indicado.')
      return
    }

    setImportingAgentImage(true)
    try {
      const response = await api.get(`/product-analysis/${selectedAgentJobId}/image-file`, {
        responseType: 'blob',
      })

      const blob = response.data
      const filename = selectedJob?.originalFilename || `agent-image-${Date.now()}.jpg`
      const mimeType = blob?.type || selectedJob?.metadata?.mimeType || 'image/jpeg'
      const imageFile = new File([blob], filename, { type: mimeType })
      const uploadFile = {
        uid: `agent-${selectedAgentJobId}-${Date.now()}`,
        name: filename,
        status: 'done',
        originFileObj: imageFile,
        type: mimeType,
        size: imageFile.size,
      }

      const merged = dedupeByUid([...fileList, uploadFile])
      revokeBlobUrls(imagePreviews)
      setFileList(merged)
      setImagePreviews(rebuildPreviews(merged))

      await api.post(`/product-analysis/${selectedAgentJobId}/import-to-add-product`)
      setCurrentAgentJob(selectedJob)

      setAgentQueue(current => current.filter(job => job._id !== selectedAgentJobId))
      setSelectedAgentJobId(null)

      if (!iaResult && !loadingIa) {
        await analyzeImage(imageFile)
      }

      message.success('Imagen del agente cargada en AddProduct')
    } catch (error) {
      message.error(error?.response?.data?.message || 'No se pudo importar la imagen del agente')
    } finally {
      setImportingAgentImage(false)
    }
  }, [
    agentQueue,
    analyzeImage,
    fileList,
    iaResult,
    imagePreviews,
    loadingIa,
    selectedAgentJobId,
    selectedAgentJob,
  ])

  const handleDeleteAgentImage = useCallback(async () => {
    if (!selectedAgentJobId) return

    const previousQueue = agentQueue
    setAgentQueue(current => current.filter(job => job._id !== selectedAgentJobId))
    setSelectedAgentJobId(null)
    setDeletingAgentImage(true)

    try {
      await api.delete(`/product-analysis/${selectedAgentJobId}`)
      message.success('Imagen y análisis eliminados permanentemente')
    } catch (error) {
      setAgentQueue(previousQueue)
      setSelectedAgentJobId(selectedAgentJobId)
      message.error(error?.response?.data?.message || 'No se pudo eliminar la imagen')
    } finally {
      setDeletingAgentImage(false)
    }
  }, [agentQueue, selectedAgentJobId])

  const resetProductWorkspace = useCallback(() => {
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
    setCurrentAgentJob(null)
    resetIa()
    dispatch(resetState())
  }, [dispatch, form, imagePreviews, resetIa])

  const processAgentJobAutomatically = useCallback(async job => {
    resetProductWorkspace()
    await waitForUiReset()

    const response = await api.get(`/product-analysis/${job._id}/image-file`, {
      responseType: 'blob',
    })

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
      publish: Boolean(job.autoPublishProduct),
      automationMode: 'agent-autosave',
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

    await api.post(`/product-analysis/${job._id}/import-to-add-product`)
    await api.post(`/product-analysis/${job._id}/complete-add-product`, {
      productId,
    })

    return productId
  }, [analyzeImage, dispatch, resetProductWorkspace, user])

  const processAutoAgentQueue = useCallback(async () => {
    if (!autoAgentEnabled || autoAgentRef.current) return

    const jobsToProcess = agentQueue.filter(job =>
      job.status === 'pending' &&
      job.metadata?.autoSaveProduct === true &&
      !autoAgentFailedJobsRef.current.has(job._id)
    )

    if (!jobsToProcess.length) return

    autoAgentRef.current = true
    setAutoAgentRunning(true)

    try {
      for (const job of jobsToProcess) {
        try {
          await processAgentJobAutomatically(job)
          setAgentQueue(current => current.filter(item => item._id !== job._id))
          message.success(`Producto creado automáticamente: ${job.originalFilename || job._id}`)
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
    processAgentJobAutomatically,
    resetProductWorkspace,
  ])

  useEffect(() => {
    processAutoAgentQueue()
  }, [processAutoAgentQueue])

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

  const normalizedIaResult =
  iaResult && typeof iaResult === 'object'
    ? {
        ...iaResult,
        appliedAt: new Date().toISOString(),
        appliedBy: user?._id || user?.id || null,
        sourceContext: 'admin-add-product',
      }
    : null

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
        aiAgentJobId: currentAgentJob?._id || null,
        aiAgentScheduledAt: currentAgentJob?.scheduledAt || currentAgentJob?.metadata?.addProductAt || null,
        aiAutomationMode: currentAgentJob ? 'agent-assisted' : 'manual',

        status: 'active',
        visibility: 'visible',
      }

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

      if (currentAgentJob?._id) {
        await api.post(`/product-analysis/${currentAgentJob._id}/complete-add-product`, {
          productId,
        })
      }

      message.success(
        hasVariants
          ? `Producto creado correctamente con ${variants.length} variantes`
          : 'Producto creado correctamente'
      )

      resetProductWorkspace()
      await waitForUiReset()
      await fetchAgentQueue()
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
  <Col xs={24} xl={22} xxl={18}>
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
              <Tag color="processing" style={{ borderRadius: 999, padding: '3px 12px' }}>
                AddProduct IA
              </Tag>
              <Tag color="success" style={{ borderRadius: 999, padding: '3px 12px' }}>
                Multi-tenant
              </Tag>
              {hasVariants && (
                <Tag color="blue" style={{ borderRadius: 999, padding: '3px 12px' }}>
                  {variants.length} variantes
                </Tag>
              )}
            </Space>

            <Title level={2} style={{ margin: 0, letterSpacing: '-0.04em' }}>
              <ThunderboltOutlined style={{ color: token.colorPrimary, marginRight: 12 }} />
              Crear producto inteligente
            </Title>

            <Text type="secondary" style={{ fontSize: 15 }}>
              Subí imágenes, analizá el producto con IA, configurá variantes y publicá con una experiencia lista para producción.
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

    <Form form={form} layout="vertical" onFinish={handleFinish}>
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
            bodyStyle={{ padding: 24 }}
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
                      <Tag color="processing" style={{ borderRadius: 999 }}>
                        Agente
                      </Tag>
                      <Tag color={autoAgentEnabled ? 'success' : 'default'} style={{ borderRadius: 999 }}>
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

                    <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.55 }}>
                      Importá imágenes del agente, programalas o dejá que AutoSave cree productos con IA cuando el modo automático esté activo.
                    </Text>
                  </Space>
                </Col>

                <Col xs={24} lg={7}>
                  <Row gutter={[10, 10]}>
                    {[
                      { label: 'Pendientes', value: agentQueueStats.pending },
                      { label: 'Programadas', value: agentQueueStats.scheduled },
                      { label: 'AutoSave', value: agentQueueStats.autoSave },
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
                          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
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
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Space wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
                      <Switch
                        checked={autoAgentEnabled}
                        onChange={setAutoAgentEnabled}
                        checkedChildren="Auto"
                        unCheckedChildren="Manual"
                        loading={autoAgentRunning}
                      />

                      <Button
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

                    <Space wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
                      <Button
                        type="primary"
                        icon={<CloudDownloadOutlined />}
                        onClick={handleImportAgentImage}
                        loading={importingAgentImage}
                        disabled={!selectedAgentJobId || selectedAgentJob?.status === 'scheduled'}
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
                  type={selectedAgentJob.status === 'scheduled' ? 'warning' : 'success'}
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
                    <InboxOutlined style={{ fontSize: 40, color: token.colorPrimary }} />
                  </div>

                  <Text strong style={{ fontSize: 17, display: 'block' }}>
                    Arrastrá imágenes o importalas desde el agente
                  </Text>

                  <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                    Las imágenes cargadas disparan el análisis visual con IA.
                  </Text>

                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
                    JPG, PNG y WEBP recomendados · Alta calidad mejora la precisión
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
            bodyStyle={{ padding: 24 }}
          >
            <Row gutter={[18, 18]}>
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
                    rows={5}
                    placeholder="Describí beneficios, materiales, uso recomendado y detalles relevantes..."
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

              <Col xs={24}>
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
              <Space size={10}>
                <ClusterOutlined style={{ color: token.colorPrimary }} />
                <span>Variantes del producto</span>
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
            bodyStyle={{ padding: 24 }}
          >
            {hasVariants ? (
              <>
                <Alert
                  message="Configurá atributos, generá combinaciones y asigná una imagen específica por variante."
                  type="info"
                  showIcon
                  style={{ marginBottom: 20, borderRadius: 14 }}
                />

                {dynamicAttributes.length > 0 ? (
                  <>
                    <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
                      {dynamicAttributes.map(attr => (
                        <Col xs={24} md={12} key={attr.name}>
                          <Form.Item
                            label={
                              <Space>
                                {attr.label}
                                {attr.values.length > 0 && (
                                  <Tag color="blue" style={{ borderRadius: 999 }}>
                                    {attr.values.length} sugeridos
                                  </Tag>
                                )}
                              </Space>
                            }
                          >
                            <Select
                              mode="tags"
                              placeholder={`Seleccioná o escribí ${attr.label.toLowerCase()}`}
                              value={selectedAttributes[attr.name] || []}
                              onChange={values => handleAttributeValuesChange(attr.name, values)}
                              tokenSeparators={[',']}
                              allowClear
                              options={attr.values.map(value => ({ value, label: value }))}
                            />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>

                    <Space wrap style={{ marginBottom: 18 }}>
                      <Button
                        type="dashed"
                        onClick={handleAddCustomAttribute}
                        icon={<PlusOutlined />}
                      >
                        Agregar atributo
                      </Button>

                      <Button
                        type="primary"
                        onClick={generateVariantsFromAttributes}
                        icon={<ReloadOutlined />}
                        disabled={!canGenerateVariants}
                      >
                        Generar combinaciones
                      </Button>
                    </Space>
                  </>
                ) : (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '30px 16px',
                      borderRadius: 16,
                      border: `1px dashed ${token.colorBorder}`,
                      background: token.colorFillAlter,
                    }}
                  >
                    <Text type="secondary">
                      La IA no detectó atributos específicos.
                    </Text>
                    <br />
                    <Button
                      type="primary"
                      onClick={handleAddCustomAttribute}
                      icon={<PlusOutlined />}
                      style={{ marginTop: 12 }}
                    >
                      Agregar atributo manualmente
                    </Button>
                  </div>
                )}

                {variants.length > 0 && (
                  <>
                    <Divider orientation="left">
                      <Space>
                        <AppstoreOutlined />
                        <span>{variants.length} variantes configuradas</span>
                      </Space>
                    </Divider>

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
                          title: 'Combinación',
                          dataIndex: 'nombre',
                          key: 'nombre',
                          width: 260,
                          fixed: 'left',
                          render: (_, record) => (
                            <Space direction="vertical" size={4}>
                              <Tag color="blue" style={{ fontSize: 13, padding: '4px 10px', borderRadius: 999 }}>
                                {record.nombre}
                              </Tag>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {Object.entries(record.combinacion)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join(' · ')}
                              </Text>
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
                                      ? { ...variant, price: Number(val || 0) }
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
                                      ? { ...variant, stock: Number(val || 0) }
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
                                      ? { ...variant, sku: e.target.value }
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
                            const selectedLocal = localImages.find(img => img.uid === record.imageSourceUid)

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
                                  boxShadow: '0 8px 18px rgba(15,23,42,.08)',
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
                <Text type="secondary">
                  Este producto no tiene variaciones. Activá el switch si necesitás talles, colores o modelos.
                </Text>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <div style={{ position: 'sticky', top: 24 }}>
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
              bodyStyle={{ padding: 24 }}
            >
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <Form.Item
                    name="precio"
                    label={hasVariants ? 'Precio base de referencia' : 'Precio'}
                    rules={[{ required: true, message: 'El precio es obligatorio' }]}
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
                              price: Number(variant.price || 0) === 0 ? Number(value || 0) : variant.price,
                            })),
                          )
                        }
                      }}
                    />
                  </Form.Item>
                </Col>

                {!hasVariants && (
                  <Col xs={24}>
                    <Form.Item
                      name="cantidad"
                      label="Cantidad en stock"
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

                <Col xs={24}>
                  <Form.Item
                    name="condicion"
                    label="Condición"
                    rules={[{ required: true, message: 'La condición es obligatoria' }]}
                  >
                    <Select size="large" placeholder="Seleccioná la condición">
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
              bodyStyle={{ padding: 24 }}
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
              bodyStyle={{ padding: 20 }}
            >
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                {isError && (
                  <Alert
                    type="error"
                    message={productMessage || 'Error guardando producto'}
                    showIcon
                    style={{ borderRadius: 14 }}
                  />
                )}

                <Button
                  htmlType="submit"
                  type="primary"
                  size="large"
                  block
                  loading={isLoading}
                  icon={<CheckCircleOutlined />}
                  style={{
                    height: 52,
                    fontSize: 16,
                    fontWeight: 800,
                    borderRadius: 14,
                    boxShadow: `0 14px 28px ${token.colorPrimary}30`,
                  }}
                >
                  {isLoading
                    ? 'Guardando...'
                    : hasVariants
                      ? `Guardar con ${variants.length} variantes`
                      : 'Guardar producto'}
                </Button>

                <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block' }}>
                  Se validará tenant, imágenes, variantes y metadatos IA antes de publicar.
                </Text>
              </Space>
            </Card>
          </div>
        </Col>
      </Row>
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
