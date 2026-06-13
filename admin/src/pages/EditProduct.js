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
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import {
  ArrowLeftOutlined,
  ClusterOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import {
  assignVariantImage,
  getAProduct,
  resetState,
  updateAProduct,
  uploadProductImage,
} from '../features/product/productSlice'

const { Title, Text, Paragraph } = Typography

const pageStyles = {
  page: {
    minHeight: '100vh',
    padding: 24,
    background:
      'linear-gradient(180deg, #f6f8fb 0%, #eef3f8 42%, #e9eef5 100%)',
  },
  shell: {
    maxWidth: 1520,
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
    fontWeight: 700,
  },
  muted: {
    color: '#64748b',
  },
  variantHint: {
    marginBottom: 16,
    borderRadius: 14,
  },
}

const normalizeString = (value = '') => String(value || '').trim()

const normalizeNumber = value => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0
}

const slugifyKeyPart = value =>
  normalizeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

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

const serializeAttributes = attributes => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')
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
      const fallbackKey = index === 0 ? 'variante' : `atributo_${index + 1}`
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

const ensureVariantAttributes = variant => {
  const attributes = normalizeAttributes(variant?.attributes)
  if (Object.keys(attributes).length > 0) return attributes

  const fallbackName = normalizeString(variant?.nombre)
  if (!fallbackName) return {}

  return {
    variante: fallbackName,
  }
}

const buildVariantName = attributes => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ')
}

const buildVariantKey = attributes => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${normalizeString(key)}:${normalizeString(value)}`)
    .join('|')
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

const inferVariantAttributes = variants => {
  const attributesMap = new Map()

  variants.forEach(variant => {
    const attributes = ensureVariantAttributes(variant)

    Object.entries(attributes).forEach(([key, value]) => {
      const cleanKey = slugifyKeyPart(key)
      const cleanValue = normalizeString(value)

      if (!cleanKey) return

      if (!attributesMap.has(cleanKey)) {
        attributesMap.set(cleanKey, new Set())
      }

      if (cleanValue) {
        attributesMap.get(cleanKey).add(cleanValue)
      }
    })
  })

  return Array.from(attributesMap.entries()).map(([name, values]) => ({
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
    type: 'select',
    values: Array.from(values),
  }))
}

const normalizeVariantAttributesDefinition = (variantAttributes, variants) => {
  if (Array.isArray(variantAttributes) && variantAttributes.length > 0) {
    return variantAttributes
      .map(attr => {
        const name = slugifyKeyPart(attr?.name || attr?.label)
        if (!name) return null

        return {
          name,
          label: attr?.label || name,
          type: attr?.type || 'select',
          values: Array.isArray(attr?.values) ? attr.values : [],
        }
      })
      .filter(Boolean)
  }

  return inferVariantAttributes(variants)
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
    const cleanSku = normalizeString(variant.sku).toUpperCase()
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
  const cleanSku = normalizeString(variant.sku).toUpperCase()
  const variantKey =
    buildVariantKey(attributes) ||
    normalizeString(variant.key) ||
    `variant-${index + 1}`
  const nombre =
    normalizeString(variant.nombre) ||
    buildVariantName(attributes) ||
    `Variante ${index + 1}`

  const payload = {
    _id: variant.variantId || undefined,
    id: variant.variantId || undefined,
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

  if (cleanSku) {
    payload.sku = cleanSku
  }

  return payload
}

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
      placeholder={
        images.length ? 'Seleccionar imagen' : 'Sin imágenes disponibles'
      }
      style={{ width: '100%' }}
      allowClear
      disabled={!images.length}
      options={options}
      onChange={selectedUrl => {
        const selectedImage =
          images.find(img => img.url === selectedUrl) || null
        onChange(selectedImage)
      }}
    />
  )
}

const EditProduct = () => {
  const { productId } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const [form] = Form.useForm()

  const [fileList, setFileList] = useState([])
  const [variants, setVariants] = useState([])
  const [hasVariants, setHasVariants] = useState(false)
  const [editableTags, setEditableTags] = useState([])
  const [inputTag, setInputTag] = useState('')
  const [isInitializing, setIsInitializing] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [productImages, setProductImages] = useState([])

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

  const totalVariantStock = useMemo(
    () =>
      variants.reduce(
        (total, variant) => total + normalizeNumber(variant.stock),
        0,
      ),
    [variants],
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
      const images = Array.isArray(normalizedProduct.images)
        ? normalizedProduct.images
        : []
      const productVariants = Array.isArray(normalizedProduct.variants)
        ? normalizedProduct.variants
        : []

      form.setFieldsValue({
        title: normalizedProduct.title || '',
        description: normalizedProduct.description || '',
        price: normalizeNumber(normalizedProduct.price),
        stock: normalizeNumber(normalizedProduct.stock),
        categoria: normalizedProduct.categoria || '',
        subcategoria: normalizedProduct.subcategoria || '',
        marca: normalizedProduct.marca || '',
        condicion: normalizedProduct.condicion || 'nuevo',
        material: normalizedProduct.material || '',
        color: Array.isArray(normalizedProduct.color)
          ? normalizedProduct.color.join(', ')
          : normalizeString(normalizedProduct.color),
      })

      setEditableTags(
        Array.isArray(normalizedProduct.tags) ? normalizedProduct.tags : [],
      )
      setFileList(images.map((img, index) => toUploadFile(img, index)))
      setProductImages(images)

      if (productVariants.length > 0) {
        const mappedVariants = productVariants.map((variant, index) => {
          const attributes = normalizeAttributes(
            variant.attributes || variant.combinacion || {},
          )
          const assignedImage = variant.image?.url
            ? images.find(
                img =>
                  img.url === variant.image.url ||
                  img.public_id === variant.image.public_id,
              ) || variant.image
            : null

          return {
            key:
              variant._id ||
              variant.id ||
              buildVariantKey(attributes) ||
              `variant-${index}`,
            variantId: variant._id || variant.id || null,
            nombre:
              variant.nombre ||
              buildVariantName(attributes) ||
              `Variante ${index + 1}`,
            attributes,
            attributeText: serializeAttributes(attributes),
            price: normalizeNumber(variant.price),
            stock: normalizeNumber(variant.stock),
            sku: variant.sku || '',
            isActive: variant.isActive !== false,
            assignedImage,
          }
        })

        setHasVariants(true)
        setVariants(mappedVariants)
      } else {
        setHasVariants(false)
        setVariants([])
      }

      setIsInitializing(false)
    } catch (error) {
      setLoadError('Error al procesar el producto')
      setIsInitializing(false)
    }
  }, [form, isError, normalizedProduct])

  const updateVariant = useCallback((variantKey, patch) => {
    setVariants(prev =>
      prev.map(variant =>
        variant.key === variantKey
          ? {
              ...variant,
              ...patch,
            }
          : variant,
      ),
    )
  }, [])

  const handleTagAdd = useCallback(() => {
    const cleanTag = normalizeString(inputTag).toLowerCase()
    if (!cleanTag) return

    if (
      !editableTags
        .map(tag => normalizeString(tag).toLowerCase())
        .includes(cleanTag)
    ) {
      setEditableTags(prev => [...prev, cleanTag])
    }

    setInputTag('')
  }, [editableTags, inputTag])

  const handleTagRemove = useCallback(removedTag => {
    setEditableTags(prev => prev.filter(tag => tag !== removedTag))
  }, [])

  const handleMainImagesChange = useCallback(({ fileList: newFileList }) => {
    if (newFileList.length > 12) {
      message.warning('Máximo 12 imágenes por producto')
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

  const handleAddVariant = useCallback(() => {
    setVariants(prev => {
      const nextIndex = prev.length + 1
      const attributeName =
        slugifyKeyPart(normalizedProduct?.variantAttributes?.[0]?.name) ||
        'variante'
      const attributes = {
        [attributeName]: `opcion-${nextIndex}`,
      }

      return [
        ...prev,
        {
          key: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          variantId: null,
          nombre: `Variante ${nextIndex}`,
          attributes,
          attributeText: serializeAttributes(attributes),
          price: normalizeNumber(form.getFieldValue('price')),
          stock: 0,
          sku: '',
          isActive: true,
          assignedImage: null,
        },
      ]
    })
  }, [form, normalizedProduct?.variantAttributes])

  const handleDeleteVariant = useCallback(record => {
    setVariants(prev => prev.filter(variant => variant.key !== record.key))
  }, [])

  const syncVariantsWithServerProduct = useCallback(
    (serverProduct, localVariants) => {
      const serverVariants = Array.isArray(serverProduct?.variants)
        ? serverProduct.variants
        : []

      return localVariants.map(localVariant => {
        const localAttributes = ensureVariantAttributes(localVariant)
        const localKey = buildVariantKey(localAttributes)
        const localSku = normalizeString(localVariant.sku).toUpperCase()
        const localName = normalizeString(localVariant.nombre).toLowerCase()

        const matched = serverVariants.find(serverVariant => {
          const serverAttributes = normalizeAttributes(
            serverVariant.attributes || serverVariant.combinacion || {},
          )
          const serverKey = buildVariantKey(serverAttributes)
          const serverSku = normalizeString(serverVariant.sku).toUpperCase()
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
        }
      })
    },
    [],
  )

  const handleFinish = async values => {
    if (hasVariants) {
      const variantError = validateVariantsBeforeSave(variants)

      if (variantError) {
        message.error(variantError)
        return
      }
    }

    setIsSaving(true)

    try {
      const payload = {
        title: normalizeString(values.title),
        description: normalizeString(values.description),
        categoria: normalizeString(values.categoria),
        subcategoria: normalizeString(values.subcategoria),
        marca: normalizeString(values.marca),
        condicion: normalizeString(values.condicion || 'nuevo'),
        material: normalizeString(values.material),
        color: normalizeString(values.color)
          ? normalizeString(values.color)
              .split(',')
              .map(item => item.trim())
              .filter(Boolean)
          : [],
        tags: editableTags
          .map(tag => normalizeString(tag).toLowerCase())
          .filter(Boolean),
        price: normalizeNumber(values.price),
        stock: hasVariants ? totalVariantStock : normalizeNumber(values.stock),
        hasVariants,
        visibility: normalizedProduct?.visibility || 'visible',
        status: normalizedProduct?.status || 'active',
      }

      if (hasVariants) {
        payload.variantAttributes = normalizeVariantAttributesDefinition(
          normalizedProduct?.variantAttributes,
          variants,
        )
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

      const updatedProduct =
        updatedProductResponse?.data || updatedProductResponse
      let mergedImages = Array.isArray(updatedProduct?.images)
        ? [...updatedProduct.images]
        : []
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
        const latestProductResponse = await dispatch(
          getAProduct(productId),
        ).unwrap()
        const latestProduct =
          latestProductResponse?.data || latestProductResponse
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

      await dispatch(getAProduct(productId)).unwrap()

      message.success('Producto actualizado con éxito')
      navigate('/admin/productlist')
    } catch (error) {
      message.error(
        error?.message || error || 'Error al actualizar el producto',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const variantColumns = useMemo(
    () => [
      {
        title: 'Variante',
        dataIndex: 'nombre',
        key: 'nombre',
        width: 230,
        fixed: 'left',
        render: (_, record) => (
          <Input
            value={record.nombre}
            placeholder="Ej: Rojo / Talle M"
            onChange={event =>
              updateVariant(record.key, { nombre: event.target.value })
            }
          />
        ),
      },
      {
        title: (
          <Space size={4}>
            Combinación
            <Tooltip title="Formato recomendado: color: rojo, talle: M. También acepta color=rojo o una línea por atributo.">
              <InfoCircleOutlined style={{ color: '#94a3b8' }} />
            </Tooltip>
          </Space>
        ),
        dataIndex: 'attributeText',
        key: 'attributeText',
        width: 330,
        render: (_, record) => (
          <Input.TextArea
            value={record.attributeText}
            autoSize={{ minRows: 1, maxRows: 3 }}
            placeholder="color: rojo, talle: M"
            onChange={event => {
              const value = event.target.value
              updateVariant(record.key, {
                attributeText: value,
                attributes: parseAttributesInput(value),
              })
            }}
          />
        ),
      },
      {
        title: 'Precio',
        dataIndex: 'price',
        key: 'price',
        width: 140,
        render: (_, record) => (
          <InputNumber
            min={0}
            value={record.price}
            style={{ width: '100%' }}
            prefix="$"
            onChange={value =>
              updateVariant(record.key, { price: normalizeNumber(value) })
            }
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
            value={record.stock}
            style={{ width: '100%' }}
            onChange={value =>
              updateVariant(record.key, { stock: normalizeNumber(value) })
            }
          />
        ),
      },
      {
        title: 'SKU',
        dataIndex: 'sku',
        key: 'sku',
        width: 170,
        render: (_, record) => (
          <Input
            value={record.sku}
            placeholder="Opcional"
            onChange={event =>
              updateVariant(record.key, { sku: event.target.value })
            }
          />
        ),
      },
      {
        title: 'Imagen',
        key: 'assignedImage',
        width: 310,
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
        width: 90,
        align: 'center',
        render: (_, record) => (
          <Switch
            checked={record.isActive !== false}
            onChange={checked =>
              updateVariant(record.key, { isActive: checked })
            }
          />
        ),
      },
      {
        title: '',
        key: 'actions',
        width: 76,
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
    [
      handleAssignImageToVariant,
      handleDeleteVariant,
      productImages,
      updateVariant,
    ],
  )

  if (isInitializing || (isLoading && !normalizedProduct)) {
    return (
      <div style={pageStyles.page}>
        <div style={{ padding: 56, textAlign: 'center' }}>
          <Spin size="large" />
          <Text style={{ display: 'block', marginTop: 16, color: '#64748b' }}>
            Cargando producto...
          </Text>
          <Text style={{ display: 'block', marginTop: 8, color: '#94a3b8' }}>
            ID: {productId}
          </Text>
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
                <p>
                  {loadError || errorMessage || 'No se pudo cargar el producto'}
                </p>
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
              <Button
                type="primary"
                onClick={() => navigate('/admin/productlist')}
              >
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
                  Actualización productiva de información comercial, galería y
                  variantes con persistencia completa.
                </Paragraph>
              </Space>
            </Col>

            <Col xs={24} lg={9}>
              <Row gutter={[12, 12]} justify="end">
                <Col>
                  <Card
                    size="small"
                    style={{ minWidth: 128, borderRadius: 14 }}
                  >
                    <Text type="secondary">Variantes</Text>
                    <Title level={4} style={{ margin: 0 }}>
                      {variants.length}
                    </Title>
                  </Card>
                </Col>
                <Col>
                  <Card
                    size="small"
                    style={{ minWidth: 128, borderRadius: 14 }}
                  >
                    <Text type="secondary">Activas</Text>
                    <Title level={4} style={{ margin: 0 }}>
                      {activeVariantsCount}
                    </Title>
                  </Card>
                </Col>
                <Col>
                  <Card
                    size="small"
                    style={{ minWidth: 128, borderRadius: 14 }}
                  >
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

        <Form
          form={form}
          layout="vertical"
          onFinish={handleFinish}
          scrollToFirstError
        >
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
                    <Button
                      icon={<ArrowLeftOutlined />}
                      onClick={() => navigate(-1)}
                    >
                      Cancelar
                    </Button>
                  }
                >
                  <Form.Item
                    name="title"
                    label="Título del producto"
                    rules={[
                      { required: true, message: 'El título es obligatorio' },
                    ]}
                  >
                    <Input
                      placeholder="Ej: Camiseta de algodón premium"
                      size="large"
                    />
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
                    <Input.TextArea
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
                          <Select.Option value="reacondicionado">
                            Reacondicionado
                          </Select.Option>
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
                    <Space
                      direction="vertical"
                      style={{ width: '100%' }}
                      size="small"
                    >
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
                        <Button
                          type="primary"
                          onClick={handleTagAdd}
                          icon={<PlusOutlined />}
                        >
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
                      <ClusterOutlined /> Variantes
                    </span>
                  }
                  extra={
                    <Space>
                      <Text type="secondary">Usar variantes</Text>
                      <Switch checked={hasVariants} onChange={setHasVariants} />
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
                        message="Edición real de variantes"
                        description="La combinación se guarda en attributes y combinacion para mantener compatibilidad con el backend. Ejemplo válido: color: rojo, talle: M."
                        type="success"
                        showIcon
                        style={pageStyles.variantHint}
                      />

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
                          <Tag color="success">
                            Activas: {activeVariantsCount}
                          </Tag>
                          <Tag color="geekblue">
                            Stock variantes: {totalVariantStock}
                          </Tag>
                        </Space>

                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={handleAddVariant}
                        >
                          Agregar variante
                        </Button>
                      </Space>

                      <Table
                        dataSource={variants}
                        pagination={false}
                        size="middle"
                        rowKey="key"
                        columns={variantColumns}
                        scroll={{ x: 1480 }}
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
                        <InputNumber
                          style={{ width: '100%' }}
                          prefix="$"
                          min={0}
                        />
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
                      <PictureOutlined /> Galería
                    </span>
                  }
                >
                  <Paragraph style={pageStyles.muted}>
                    Máximo 12 imágenes. Las variantes pueden usar una imagen
                    específica desde esta galería.
                  </Paragraph>

                  <Upload
                    listType="picture-card"
                    fileList={fileList}
                    onChange={handleMainImagesChange}
                    beforeUpload={() => false}
                    multiple
                  >
                    {fileList.length >= 12 ? null : (
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
    </div>
  )
}

export default EditProduct
