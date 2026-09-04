import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Flex,
  Modal,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  Alert,
  message,
  theme,
} from 'antd'
import {
  CrownOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import axios from 'axios'

const { Paragraph, Text, Title } = Typography
const { useToken } = theme

const PLAN_DETAILS = {
  starter: {
    name: 'Emprendedor',
    price: 26.14,
    currency: 'USD',
    icon: RocketOutlined,
  },
  pro: {
    name: 'Profesional',
    price: 99,
    currency: 'USD',
    icon: CrownOutlined,
  },
}

const STATUS_CONFIG = {
  active: {
    label: 'Activa',
    color: 'success',
    icon: CheckCircleOutlined,
  },
  trialing: {
    label: 'En prueba',
    color: 'processing',
    icon: ClockCircleOutlined,
  },
  past_due: {
    label: 'Pendiente de pago',
    color: 'warning',
    icon: ExclamationCircleOutlined,
  },
  cancelled: {
    label: 'Cancelada',
    color: 'error',
    icon: ExclamationCircleOutlined,
  },
  expired: {
    label: 'Expirada',
    color: 'default',
    icon: ExclamationCircleOutlined,
  },
}

const formatDate = date => {
  if (!date) return 'No disponible'
  return new Date(date).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const formatCurrency = (amount, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

const PlanCard = ({ plan, current, onSelectPlan }) => {
  const { token } = useToken()
  const PlanDetail = PLAN_DETAILS[plan]
  if (!PlanDetail) return null

  const PlanIcon = PlanDetail.icon
  const isCurrent = current === plan

  return (
    <Card
      styles={{
        body: {
          padding: 20,
        },
      }}
      style={{
        borderRadius: token.borderRadiusLG,
        border: `2px solid ${isCurrent ? token.colorPrimary : token.colorBorderSecondary}`,
        background: isCurrent ? token.colorPrimaryBg : 'transparent',
      }}
    >
      <Flex justify="space-between" align="flex-start" gap={12}>
        <Flex direction="vertical" gap={8} style={{ flex: 1 }}>
          <Flex align="center" gap={8}>
            <PlanIcon style={{ fontSize: 20, color: token.colorPrimary }} />
            <Text strong style={{ fontSize: 16 }}>
              {PlanDetail.name}
            </Text>
          </Flex>
          <Text strong style={{ fontSize: 24, color: token.colorTextHeading }}>
            {formatCurrency(PlanDetail.price)}
            <Text style={{ fontSize: 12, marginLeft: 4 }}>/ mes</Text>
          </Text>
        </Flex>
        {isCurrent && (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            Actual
          </Tag>
        )}
      </Flex>

      {!isCurrent && (
        <Button
          type="primary"
          block
          style={{ marginTop: 16 }}
          onClick={() => onSelectPlan(plan)}
          icon={<SwapOutlined />}
        >
          Cambiar a este plan
        </Button>
      )}
    </Card>
  )
}

const SubscriptionManagementPage = () => {
  const navigate = useNavigate()
  const { token } = useToken()
  const [loading, setLoading] = useState(true)
  const [subscription, setSubscription] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [changingPlan, setChangingPlan] = useState(false)
  const [cancellingSubscription, setCancellingSubscription] = useState(false)
  const [error, setError] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(null)

  // Cargar datos de suscripción
  useEffect(() => {
    const fetchSubscriptionData = async () => {
      try {
        setLoading(true)
        setError(null)

        const [subResponse, invoicesResponse] = await Promise.all([
          axios.get('/api/subscriptions/current'),
          axios.get('/api/subscriptions/invoices'),
        ])

        if (subResponse.data.success) {
          setSubscription(subResponse.data.data)
        }

        if (invoicesResponse.data.success) {
          setInvoices(invoicesResponse.data.data.invoices || [])
        }
      } catch (err) {
        console.error('Error cargando suscripción:', err)
        setError(
          err.response?.data?.message ||
            'Error al cargar información de suscripción',
        )
      } finally {
        setLoading(false)
      }
    }

    fetchSubscriptionData()
  }, [])

  const handleChangePlan = useCallback(
    newPlan => {
      if (newPlan === subscription?.plan) {
        message.warning('Ya estás suscrito a este plan')
        return
      }

      Modal.confirm({
        title: 'Cambiar plan de suscripción',
        content: `¿Estás seguro que querés cambiar a ${PLAN_DETAILS[newPlan].name}? El cambio se aplicará inmediatamente.`,
        okText: 'Sí, cambiar',
        cancelText: 'Cancelar',
        onOk: async () => {
          try {
            setChangingPlan(true)
            const response = await axios.post('/api/subscriptions/change-plan', {
              newPlan,
            })

            if (response.data.success) {
              message.success('Plan actualizado exitosamente')
              setSubscription(prev => ({
                ...prev,
                plan: response.data.data.plan,
                subscriptionStatus: response.data.data.status,
              }))
              setSelectedPlan(null)
            } else {
              message.error(response.data.message || 'Error al cambiar plan')
            }
          } catch (err) {
            console.error('Error cambiando plan:', err)
            message.error(
              err.response?.data?.message || 'Error al cambiar plan',
            )
          } finally {
            setChangingPlan(false)
          }
        },
      })
    },
    [subscription?.plan],
  )

  const handleCancelSubscription = useCallback(() => {
    Modal.confirm({
      title: 'Cancelar suscripción',
      content:
        'Si cancelas tu suscripción, perderás acceso a todas las características premium. ¿Estás seguro?',
      okText: 'Sí, cancelar',
      cancelText: 'No, mantener',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setCancellingSubscription(true)
          const response = await axios.post('/api/subscriptions/cancel')

          if (response.data.success) {
            message.success('Suscripción cancelada')
            setSubscription(prev => ({
              ...prev,
              subscriptionStatus: 'cancelled',
              plan: 'free',
            }))
          } else {
            message.error(response.data.message || 'Error al cancelar')
          }
        } catch (err) {
          console.error('Error cancelando suscripción:', err)
          message.error(
            err.response?.data?.message || 'Error al cancelar suscripción',
          )
        } finally {
          setCancellingSubscription(false)
        }
      },
    })
  }, [])

  if (loading) {
    return (
      <main
        style={{
          minHeight: '100vh',
          padding: '56px 20px 40px',
          background: token.colorBgLayout,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin size="large" />
      </main>
    )
  }

  if (!subscription) {
    return (
      <main
        style={{
          minHeight: '100vh',
          padding: '56px 20px 40px',
          background: token.colorBgLayout,
        }}
      >
        <section style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
          <Empty
            description="No hay información de suscripción"
            style={{ marginTop: 48 }}
          />
          <Flex justify="center" gap={16} style={{ marginTop: 24 }}>
            <Button type="primary" onClick={() => navigate('/subscripcion')}>
              Ver planes
            </Button>
            <Button onClick={() => navigate('/admin')}>
              Volver al panel
            </Button>
          </Flex>
        </section>
      </main>
    )
  }

  const statusConfig = STATUS_CONFIG[subscription.subscriptionStatus] || STATUS_CONFIG.trialing
  const StatusIcon = statusConfig.icon
  const isActive = subscription.subscriptionStatus === 'active'
  const canChangeOrCancel = isActive || subscription.subscriptionStatus === 'past_due'
  const trialEndsIn = subscription.trialEndsAt
    ? Math.ceil(
        (new Date(subscription.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24),
      )
    : null

  const invoiceColumns = [
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      render: date => formatDate(date),
      width: 150,
    },
    {
      title: 'Estado',
      dataIndex: 'status',
      key: 'status',
      render: status => (
        <Tag color={status === 'approved' ? 'success' : 'processing'}>
          {status === 'approved' ? 'Pagado' : 'Pendiente'}
        </Tag>
      ),
      width: 120,
    },
    {
      title: 'Monto',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount, record) =>
        formatCurrency(amount, record.currency || 'USD'),
      align: 'right',
      width: 120,
    },
    {
      title: 'Descripción',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
    },
  ]

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '56px 20px 40px',
        background: token.colorBgLayout,
      }}
    >
      <section style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
        <header style={{ marginBottom: 32 }}>
          <Title level={1} style={{ margin: 0 }}>
            Mi suscripción
          </Title>
        </header>

        {error && (
          <Alert
            message="Error"
            description={error}
            type="error"
            showIcon
            closable
            style={{ marginBottom: 24 }}
          />
        )}

        {/* Estado actual de suscripción */}
        <Card
          style={{
            marginBottom: 32,
            borderRadius: token.borderRadiusLG,
            borderLeft: `4px solid ${token.colorSuccess}`,
          }}
        >
          <Row gutter={[24, 24]}>
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Plan actual"
                value={PLAN_DETAILS[subscription.plan]?.name || 'Desconocido'}
                valueStyle={{ color: token.colorPrimary }}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Flex direction="vertical" gap={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Estado
                </Text>
                <Flex align="center" gap={8}>
                  <StatusIcon style={{ color: token[`color${statusConfig.color}`] }} />
                  <Text strong>{statusConfig.label}</Text>
                </Flex>
              </Flex>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Precio mensual"
                value={formatCurrency(PLAN_DETAILS[subscription.plan]?.price || 0)}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Flex direction="vertical" gap={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Próximo pago
                </Text>
                <Text strong>{formatDate(subscription.trialEndsAt)}</Text>
              </Flex>
            </Col>
          </Row>

          {subscription.subscriptionStatus === 'trialing' && trialEndsIn !== null && (
            <Alert
              message={`Tu período de prueba termina en ${trialEndsIn} días`}
              type="info"
              showIcon
              style={{ marginTop: 16 }}
            />
          )}

          {subscription.subscriptionStatus === 'past_due' && (
            <Alert
              message="Tu pago está pendiente. Por favor, actualiza tu método de pago."
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
            />
          )}
        </Card>

        {/* Seleccionar plan */}
        {canChangeOrCancel && (
          <>
            <Title level={3} style={{ marginBottom: 16 }}>
              Cambiar de plan
            </Title>
            <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
              {['starter', 'pro'].map(planId => (
                <Col xs={24} sm={12} key={planId}>
                  <PlanCard
                    plan={planId}
                    current={subscription.plan}
                    onSelectPlan={handleChangePlan}
                  />
                </Col>
              ))}
            </Row>

            <Divider />
          </>
        )}

        {/* Historial de pagos */}
        <Title level={3} style={{ marginBottom: 16, marginTop: 32 }}>
          Historial de pagos
        </Title>

        {invoices && invoices.length > 0 ? (
          <Card style={{ marginBottom: 32 }}>
            <Table
              columns={invoiceColumns}
              dataSource={invoices.map((inv, idx) => ({ ...inv, key: inv.id || idx }))}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Card>
        ) : (
          <Card style={{ marginBottom: 32 }}>
            <Empty description="No hay pagos registrados" />
          </Card>
        )}

        {/* Cancelar suscripción */}
        {canChangeOrCancel && (
          <Card
            style={{
              borderRadius: token.borderRadiusLG,
              background: token.colorErrorBg,
              borderColor: token.colorError,
            }}
          >
            <Flex direction="vertical" gap={12}>
              <Title level={4} style={{ margin: 0, color: token.colorError }}>
                Zona de peligro
              </Title>
              <Paragraph style={{ margin: 0, color: token.colorError }}>
                Cancelar tu suscripción eliminará acceso a características premium.
              </Paragraph>
              <Button
                danger
                type="primary"
                icon={<DeleteOutlined />}
                loading={cancellingSubscription}
                onClick={handleCancelSubscription}
                style={{ width: 'fit-content' }}
              >
                Cancelar suscripción
              </Button>
            </Flex>
          </Card>
        )}

        {!canChangeOrCancel && (
          <Alert
            message="Tu suscripción ya está cancelada o expirada"
            description="Volvé a suscribirte para acceder a características premium."
            type="info"
            showIcon
            action={
              <Button
                size="small"
                type="text"
                onClick={() => navigate('/subscripcion')}
              >
                Ver planes
              </Button>
            }
          />
        )}
      </section>
    </main>
  )
}

export default SubscriptionManagementPage
