// 📁 src/pages/AddProduct.js
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  ConfigProvider,
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
  Steps,
  Collapse,
  Modal,
  Tooltip,
} from 'antd'
import {
  InboxOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  RobotOutlined,
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
import { formatDate, formatRelativeTime } from '@utils/dateFormat'
import {
  createProducts,
  uploadProductImage,
  uploadProductVideo,
  resetState,
  assignVariantImage,
} from '@features/product/productSlice'
import productService from '@features/product/productService'
import {
  SECTION_IDS,
  normalizeString,
  toTitleCase,
  buildTitleCaseOption,
  slugifyKeyPart,
  buildVariantKey,
  buildVariantName,
  safeArray,
  MAX_GENERATED_VARIANTS,
  MAX_PRODUCT_IMAGES,
  MAX_VIDEO_SIZE_MB,
  MAX_VIDEO_DURATION_SECONDS,
  DYNAMIC_FIELD_TYPES,
  SHIPPING_TYPE_OPTIONS,
  QUICK_VARIANT_PRESETS,
  TECHNICAL_FIELD_PRESETS,
  SEO_POSITIONING_INTENT_OPTIONS,
  buildGeneratedVariantSku,
  normalizeNumberValue,
  normalizeOptionalNumberValue,
  normalizeSku,
  getVariantStockTotal,
  getVariantAttributesConfig,
  getUploadFileObject,
  sanitizeUploadFiles,
  validateSelectedFiles,
  validateSelectedVideoFile,
  getVideoDuration,
  getJobFlag,
  validateVariantsForSubmit,
  validateProductBasicsForSubmit,
  parseQuickVariantText,
  parseTechnicalFieldText,
  mergeVariantAttributeDefinitions,
  mergeSelectedVariantValues,
  generateVariantRowsFromSelection,
  extractTemplateDynamicFields,
  normalizeDynamicFieldValues,
  buildSeoPayload,
  buildSeoFormValues,
  buildLogisticsPayload,
  WATCHER_ONLINE_THRESHOLD_MS,
  getStoredBoolean,
  dedupeByUid,
  revokeBlobUrls,
  rebuildPreviews,
  waitForUiReset,
  buildSpecificationRows,
  buildFilterAttributesFromSpecifications,
  shouldIncludeTechnicalSheetFromJob,
  enforceTechnicalSheetPersistence,
  normalizeAiAnalysisForForm,
  buildProductPayloadFromAnalysis,
  createProductAttempt,
  runProductAttempt,
  selectJobsForReviewQueue,
  resolveJobAnalysis,
  describeProductAttemptFailure,
  buildProductReadiness,
  buildWizardSteps,
  getWizardCurrentStep,
} from '@features/product/addProductHelpers'
import {
  AIAnalysisPanel,
  ImagePreviewGrid,
  DynamicProductField,
  VariantImageSelector,
  ProductFormDirtyContext,
  ProductFormMutationContext,
  ProductField,
} from '@components/AddProductPanels'

// Lo que AddProduct.js exportaba antes de partirse sigue saliendo de acá.
export {
  toTitleCase,
  buildVariantKey,
  buildVariantName,
  buildGeneratedVariantSku,
  normalizeNumberValue,
  normalizeOptionalNumberValue,
  normalizeSku,
  getVariantStockTotal,
  getVariantAttributesConfig,
  validateSelectedFiles,
  validateSelectedVideoFile,
  validateVariantsForSubmit,
  validateProductBasicsForSubmit,
  parseQuickVariantText,
  inferTechnicalFieldType,
  parseTechnicalFieldText,
  mergeVariantAttributeDefinitions,
  mergeSelectedVariantValues,
  generateVariantRowsFromSelection,
  normalizeDynamicFieldType,
  normalizeDynamicFieldDefinition,
  extractTemplateDynamicFields,
  normalizeDynamicFieldValues,
  buildSeoPayload,
  buildSeoFormValues,
  buildLogisticsPayload,
  normalizeAiAnalysisForForm,
  buildProductPayloadFromAnalysis,
  createProductAttempt,
  runProductAttempt,
  selectJobsForReviewQueue,
  resolveJobAnalysis,
  describeProductAttemptFailure,
  resolveAiConfidencePercent,
  buildProductReadiness,
  buildWizardSteps,
  getWizardCurrentStep,
} from '@features/product/addProductHelpers'

const { Title, Text } = Typography
const { Dragger } = Upload
const { useToken } = theme

// Referencias estables para `rules`: ProductField está memoizado, pero un
// array literal inline (`rules={[{ required: true, ... }]}`) crea una
// referencia nueva en cada render. Como varios de estos campos usan
// Form.useWatch (titulo, categoria, subcategoria, marca, precio, cantidad),
// escribir en cualquiera de ellos re-renderiza AddProduct entero, y con
// rules inline eso invalidaba el memo de TODOS los ProductField del
// formulario en cada tecla — de ahí la sensación de "reload" al escribir.
const REQUIRED_TITULO_RULES = [{ required: true, message: 'El título es obligatorio' }]
const REQUIRED_DESCRIPCION_RULES = [
  { required: true, message: 'La descripción comercial es obligatoria' },
]
const REQUIRED_CATEGORIA_RULES = [{ required: true, message: 'La categoría es obligatoria' }]
const REQUIRED_SUBCATEGORIA_RULES = [{ required: true, message: 'La subcategoría es obligatoria' }]
const REQUIRED_MARCA_RULES = [{ required: true, message: 'La marca es obligatoria' }]
const REQUIRED_PRECIO_RULES = [{ required: true, message: 'El precio es obligatorio' }]
const REQUIRED_CANTIDAD_RULES = [{ required: true, message: 'La cantidad es obligatoria' }]
const REQUIRED_CONDICION_RULES = [{ required: true, message: 'La condición es obligatoria' }]

// ─────────────────────────────────────────────────────────────────────────────
// Marca de Henkart para toda la pantalla
//
// El tema va en un componente de afuera: useToken() lee el tema del ConfigProvider más cercano
// POR ENCIMA de quien lo llama, y el formulario tenía su ConfigProvider adentro, así que sus propios
// estilos en línea seguían leyendo los colores del tema general.
// ─────────────────────────────────────────────────────────────────────────────

const ADD_PRODUCT_THEME = {
  token: {
    colorPrimary: '#0b6bff',
    colorInfo: '#0b6bff',
    colorLink: '#0b6bff',
    colorBgLayout: '#f4f7ff',
    fontFamily: "Roboto, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontSize: 15,
    controlHeight: 40,
    controlHeightLG: 48,
    borderRadius: 12,
  },
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const HERO_BG = [
  'radial-gradient(520px 320px at 6% 0%, rgba(11,107,255,0.36), transparent 70%)',
  'radial-gradient(460px 360px at 100% 100%, rgba(122,44,255,0.32), transparent 70%)',
  '#050b1f',
].join(', ')

const HERO_TILE_STYLE = {
  padding: 14,
  borderRadius: 16,
  textAlign: 'center',
  background: 'rgba(255, 255, 255, 0.07)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
}

function AddProductForm() {
  const [form] = Form.useForm()
  const dispatch = useDispatch()
  const { token } = useToken()

  const {
    iaResult,
    analyzeImage,
    hydrateAnalysis,
    resetIa,
    loading: loadingIa,
    error: errorIa,
    lastAnalysisJobId,
  } = useProductAnalyzer()

  const [hasVariants, setHasVariants] = useState(false)
  const [variants, setVariants] = useState([])
  const [editableTags, setEditableTags] = useState([])
  const [fileList, setFileList] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [videoFile, setVideoFile] = useState(null)
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('')
  const [videoUploading, setVideoUploading] = useState(false)
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
  const [agentHeartbeat, setAgentHeartbeat] = useState(null)
  const [importingAgentImage, setImportingAgentImage] = useState(false)
  const [deletingAgentImage, setDeletingAgentImage] = useState(false)
  const [autoAgentEnabled, setAutoAgentEnabled] = useState(() =>
    getStoredBoolean('addProduct.agentAutoMode', false),
  )
  const [autoAgentRunning, setAutoAgentRunning] = useState(false)
  const [autoAgentReviewQueue, setAutoAgentReviewQueue] = useState([])
  const [autoAgentReviewOpen, setAutoAgentReviewOpen] = useState(false)
  const [reviewItemBusyId, setReviewItemBusyId] = useState(null)
  const [currentAgentJob, setCurrentAgentJob] = useState(null)
  const [publishProduct, setPublishProduct] = useState(true)
  const [savingProduct, setSavingProduct] = useState(false)
  const [formHasChanges, setFormHasChanges] = useState(false)
  const [submitErrors, setSubmitErrors] = useState([])
  const [committedClassification, setCommittedClassification] = useState({
    categoria: '',
    subcategoria: '',
  })

  const inputRef = useRef(null)
  const autoAgentRef = useRef(false)
  const autoAgentFailedJobsRef = useRef(new Set())
  // Alta en curso del formulario y de cada ítem de la cola de revisión (por
  // job): un reintento sigue desde el paso que falló. Ver runProductAttempt.
  const productAttemptRef = useRef(null)
  const agentAttemptsRef = useRef(new Map())
  // Trabajos que ya están en la cola de revisión (ver selectJobsForReviewQueue).
  const reviewQueuedJobsRef = useRef(new Set())
  const imagePreviewsRef = useRef([])
  const lastAnalyzedImageSignatureRef = useRef('')
  const categoryConfigDebounceRef = useRef(null)
  const categoryConfigRequestIdRef = useRef(0)
  const categoryConfigCacheRef = useRef(new Map())
  const technicalSheetSnapshotRef = useRef(null)
  const autoAgentReviewQueueRef = useRef([])

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

  const user = useSelector(state => state.user.user)
  const tenantId = user?.tenantId?._id || user?.tenantId || null
  const { isLoading, isError, message: productMessage } = useSelector(state => state.product)
  const selectedCategory = Form.useWatch('categoria', form)
  const selectedSubcategory = Form.useWatch('subcategoria', form)
  const watchedTitle = Form.useWatch('titulo', form)
  const watchedDescription = Form.useWatch('descripcion', form)
  const watchedPrice = Form.useWatch('precio', form)
  const watchedStock = Form.useWatch('cantidad', form)
  const watchedBrand = Form.useWatch('marca', form)

  const productReadiness = useMemo(
    () =>
      buildProductReadiness({
        imageCount: fileList.length,
        title: watchedTitle,
        description: watchedDescription,
        category: selectedCategory,
        subcategory: selectedSubcategory,
        price: watchedPrice,
        stock: watchedStock,
        brand: watchedBrand,
        hasVariants,
        variants,
        useTechnicalSheet,
        technicalFieldCount: dynamicProductFields.length,
      }),
    [
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
    ],
  )

  const missingRequiredLabels = useMemo(
    () => productReadiness.requiredChecks.filter(check => !check.done).map(check => check.label),
    [productReadiness.requiredChecks],
  )

  const scrollToSection = useCallback(sectionId => {
    if (typeof document === 'undefined') return
    const target = document.getElementById(sectionId)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const wizardSteps = useMemo(
    () => buildWizardSteps({ readiness: productReadiness, useTechnicalSheet, hasVariants }),
    [productReadiness, useTechnicalSheet, hasVariants],
  )

  const wizardCurrentStep = useMemo(() => getWizardCurrentStep(wizardSteps), [wizardSteps])

  const categoryOptions = useMemo(
    () => catalogCategories.map(category => buildTitleCaseOption(category?.name)).filter(Boolean),
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
      (total, attribute) => total * safeArray(selectedAttributes[attribute.name]).length,
      1,
    )
  }, [configuredVariantAttributes, selectedAttributes])

  const canGenerateVariants =
    variantCombinationCount > 0 && variantCombinationCount <= MAX_GENERATED_VARIANTS

  const agentQueueStats = useMemo(() => {
    return agentQueue.reduce(
      (acc, job) => {
        acc.total += 1
        acc[job.status] = (acc[job.status] || 0) + 1
        if (job.metadata?.autoSaveProduct) acc.autoSave += 1
        return acc
      },
      { total: 0, pending: 0, scheduled: 0, completed: 0, autoSave: 0 },
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
  }, [currentAgentJob, editableTags.length, fileList.length, formHasChanges, variants.length])

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
        patch.categoria !== undefined ? patch.categoria : form.getFieldValue('categoria')
      const currentSubcategory =
        patch.subcategoria !== undefined ? patch.subcategoria : form.getFieldValue('subcategoria')

      const categoria = toTitleCase(currentCategory)
      const subcategoria = toTitleCase(currentSubcategory)

      const valuesToPatch = {}
      if (categoria && categoria !== currentCategory) valuesToPatch.categoria = categoria
      if (subcategoria && subcategoria !== currentSubcategory) {
        valuesToPatch.subcategoria = subcategoria
      }
      if (Object.keys(valuesToPatch).length) setProductFormValues(valuesToPatch)

      setCommittedClassification(prev => {
        if (prev.categoria === categoria && prev.subcategoria === subcategoria) return prev
        return { categoria, subcategoria }
      })
    },
    [form, setProductFormValues],
  )

  useEffect(() => {
    if (!hasUserWorkspace) return undefined

    const handleBeforeUnload = event => {
      event.preventDefault()
      event.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUserWorkspace])

  useEffect(() => {
    imagePreviewsRef.current = imagePreviews
  }, [imagePreviews])

  useEffect(() => {
    autoAgentReviewQueueRef.current = autoAgentReviewQueue
  }, [autoAgentReviewQueue])

  useEffect(() => {
    return () => {
      dispatch(resetState())
      revokeBlobUrls(imagePreviewsRef.current)
      autoAgentReviewQueueRef.current.forEach(item => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      })
    }
  }, [dispatch])

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
          message.warning(error?.message || 'No se pudo cargar el catálogo de categorías')
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
              values: [...new Set([...safeArray(previous?.values), ...safeArray(field.values)])],
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
        const merged = new Map(current.map(attribute => [attribute.name, attribute]))

        templateAttributes.forEach(attribute => {
          const name = normalizeString(attribute.name).toLowerCase().replace(/\s+/g, '_')

          if (!name) return

          const previous = merged.get(name)
          const values = [
            ...new Set([...safeArray(previous?.values), ...safeArray(attribute.values)]),
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
        const response = await productService.getCategoryConfig(category, subcategory)

        if (requestId !== categoryConfigRequestIdRef.current) return

        categoryConfigCacheRef.current.set(requestKey, response)
        applyTemplateResponse(response)
      } catch (error) {
        if (requestId === categoryConfigRequestIdRef.current) {
          setCatalogTemplate(null)
          message.warning(error?.message || 'No se pudo cargar la plantilla de la subcategoría')
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

        // 'pending'/'scheduled' con autoAnalyze:false son los que espera
        // /admin/product-analysis que AddProduct analice. 'completed' sin
        // producto se acepta sin ese filtro: ya tiene un análisis hecho
        // (por AddProduct o por un job autónomo del agente que no llegó a
        // crear el producto solo) y AddProduct es el único lugar donde
        // ahora se puede convertir en producto — no hay "Aprobar" en
        // /admin/product-analysis.
        const items = (Array.isArray(data?.items) ? data.items : []).filter(
          item =>
            (item.status === 'completed' && !item.createdProductId) ||
            (['pending', 'scheduled'].includes(item.status) &&
              item.metadata?.autoAnalyze === false),
        )
        setAgentQueue(items)
        if (!preserveSelection) {
          setSelectedAgentJobId(current =>
            current && items.some(item => item._id === current) ? current : items[0]?._id || null,
          )
        }
      } catch (error) {
        if (!silent) {
          message.error(error?.response?.data?.message || 'No se pudo cargar la cola del agente')
        }
      } finally {
        if (!silent) setLoadingAgentQueue(false)
      }
    },
    [],
  )

  const fetchAgentHeartbeat = useCallback(async () => {
    try {
      const { data } = await api.get('/product-analysis/agent-heartbeat')
      setAgentHeartbeat(data?.data || null)
    } catch {
      // Indicador secundario: si falla no debe interrumpir el flujo de carga.
    }
  }, [])

  useEffect(() => {
    fetchAgentQueue()
    fetchAgentHeartbeat()
  }, [fetchAgentQueue, fetchAgentHeartbeat])

  // La cola del agente puede cambiar de estado sola (una imagen
  // programada se analiza automáticamente apenas llega su hora, sin que
  // nadie tenga esta pantalla abierta). Sin este refresco periódico, el
  // selector se queda mostrando "Programada" con datos viejos aunque el
  // backend ya la haya analizado, y el botón "Cargar ahora" rechaza la
  // acción por el estado desactualizado que quedó en el navegador.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAgentQueue({ silent: true, preserveSelection: true })
      fetchAgentHeartbeat()
    }, 15000)

    return () => clearInterval(interval)
  }, [fetchAgentQueue, fetchAgentHeartbeat])

  const normalizedAiDraft = useMemo(() => {
    return iaResult && typeof iaResult === 'object' ? normalizeAiAnalysisForForm(iaResult) : null
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
          values: [...new Set([...safeArray(previous?.values), ...safeArray(field.values)])],
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
    const title = normalizeString(values.titulo || normalizedAiDraft?.fields?.titulo)
    const category = toTitleCase(values.categoria || normalizedAiDraft?.fields?.categoria)
    const subcategory = toTitleCase(values.subcategoria || normalizedAiDraft?.fields?.subcategoria)
    const brand = normalizeString(values.marca || normalizedAiDraft?.fields?.marca)
    const material = normalizeString(values.material || normalizedAiDraft?.fields?.material)
    const color = normalizeString(values.color || normalizedAiDraft?.fields?.color)
    const currentDynamicValues = values.dynamicFields || {}
    const specificationRows = buildSpecificationRows(dynamicProductFields, currentDynamicValues)

    if (!title && !specificationRows.length && !normalizedAiDraft?.fields?.descripcionTecnica) {
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
      message.info('La IA no devolvió campos de ficha técnica para este producto')
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
      mergeVariantAttributeDefinitions(current, normalizedAiDraft.variantAttributes),
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
        basePrice: form.getFieldValue('precio') || normalizedAiDraft.fields.precio,
        productTitle: form.getFieldValue('titulo') || normalizedAiDraft.fields.titulo,
      })

      return generated.variants.length ? generated.variants : normalizedAiDraft.variants
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

    const mergedAttributes = mergeVariantAttributeDefinitions(dynamicAttributes, parsedAttributes)
    const mergedSelected = mergeSelectedVariantValues(selectedAttributes, incomingSelected)

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

    message.success(`${generated.variants.length} variantes generadas rápidamente`)
  }, [dynamicAttributes, form, quickVariantText, selectedAttributes, variants])

  const applyVariantPreset = useCallback(
    preset => {
      const presetAttributes = safeArray(preset?.attributes)

      if (!presetAttributes.length) return

      const incomingSelected = presetAttributes.reduce((acc, attribute) => {
        acc[attribute.name] = safeArray(attribute.values)
        return acc
      }, {})

      const mergedAttributes = mergeVariantAttributeDefinitions(dynamicAttributes, presetAttributes)
      const mergedSelected = mergeSelectedVariantValues(selectedAttributes, incomingSelected)

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
      message.success(`${preset.label} aplicado · ${generated.variants.length} variantes listas`)
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
      titulo: normalizeString(values.titulo) || normalizeString(aiFields.titulo),
      descripcion:
        normalizeString(values.descripcion) ||
        normalizeString(aiFields.descripcion) ||
        (useTechnicalSheet
          ? normalizeString(values.descripcionTecnica) ||
            normalizeString(aiFields.descripcionTecnica)
          : ''),
      descripcionTecnica: useTechnicalSheet
        ? normalizeString(values.descripcionTecnica) || normalizeString(aiFields.descripcionTecnica)
        : '',
      marca: normalizeString(values.marca) || normalizeString(aiFields.marca),
      categoria: toTitleCase(values.categoria || aiFields.categoria),
      subcategoria: toTitleCase(values.subcategoria || aiFields.subcategoria),
      material: normalizeString(values.material) || normalizeString(aiFields.material),
      color: normalizeString(values.color) || normalizeString(aiFields.color),
      tags: editableTags,
    }

    if (!baseValues.titulo && !baseValues.descripcion) {
      message.warning('Completá o aplicá primero el título y la descripción para generar SEO')
      return
    }

    setProductFormValues(buildSeoFormValues(baseValues))
    message.success('SEO generado desde los datos actuales del producto')
  }, [editableTags, form, normalizedAiDraft, setProductFormValues, useTechnicalSheet])

  const generateSeoPositioningFromCurrentValues = useCallback(() => {
    const values = form.getFieldsValue(true) || {}
    const title = normalizeString(values.titulo || normalizedAiDraft?.fields?.titulo)
    const category = toTitleCase(values.categoria || normalizedAiDraft?.fields?.categoria)
    const subcategory = toTitleCase(values.subcategoria || normalizedAiDraft?.fields?.subcategoria)
    const brand = normalizeString(values.marca || normalizedAiDraft?.fields?.marca)
    const material = normalizeString(values.material || normalizedAiDraft?.fields?.material)
    const color = normalizeString(values.color || normalizedAiDraft?.fields?.color)

    if (!title && !subcategory && !category) {
      message.warning('Completá título, categoría o subcategoría para crear posicionamiento SEO')
      return
    }

    const focusKeyword =
      normalizeString(values.seoFocusKeyword) ||
      [brand, title || subcategory || category].filter(Boolean).join(' ').slice(0, 90)

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

    const contentPillars = [focusKeyword, subcategory, category, brand, material, color]
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
          shortDescription: fields.shortDescription || seoFromAi.shortDescription,
        },
        metaTitle: { metaTitle: fields.metaTitle || seoFromAi.metaTitle },
        metaDescription: {
          metaDescription: fields.metaDescription || seoFromAi.metaDescription,
        },
        seoKeywords: {
          seoKeywords: fields.seoKeywords?.length ? fields.seoKeywords : seoFromAi.seoKeywords,
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
    [commitClassificationFromForm, form, normalizedAiDraft, setProductFormValues],
  )

  const applyAiSafeFields = useCallback(() => {
    if (!normalizedAiDraft) return

    const { fields, review } = normalizedAiDraft
    const patch = {
      titulo: fields.titulo,
      descripcion: fields.descripcion,
      descripcionTecnica: useTechnicalSheet ? fields.descripcionTecnica : undefined,
      categoria: fields.categoria,
      subcategoria: fields.subcategoria,
      marca: fields.marca,
      color: fields.color,
      material: Number(review.materialConfidence || 0) >= 0.45 ? fields.material : undefined,
      precio: Number(review.priceConfidence || 0) >= 0.55 ? fields.precio : undefined,
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
      descripcionTecnica: useTechnicalSheet ? fields.descripcionTecnica : undefined,
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
      setDynamicProductFields(prev => prev.filter(field => field.name !== fieldName))
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
              values: [...new Set([...safeArray(attribute.values), ...normalizedValues])],
            }
          : attribute,
      ),
    )
  }, [])

  const handleRemoveVariantAttribute = useCallback(attrName => {
    setDynamicAttributes(prev => prev.filter(attribute => attribute.name !== attrName))
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
      message.warning('Completá categoría y subcategoría antes de guardar la plantilla')
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
        item => normalizeString(item.name).toLowerCase() === subcategory.toLowerCase(),
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

    const createdCount = generated.variants.filter(variant => variant.uiStatus === 'new').length

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
        message.warning(`Solo se conservaron las primeras ${MAX_PRODUCT_IMAGES} imágenes.`)
      }

      if (uniqueFiles.length > 0 && !iaResult && !loadingIa) {
        const fileToAnalyze = uniqueFiles[0]?.originFileObj || uniqueFiles[0]

        if (fileToAnalyze) {
          const signature = buildImageSignature(fileToAnalyze)
          const shouldAnalyze = signature && signature !== lastAnalyzedImageSignatureRef.current

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

  const handleVideoChange = useCallback(
    async ({ fileList: newFileList }) => {
      const selected = newFileList[newFileList.length - 1]
      if (!selected) return

      const validationError = validateSelectedVideoFile(selected)
      if (validationError) {
        message.error(validationError)
        return
      }

      const duration = await getVideoDuration(selected)
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        message.error(`El video no puede durar más de ${MAX_VIDEO_DURATION_SECONDS} segundos.`)
        return
      }

      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl)
      }

      const fileObject = getUploadFileObject(selected)
      setVideoFile(selected)
      setVideoPreviewUrl(URL.createObjectURL(fileObject))
    },
    [videoPreviewUrl],
  )

  const handleRemoveVideo = useCallback(() => {
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl)
    }
    setVideoFile(null)
    setVideoPreviewUrl('')
  }, [videoPreviewUrl])

  const handleReanalyzeImage = useCallback(
    async (index = null) => {
      const uploadFile =
        index !== null && fileList[index]?.originFileObj
          ? fileList[index]
          : safeArray(fileList).find(file => Boolean(file?.originFileObj))
      const imageFile = uploadFile?.originFileObj

      if (!imageFile) {
        message.warning(
          'Para reanalizar necesitás tener una imagen cargada localmente en el formulario.',
        )
        return
      }

      try {
        resetIa()
        lastAnalyzedImageSignatureRef.current = buildImageSignature(imageFile) || ''
        // Si la imagen vino de un job de la cola, el reanálisis actualiza
        // ese mismo job en vez de generar un registro nuevo.
        await analyzeImage(imageFile, { jobId: currentAgentJob?._id || null })
        message.success(
          index !== null ? `Imagen ${index + 1} analizada con IA` : 'Imagen reanalizada con IA',
        )
      } catch (error) {
        message.error(error?.message || 'No se pudo reanalizar la imagen')
      }
    },
    [analyzeImage, buildImageSignature, currentAgentJob, fileList, resetIa],
  )

  const resetProductWorkspace = useCallback(() => {
    form.resetFields()
    notifyFormMutation()
    revokeBlobUrls(imagePreviews)
    setFileList([])
    setImagePreviews([])
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl)
    }
    setVideoFile(null)
    setVideoPreviewUrl('')
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
    setSubmitErrors([])
    lastAnalyzedImageSignatureRef.current = ''
    technicalSheetSnapshotRef.current = null
    productAttemptRef.current = null
    resetIa()
    dispatch(resetState())
  }, [dispatch, form, imagePreviews, notifyFormMutation, resetIa, videoPreviewUrl])

  const handleImportAgentImage = useCallback(
    async overrideJobId => {
      // overrideJobId permite disparar la carga sobre un job puntual (usado
      // por el auto-loader cuando llega la hora programada) sin depender
      // del dropdown — setSelectedAgentJobId es async, así que leer
      // selectedAgentJobId justo después de setearlo daría el valor viejo.
      const targetJobId = typeof overrideJobId === 'string' ? overrideJobId : selectedAgentJobId

      if (!targetJobId) {
        message.warning('No hay imágenes pendientes del agente')
        return false
      }

      const targetJob = agentQueue.find(job => job._id === targetJobId) || null

      if (targetJob?.status === 'scheduled') {
        message.warning(
          'La imagen todavía está programada. Va a estar disponible en el horario indicado.',
        )
        return false
      }

      if (hasUserWorkspace) {
        message.warning(
          'Hay un producto en edición. Guardalo, descartalo o limpiá el formulario antes de cargar otra imagen.',
        )
        return false
      }

      setImportingAgentImage(true)
      try {
        const importResponse = await api.post(
          `/product-analysis/${targetJobId}/import-to-add-product`,
        )
        // Si AddProduct ya la analizó sola (llegó su hora programada), el
        // backend nos manda el análisis ya calculado acá — no hace falta
        // gastar otra llamada a la IA, solo hidratamos el formulario.
        const alreadyAnalyzed = importResponse?.data?.analysis || null

        resetProductWorkspace()
        await waitForUiReset()

        const response = await api.get(`/product-analysis/${targetJobId}/image-file`, {
          responseType: 'blob',
        })

        const blob = response.data
        const filename = targetJob?.originalFilename || `agent-image-${Date.now()}.jpg`
        const mimeType = blob?.type || targetJob?.metadata?.mimeType || 'image/jpeg'
        const imageFile = new File([blob], filename, { type: mimeType })
        const uploadFile = {
          uid: `agent-${targetJobId}-${Date.now()}`,
          name: filename,
          status: 'done',
          originFileObj: imageFile,
          type: mimeType,
          size: imageFile.size,
        }

        const merged = dedupeByUid([uploadFile])
        setFileList(merged)
        setImagePreviews(rebuildPreviews(merged))

        setCurrentAgentJob(targetJob)

        setAgentQueue(current => current.filter(job => job._id !== targetJobId))
        setSelectedAgentJobId(null)

        if (alreadyAnalyzed) {
          hydrateAnalysis(alreadyAnalyzed)
          message.success('Imagen y análisis de AddProduct cargados')
        } else {
          await analyzeImage(imageFile, { jobId: targetJobId })
          message.success('Imagen del agente cargada en AddProduct')
        }

        return true
      } catch (error) {
        // 409: el job ya no está disponible porque se aprobó o lo tomó otro
        // flujo, y esta cola local quedó vieja. No falló la importación: ya no
        // hay nada que importar.
        //
        // El refresco cada 15s existe justamente por esto (ver el useEffect del
        // intervalo más arriba), pero deja una ventana: guardar un producto
        // aprueba su job al instante, y actuar dentro de esos segundos choca
        // con el estado viejo. Se refresca acá para cerrarla — y refrescar la
        // cola entera, en vez de sacar solo esta entrada, corrige de una todas
        // las que hayan quedado obsoletas. Si no, cada imagen ya procesada
        // vuelve a dar su propio error, de a una.
        if (error?.response?.status === 409) {
          setSelectedAgentJobId(null)
          await fetchAgentQueue({ silent: true, preserveSelection: false })
          message.info('Esa imagen ya estaba procesada. Actualicé la lista.')
          return false
        }

        message.error(error?.response?.data?.message || 'No se pudo importar la imagen del agente')
        return false
      } finally {
        setImportingAgentImage(false)
      }
    },
    [
      agentQueue,
      analyzeImage,
      fetchAgentQueue,
      hydrateAnalysis,
      hasUserWorkspace,
      resetProductWorkspace,
      selectedAgentJobId,
    ],
  )

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

  const prepareAgentJobForReview = useCallback(
    async job => {
      const importResponse = await api.post(`/product-analysis/${job._id}/import-to-add-product`)
      // Un trabajo ya analizado (por el backend al subirlo, o al llegar su
      // hora) viene con su análisis: se usa ese, como hace el import manual,
      // en vez de pagar otra llamada a la IA por la misma foto (ver
      // resolveJobAnalysis, más abajo).

      resetProductWorkspace()
      await waitForUiReset()

      const response = await api.get(`/product-analysis/${job._id}/image-file`, {
        responseType: 'blob',
      })

      const blob = response.data
      const filename = job.originalFilename || `agent-image-${Date.now()}.jpg`
      const mimeType = blob?.type || job.metadata?.mimeType || 'image/jpeg'
      const imageFile = new File([blob], filename, { type: mimeType })
      const analysis = await resolveJobAnalysis(importResponse, () =>
        analyzeImage(imageFile, { jobId: job._id }),
      )

      if (!analysis) {
        throw new Error('La IA no devolvió análisis para la imagen')
      }

      const payload = buildProductPayloadFromAnalysis({
        analysis,
        job,
        user,
        publish: getJobFlag(job, 'autoPublishProduct'),
        automationMode: 'agent-autosave',
        includeTechnicalSheet: shouldIncludeTechnicalSheetFromJob(job),
      })

      return { job, imageFile, payload }
    },
    [analyzeImage, resetProductWorkspace, user],
  )

  // Publica (crea + sube imagen) un ítem de la cola de revisión.
  // Requiere aprobación explícita del usuario: ver autoAgentReviewQueue.
  const commitAgentReviewItem = useCallback(
    async ({ job, imageFile, payload }) => {
      const attempts = agentAttemptsRef.current

      if (!attempts.has(job._id)) {
        // Derivado del job y no aleatorio: un análisis da un solo producto,
        // aunque se apruebe dos veces o desde otra pestaña.
        attempts.set(job._id, createProductAttempt(`agent-review-${job._id}`))
      }

      const attempt = attempts.get(job._id)
      const published = payload?.status === 'active'

      await runProductAttempt({
        attempt,
        createDraft: clientRequestId =>
          dispatch(
            createProducts({
              ...payload,
              status: 'draft',
              visibility: 'hidden',
              clientRequestId,
            }),
          ).unwrap(),
        steps: [
          {
            key: 'image',
            run: ({ productId, clientRequestId }) =>
              dispatch(
                uploadProductImage({
                  productId,
                  imageFile,
                  clientUploadId: `${clientRequestId}:image`,
                  silent: true,
                }),
              ).unwrap(),
          },
        ],
        publish: published ? productService.publishDraftProduct : null,
        // Después de publicar: cerrar el análisis antes lo deja aprobado, y
        // si la publicación fallaba el ítem ya no se podía descartar (el
        // backend rechaza descartar un análisis aprobado).
        finalSteps: [
          {
            key: 'link-job',
            run: ({ productId }) =>
              api.post(`/product-analysis/${job._id}/complete-add-product`, { productId }),
          },
        ],
      })

      attempts.delete(job._id)

      return { productId: attempt.productId, published }
    },
    [dispatch],
  )

  const discardAgentReviewItem = useCallback(async job => {
    await api.post(`/product-analysis/${job._id}/reject`, {
      reason: 'Descartado en revisión de AutoSave.',
    })
  }, [])

  const removeReviewItem = useCallback(id => {
    reviewQueuedJobsRef.current.delete(id)
    setAutoAgentReviewQueue(current => {
      const target = current.find(item => item.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return current.filter(item => item.id !== id)
    })
  }, [])

  const handleApproveReviewItem = useCallback(
    async item => {
      setReviewItemBusyId(item.id)
      try {
        const { published } = await commitAgentReviewItem(item)
        const name = item.payload?.title || item.job.originalFilename || item.id
        message.success(
          published ? `Producto publicado: ${name}` : `Producto guardado como borrador: ${name}`,
        )
        removeReviewItem(item.id)
      } catch (error) {
        message.error(
          describeProductAttemptFailure(
            agentAttemptsRef.current.get(item.job._id),
            error,
            'No se pudo publicar el producto',
          ),
        )
      } finally {
        setReviewItemBusyId(null)
      }
    },
    [commitAgentReviewItem, removeReviewItem],
  )

  const handleDiscardReviewItem = useCallback(
    async item => {
      setReviewItemBusyId(item.id)
      try {
        await discardAgentReviewItem(item.job)
        const halfDone = agentAttemptsRef.current.get(item.job._id)?.productId
        agentAttemptsRef.current.delete(item.job._id)
        message.info(
          halfDone
            ? 'Producto descartado. El producto que quedó de un intento anterior sigue en Productos: borralo desde ahí si no lo querés.'
            : 'Producto descartado, no se publicó',
        )
        removeReviewItem(item.id)
      } catch (error) {
        message.error(
          error?.response?.data?.message || error?.message || 'No se pudo descartar el producto',
        )
      } finally {
        setReviewItemBusyId(null)
      }
    },
    [discardAgentReviewItem, removeReviewItem],
  )

  const handleApproveAllReview = useCallback(async () => {
    for (const item of autoAgentReviewQueue) {
      await handleApproveReviewItem(item)
    }
  }, [autoAgentReviewQueue, handleApproveReviewItem])

  const handleDiscardAllReview = useCallback(async () => {
    for (const item of autoAgentReviewQueue) {
      await handleDiscardReviewItem(item)
    }
  }, [autoAgentReviewQueue, handleDiscardReviewItem])

  const processAutoAgentQueue = useCallback(async () => {
    if (!autoAgentEnabled || autoAgentRef.current || hasUserWorkspace) return

    const jobsToProcess = selectJobsForReviewQueue(agentQueue, {
      failedIds: autoAgentFailedJobsRef.current,
      queuedIds: reviewQueuedJobsRef.current,
    })

    if (!jobsToProcess.length) return

    autoAgentRef.current = true
    setAutoAgentRunning(true)

    const prepared = []

    try {
      for (const job of jobsToProcess) {
        try {
          const item = await prepareAgentJobForReview(job)
          reviewQueuedJobsRef.current.add(job._id)
          prepared.push({
            id: job._id,
            ...item,
            previewUrl: URL.createObjectURL(item.imageFile),
          })
          setAgentQueue(current => current.filter(entry => entry._id !== job._id))
        } catch (error) {
          // 409 no es un fallo: el job dejó de estar disponible porque ya se
          // aprobó o lo tomó otro flujo, y esta cola local quedó vieja. Pasa
          // justo después de guardar un producto — el guardado aprueba el job
          // y este recorrido todavía lo ve como 'pending' —, así que un error
          // rojo acusa de fallar a una operación que salió bien. Se saca de la
          // cola y se sigue.
          if (error?.response?.status === 409) {
            setAgentQueue(current => current.filter(entry => entry._id !== job._id))
            continue
          }

          autoAgentFailedJobsRef.current.add(job._id)
          message.error(
            error?.response?.data?.message ||
              error?.message ||
              `No se pudo preparar ${job.originalFilename || job._id} para revisión`,
          )
        }
      }

      if (prepared.length) {
        setAutoAgentReviewQueue(current => [...current, ...prepared])
        setAutoAgentReviewOpen(true)
        message.info(
          prepared.length === 1
            ? '1 producto de AutoSave está listo para revisar antes de publicar'
            : `${prepared.length} productos de AutoSave están listos para revisar antes de publicar`,
        )
      }

      await fetchAgentQueue()
    } finally {
      autoAgentRef.current = false
      setAutoAgentRunning(false)
    }
  }, [agentQueue, autoAgentEnabled, fetchAgentQueue, hasUserWorkspace, prepareAgentJobForReview])

  useEffect(() => {
    processAutoAgentQueue()
  }, [processAutoAgentQueue])

  // Con "Auto activo", una imagen que llega a horario (queda 'pending' en
  // /admin/product-analysis) no debería necesitar que alguien la
  // seleccione a mano en el desplegable y apriete "Cargar ahora". Este
  // efecto hace exactamente eso solo: carga la próxima pendiente en el
  // formulario y dispara el análisis — la creación del producto sigue
  // siendo manual (botón "Guardar"), esto solo ahorra el click de carga.
  // No compite con processAutoAgentQueue: ese procesa jobs con
  // autoSaveProduct:true (van a la cola de revisión AutoSave); este
  // procesa el resto.
  const autoLoadNextPendingJob = useCallback(async () => {
    if (!autoAgentEnabled || autoAgentRef.current || importingAgentImage || hasUserWorkspace) {
      return
    }

    const nextJob = agentQueue.find(
      job =>
        ['pending', 'completed'].includes(job.status) &&
        job.metadata?.autoSaveProduct !== true &&
        !autoAgentFailedJobsRef.current.has(job._id),
    )

    if (!nextJob) return

    autoAgentRef.current = true

    try {
      const succeeded = await handleImportAgentImage(nextJob._id)
      if (!succeeded) {
        autoAgentFailedJobsRef.current.add(nextJob._id)
      }
    } finally {
      autoAgentRef.current = false
    }
  }, [agentQueue, autoAgentEnabled, handleImportAgentImage, hasUserWorkspace, importingAgentImage])

  useEffect(() => {
    autoLoadNextPendingJob()
  }, [autoLoadNextPendingJob])

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

        if (prevList.length + safeArray(incomingFiles).length > MAX_PRODUCT_IMAGES) {
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
          variant.imageSourceUid === file.uid ? { ...variant, imageSourceUid: null } : variant,
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

  const handleReorderImage = useCallback(
    (fromIndex, toIndex) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= fileList.length ||
        toIndex >= fileList.length
      ) {
        return
      }

      const reordered = [...fileList]
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, moved)

      revokeBlobUrls(imagePreviews)
      setFileList(reordered)
      setImagePreviews(rebuildPreviews(reordered))
    },
    [fileList, imagePreviews],
  )

  const handleSetPrincipalImage = useCallback(
    index => handleReorderImage(index, 0),
    [handleReorderImage],
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
    const collectedErrors = []

    // Las fotos se piden para publicar; un borrador se guarda sin ellas.
    if (!fileList.length) {
      if (publishProduct) {
        collectedErrors.push({
          section: SECTION_IDS.imagenes,
          message: 'Debes subir al menos una imagen',
        })
      }
    } else {
      const fileValidationError = validateSelectedFiles(fileList)
      if (fileValidationError) {
        collectedErrors.push({
          section: SECTION_IDS.imagenes,
          message: fileValidationError,
        })
      }
    }

    const basicsError = validateProductBasicsForSubmit({
      values,
      hasVariants,
      publish: publishProduct,
    })
    if (basicsError) {
      collectedErrors.push({
        section: /precio|cantidad|stock/i.test(basicsError)
          ? SECTION_IDS.precio
          : SECTION_IDS.informacion,
        message: basicsError,
      })
    }

    if (hasVariants) {
      const variantError = validateVariantsForSubmit(variants, { publish: publishProduct })

      if (variantError) {
        collectedErrors.push({
          section: SECTION_IDS.variantes,
          message: variantError,
        })
      }
    }

    if (!tenantId) {
      collectedErrors.push({ section: null, message: 'Tenant no disponible' })
    }

    setSubmitErrors(collectedErrors)

    if (collectedErrors.length) {
      message.error(
        collectedErrors.length === 1
          ? collectedErrors[0].message
          : `Hay ${collectedErrors.length} problemas que resolver antes de ${
              publishProduct ? 'publicar' : 'guardar'
            }`,
      )
      scrollToSection(collectedErrors[0].section || SECTION_IDS.imagenes)
      return
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
        ? normalizeDynamicFieldValues(dynamicProductFields, values.dynamicFields || {})
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
              normalizeSku(variant.sku) || buildGeneratedVariantSku(values.titulo, combination, idx)

            return {
              key,
              nombre: buildVariantName(combination) || `Variante ${idx + 1}`,
              sku,
              attributes: combination,
              combinacion: combination,
              price: normalizeNumberValue(variant.price),
              costoUnitario: normalizeOptionalNumberValue(variant.costoUnitario),
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
        costoUnitario: normalizeOptionalNumberValue(values.costoUnitario),
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
        aiOriginalOutput: normalizedIaResult ? JSON.stringify(normalizedIaResult) : null,
        aiConfidence: normalizedIaResult?.confidence ?? null,
        // Solo con análisis: un producto cargado a mano quedaba con 'gemini'.
        aiSource: normalizedIaResult
          ? normalizedIaResult.source || normalizedIaResult.model || null
          : null,
        aiImageHash: normalizedIaResult?.hash || null,
        aiNeedsReview:
          normalizedIaResult?.needsReview === true ||
          normalizedIaResult?.requiresHumanReview === true ||
          false,
        aiAgentJobId: currentAgentJob?._id || null,
        aiAgentScheduledAt:
          currentAgentJob?.scheduledAt || currentAgentJob?.metadata?.addProductAt || null,
        aiAutomationMode: currentAgentJob ? 'agent-assisted' : 'manual',
        // Sin status: se crea siempre como borrador y, si corresponde, se
        // publica al final (ver runProductAttempt).
      }

      const payloadForCreate = enforceTechnicalSheetPersistence(productPayload, useTechnicalSheet)

      if (!productAttemptRef.current) productAttemptRef.current = createProductAttempt()

      // El job puede venir de la cola del agente (currentAgentJob) o de una
      // subida manual arrastrada al dropzone (lastAnalysisJobId) — en
      // ambos casos queda vinculado al producto recién creado para que
      // aparezca en el historial de /admin/product-analysis.
      const linkedAnalysisJobId = currentAgentJob?._id || lastAnalysisJobId

      const imageSteps = fileList
        .filter(file => file?.originFileObj)
        .map(file => ({
          key: `image:${file.uid}`,
          run: async ({ productId, uploads, clientRequestId }) => {
            const clientUploadId = `${clientRequestId}:${file.uid}`
            const uploadResult = await dispatch(
              uploadProductImage({
                productId,
                imageFile: file.originFileObj,
                clientUploadId,
                silent: true,
              }),
            ).unwrap()

            const imagesArray = Array.isArray(uploadResult?.data)
              ? uploadResult.data
              : Array.isArray(uploadResult)
                ? uploadResult
                : []

            // Si la subida ya estaba guardada, el backend devuelve todas las
            // imágenes: esta no es necesariamente la última.
            const uploadedImage =
              imagesArray.find(image => image?.clientUploadId === clientUploadId) ||
              imagesArray[imagesArray.length - 1]

            if (uploadedImage?.url) {
              uploads.set(file.uid, uploadedImage)
            }
          },
        }))

      // El video no frena el alta: si falla se avisa y se sigue, como antes.
      const videoSteps = videoFile
        ? [
            {
              key: 'video',
              run: async ({ productId }) => {
                try {
                  setVideoUploading(true)
                  await dispatch(
                    uploadProductVideo({
                      productId,
                      videoFile: getUploadFileObject(videoFile),
                      silent: true,
                    }),
                  ).unwrap()
                } catch {
                  message.warning(
                    'El producto se creó, pero el video no pudo subirse. Podés reintentarlo luego desde Editar producto.',
                  )
                } finally {
                  setVideoUploading(false)
                }
              },
            },
          ]
        : []

      const variantImageSteps = hasVariants
        ? variants
            .filter(localVariant => localVariant.imageSourceUid)
            .map(localVariant => ({
              key: `variant-image:${localVariant.key}`,
              run: async ({ productId, product, uploads }) => {
                const selectedUploadedImage = uploads.get(localVariant.imageSourceUid)
                if (!selectedUploadedImage?.url) return

                const createdVariant = safeArray(product?.variants).find(
                  variant =>
                    variant.key === localVariant.key ||
                    buildVariantKey(variant.attributes || {}) === localVariant.key,
                )

                if (!createdVariant?._id) return

                await dispatch(
                  assignVariantImage({
                    productId,
                    variantId: createdVariant._id,
                    image: {
                      public_id: selectedUploadedImage.public_id,
                      url: selectedUploadedImage.url,
                    },
                    silent: true,
                  }),
                ).unwrap()
              },
            }))
        : []

      const linkJobSteps = linkedAnalysisJobId
        ? [
            {
              key: 'link-job',
              run: ({ productId }) =>
                api.post(`/product-analysis/${linkedAnalysisJobId}/complete-add-product`, {
                  productId,
                }),
            },
          ]
        : []

      await runProductAttempt({
        attempt: productAttemptRef.current,
        createDraft: clientRequestId =>
          dispatch(
            createProducts({
              ...payloadForCreate,
              status: 'draft',
              visibility: 'hidden',
              clientRequestId,
            }),
          ).unwrap(),
        steps: [...imageSteps, ...videoSteps, ...variantImageSteps],
        publish: publishProduct ? productService.publishDraftProduct : null,
        finalSteps: linkJobSteps,
      })

      const outcome = publishProduct ? 'Producto publicado' : 'Producto guardado como borrador'
      message.success(
        hasVariants && variants.length > 0
          ? `${outcome} con ${variants.length} variantes`
          : outcome,
      )

      resetProductWorkspace()
      await waitForUiReset()
      await fetchAgentQueue()
    } catch (error) {
      message.error(
        describeProductAttemptFailure(productAttemptRef.current, error, 'Error al crear producto'),
      )
    } finally {
      setSavingProduct(false)
    }
  }

  return (
    <>
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
            md={23}
            lg={22}
            xl={21}
            xxl={19}
            style={{ width: '100%', maxWidth: 1560, margin: '0 auto' }}
          >
            <div
              style={{
                marginBottom: 24,
                padding: '30px 30px 26px',
                borderRadius: 24,
                color: '#fff',
                background: HERO_BG,
                boxShadow: '0 24px 50px -28px rgba(5, 11, 31, 0.7)',
              }}
            >
              <Row gutter={[24, 20]} align="middle" justify="space-between">
                <Col xs={24} lg={15}>
                  <Space direction="vertical" size={8}>
                    <span
                      style={{
                        color: '#14d8ff',
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.16em',
                      }}
                    >
                      NUEVO PRODUCTO
                    </span>

                    <Title
                      level={1}
                      style={{
                        margin: 0,
                        color: '#fff',
                        fontFamily: DISPLAY_FONT,
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      Creá tu producto
                    </Title>

                    <Text style={{ color: '#b9c6ee', fontSize: 15 }}>
                      Subí las imágenes, revisá lo que propone la IA, completá la ficha técnica, las
                      variantes y la logística, y publicá cuando quieras.
                    </Text>

                    <Space wrap size={10}>
                      {hasVariants && (
                        <Tag color="blue" style={{ borderRadius: 999, padding: '3px 12px' }}>
                          {variants.length} variantes
                        </Tag>
                      )}

                      {hasUserWorkspace && (
                        <Popconfirm
                          title="¿Vaciar el formulario?"
                          description="Se van a perder las imágenes, variantes, ficha técnica y demás datos cargados. Esta acción no se puede deshacer."
                          okText="Vaciar todo"
                          cancelText="Cancelar"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => {
                            resetProductWorkspace()
                            message.success('Formulario vacío. Podés empezar de nuevo.')
                          }}
                        >
                          <Button
                            htmlType="button"
                            danger
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            disabled={savingProduct || isLoading}
                          >
                            Vaciar formulario
                          </Button>
                        </Popconfirm>
                      )}
                    </Space>
                  </Space>
                </Col>

                <Col xs={24} lg={9}>
                  <Row gutter={[12, 12]}>
                    {[
                      ['Imágenes', fileList.length],
                      ['Variantes', variants.length],
                      ['IA', iaResult ? 'OK' : '—'],
                    ].map(([label, value]) => (
                      <Col xs={8} key={label}>
                        <div style={HERO_TILE_STYLE}>
                          <Text style={{ color: '#b9c6ee', fontSize: 13 }}>{label}</Text>
                          <div
                            style={{
                              fontSize: 24,
                              fontWeight: 800,
                              fontFamily: DISPLAY_FONT,
                            }}
                          >
                            {value}
                          </div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                </Col>
              </Row>
            </div>

            <div
              className="add-product-steps-bar"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 10,
                marginBottom: 24,
                padding: '14px 20px',
                borderRadius: 16,
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
              }}
            >
              <Steps
                size="small"
                responsive
                current={wizardCurrentStep}
                onChange={index => scrollToSection(wizardSteps[index]?.sectionId)}
                items={wizardSteps.map(step => ({
                  title: step.title,
                  description: step.optional ? 'Opcional' : undefined,
                  status: step.status,
                }))}
              />
            </div>

            <ProductFormDirtyContext.Provider value={markFormAsChanged}>
              <ProductFormMutationContext.Provider
                value={{
                  version: formMutationVersion,
                  notifyMutation: notifyFormMutation,
                }}
              >
                <Form
                  form={form}
                  layout="vertical"
                  scrollToFirstError={false}
                  disabled={savingProduct || isLoading}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
                      event.preventDefault()
                    }
                  }}
                  onFinish={() => handleFinish(form.getFieldsValue(true))}
                >
                  <Row gutter={[24, 24]} align="top">
                    <Col xs={24} xl={0}>
                      <Alert
                        type={productReadiness.isReady ? 'success' : 'warning'}
                        showIcon
                        style={{
                          marginBottom: submitErrors.length ? 12 : 20,
                          borderRadius: 14,
                        }}
                        message={
                          productReadiness.isReady
                            ? 'Listo para publicar'
                            : `Completá lo esencial (${productReadiness.doneRequired}/${productReadiness.requiredChecks.length} · ${productReadiness.percent}%)`
                        }
                        description={
                          productReadiness.isReady
                            ? undefined
                            : `Faltan: ${missingRequiredLabels.join(', ')}`
                        }
                      />

                      {submitErrors.length > 0 && (
                        <Alert
                          type="error"
                          showIcon
                          style={{ marginBottom: 20, borderRadius: 14 }}
                          message={
                            submitErrors.length === 1
                              ? 'No se pudo publicar: hay un problema para resolver'
                              : `No se pudo publicar: hay ${submitErrors.length} problemas para resolver`
                          }
                          description={
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {submitErrors.map((err, idx) => (
                                <li key={idx}>
                                  {err.section ? (
                                    <a
                                      href={`#${err.section}`}
                                      onClick={event => {
                                        event.preventDefault()
                                        scrollToSection(err.section)
                                      }}
                                    >
                                      {err.message}
                                    </a>
                                  ) : (
                                    err.message
                                  )}
                                </li>
                              ))}
                            </ul>
                          }
                        />
                      )}
                    </Col>

                    <Col xs={24} xl={15}>
                      <Card
                        id={SECTION_IDS.imagenes}
                        title={
                          <Space size={10}>
                            <span className="add-product-step-badge">1</span>
                            <PictureOutlined style={{ color: token.colorPrimary }} />
                            <span className="add-product-card-title">Imágenes del producto</span>
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
                        <Text
                          type="secondary"
                          style={{
                            display: 'block',
                            marginBottom: 16,
                            fontSize: 14,
                          }}
                        >
                          Subí al menos una imagen del producto — es el único dato obligatorio de
                          esta sección.
                        </Text>

                        <Collapse
                          ghost
                          className="add-product-agent-collapse"
                          defaultActiveKey={autoAgentEnabled || currentAgentJob ? ['agent'] : []}
                          style={{
                            marginBottom: 20,
                            borderRadius: 18,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: `linear-gradient(135deg, ${token.colorFillAlter}, ${token.colorBgContainer})`,
                          }}
                          items={[
                            {
                              key: 'agent',
                              label: (
                                <Space size={8}>
                                  <RobotOutlined style={{ color: token.colorPrimary }} />
                                  <Text strong style={{ fontSize: 14 }}>
                                    Importar desde el agente IA ({agentQueueStats.total} en cola)
                                  </Text>
                                </Space>
                              ),
                              children: (
                                <>
                                  <Row gutter={[18, 18]} align="middle">
                                    <Col xs={24} lg={10}>
                                      <Space direction="vertical" size={6}>
                                        <Space wrap>
                                          <Tag color="processing" style={{ borderRadius: 999 }}>
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
                                          <Tooltip
                                            title={
                                              agentHeartbeat
                                                ? `${agentHeartbeat.hostname || 'PC del local'} · v${agentHeartbeat.version || '?'} · pendientes: ${agentHeartbeat.queue?.pending ?? 0}`
                                                : 'El watcher local todavía no envió ningún heartbeat.'
                                            }
                                          >
                                            <Tag
                                              color={
                                                agentHeartbeat?.lastHeartbeatAt &&
                                                Date.now() -
                                                  new Date(
                                                    agentHeartbeat.lastHeartbeatAt,
                                                  ).getTime() <
                                                  WATCHER_ONLINE_THRESHOLD_MS
                                                  ? 'success'
                                                  : 'default'
                                              }
                                              style={{ borderRadius: 999 }}
                                            >
                                              {agentHeartbeat?.lastHeartbeatAt
                                                ? `Watcher ${formatRelativeTime(agentHeartbeat.lastHeartbeatAt)}`
                                                : 'Watcher sin conexión'}
                                            </Tag>
                                          </Tooltip>
                                        </Space>

                                        <Text strong style={{ fontSize: 15 }}>
                                          Bandeja inteligente
                                        </Text>

                                        <Text
                                          type="secondary"
                                          style={{
                                            fontSize: 13,
                                            lineHeight: 1.55,
                                          }}
                                        >
                                          Importá imágenes del agente, programalas o dejá que
                                          AutoSave cree productos con IA cuando el modo automático
                                          esté activo.
                                        </Text>
                                      </Space>
                                    </Col>

                                    <Col xs={24} lg={14}>
                                      <Space
                                        direction="vertical"
                                        size={10}
                                        style={{ width: '100%' }}
                                      >
                                        <Space
                                          wrap
                                          className="add-product-agent-actions"
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
                                          className="add-product-agent-actions"
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

                                  <Row gutter={[10, 10]} style={{ marginTop: 16 }}>
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
                                        label: 'Analizadas',
                                        value: agentQueueStats.completed,
                                      },
                                      {
                                        label: 'AutoSave',
                                        value: agentQueueStats.autoSave,
                                      },
                                    ].map(metric => (
                                      <Col xs={6} key={metric.label}>
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
                                            style={{
                                              fontSize: 13,
                                              display: 'block',
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                            }}
                                            title={metric.label}
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

                                  {selectedAgentJob && (
                                    <Alert
                                      type={
                                        selectedAgentJob.status === 'scheduled'
                                          ? 'warning'
                                          : selectedAgentJob.status === 'completed'
                                            ? 'success'
                                            : 'info'
                                      }
                                      showIcon
                                      style={{
                                        marginTop: 16,
                                        borderRadius: 14,
                                      }}
                                      message={
                                        selectedAgentJob.status === 'scheduled'
                                          ? `Programada para ${formatDate(selectedAgentJob.scheduledAt)}`
                                          : selectedAgentJob.status === 'completed'
                                            ? 'AddProduct ya la analizó'
                                            : 'Disponible para AddProduct'
                                      }
                                      description={
                                        selectedAgentJob.status === 'completed'
                                          ? 'AddProduct ya la analizó con IA sola, sin que nadie tuviera esta pantalla abierta (título, variantes, ficha técnica, SEO). Al cargarla acá se autocompleta el formulario sin volver a llamar a la IA — revisá y guardá cuando quieras.'
                                          : 'Esta imagen todavía no fue analizada: al cargarla acá se sube al formulario y se dispara la IA para que la revises antes de guardar.'
                                      }
                                    />
                                  )}
                                </>
                              ),
                            },
                          ]}
                        />

                        {autoAgentReviewQueue.length > 0 && (
                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginBottom: 20, borderRadius: 14 }}
                            message={
                              autoAgentReviewQueue.length === 1
                                ? '1 producto de AutoSave está esperando tu aprobación'
                                : `${autoAgentReviewQueue.length} productos de AutoSave están esperando tu aprobación`
                            }
                            description="La IA los preparó, pero ninguno se publica hasta que los revises."
                            action={
                              <Button
                                htmlType="button"
                                type="primary"
                                size="small"
                                onClick={() => setAutoAgentReviewOpen(true)}
                              >
                                Revisar ahora
                              </Button>
                            }
                          />
                        )}

                        <Modal
                          open={autoAgentReviewOpen}
                          onCancel={() => setAutoAgentReviewOpen(false)}
                          title={
                            <Space size={8}>
                              <RobotOutlined style={{ color: token.colorPrimary }} />
                              <span>Revisar productos de AutoSave</span>
                            </Space>
                          }
                          width={720}
                          footer={
                            autoAgentReviewQueue.length > 0 ? (
                              <Space>
                                <Popconfirm
                                  title="Descartar todos"
                                  description="Ningún producto de esta tanda se va a publicar."
                                  okText="Descartar todo"
                                  cancelText="Cancelar"
                                  okButtonProps={{ danger: true }}
                                  onConfirm={handleDiscardAllReview}
                                >
                                  <Button
                                    htmlType="button"
                                    danger
                                    disabled={Boolean(reviewItemBusyId)}
                                  >
                                    Descartar todo
                                  </Button>
                                </Popconfirm>
                                <Popconfirm
                                  title="Publicar todos"
                                  description={`Se van a crear ${autoAgentReviewQueue.length} producto${autoAgentReviewQueue.length === 1 ? '' : 's'} tal como los preparó la IA.`}
                                  okText="Publicar todo"
                                  cancelText="Cancelar"
                                  onConfirm={handleApproveAllReview}
                                >
                                  <Button
                                    htmlType="button"
                                    type="primary"
                                    loading={Boolean(reviewItemBusyId)}
                                  >
                                    Aprobar y publicar todo
                                  </Button>
                                </Popconfirm>
                              </Space>
                            ) : (
                              <Button
                                htmlType="button"
                                onClick={() => setAutoAgentReviewOpen(false)}
                              >
                                Cerrar
                              </Button>
                            )
                          }
                        >
                          {autoAgentReviewQueue.length === 0 ? (
                            <Empty description="No hay productos pendientes de revisión" />
                          ) : (
                            <Space direction="vertical" size={14} style={{ width: '100%' }}>
                              <Alert
                                type="info"
                                showIcon
                                message="Ningún producto se publica hasta que lo apruebes"
                                style={{ borderRadius: 12 }}
                              />
                              {autoAgentReviewQueue.map(item => (
                                <Card
                                  key={item.id}
                                  size="small"
                                  style={{ borderRadius: 14 }}
                                  styles={{ body: { padding: 14 } }}
                                >
                                  <Row gutter={14} align="middle">
                                    <Col flex="72px">
                                      <img
                                        src={item.previewUrl}
                                        alt={`Vista previa de ${item.payload?.title || 'producto preparado por IA'}`}
                                        style={{
                                          width: 72,
                                          height: 72,
                                          objectFit: 'cover',
                                          borderRadius: 10,
                                          border: `1px solid ${token.colorBorderSecondary}`,
                                        }}
                                      />
                                    </Col>
                                    <Col flex="auto">
                                      <Text strong>{item.payload?.title}</Text>
                                      <br />
                                      <Text type="secondary" style={{ fontSize: 13 }}>
                                        {item.payload?.categoria}
                                        {item.payload?.subcategoria
                                          ? ` / ${item.payload.subcategoria}`
                                          : ''}
                                        {' · '}
                                        {item.payload?.status === 'active'
                                          ? 'Se publica visible'
                                          : 'Se crea como borrador'}
                                      </Text>
                                      <br />
                                      <Text style={{ fontSize: 13 }}>
                                        ${Number(item.payload?.price || 0).toLocaleString('es-AR')}
                                        {' · Stock: '}
                                        {item.payload?.stock ?? 0}
                                      </Text>
                                    </Col>
                                    <Col flex="none">
                                      <Space>
                                        <Popconfirm
                                          title="Descartar producto"
                                          description="No se va a crear este producto."
                                          okText="Descartar"
                                          cancelText="Cancelar"
                                          okButtonProps={{ danger: true }}
                                          onConfirm={() => handleDiscardReviewItem(item)}
                                        >
                                          <Button
                                            htmlType="button"
                                            danger
                                            size="small"
                                            icon={<DeleteOutlined />}
                                            loading={reviewItemBusyId === item.id}
                                            disabled={
                                              reviewItemBusyId !== null &&
                                              reviewItemBusyId !== item.id
                                            }
                                            aria-label={`Descartar producto preparado ${item.payload?.title || ''}`}
                                          />
                                        </Popconfirm>
                                        <Button
                                          htmlType="button"
                                          type="primary"
                                          size="small"
                                          icon={<CheckOutlined />}
                                          onClick={() => handleApproveReviewItem(item)}
                                          loading={reviewItemBusyId === item.id}
                                          disabled={
                                            reviewItemBusyId !== null &&
                                            reviewItemBusyId !== item.id
                                          }
                                        >
                                          Publicar
                                        </Button>
                                      </Space>
                                    </Col>
                                  </Row>
                                </Card>
                              ))}
                            </Space>
                          )}
                        </Modal>

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
                              minHeight: 280,
                              display: 'flex',
                              alignItems: 'center',
                              background: `linear-gradient(135deg, ${token.colorBgContainer}, ${token.colorFillAlter})`,
                              border: `2px dashed ${token.colorPrimaryBorder || token.colorBorder}`,
                            }}
                          >
                            <div style={{ textAlign: 'center' }}>
                              <div
                                style={{
                                  width: 104,
                                  height: 104,
                                  borderRadius: 28,
                                  background: `${token.colorPrimary}14`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  margin: '0 auto 18px',
                                  border: `1px solid ${token.colorPrimaryBorder || token.colorBorder}`,
                                }}
                              >
                                <InboxOutlined
                                  style={{
                                    fontSize: 48,
                                    color: token.colorPrimary,
                                  }}
                                />
                              </div>

                              <Text strong style={{ fontSize: 19, display: 'block' }}>
                                Arrastrá imágenes o importalas desde el agente
                              </Text>

                              <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                                Las imágenes cargadas disparan el análisis visual con IA.
                              </Text>

                              <Text
                                type="secondary"
                                style={{
                                  fontSize: 12,
                                  display: 'block',
                                  marginTop: 10,
                                }}
                              >
                                JPG, PNG, WEBP, HEIC/HEIF · máximo {MAX_PRODUCT_IMAGES} imágenes ·
                                alta calidad mejora la precisión
                              </Text>
                            </div>
                          </Dragger>
                        ) : (
                          <ImagePreviewGrid
                            previews={imagePreviews}
                            fileList={fileList}
                            onRemove={handleRemove}
                            onAddMore={handleAddMoreImages}
                            onReorder={handleReorderImage}
                            onSetPrincipal={handleSetPrincipalImage}
                            onAnalyze={handleReanalyzeImage}
                            analyzing={loadingIa}
                          />
                        )}
                      </Card>

                      <Card
                        style={{ borderRadius: 20, marginTop: 20 }}
                        styles={{ body: { padding: 24 } }}
                      >
                        <Space
                          direction="vertical"
                          size={4}
                          style={{ width: '100%', marginBottom: 16 }}
                        >
                          <Text strong style={{ fontSize: 16 }}>
                            Video del producto (opcional)
                          </Text>
                          <Text type="secondary">
                            Un solo video de hasta {MAX_VIDEO_SIZE_MB}MB y{' '}
                            {MAX_VIDEO_DURATION_SECONDS} segundos. MP4, WEBM o MOV.
                          </Text>
                        </Space>

                        {!videoFile ? (
                          <Upload
                            accept="video/mp4,video/webm,video/quicktime"
                            beforeUpload={() => false}
                            showUploadList={false}
                            onChange={handleVideoChange}
                            maxCount={1}
                          >
                            <Button icon={<InboxOutlined />}>Seleccionar video</Button>
                          </Upload>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 16,
                              flexWrap: 'wrap',
                            }}
                          >
                            <video
                              src={videoPreviewUrl}
                              controls
                              style={{
                                width: 220,
                                borderRadius: 12,
                                background: '#000',
                              }}
                            />
                            <Space direction="vertical">
                              <Text>
                                {getUploadFileObject(videoFile)?.name || 'Video seleccionado'}
                              </Text>
                              <Button danger loading={videoUploading} onClick={handleRemoveVideo}>
                                Quitar video
                              </Button>
                            </Space>
                          </div>
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
                        id={SECTION_IDS.informacion}
                        title={
                          <Space size={10}>
                            <span className="add-product-step-badge">2</span>
                            <ShoppingOutlined style={{ color: token.colorPrimary }} />
                            <span className="add-product-card-title">Información del producto</span>
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
                        <Text
                          type="secondary"
                          style={{
                            display: 'block',
                            marginBottom: 16,
                            fontSize: 14,
                          }}
                        >
                          Lo que ve el cliente: título, descripción y clasificación — todo
                          obligatorio.
                        </Text>

                        <Row gutter={[18, 18]}>
                          <Col xs={24}>
                            <ProductField
                              name="titulo"
                              label="Título del producto"
                              rules={REQUIRED_TITULO_RULES}
                            >
                              <Input
                                size="large"
                                placeholder="Nombre comercial claro del producto"
                                prefix={
                                  <FileTextOutlined style={{ color: token.colorTextSecondary }} />
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
                              rules={REQUIRED_DESCRIPCION_RULES}
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
                              rules={REQUIRED_CATEGORIA_RULES}
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
                                  commitClassificationFromForm({
                                    categoria: value,
                                  })
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
                                      style={{
                                        color: token.colorTextSecondary,
                                      }}
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
                              rules={REQUIRED_SUBCATEGORIA_RULES}
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
                                      style={{
                                        color: token.colorTextSecondary,
                                      }}
                                    />
                                  }
                                />
                              </AutoComplete>
                            </ProductField>
                          </Col>

                          <Col xs={24} md={12}>
                            <ProductField name="marca" label="Marca" rules={REQUIRED_MARCA_RULES}>
                              <Input
                                size="large"
                                placeholder="Marca visible o declarada"
                                prefix={
                                  <ShoppingOutlined style={{ color: token.colorTextSecondary }} />
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
                                  <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
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
                        id={SECTION_IDS.ficha}
                        title={
                          <Space size={10}>
                            <span className="add-product-step-badge">3</span>
                            <AppstoreOutlined style={{ color: token.colorPrimary }} />
                            <span className="add-product-card-title">
                              Ficha técnica inteligente
                            </span>
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
                              if (checked) {
                                setUseTechnicalSheet(true)
                                const snapshot = technicalSheetSnapshotRef.current
                                if (snapshot) {
                                  const currentDynamicFields =
                                    form.getFieldValue('dynamicFields') || {}
                                  const hasCurrentValues = Object.values(currentDynamicFields).some(
                                    value =>
                                      Array.isArray(value)
                                        ? value.length > 0
                                        : value !== undefined && value !== null && value !== '',
                                  )
                                  if (
                                    !hasCurrentValues &&
                                    !normalizeString(form.getFieldValue('descripcionTecnica'))
                                  ) {
                                    setProductFormValues({
                                      descripcionTecnica: snapshot.descripcionTecnica,
                                      dynamicFields: snapshot.dynamicFields,
                                    })
                                    message.info(
                                      'Se restauraron los datos técnicos que habías cargado',
                                    )
                                  }
                                  technicalSheetSnapshotRef.current = null
                                }
                                return
                              }

                              const currentDescripcionTecnica =
                                form.getFieldValue('descripcionTecnica')
                              const currentDynamicFields = form.getFieldValue('dynamicFields') || {}
                              const hasData =
                                normalizeString(currentDescripcionTecnica) ||
                                Object.values(currentDynamicFields).some(value =>
                                  Array.isArray(value)
                                    ? value.length > 0
                                    : value !== undefined && value !== null && value !== '',
                                )

                              const disableTechnicalSheet = () => {
                                technicalSheetSnapshotRef.current = {
                                  descripcionTecnica: currentDescripcionTecnica,
                                  dynamicFields: currentDynamicFields,
                                }
                                setUseTechnicalSheet(false)
                                setProductFormValues({
                                  descripcionTecnica: undefined,
                                  dynamicFields: {},
                                })
                                message.info('Ficha técnica desactivada para este producto')
                              }

                              if (!hasData) {
                                setUseTechnicalSheet(false)
                                return
                              }

                              Modal.confirm({
                                title: '¿Desactivar la ficha técnica?',
                                content:
                                  'Se van a quitar del formulario los datos técnicos cargados (descripción técnica y campos). Si la reactivás sin cargar un producto nuevo, se restauran automáticamente.',
                                okText: 'Desactivar',
                                okButtonProps: { danger: true },
                                cancelText: 'Cancelar',
                                onOk: disableTechnicalSheet,
                              })
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
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
                                  La IA encontró {normalizedAiDraft.dynamicFields.length} datos
                                  posibles. Podés aplicarlos y luego quitar los que no correspondan.
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
                              <Space direction="vertical" size={14} style={{ width: '100%' }}>
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
                                  onChange={event => setTechnicalQuickText(event.target.value)}
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
                                    onClick={generateTechnicalDescriptionFromCurrentValues}
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
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                      <DynamicProductField field={field} />
                                      <Space size={6} wrap>
                                        {field.required && (
                                          <Tag color="red" style={{ borderRadius: 999 }}>
                                            Obligatorio
                                          </Tag>
                                        )}
                                        {field.source && (
                                          <Tag style={{ borderRadius: 999 }}>{field.source}</Tag>
                                        )}
                                        <Button
                                          htmlType="button"
                                          size="small"
                                          type="link"
                                          danger
                                          onClick={() =>
                                            handleRemoveDynamicProductField(field.name)
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
                                  onChange={event => setCustomFieldName(event.target.value)}
                                  onPressEnter={handleAddDynamicProductField}
                                  placeholder="Ej: Potencia, Material, Capacidad"
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
                        id={SECTION_IDS.variantes}
                        title={
                          <Space size={10}>
                            <span className="add-product-step-badge">4</span>
                            <ClusterOutlined style={{ color: token.colorPrimary }} />
                            <span className="add-product-card-title">
                              Opciones vendibles del producto
                            </span>
                            {dynamicAttributes.length > 0 && (
                              <Tag color="success" style={{ borderRadius: 999 }}>
                                {dynamicAttributes.length} atributos detectados
                              </Tag>
                            )}
                            {!hasVariants && (
                              <Tag color="default" style={{ borderRadius: 999 }}>
                                Opcional
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
                                  <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                                    Pegá opciones en una línea y generá combinaciones sin cargar
                                    campo por campo.
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
                                    onChange={event => setQuickVariantText(event.target.value)}
                                    rows={2}
                                    placeholder="Ej: Color: Negro, Blanco | Medida: 500ml, 1L | Presentación: Unidad, Pack"
                                    style={{ marginTop: 10 }}
                                  />
                                </Col>
                                <Col xs={24} lg={9}>
                                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
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
                                    onChange={event => setNewAttributeName(event.target.value)}
                                    onPressEnter={handleAddCustomAttribute}
                                    placeholder="Ej: Color, Talle, Presentación"
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
                                      {
                                        value: 'select',
                                        label: 'Lista de opciones',
                                      },
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
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
                                          <Badge count={index + 1} color={token.colorPrimary} />
                                          <div>
                                            <Text strong>{attr.label}</Text>
                                            <br />
                                            <Text type="secondary" style={{ fontSize: 12 }}>
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
                                            handleAttributeValuesChange(attr.name, values)
                                          }
                                          tokenSeparators={[',']}
                                          allowClear
                                          style={{ width: '100%' }}
                                          options={safeArray(attr.values).map(value => ({
                                            value,
                                            label: value,
                                          }))}
                                        />
                                      </Col>
                                      <Col xs={4} md={2} style={{ textAlign: 'right' }}>
                                        <Button
                                          htmlType="button"
                                          type="text"
                                          danger
                                          icon={<DeleteOutlined />}
                                          onClick={() => handleRemoveVariantAttribute(attr.name)}
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
                              <Row gutter={[12, 12]} align="middle" justify="space-between">
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
                                    <span>{variants.length} variantes configuradas</span>
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

                                {(() => {
                                  const renderVariantLabel = record => (
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
                                          <Tag color="success" style={{ borderRadius: 999 }}>
                                            Nueva
                                          </Tag>
                                        )}
                                        {record.isActive === false && (
                                          <Tag color="default" style={{ borderRadius: 999 }}>
                                            Inactiva
                                          </Tag>
                                        )}
                                      </Space>
                                    </Space>
                                  )

                                  const renderVariantPrice = record => (
                                    <InputNumber
                                      prefix="$"
                                      style={{ width: '100%' }}
                                      min={0}
                                      value={record.price}
                                      aria-label={`Precio de ${record.nombre || 'la variante'}`}
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
                                  )

                                  const renderVariantCost = record => (
                                    <InputNumber
                                      prefix="$"
                                      style={{ width: '100%' }}
                                      min={0}
                                      placeholder="Sin informar"
                                      value={record.costoUnitario}
                                      aria-label={`Costo unitario de ${record.nombre || 'la variante'}`}
                                      onChange={val => {
                                        setVariants(prev =>
                                          prev.map(variant =>
                                            variant.key === record.key
                                              ? {
                                                  ...variant,
                                                  costoUnitario: normalizeOptionalNumberValue(val),
                                                }
                                              : variant,
                                          ),
                                        )
                                      }}
                                    />
                                  )

                                  const renderVariantStock = record => (
                                    <InputNumber
                                      min={0}
                                      style={{ width: '100%' }}
                                      value={record.stock}
                                      aria-label={`Stock de ${record.nombre || 'la variante'}`}
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
                                  )

                                  const renderVariantSku = record => (
                                    <Input
                                      placeholder="Ej: FOX-BOTA-42"
                                      value={record.sku}
                                      aria-label={`SKU de ${record.nombre || 'la variante'}`}
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
                                  )

                                  const renderVariantImageSelector = record => (
                                    <VariantImageSelector
                                      variant={record}
                                      localImages={localImages}
                                      onAssign={handleAssignVariantImage}
                                    />
                                  )

                                  const renderVariantPreview = record => {
                                    const selectedLocal = localImages.find(
                                      img => img.uid === record.imageSourceUid,
                                    )

                                    return selectedLocal?.preview ? (
                                      <img
                                        src={selectedLocal.preview}
                                        alt={`Vista previa de ${record.nombre || 'la variante'}`}
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
                                      <Tag style={{ borderRadius: 999 }}>Sin imagen</Tag>
                                    )
                                  }

                                  const renderVariantActive = record => (
                                    <Switch
                                      checked={record.isActive !== false}
                                      aria-label={`Activar o desactivar ${record.nombre || 'la variante'}`}
                                      onChange={checked => {
                                        setVariants(prev =>
                                          prev.map(variant =>
                                            variant.key === record.key
                                              ? {
                                                  ...variant,
                                                  isActive: checked,
                                                }
                                              : variant,
                                          ),
                                        )
                                      }}
                                      size="small"
                                    />
                                  )

                                  const renderVariantDelete = record => (
                                    <Button
                                      htmlType="button"
                                      type="text"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => {
                                        setVariants(prev =>
                                          prev.filter(variant => variant.key !== record.key),
                                        )
                                      }}
                                      size="small"
                                      aria-label={`Eliminar variante ${record.nombre || record.key}`}
                                    />
                                  )

                                  return (
                                    <>
                                      <Table
                                        className="variant-table-desktop"
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
                                            width: 220,
                                            fixed: 'left',
                                            render: (_, record) => renderVariantLabel(record),
                                          },
                                          {
                                            title: 'Precio',
                                            dataIndex: 'price',
                                            key: 'price',
                                            width: 150,
                                            render: (_, record) => renderVariantPrice(record),
                                          },
                                          {
                                            title: 'Costo (opcional)',
                                            dataIndex: 'costoUnitario',
                                            key: 'costoUnitario',
                                            width: 150,
                                            render: (_, record) => renderVariantCost(record),
                                          },
                                          {
                                            title: 'Stock',
                                            dataIndex: 'stock',
                                            key: 'stock',
                                            width: 120,
                                            render: (_, record) => renderVariantStock(record),
                                          },
                                          {
                                            title: 'SKU opcional',
                                            dataIndex: 'sku',
                                            key: 'sku',
                                            width: 180,
                                            render: (_, record) => renderVariantSku(record),
                                          },
                                          {
                                            title: 'Imagen de variante',
                                            key: 'image',
                                            width: 260,
                                            render: (_, record) =>
                                              renderVariantImageSelector(record),
                                          },
                                          {
                                            title: 'Preview',
                                            key: 'preview',
                                            width: 110,
                                            render: (_, record) => renderVariantPreview(record),
                                          },
                                          {
                                            title: 'Activo',
                                            key: 'active',
                                            width: 90,
                                            align: 'center',
                                            render: (_, record) => renderVariantActive(record),
                                          },
                                          {
                                            title: '',
                                            key: 'delete',
                                            width: 60,
                                            render: (_, record) => renderVariantDelete(record),
                                          },
                                        ]}
                                      />

                                      <Space
                                        direction="vertical"
                                        size={12}
                                        className="variant-cards-mobile"
                                        style={{ width: '100%' }}
                                      >
                                        {variants.map(record => (
                                          <Card
                                            key={record.key}
                                            size="small"
                                            style={{ borderRadius: 14 }}
                                            styles={{ body: { padding: 14 } }}
                                          >
                                            <Space
                                              direction="vertical"
                                              size={10}
                                              style={{ width: '100%' }}
                                            >
                                              <Row justify="space-between" align="top" wrap={false}>
                                                <Col flex="auto">{renderVariantLabel(record)}</Col>
                                                <Col flex="none">{renderVariantDelete(record)}</Col>
                                              </Row>

                                              <Row gutter={[10, 10]}>
                                                <Col xs={12}>
                                                  <Text
                                                    type="secondary"
                                                    style={{
                                                      fontSize: 12,
                                                      display: 'block',
                                                      marginBottom: 4,
                                                    }}
                                                  >
                                                    Precio
                                                  </Text>
                                                  {renderVariantPrice(record)}
                                                </Col>
                                                <Col xs={12}>
                                                  <Text
                                                    type="secondary"
                                                    style={{
                                                      fontSize: 12,
                                                      display: 'block',
                                                      marginBottom: 4,
                                                    }}
                                                  >
                                                    Stock
                                                  </Text>
                                                  {renderVariantStock(record)}
                                                </Col>
                                                <Col xs={12}>
                                                  <Text
                                                    type="secondary"
                                                    style={{
                                                      fontSize: 12,
                                                      display: 'block',
                                                      marginBottom: 4,
                                                    }}
                                                  >
                                                    Costo (opcional)
                                                  </Text>
                                                  {renderVariantCost(record)}
                                                </Col>
                                                <Col xs={24}>
                                                  <Text
                                                    type="secondary"
                                                    style={{
                                                      fontSize: 12,
                                                      display: 'block',
                                                      marginBottom: 4,
                                                    }}
                                                  >
                                                    SKU opcional
                                                  </Text>
                                                  {renderVariantSku(record)}
                                                </Col>
                                              </Row>

                                              <Row
                                                justify="space-between"
                                                align="middle"
                                                gutter={[10, 10]}
                                              >
                                                <Col flex="auto">
                                                  {renderVariantImageSelector(record)}
                                                </Col>
                                                <Col flex="none">
                                                  {renderVariantPreview(record)}
                                                </Col>
                                              </Row>

                                              <Row justify="space-between" align="middle">
                                                <Col>
                                                  <Text style={{ fontSize: 13 }}>
                                                    Variante activa
                                                  </Text>
                                                </Col>
                                                <Col>{renderVariantActive(record)}</Col>
                                              </Row>
                                            </Space>
                                          </Card>
                                        ))}
                                      </Space>
                                    </>
                                  )
                                })()}

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
                                Este producto no tiene opciones vendibles. Activá variantes solo si
                                el cliente debe elegir una alternativa específica antes de comprar.
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
                              <CheckCircleOutlined style={{ color: token.colorPrimary }} />
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
                          <Space direction="vertical" size={14} style={{ width: '100%' }}>
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
                                    {productReadiness.requiredChecks.length} datos obligatorios
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
                                    check.done ? 'success' : check.required ? 'warning' : 'default'
                                  }
                                  style={{
                                    borderRadius: 999,
                                    marginInlineEnd: 0,
                                  }}
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
                                  : `Faltan: ${missingRequiredLabels.join(', ')}`
                              }
                            />
                          </Space>
                        </Card>
                        <Card
                          id={SECTION_IDS.precio}
                          title={
                            <Space size={10}>
                              <span className="add-product-step-badge">5</span>
                              <DollarOutlined style={{ color: token.colorPrimary }} />
                              <span className="add-product-card-title">
                                Precio y disponibilidad
                              </span>
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
                          <Text
                            type="secondary"
                            style={{
                              display: 'block',
                              marginBottom: 16,
                              fontSize: 14,
                            }}
                          >
                            Precio, condición y stock visibles en el catálogo — obligatorios para
                            publicar.
                          </Text>

                          <Row gutter={[16, 16]}>
                            <Col xs={24}>
                              <ProductField
                                name="precio"
                                label={hasVariants ? 'Precio base de referencia' : 'Precio'}
                                rules={REQUIRED_PRECIO_RULES}
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

                            <Col xs={24}>
                              <ProductField name="costoUnitario" label="Costo unitario (opcional)">
                                <InputNumber
                                  size="large"
                                  style={{ width: '100%' }}
                                  min={0}
                                  precision={2}
                                  prefix="$"
                                  placeholder="Sin informar"
                                />
                              </ProductField>
                              <Text
                                type="secondary"
                                style={{
                                  display: 'block',
                                  marginTop: -8,
                                  marginBottom: 8,
                                  fontSize: 12,
                                }}
                              >
                                Lo que te cuesta a vos, no lo que cobrás. Solo se usa para calcular
                                margen — nunca se le muestra al cliente ni se lo inventa la IA.
                              </Text>
                            </Col>

                            {!hasVariants && (
                              <Col xs={24}>
                                <ProductField
                                  name="cantidad"
                                  label="Cantidad en stock"
                                  rules={REQUIRED_CANTIDAD_RULES}
                                >
                                  <InputNumber
                                    size="large"
                                    style={{ width: '100%' }}
                                    min={1}
                                    placeholder="1"
                                    prefix={
                                      <NumberOutlined
                                        style={{
                                          color: token.colorTextSecondary,
                                        }}
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
                                rules={REQUIRED_CONDICION_RULES}
                              >
                                <Select size="large" placeholder="Seleccioná la condición">
                                  <Select.Option value="nuevo">
                                    <Tag color="success" style={{ borderRadius: 999 }}>
                                      Nuevo
                                    </Tag>
                                  </Select.Option>
                                  <Select.Option value="usado">
                                    <Tag color="warning" style={{ borderRadius: 999 }}>
                                      Usado
                                    </Tag>
                                  </Select.Option>
                                  <Select.Option value="reacondicionado">
                                    <Tag color="processing" style={{ borderRadius: 999 }}>
                                      Reacondicionado
                                    </Tag>
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
                              <FileTextOutlined style={{ color: token.colorPrimary }} />
                              <span className="add-product-card-title">
                                SEO y contenido comercial
                              </span>
                              <Tag color="default" style={{ borderRadius: 999 }}>
                                Opcional
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
                          <Text
                            type="secondary"
                            style={{
                              display: 'block',
                              marginBottom: 16,
                              fontSize: 14,
                            }}
                          >
                            Mejora cómo se encuentra el producto en buscadores y recomendaciones
                            internas.
                          </Text>

                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
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

                            <ProductField name="seoFocusKeyword" label="Keyword principal">
                              <Input placeholder="Ej: Moto Morini X-Cape 700" />
                            </ProductField>

                            <ProductField
                              name="seoSearchIntent"
                              label="Intención de búsqueda"
                              initialValue="commercial"
                            >
                              <Select options={SEO_POSITIONING_INTENT_OPTIONS} />
                            </ProductField>

                            <ProductField name="seoPositioning" label="Posicionamiento SEO">
                              <Input.TextArea
                                rows={4}
                                maxLength={900}
                                showCount
                                placeholder="Definí cómo debe posicionarse este producto en buscadores, qué intención resuelve y qué lo diferencia."
                              />
                            </ProductField>

                            <ProductField name="seoTargetAudience" label="Audiencia objetivo">
                              <Input placeholder="Ej: usuarios que buscan una motocicleta adventure para ruta y uso mixto" />
                            </ProductField>

                            <ProductField name="seoContentAngle" label="Enfoque de contenido">
                              <Input.TextArea
                                rows={2}
                                maxLength={420}
                                showCount
                                placeholder="Qué destacar en la descripción, fichas, contenido y FAQs."
                              />
                            </ProductField>

                            <ProductField name="seoFaq" label="Preguntas frecuentes SEO">
                              <Select
                                width="100%"
                                mode="tags"
                                tokenSeparators={[',']}
                                placeholder="Ej: ¿Qué motor tiene?, ¿Para qué uso sirve?, ¿Qué revisar antes de comprar?"
                              />
                            </ProductField>

                            <ProductField name="seoContentPillars" label="Pilares de contenido">
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

                            <ProductField name="shortDescription" label="Descripción corta">
                              <Input.TextArea
                                rows={2}
                                maxLength={260}
                                showCount
                                placeholder="Resumen comercial breve para cards, SEO y vistas rápidas."
                              />
                            </ProductField>

                            <ProductField name="metaTitle" label="Meta title">
                              <Input maxLength={70} showCount placeholder="Título SEO" />
                            </ProductField>

                            <ProductField name="metaDescription" label="Meta description">
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
                              <ShoppingOutlined style={{ color: token.colorPrimary }} />
                              <span className="add-product-card-title">
                                Logística, garantía y origen
                              </span>
                              <Tag color="default" style={{ borderRadius: 999 }}>
                                Opcional
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
                          <Text
                            type="secondary"
                            style={{
                              display: 'block',
                              marginBottom: 16,
                              fontSize: 14,
                            }}
                          >
                            Ayuda a calcular envío y a comunicar garantía y origen — podés
                            completarlo después.
                          </Text>

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
                                <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                              </ProductField>
                            </Col>
                            <Col xs={8}>
                              <ProductField name="packageWidthCm" label="Ancho cm">
                                <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                              </ProductField>
                            </Col>
                            <Col xs={8}>
                              <ProductField name="packageHeightCm" label="Alto cm">
                                <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                              </ProductField>
                            </Col>
                            <Col xs={24}>
                              <ProductField name="warranty" label="Garantía">
                                <Input placeholder="Ej: 6 meses por defecto de fabricación" />
                              </ProductField>
                            </Col>
                            <Col xs={24}>
                              <ProductField name="countryOfOrigin" label="País de origen">
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
                          id={SECTION_IDS.publicar}
                          className="add-product-publish-card"
                          style={{
                            borderRadius: 20,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
                          }}
                          styles={{ body: { padding: 20 } }}
                        >
                          <Space direction="vertical" size={14} style={{ width: '100%' }}>
                            <Space size={10}>
                              <span className="add-product-step-badge">6</span>
                              <Text strong className="add-product-card-title">
                                Publicar
                              </Text>
                            </Space>

                            {isError && (
                              <Alert
                                type="error"
                                message={productMessage || 'Error guardando producto'}
                                showIcon
                                style={{ borderRadius: 14 }}
                              />
                            )}

                            {!productReadiness.isReady && (
                              <Alert
                                type="warning"
                                showIcon
                                message={`Faltan: ${missingRequiredLabels.join(', ')}`}
                                style={{ borderRadius: 14 }}
                              />
                            )}

                            {submitErrors.length > 0 && (
                              <Alert
                                type="error"
                                showIcon
                                style={{ borderRadius: 14 }}
                                message={`No se pudo ${publishProduct ? 'publicar' : 'guardar'}: ${
                                  submitErrors.length === 1
                                    ? 'hay un problema para resolver'
                                    : `hay ${submitErrors.length} problemas para resolver`
                                }`}
                                description={
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                    {submitErrors.map((err, idx) => (
                                      <li key={idx}>
                                        {err.section ? (
                                          <a
                                            href={`#${err.section}`}
                                            onClick={event => {
                                              event.preventDefault()
                                              scrollToSection(err.section)
                                            }}
                                          >
                                            {err.message}
                                          </a>
                                        ) : (
                                          err.message
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                }
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
                                    {publishProduct ? 'Publicar visible' : 'Guardar borrador'}
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
                                  checkedChildren="Visible"
                                  unCheckedChildren="Borrador"
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
                              Antes de publicar se revisan las imágenes, las variantes y los datos
                              del producto.
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

        .add-product-card-title {
          font-family: ${DISPLAY_FONT};
          font-size: 17px;
          font-weight: 800;
          letter-spacing: -0.01em;
        }

        .add-product-step-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          border-radius: 999px;
          background: linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%);
          color: ${token.colorTextLightSolid || '#fff'};
          font-size: 12px;
          font-weight: 700;
          line-height: 22px;
        }

        .add-product-agent-collapse .ant-collapse-header {
          padding: 12px 16px !important;
        }

        .add-product-agent-collapse .ant-collapse-content-box {
          padding: 4px 16px 16px !important;
        }

        .variant-cards-mobile {
          display: none;
        }

        @media (max-width: 767.98px) {
          .variant-table-desktop {
            display: none;
          }

          .variant-cards-mobile {
            display: flex;
          }
        }

        @media (max-width: 575.98px) {
          .add-product-stable-page {
            padding: 12px !important;
          }

          .add-product-agent-actions {
            justify-content: flex-start !important;
          }

          .add-product-agent-actions .ant-btn {
            flex: 1 1 auto;
          }

          /* En vertical la barra mide más de 300 px: pegada arriba tapaba media pantalla. */
          .add-product-steps-bar {
            position: static !important;
            padding: 10px 12px !important;
          }

          .add-product-steps-bar .ant-steps-item-title {
            font-size: 12px !important;
          }

          .add-product-card-title {
            font-size: 15px;
          }

          .add-product-stable-page .ant-card-head-title {
            white-space: normal;
          }

          .add-product-stable-page .ant-card-head-title .ant-space {
            flex-wrap: wrap;
            row-gap: 4px;
          }
        }

        @media (min-width: 576px) and (max-width: 1199.98px) {
          .add-product-stable-page {
            padding: 16px !important;
          }
        }

        @media (min-width: 1200px) {
          .add-product-publish-card {
            position: sticky;
            top: 24px;
          }
        }
      `}</style>
      </div>
    </>
  )
}

export default function AddProduct() {
  return (
    <ConfigProvider theme={ADD_PRODUCT_THEME}>
      <AddProductForm />
    </ConfigProvider>
  )
}
