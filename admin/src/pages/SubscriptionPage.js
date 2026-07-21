import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Col, Divider, Flex, Row, Space, Tag, Typography, theme } from 'antd'
import { CheckCircleFilled, CrownOutlined, LockOutlined, RocketOutlined } from '@ant-design/icons'

const { Paragraph, Text, Title } = Typography
const { useToken } = theme

const SUBSCRIPTION_PLANS = Object.freeze([
  {
    id: 'starter',
    name: 'Emprendedor',
    description: 'Las herramientas esenciales para poner en marcha una tienda.',
    monthlyPrice: 29,
    icon: RocketOutlined,
    features: [
      'Hasta 100 productos',
      'Dominio personalizado',
      'Panel de estadísticas esencial',
      'Soporte por correo electrónico',
    ],
    actionLabel: 'Elegir Emprendedor',
    featured: false,
  },
  {
    id: 'pro',
    name: 'Profesional',
    description: 'Automatización y capacidad para una operación en crecimiento.',
    monthlyPrice: 99,
    icon: CrownOutlined,
    features: [
      'Productos ilimitados',
      'Analizador de productos con IA',
      'Múltiples administradores',
      'Reportes avanzados',
      'Soporte prioritario',
    ],
    actionLabel: 'Elegir Profesional',
    featured: true,
  },
])

const formatMonthlyPrice = value =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)

const PlanCard = ({ plan, onSelect }) => {
  const { token } = useToken()
  const PlanIcon = plan.icon
  const accentColor = plan.featured ? token.colorPrimary : token.colorInfo

  return (
    <Card
      aria-label={`Plan ${plan.name}`}
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: 28,
        },
      }}
      style={{
        height: '100%',
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${plan.featured ? token.colorPrimary : token.colorBorderSecondary}`,
        boxShadow: plan.featured ? token.boxShadowSecondary : 'none',
      }}
    >
      <Flex justify="space-between" align="flex-start" gap={16}>
        <Flex
          align="center"
          justify="center"
          style={{
            width: 52,
            height: 52,
            flex: '0 0 52px',
            borderRadius: token.borderRadius,
            color: accentColor,
            background: plan.featured ? token.colorPrimaryBg : token.colorInfoBg,
          }}
        >
          <PlanIcon aria-hidden style={{ fontSize: 25 }} />
        </Flex>

        {plan.featured && (
          <Tag color="processing" style={{ marginInlineEnd: 0 }}>
            Recomendado
          </Tag>
        )}
      </Flex>

      <Title level={2} style={{ margin: '22px 0 6px', fontSize: 25 }}>
        {plan.name}
      </Title>
      <Paragraph type="secondary" style={{ minHeight: 44, marginBottom: 20, lineHeight: 1.55 }}>
        {plan.description}
      </Paragraph>

      <Flex align="baseline" gap={8}>
        <Text
          strong
          style={{
            color: token.colorTextHeading,
            fontSize: 38,
            lineHeight: 1.1,
          }}
        >
          {formatMonthlyPrice(plan.monthlyPrice)}
        </Text>
        <Text type="secondary">por mes</Text>
      </Flex>

      <Divider style={{ margin: '24px 0 18px' }} />

      <Space direction="vertical" size={13} style={{ width: '100%', flex: 1, marginBottom: 28 }}>
        {plan.features.map(feature => (
          <Flex key={feature} align="flex-start" gap={10}>
            <CheckCircleFilled
              aria-hidden
              style={{
                color: token.colorSuccess,
                fontSize: 16,
                marginTop: 3,
              }}
            />
            <Text style={{ lineHeight: 1.55 }}>{feature}</Text>
          </Flex>
        ))}
      </Space>

      <Button
        type={plan.featured ? 'primary' : 'default'}
        size="large"
        block
        onClick={() => onSelect(plan.id)}
        aria-label={`${plan.actionLabel}, ${formatMonthlyPrice(plan.monthlyPrice)} por mes`}
        style={{ height: 48, fontWeight: 600 }}
      >
        {plan.actionLabel}
      </Button>
    </Card>
  )
}

const SubscriptionPage = () => {
  const navigate = useNavigate()
  const { token } = useToken()

  const handleSelectPlan = useCallback(
    planId => {
      const selectedPlan = SUBSCRIPTION_PLANS.find(plan => plan.id === planId)

      if (!selectedPlan) return

      navigate(`/signup?plan=${encodeURIComponent(selectedPlan.id)}`, {
        state: { planId: selectedPlan.id },
      })
    },
    [navigate],
  )

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '56px 20px 40px',
        background: token.colorBgLayout,
      }}
    >
      <section
        aria-labelledby="subscription-title"
        style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}
      >
        <header
          style={{
            maxWidth: 680,
            margin: '0 auto 40px',
            textAlign: 'center',
          }}
        >
          <Text
            strong
            style={{
              color: token.colorPrimary,
              fontSize: 13,
              textTransform: 'uppercase',
            }}
          >
            Planes de suscripción
          </Text>
          <Title id="subscription-title" level={1} style={{ margin: '10px 0 12px', fontSize: 38 }}>
            Elegí una base sólida para tu tienda
          </Title>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 17, lineHeight: 1.65 }}>
            Seleccioná la capacidad que necesitás hoy. Podrás cambiar de plan cuando evolucione tu
            operación.
          </Paragraph>
        </header>

        <Row gutter={[20, 20]} justify="center" align="stretch">
          {SUBSCRIPTION_PLANS.map(plan => (
            <Col xs={24} md={12} key={plan.id}>
              <PlanCard plan={plan} onSelect={handleSelectPlan} />
            </Col>
          ))}
        </Row>

        <Flex
          justify="center"
          align="center"
          gap={8}
          wrap
          style={{
            marginTop: 28,
            color: token.colorTextSecondary,
            textAlign: 'center',
          }}
        >
          <LockOutlined aria-hidden />
          <Text type="secondary">
            Conexión segura, actualizaciones incluidas y aislamiento por tienda.
          </Text>
        </Flex>
      </section>
    </main>
  )
}

export default SubscriptionPage
