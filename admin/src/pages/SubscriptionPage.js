import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { Alert, Button, Card, Col, Divider, Flex, Row, Skeleton, Space, Tag, Typography, theme } from 'antd'
import { CheckCircleFilled, LockOutlined } from '@ant-design/icons'
import {
  PLAN_PRESENTATION,
  SELLABLE_PLANS,
  formatArs,
  isPlanContratable,
} from '../constants/plans.js'
import { getPlanCatalog } from '../services/subscriptionPlansService.js'

const { Paragraph, Text, Title } = Typography
const { useToken } = theme

// Los precios NO están acá. Vienen de /subscriptions/plans, que es la misma
// fuente con la que el backend cobra. Antes esta pantalla tenía su propia lista
// con 40.000 ARS para el starter y 99 USD para el pro, y SubscriptionManagement
// tenía otra que decía 26,14 USD para el mismo starter — el resultado congelado
// de dividir esos 40.000 por el dólar de un día de agosto. Dos pantallas del
// mismo panel mostrando dos precios distintos para lo mismo.

const PlanCard = ({ planId, priceArs, onSelect }) => {
  const { token } = useToken()
  const plan = PLAN_PRESENTATION[planId]
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

      <Flex vertical gap={2}>
        <Flex align="baseline" gap={8}>
          <Text
            strong
            style={{
              color: token.colorTextHeading,
              fontSize: 38,
              lineHeight: 1.1,
            }}
          >
            {formatArs(priceArs, { sinPrecio: 'A definir' })}
          </Text>
          <Text type="secondary">por mes</Text>
        </Flex>
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
        onClick={() => onSelect(planId)}
        disabled={!isPlanContratable(priceArs)}
        aria-label={`${plan.actionLabel}, ${formatArs(priceArs)} por mes`}
        style={{ height: 48, fontWeight: 600 }}
      >
        {isPlanContratable(priceArs) ? plan.actionLabel : 'Precio a definir'}
      </Button>
    </Card>
  )
}

const SubscriptionPage = () => {
  const navigate = useNavigate()
  const { token } = useToken()
  const isAuthenticated = useSelector(state => state.user?.isAuthenticated)

  const [precios, setPrecios] = useState({})
  const [cargando, setCargando] = useState(true)
  const [errorPrecios, setErrorPrecios] = useState('')

  useEffect(() => {
    let vigente = true

    getPlanCatalog()
      .then(catalogo => {
        if (!vigente) return

        setPrecios(
          Object.fromEntries(
            (catalogo?.plans || []).map(p => [p.plan, p.monthlyPriceArs]),
          ),
        )
      })
      .catch(() => {
        if (!vigente) return

        // Sin precios no se muestran precios. Inventar uno de respaldo sería
        // volver al problema: una pantalla afirmando un número que el cobro no
        // va a respetar.
        setErrorPrecios('No se pudieron cargar los precios. Volvé a intentar en un momento.')
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    return () => {
      vigente = false
    }
  }, [])

  // Esta pantalla es pública, así que el visitante puede no tener comercio
  // todavía. El checkout cobra sobre un comercio ya identificado: sin sesión
  // no hay a qué cobrarle, así que primero pasa por el alta y vuelve con el
  // plan elegido. Con sesión va derecho a pagar.
  const handleSelectPlan = useCallback(
    planId => {
      if (!PLAN_PRESENTATION[planId]) return

      const plan = encodeURIComponent(planId)
      const destination = isAuthenticated
        ? `/checkout?plan=${plan}`
        : `/signup?plan=${plan}`

      navigate(destination, {
        state: { planId },
      })
    },
    [navigate, isAuthenticated],
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

        {errorPrecios && (
          <Alert
            type="warning"
            showIcon
            message={errorPrecios}
            style={{ marginBottom: 20, borderRadius: 8 }}
          />
        )}

        <Row gutter={[20, 20]} justify="center" align="stretch">
          {cargando
            ? SELLABLE_PLANS.map(planId => (
              <Col xs={24} md={12} key={planId}>
                <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>
              </Col>
            ))
            : SELLABLE_PLANS.map(planId => (
              <Col xs={24} md={12} key={planId}>
                <PlanCard
                  planId={planId}
                  priceArs={precios[planId]}
                  onSelect={handleSelectPlan}
                />
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
