import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import {
  Form,
  Input,
  Select,
  Card,
  Button,
  Row,
  Col,
  Typography,
  Space,
  Tag,
  InputNumber,
  Alert,
  Switch,
  Table,
  Upload,
  message,
  Spin,
  Empty,
  Image,
} from 'antd'
import {
  InfoCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
  ClusterOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import {
  getAProduct,
  updateAProduct,
  uploadProductImage,
  assignVariantImage,
  resetState,
} from '../features/product/productSlice'

const { Title, Text } = Typography

const normalizeString = (value = '') => String(value || '').trim()

const normalizeAttributes = (attributes) => {
  if (!attributes) return {}
  if (attributes instanceof Map) return Object.fromEntries(attributes)
  if (typeof attributes === 'object' && !Array.isArray(attributes)) return attributes
  return {}
}

const buildVariantName = (attributes = {}) => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ')
}

const buildVariantKey = (attributes = {}) => {
  const normalized = normalizeAttributes(attributes)

  return Object.entries(normalized)
    .filter(([key, value]) => normalizeString(key) && normalizeString(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${normalizeString(key)}:${normalizeString(value)}`)
    .join('|')
}

const toUploadFile = (image, index = 0) => ({
  uid: image?.public_id || `existing-${index}`,
  name: image?.public_id || `image-${index}`,
  status: 'done',
  url: image?.url,
  public_id: image?.public_id || null,
})

const extractImagesFromUploadResponse = (response) => {
  if (Array.isArray(response?.data)) return response.data
  if (Array.isArray(response)) return response
  return []
}

const VariantImageSelector = ({ value, images, onChange }) => {
  return (
    <Select
      value={value || undefined}
      placeholder="Seleccionar imagen"
      style={{ width: '100%' }}
      allowClear
      onChange={(selectedUrl) => {
        const selectedImage = images.find((img) => img.url === selectedUrl) || null
        onChange(selectedImage)
      }}
      options={images.map((img) => ({
        value: img.url,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={img.url}
              alt={img.public_id || 'img'}
              style={{
                width: 32,
                height: 32,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid #eee',
              }}
            />
            <span>{img.public_id || img.url}</span>
          </div>
        ),
      }))}
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
  const [loadError, setLoadError] = useState(null)
  const [productImages, setProductImages] = useState([])

  const {
    singleProduct,
    isLoading,
    isSuccess,
    isError,
    message: errorMessage,
  } = useSelector((state) => state.product)

  const normalizedProduct = useMemo(() => {
    if (!singleProduct || typeof singleProduct !== 'object') return null
    return singleProduct
  }, [singleProduct])

  useEffect(() => {
    if (!productId) {
      setLoadError('ID de producto no proporcionado')
      setIsInitializing(false)
      return
    }

    setIsInitializing(true)
    setLoadError(null)

    dispatch(getAProduct(productId))
      .unwrap()
      .catch((error) => {
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
        price: Number(normalizedProduct.price || 0),
        stock: Number(normalizedProduct.stock || 0),
        categoria: normalizedProduct.categoria || '',
        subcategoria: normalizedProduct.subcategoria || '',
        marca: normalizedProduct.marca || '',
        condicion: normalizedProduct.condicion || 'nuevo',
        material: normalizedProduct.material || '',
        color: Array.isArray(normalizedProduct.color)
          ? normalizedProduct.color.join(', ')
          : normalizeString(normalizedProduct.color),
      })

      setEditableTags(Array.isArray(normalizedProduct.tags) ? normalizedProduct.tags : [])
      setFileList(images.map((img, index) => toUploadFile(img, index)))
      setProductImages(images)

      if (productVariants.length > 0) {
        setHasVariants(true)

        const mappedVariants = productVariants.map((variant, index) => {
          const attributes = normalizeAttributes(variant.attributes || variant.combinacion || {})
          const assignedImage = variant.image?.url
            ? images.find(
                (img) =>
                  img.url === variant.image.url ||
                  img.public_id === variant.image.public_id
              ) || variant.image
            : null

          return {
            key: variant._id || variant.id || buildVariantKey(attributes) || `variant-${index}`,
            variantId: variant._id || variant.id || null,
            nombre: buildVariantName(attributes) || variant.nombre || `Variante ${index + 1}`,
            attributes,
            price: Number(variant.price || 0),
            stock: Number(variant.stock || 0),
            sku: variant.sku || '',
            isActive: variant.isActive !== false,
            assignedImage,
          }
        })

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
  }, [normalizedProduct, form, isError, isSuccess])

  const handleTagAdd = useCallback(() => {
    const cleanTag = normalizeString(inputTag)
    if (!cleanTag) return

    if (!editableTags.includes(cleanTag)) {
      setEditableTags((prev) => [...prev, cleanTag])
    }

    setInputTag('')
  }, [editableTags, inputTag])

  const handleTagRemove = useCallback((removedTag) => {
    setEditableTags((prev) => prev.filter((tag) => tag !== removedTag))
  }, [])

  const handleMainImagesChange = useCallback(({ fileList: newFileList }) => {
    if (newFileList.length > 12) {
      message.warning('Máximo 12 imágenes')
      return
    }
    setFileList(newFileList)
  }, [])

  const handleAssignImageToVariant = useCallback((variantKey, image) => {
    setVariants((prev) =>
      prev.map((variant) =>
        variant.key === variantKey
          ? {
              ...variant,
              assignedImage: image || null,
            }
          : variant
      )
    )
  }, [])

  const handleAddVariant = useCallback(() => {
    setVariants((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}`,
        variantId: null,
        nombre: `Variante ${prev.length + 1}`,
        attributes: {},
        price: Number(form.getFieldValue('price') || 0),
        stock: 0,
        sku: '',
        isActive: true,
        assignedImage: null,
      },
    ])
  }, [form])

  const handleDeleteVariant = useCallback((record) => {
    setVariants((prev) => prev.filter((variant) => variant.key !== record.key))
  }, [])

  const syncVariantsWithServerProduct = useCallback((serverProduct, localVariants) => {
    const serverVariants = Array.isArray(serverProduct?.variants) ? serverProduct.variants : []

    return localVariants.map((localVariant) => {
      const matched = serverVariants.find((serverVariant) => {
        const serverAttrs = normalizeAttributes(serverVariant.attributes || {})
        return (
          (localVariant.variantId && String(serverVariant._id) === String(localVariant.variantId)) ||
          (serverVariant.key && serverVariant.key === buildVariantKey(localVariant.attributes)) ||
          buildVariantKey(serverAttrs) === buildVariantKey(localVariant.attributes)
        )
      })

      return {
        ...localVariant,
        variantId: matched?._id || localVariant.variantId || null,
      }
    })
  }, [])

  const handleFinish = async (values) => {
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
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
        tags: editableTags
          .map((tag) => normalizeString(tag).toLowerCase())
          .filter(Boolean),
        price: Number(values.price || 0),
        stock: hasVariants ? 0 : Number(values.stock || 0),
        hasVariants,
        visibility: normalizedProduct?.visibility || 'visible',
        status: normalizedProduct?.status || 'active',
      }

      if (hasVariants) {
        payload.variantAttributes =
          Array.isArray(normalizedProduct?.variantAttributes) &&
          normalizedProduct.variantAttributes.length > 0
            ? normalizedProduct.variantAttributes.map((attr) => ({
                name: attr.name,
                label: attr.label,
                type: attr.type || 'select',
              }))
            : []

        payload.variants = variants.map((variant, index) => ({
          _id: variant.variantId || undefined,
          key:
            buildVariantKey(variant.attributes) ||
            variant.key ||
            `variant-${index + 1}`,
          attributes: normalizeAttributes(variant.attributes),
          price: Number(variant.price || 0),
          stock: Number(variant.stock || 0),
          sku: normalizeString(variant.sku).toUpperCase(),
          isActive: variant.isActive !== false,
          image: variant.assignedImage
            ? {
                public_id: variant.assignedImage.public_id || '',
                url: variant.assignedImage.url,
              }
            : null,
        }))
      } else {
        payload.variantAttributes = []
        payload.variants = []
      }

      const updatedProductResponse = await dispatch(
        updateAProduct({
          productId,
          data: payload,
        })
      ).unwrap()

      const updatedProduct = updatedProductResponse?.data || updatedProductResponse

      let mergedImages = Array.isArray(updatedProduct?.images)
        ? [...updatedProduct.images]
        : []

      const newFiles = fileList.filter((file) => !!file.originFileObj)

      if (newFiles.length > 0) {
        for (const file of newFiles) {
          const uploadResponse = await dispatch(
            uploadProductImage({
              productId,
              imageFile: file.originFileObj,
            })
          ).unwrap()

          const uploaded = extractImagesFromUploadResponse(uploadResponse)
          if (uploaded.length > 0) {
            mergedImages = uploaded
          }
        }
      }

      setProductImages(mergedImages)
      setFileList(mergedImages.map((img, index) => toUploadFile(img, index)))

      if (hasVariants && variants.length > 0) {
        const syncedVariants = syncVariantsWithServerProduct(updatedProduct, variants)

        for (const variant of syncedVariants) {
          if (!variant.variantId || !variant.assignedImage?.url) continue

          const matchingImage = mergedImages.find(
            (img) =>
              img.url === variant.assignedImage.url ||
              img.public_id === variant.assignedImage.public_id
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
            })
          ).unwrap()
        }
      }

      await dispatch(getAProduct(productId)).unwrap()

      message.success('Producto actualizado con éxito')
      navigate('/admin/productlist')
    } catch (error) {
      message.error(error?.message || 'Error al actualizar el producto')
    }
  }

  const variantColumns = [
    {
      title: 'Nombre',
      dataIndex: 'nombre',
      key: 'nombre',
      width: 220,
      render: (_, record) => (
        <Input
          value={record.nombre}
          onChange={(e) => {
            const value = e.target.value
            setVariants((prev) =>
              prev.map((variant) =>
                variant.key === record.key ? { ...variant, nombre: value } : variant
              )
            )
          }}
        />
      ),
    },
    {
      title: 'Precio',
      dataIndex: 'price',
      key: 'price',
      width: 130,
      render: (_, record) => (
        <InputNumber
          min={0}
          value={record.price}
          style={{ width: '100%' }}
          prefix="$"
          onChange={(val) => {
            setVariants((prev) =>
              prev.map((variant) =>
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
          value={record.stock}
          style={{ width: '100%' }}
          onChange={(val) => {
            setVariants((prev) =>
              prev.map((variant) =>
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
      width: 160,
      render: (_, record) => (
        <Input
          value={record.sku}
          onChange={(e) => {
            const value = e.target.value
            setVariants((prev) =>
              prev.map((variant) =>
                variant.key === record.key ? { ...variant, sku: value } : variant
              )
            )
          }}
        />
      ),
    },
    {
      title: 'Imagen asignada',
      key: 'assignedImage',
      width: 320,
      render: (_, record) => (
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <VariantImageSelector
            value={record.assignedImage?.url || null}
            images={productImages}
            onChange={(image) => handleAssignImageToVariant(record.key, image)}
          />

          {record.assignedImage?.url ? (
            <Image
              src={record.assignedImage.url}
              alt={record.nombre}
              width={56}
              height={56}
              style={{ objectFit: 'cover', borderRadius: 8 }}
            />
          ) : (
            <Tag>Usará imagen general</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Activa',
      key: 'isActive',
      width: 90,
      render: (_, record) => (
        <Switch
          checked={record.isActive !== false}
          onChange={(checked) => {
            setVariants((prev) =>
              prev.map((variant) =>
                variant.key === record.key
                  ? { ...variant, isActive: checked }
                  : variant
              )
            )
          }}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 70,
      render: (_, record) => (
        <Button
          danger
          type="text"
          icon={<DeleteOutlined />}
          onClick={() => handleDeleteVariant(record)}
        />
      ),
    },
  ]

  if (isInitializing || isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin size="large" />
        <Text style={{ display: 'block', marginTop: 16, color: '#999' }}>
          Cargando producto...
        </Text>
        <Text style={{ display: 'block', marginTop: 8, color: '#999' }}>
          ID: {productId}
        </Text>
      </div>
    )
  }

  if (loadError || (isError && !normalizedProduct)) {
    return (
      <div style={{ padding: 40 }}>
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
          style={{ marginBottom: 24 }}
        />
        <Button type="primary" onClick={() => navigate('/admin/productlist')}>
          Volver a la lista de productos
        </Button>
      </div>
    )
  }

  if (!normalizedProduct) {
    return (
      <div style={{ padding: 40 }}>
        <Empty description="No se encontró el producto">
          <Button type="primary" onClick={() => navigate('/admin/productlist')}>
            Volver a la lista
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div style={{ padding: 20 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={3} style={{ margin: 0 }}>
            <SaveOutlined /> {normalizedProduct.title ? `Editar: ${normalizedProduct.title}` : 'Editor de Producto'}
          </Title>

          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
            Cancelar
          </Button>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleFinish}
          scrollToFirstError
        >
          <Row gutter={24}>
            <Col xs={24} lg={16}>
              <Card
                title={<span><InfoCircleOutlined /> Información General</span>}
                variant="borderless"
              >
                <Form.Item
                  name="title"
                  label="Título del Producto"
                  rules={[{ required: true, message: 'El título es obligatorio' }]}
                >
                  <Input placeholder="Ej: Camiseta de Algodón Premium" size="large" />
                </Form.Item>

                <Form.Item
                  name="description"
                  label="Descripción"
                  rules={[{ required: true, message: 'La descripción es obligatoria' }]}
                >
                  <Input.TextArea
                    rows={4}
                    placeholder="Describe las características principales..."
                  />
                </Form.Item>

                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="marca"
                      label="Marca"
                      rules={[{ required: true, message: 'La marca es obligatoria' }]}
                    >
                      <Input placeholder="Ej: Nike, Adidas" />
                    </Form.Item>
                  </Col>

                  <Col xs={24} sm={12}>
                    <Form.Item name="material" label="Material">
                      <Input placeholder="Ej: Algodón" />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="condicion"
                      label="Condición"
                      rules={[{ required: true, message: 'La condición es obligatoria' }]}
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

                <Form.Item label="Etiquetas (Tags)">
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    <Space wrap style={{ marginBottom: 8 }}>
                      {editableTags.map((tag, index) => (
                        <Tag
                          key={`${tag}-${index}`}
                          closable
                          onClose={() => handleTagRemove(tag)}
                          color="blue"
                        >
                          {tag}
                        </Tag>
                      ))}
                    </Space>

                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder="Agregar etiqueta..."
                        value={inputTag}
                        onChange={(e) => setInputTag(e.target.value)}
                        onPressEnter={handleTagAdd}
                      />
                      <Button type="primary" onClick={handleTagAdd} icon={<PlusOutlined />}>
                        Agregar
                      </Button>
                    </Space.Compact>
                  </Space>
                </Form.Item>
              </Card>

              <Card
                title={<span><ClusterOutlined /> Variantes</span>}
                style={{ marginTop: 24 }}
                variant="borderless"
                extra={
                  <Switch
                    checked={hasVariants}
                    onChange={setHasVariants}
                  />
                }
              >
                {!hasVariants ? (
                  <Alert
                    message="Variantes desactivadas"
                    description="Activa las variantes si el producto tiene diferentes opciones."
                    type="info"
                    showIcon
                  />
                ) : (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddVariant}>
                        Agregar variante
                      </Button>
                    </div>

                    <Table
                      dataSource={variants}
                      pagination={false}
                      size="small"
                      rowKey="key"
                      columns={variantColumns}
                      scroll={{ x: 1100 }}
                    />
                  </>
                )}
              </Card>
            </Col>

            <Col xs={24} lg={8}>
              <Card
                title={<span><PictureOutlined /> Galería</span>}
                variant="borderless"
              >
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

              <Card style={{ marginTop: 24 }} variant="borderless">
                <Form.Item
                  name="categoria"
                  label="Categoría"
                  rules={[{ required: true, message: 'La categoría es obligatoria' }]}
                >
                  <Input />
                </Form.Item>

                <Form.Item
                  name="subcategoria"
                  label="Subcategoría"
                  rules={[{ required: true, message: 'La subcategoría es obligatoria' }]}
                >
                  <Input />
                </Form.Item>

                <Form.Item
                  name="price"
                  label="Precio"
                  rules={[{ required: true, message: 'El precio es obligatorio' }]}
                >
                  <InputNumber style={{ width: '100%' }} prefix="$" min={0} />
                </Form.Item>

                {!hasVariants && (
                  <Form.Item
                    name="stock"
                    label="Stock"
                    rules={[{ required: true, message: 'El stock es obligatorio' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                )}

                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={isLoading}
                  icon={<SaveOutlined />}
                  style={{ marginTop: 16 }}
                >
                  Guardar Cambios
                </Button>
              </Card>
            </Col>
          </Row>
        </Form>
      </Space>
    </div>
  )
}

export default EditProduct