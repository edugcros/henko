import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Empty, Modal, Spin, Table, message } from 'antd'
import {
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import api from '@utils/axiosConfig'
import {
  PLAN_PRESENTATION,
  SELLABLE_PLANS,
  formatArs,
  formatCount,
  getPlanQuotaLines,
  isPlanContratable,
} from '../constants/plans.js'
import './SubscriptionManagementPage.css'

// PLAN_DETAILS vivía acá con los precios adentro: 26,14 USD el starter y 99 USD
// el pro. Ese 26,14 era el resultado congelado de dividir 40.000 pesos por el
// dólar del 24/08/2026 — o sea que esta pantalla mostraba un número y el cobro
// salía de otro. El nombre y el ícono se mudaron a constants/plans.js y el
// precio lo trae el backend, que es quien cobra. Los cupos de IA vienen del mismo
// catálogo.

// `tone` elige el color de la etiqueta de estado (ver .hk-sus-pill en el CSS).
const STATUS_CONFIG = {
  active: {
    label: 'Activa',
    tone: 'ok',
    icon: CheckCircleOutlined,
  },
  trialing: {
    label: 'En prueba',
    tone: 'info',
    icon: ClockCircleOutlined,
  },
  past_due: {
    label: 'Pendiente de pago',
    tone: 'warn',
    icon: ExclamationCircleOutlined,
  },
  cancelled: {
    label: 'Cancelada',
    tone: 'bad',
    icon: ExclamationCircleOutlined,
  },
  expired: {
    label: 'Expirada',
    tone: 'muted',
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

// Las facturas de Mercado Pago traen su propia moneda; el resto es pesos.
const formatCurrency = (amount, currency = 'ARS') =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)

const PlanCard = ({ plan, priceArs, limits, current, onSelectPlan }) => {
  const PlanDetail = PLAN_PRESENTATION[plan]
  if (!PlanDetail) return null

  const PlanIcon = PlanDetail.icon
  const isCurrent = current === plan
  const cupos = getPlanQuotaLines(limits)

  return (
    <article
      className={`hk-sus-plan${isCurrent ? ' is-current' : ''}`}
      aria-label={`Plan ${PlanDetail.name}`}
    >
      <header className="hk-sus-plan-head">
        <span className="hk-sus-plan-icon" aria-hidden="true">
          <PlanIcon />
        </span>
        <h3>{PlanDetail.name}</h3>
        {isCurrent && (
          <span className="hk-sus-pill is-ok">
            <CheckCircleOutlined aria-hidden="true" /> Actual
          </span>
        )}
      </header>

      <p className="hk-sus-plan-price">
        <strong>{formatArs(priceArs, { sinPrecio: 'A definir' })}</strong>
        <span>/ mes</span>
      </p>

      <ul className="hk-sus-plan-list">
        {PlanDetail.features.map(feature => (
          <li key={feature}>
            <CheckOutlined aria-hidden="true" /> {feature}
          </li>
        ))}
      </ul>

      {cupos.length > 0 && (
        <div className="hk-sus-quotas">
          <span>Cada mes incluye</span>
          <ul>
            {cupos.map(cupo => (
              <li key={cupo.key}>
                <b>{formatCount(cupo.amount)}</b> {cupo.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isCurrent && (
        <Button
          type="primary"
          block
          size="large"
          onClick={() => onSelectPlan(plan)}
          icon={<SwapOutlined />}
          disabled={!isPlanContratable(priceArs)}
        >
          {isPlanContratable(priceArs) ? 'Cambiar a este plan' : 'Precio a definir'}
        </Button>
      )}
    </article>
  )
}

const SubscriptionManagementPage = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [subscription, setSubscription] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [changingPlan, setChangingPlan] = useState(false)
  const [cancellingSubscription, setCancellingSubscription] = useState(false)
  const [error, setError] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(null)
  // Los precios y los cupos los sirve el backend. Esta pantalla los tenía escritos
  // a mano y no coincidían con los de la pantalla de planes ni con lo que se cobra.
  const [catalogo, setCatalogo] = useState({})

  // Cargar datos de suscripción
  useEffect(() => {
    const fetchSubscriptionData = async () => {
      try {
        setLoading(true)
        setError(null)

        const [subResponse, invoicesResponse, plansResponse] = await Promise.all([
          api.get('/subscriptions/current'),
          api.get('/subscriptions/invoices'),
          api.get('/subscriptions/plans'),
        ])

        const planes = plansResponse?.data?.data?.plans || []
        setCatalogo(
          Object.fromEntries(
            planes.map(p => [p.plan, { price: p.monthlyPriceArs, limits: p.limits }]),
          ),
        )

        if (subResponse.data.success) {
          setSubscription(subResponse.data.data)
        }

        if (invoicesResponse.data.success) {
          setInvoices(invoicesResponse.data.data.invoices || [])
        }
      } catch (err) {
        console.error('Error cargando suscripción:', err)
        setError(err.response?.data?.message || 'Error al cargar información de suscripción')
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

      // Sin suscripción en Mercado Pago no hay nada que cambiar: hay que crear
      // la primera, y eso se hace en el checkout.
      //
      // Antes este botón llamaba igual a /subscriptions/change-plan, que le
      // pide a Mercado Pago modificar el monto de una suscripción existente.
      // Para un comercio que todavía no tiene ninguna, la única respuesta
      // posible era "Suscripción de Mercado Pago no encontrada" — un mensaje
      // correcto que no dice qué hacer, sobre un botón que no podía funcionar.
      if (!subscription?.mercadoPago?.subscriptionId) {
        navigate(`/checkout?plan=${encodeURIComponent(newPlan)}`)
        return
      }

      Modal.confirm({
        title: 'Cambiar plan de suscripción',
        content: `¿Estás seguro que querés cambiar a ${PLAN_PRESENTATION[newPlan].name}? El cambio se aplicará inmediatamente.`,
        okText: 'Sí, cambiar',
        cancelText: 'Cancelar',
        onOk: async () => {
          try {
            setChangingPlan(true)
            const response = await api.post('/subscriptions/change-plan', {
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
            message.error(err.response?.data?.message || 'Error al cambiar plan')
          } finally {
            setChangingPlan(false)
          }
        },
      })
    },
    [subscription?.plan, subscription?.mercadoPago?.subscriptionId, navigate],
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
          const response = await api.post('/subscriptions/cancel')

          if (response.data.success) {
            message.success('Suscripción cancelada')
            // El plan NO cambia al cancelar: cambia el ESTADO. Acá se bajaba
            // a 'free', que ya no existe — y hacía que la pantalla mostrara un
            // plan distinto del que el backend guarda, que sigue siendo el
            // contratado con la suscripción dada de baja.
            setSubscription(prev => ({
              ...prev,
              subscriptionStatus: 'cancelled',
            }))
          } else {
            message.error(response.data.message || 'Error al cancelar')
          }
        } catch (err) {
          console.error('Error cancelando suscripción:', err)
          message.error(err.response?.data?.message || 'Error al cancelar suscripción')
        } finally {
          setCancellingSubscription(false)
        }
      },
    })
  }, [])

  if (loading) {
    return (
      <main className="hk-sus is-centered">
        <Spin size="large" />
      </main>
    )
  }

  if (!subscription) {
    return (
      <main className="hk-sus">
        <section className="hk-sus-wrap">
          {/* Si la carga falló hay que decir por qué: «no hay información» a secas escondía el error. */}
          {error && (
            <Alert
              message="Error"
              description={error}
              type="error"
              showIcon
              style={{ marginBottom: 24 }}
            />
          )}
          <Empty description="No hay información de suscripción" />
          <div className="hk-sus-empty-actions">
            <Button type="primary" onClick={() => navigate('/subscripcion')}>
              Ver planes
            </Button>
            <Button onClick={() => navigate('/admin')}>Volver al panel</Button>
          </div>
        </section>
      </main>
    )
  }

  const statusConfig = STATUS_CONFIG[subscription.subscriptionStatus] || STATUS_CONFIG.trialing
  const StatusIcon = statusConfig.icon
  const isActive = subscription.subscriptionStatus === 'active'
  const canChangeOrCancel = isActive || subscription.subscriptionStatus === 'past_due'
  // En prueba todavía no hay nada que cancelar, pero SÍ hay que poder elegir plan: es el comercio
  // que tiene que suscribirse. Antes la pantalla lo trataba como dado de baja y le decía que su
  // suscripción ya estaba «cancelada o expirada». Sin suscripción en Mercado Pago, elegir un plan
  // lleva al checkout (ver handleChangePlan).
  const puedeElegirPlan = canChangeOrCancel || subscription.subscriptionStatus === 'trialing'

  // Cancelar exige una suscripción real en Mercado Pago. El estado del comercio
  // puede decir 'active' sin que exista ninguna —es el caso de un plan puesto a
  // mano—, y ahí el botón de cancelar solo puede devolver un error.
  const tieneSuscripcionEnMercadoPago = Boolean(subscription.mercadoPago?.subscriptionId)
  // El próximo cobro sale del proveedor. currentPeriodEnd es el respaldo:
  // en una suscripción que cobra al inicio de cada período, el período vigente
  // termina justo cuando llega el cobro siguiente.
  const nextPaymentAt =
    subscription.mercadoPago?.nextBillingAt || subscription.mercadoPago?.currentPeriodEnd || null

  // Una suscripción dada de baja y sin ninguna fecha no tiene un «fin de la prueba» que mostrar.
  const mostrarFecha =
    Boolean(nextPaymentAt || subscription.trialEndsAt) ||
    ['active', 'trialing', 'past_due'].includes(subscription.subscriptionStatus)

  const trialEndsIn = subscription.trialEndsAt
    ? Math.ceil((new Date(subscription.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24))
    : null

  const invoiceColumns = [
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      render: date => formatDate(date),
      width: 200,
    },
    {
      title: 'Estado',
      dataIndex: 'status',
      key: 'status',
      render: status => (
        <span className={`hk-sus-pill ${status === 'approved' ? 'is-ok' : 'is-info'}`}>
          {status === 'approved' ? 'Pagado' : 'Pendiente'}
        </span>
      ),
      width: 120,
    },
    {
      title: 'Monto',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount, record) => formatCurrency(amount, record.currency || 'ARS'),
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
    <main className="hk-sus">
      <section className="hk-sus-wrap">
        <header className="hk-sus-head">
          <h1>Mi suscripción</h1>
          <p>Tu plan, tu próximo cobro y tu historial de pagos.</p>
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
        <section className="hk-sus-summary" aria-label="Estado de tu suscripción">
          <div className="hk-sus-summary-main">
            <span className="hk-sus-eyebrow">PLAN ACTUAL</span>
            <p className="hk-sus-summary-plan">
              {PLAN_PRESENTATION[subscription.plan]?.name || 'Desconocido'}
            </p>
            <span className={`hk-sus-pill is-${statusConfig.tone} is-on-dark`}>
              <StatusIcon aria-hidden="true" /> {statusConfig.label}
            </span>
          </div>

          <dl className="hk-sus-facts">
            <div>
              <dt>Precio mensual</dt>
              <dd>{formatArs(catalogo[subscription.plan]?.price ?? null)}</dd>
            </div>
            {mostrarFecha && (
              <div>
                {/*
                  Decía "Próximo pago" y mostraba trialEndsAt: el fin del
                  período de prueba, que en un comercio que ya paga es una
                  fecha vieja y no tiene nada que ver con el próximo cobro.
                  El dato correcto lo informa Mercado Pago y el endpoint ya lo
                  devolvía dentro de mercadoPago; solo que nadie lo leía.
                */}
                <dt>{nextPaymentAt ? 'Próximo pago' : 'Fin de la prueba'}</dt>
                <dd>{formatDate(nextPaymentAt || subscription.trialEndsAt)}</dd>
              </div>
            )}
          </dl>

          {subscription.subscriptionStatus === 'trialing' && trialEndsIn !== null && (
            <p className="hk-sus-note is-info">
              {`Tu período de prueba termina en ${trialEndsIn} días`}
            </p>
          )}

          {subscription.subscriptionStatus === 'past_due' && (
            <p className="hk-sus-note is-warn" role="alert">
              Tu pago está pendiente. Por favor, actualiza tu método de pago.
            </p>
          )}
        </section>

        {/* Seleccionar plan */}
        {puedeElegirPlan && (
          <section className="hk-sus-section" aria-labelledby="hk-sus-plans-title">
            <h2 id="hk-sus-plans-title">Cambiar de plan</h2>
            <div className="hk-sus-plans">
              {SELLABLE_PLANS.map(planId => (
                <PlanCard
                  key={planId}
                  plan={planId}
                  priceArs={catalogo[planId]?.price ?? null}
                  limits={catalogo[planId]?.limits}
                  current={subscription.plan}
                  onSelectPlan={handleChangePlan}
                />
              ))}
            </div>
          </section>
        )}

        {/* Historial de pagos */}
        <section className="hk-sus-section" aria-labelledby="hk-sus-invoices-title">
          <h2 id="hk-sus-invoices-title">Historial de pagos</h2>

          <div className="hk-sus-card">
            {invoices && invoices.length > 0 ? (
              <Table
                columns={invoiceColumns}
                dataSource={invoices.map((inv, idx) => ({ ...inv, key: inv.id || idx }))}
                pagination={{ pageSize: 10 }}
                size="small"
                scroll={{ x: 520 }}
              />
            ) : (
              <Empty description="No hay pagos registrados" />
            )}
          </div>
        </section>

        {/* Cancelar suscripción */}
        {canChangeOrCancel && tieneSuscripcionEnMercadoPago && (
          <section className="hk-sus-danger" aria-labelledby="hk-sus-danger-title">
            <div>
              <h2 id="hk-sus-danger-title">Zona de peligro</h2>
              <p>Cancelar tu suscripción eliminará acceso a características premium.</p>
            </div>
            <Button
              danger
              loading={cancellingSubscription}
              onClick={handleCancelSubscription}
              size="large"
            >
              Cancelar suscripción
            </Button>
          </section>
        )}

        {!puedeElegirPlan && (
          <Alert
            message="Tu suscripción ya está cancelada o expirada"
            description="Volvé a suscribirte para acceder a características premium."
            type="info"
            showIcon
            action={
              <Button size="small" type="text" onClick={() => navigate('/subscripcion')}>
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
