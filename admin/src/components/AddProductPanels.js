// 📁 src/components/AddProductPanels.js
//
// Los subcomponentes de AddProduct: el panel del análisis de la IA, la grilla
// de imágenes, los campos dinámicos, el selector de imagen de variante y
// ProductField con sus contextos. Salieron de AddProduct.js tal cual.
import React, { useState, useEffect, useCallback } from 'react'
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
  Upload,
  Empty,
  Switch,
  theme,
  Space,
} from 'antd'
import {
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
  ArrowLeftOutlined,
  ArrowRightOutlined,
  StarOutlined,
} from '@ant-design/icons'

import {
  normalizeString,
  safeArray,
  buildSeoPayload,
  normalizeAiAnalysisForForm,
  resolveAiConfidencePercent,
  normalizeNamePath,
  setFormFieldValue,
  extractInputValue,
  getRequiredMessage,
  isEmptyFieldValue,
} from '@features/product/addProductHelpers'

const { Text, Paragraph } = Typography
const { useToken } = theme

export const AIAnalysisPanel = ({
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
            <RobotOutlined style={{ fontSize: 52, color: token.colorPrimary }} />
          </div>
          <Text strong style={{ fontSize: 17, display: 'block', margin: '16px 0 8px' }}>
            Analizando imagen con IA
          </Text>
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            Identificando producto, atributos, ficha técnica, SEO y señales de revisión.
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
            onClick={() => onReset()}
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
  const { fields, dynamicFields, dynamicValues, hasExplicitVariants, variants, review, tags } =
    normalized
  const confidencePercent = resolveAiConfidencePercent(iaResult)
  const materialPercent = Math.round(
    Math.max(0, Math.min(1, Number(review.materialConfidence || 0))) * 100,
  )
  const pricePercent = Math.round(
    Math.max(0, Math.min(1, Number(review.priceConfidence || 0))) * 100,
  )
  const technicalDescription = fields.descripcionTecnica
  const commercialDescription = fields.descripcion
  // Sin dato de confianza también se pide revisar.
  const shouldReview =
    review.requiresHumanReview || confidencePercent === null || confidencePercent < 65

  const formatSuggestedValue = value => {
    if (Array.isArray(value))
      return value
        .map(item => normalizeString(item))
        .filter(Boolean)
        .join(', ')
    if (value === true) return 'Sí'
    if (value === false) return 'No'
    if (value === undefined || value === null || value === '') return ''
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
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
      value: fields.precio ? `$${Number(fields.precio).toLocaleString('es-AR')}` : '',
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
      value: fields.shortDescription || buildSeoPayload({ ...fields, tags }).shortDescription,
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
      value: fields.metaDescription || buildSeoPayload({ ...fields, tags }).metaDescription,
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
      description: 'Podés aplicar campo por campo o usar el botón “Generar SEO con IA”.',
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
              ellipsis={available ? { rows: 3, expandable: true, symbol: 'Ver más' } : false}
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
            block
            type={available ? 'primary' : 'default'}
            ghost={available}
            icon={<CheckCircleOutlined />}
            disabled={!available}
            onClick={() => onApplyField?.(item.fieldName)}
            style={{
              borderRadius: 999,
              whiteSpace: 'normal',
              height: 'auto',
              minHeight: 28,
              lineHeight: 1.3,
              padding: '4px 12px',
            }}
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
              <RobotOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
              <span>Revisión inteligente de la IA</span>
              <Tag color={shouldReview ? 'warning' : 'success'} style={{ borderRadius: 999 }}>
                {confidencePercent === null
                  ? 'Confianza sin dato'
                  : `${confidencePercent}% confianza`}
              </Tag>
              {shouldReview && (
                <Tag color="orange" style={{ borderRadius: 999 }}>
                  Revisar antes de publicar
                </Tag>
              )}
            </Space>
          </Col>
          <Col>
            <Button
              htmlType="button"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => onReset()}
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
        <Button htmlType="button" icon={<CheckOutlined />} onClick={onApplySafeFields}>
          Aplicar solo campos seguros
        </Button>
        <Button htmlType="button" icon={<ThunderboltOutlined />} onClick={onApplySeo}>
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
        <div key={section.key} style={{ marginTop: section.key === 'main' ? 0 : 20 }}>
          <Divider orientation="left" plain>
            {section.title}
          </Divider>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {section.description}
          </Text>
          <Row gutter={[14, 14]}>
            {section.items.map(item => (
              <Col xs={24} sm={12} xl={8} key={item.key}>
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
                <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
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
                <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
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
                      {field.source && <Tag style={{ borderRadius: 999 }}>{field.source}</Tag>}
                      {field.filterable && (
                        <Tag color="blue" style={{ borderRadius: 999 }}>
                          Filtro
                        </Tag>
                      )}
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

export const ImagePreviewGrid = ({
  previews,
  fileList,
  onRemove,
  onAddMore,
  onReorder,
  onSetPrincipal,
  onAnalyze,
  analyzing,
}) => {
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
      <Text strong style={{ display: 'block', marginBottom: 4 }}>
        Imágenes seleccionadas ({previews.length})
      </Text>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
        La primera imagen es la portada del producto. Usá las flechas para reordenar o marcá otra
        como principal.
      </Text>

      <Row gutter={[16, 16]}>
        {previews.map((src, i) => (
          <Col key={`${src}-${i}`} xs={12} sm={8} md={8} lg={6} xl={4}>
            <div
              style={{
                width: '100%',
                position: 'relative',
                borderRadius: 12,
                overflow: 'hidden',
                border: `2px solid ${token.colorBorder}`,
                transition: 'all 0.3s ease',
                background: token.colorBgContainer,
              }}
              className="image-preview-item"
            >
              <div style={{ position: 'relative' }}>
                <img
                  src={src}
                  alt={`Imagen ${i + 1} de ${previews.length} del producto${i === 0 ? ' (portada)' : ''}`}
                  style={{
                    width: '100%',
                    height: 208,
                    objectFit: 'cover',
                    display: 'block',
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
                    gap: 8,
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
                    aria-label={`Ver imagen ${i + 1} en tamaño completo`}
                  />
                  {onAnalyze && (
                    <Button
                      htmlType="button"
                      shape="circle"
                      icon={<ThunderboltOutlined />}
                      size="small"
                      loading={analyzing}
                      disabled={analyzing}
                      onClick={() => onAnalyze(i)}
                      aria-label={`Analizar imagen ${i + 1} con IA`}
                      title="Analizar esta imagen con IA"
                    />
                  )}
                  <Button
                    htmlType="button"
                    danger
                    shape="circle"
                    icon={<DeleteOutlined />}
                    size="small"
                    onClick={() => onRemove(fileList[i])}
                    aria-label={`Eliminar imagen ${i + 1}`}
                  />
                </div>

                {i === 0 && (
                  <Tag
                    color="gold"
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      margin: 0,
                      fontSize: 11,
                    }}
                  >
                    Portada
                  </Tag>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 6px',
                  borderTop: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <Button
                  htmlType="button"
                  type="text"
                  size="small"
                  icon={<ArrowLeftOutlined />}
                  disabled={i === 0}
                  onClick={() => onReorder(i, i - 1)}
                  aria-label={`Mover imagen ${i + 1} hacia la izquierda`}
                  style={{ minWidth: 26 }}
                />
                {i === 0 ? (
                  <StarOutlined
                    style={{ color: token.colorWarning, fontSize: 14 }}
                    title="Portada actual"
                  />
                ) : (
                  <Button
                    htmlType="button"
                    type="text"
                    size="small"
                    icon={<StarOutlined />}
                    onClick={() => onSetPrincipal(i)}
                    aria-label={`Marcar imagen ${i + 1} como portada`}
                    title="Marcar como portada"
                    style={{ minWidth: 26 }}
                  />
                )}
                <Button
                  htmlType="button"
                  type="text"
                  size="small"
                  icon={<ArrowRightOutlined />}
                  disabled={i === previews.length - 1}
                  onClick={() => onReorder(i, i + 1)}
                  aria-label={`Mover imagen ${i + 1} hacia la derecha`}
                  style={{ minWidth: 26 }}
                />
              </div>
            </div>
          </Col>
        ))}

        <Col xs={12} sm={8} md={8} lg={6} xl={4}>
          <Upload
            showUploadList={false}
            beforeUpload={() => false}
            onChange={onAddMore}
            fileList={fileList}
            multiple
          >
            <div
              style={{
                height: 244,
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

export const DynamicProductField = ({ field }) => {
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

export const VariantImageSelector = ({ variant, localImages, onAssign }) => {
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

export const ProductFormDirtyContext = React.createContext(() => {})
export const ProductFormMutationContext = React.createContext({
  version: 0,
  notifyMutation: () => {},
})

export const ProductField = React.memo(function ProductField({
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
