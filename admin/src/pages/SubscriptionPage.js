import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { Alert, Skeleton } from 'antd'
import {
  ArrowRightOutlined,
  CheckOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  DownOutlined,
  LockOutlined,
  RobotOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import {
  PLAN_PRESENTATION,
  SELLABLE_PLANS,
  formatArs,
  formatCount,
  getPlanQuotaLines,
  isPlanContratable,
} from '../constants/plans.js'
import { getPlanCatalog } from '../services/subscriptionPlansService.js'
import { env } from '../config/env.js'
import logoHenkart from '../assets/images/logo-henkart.png'
import './SubscriptionPage.css'

// Los precios NO están acá. Vienen de /subscriptions/plans, que es la misma
// fuente con la que el backend cobra. Antes esta pantalla tenía su propia lista
// con 40.000 ARS para el starter y 99 USD para el pro, y SubscriptionManagement
// tenía otra que decía 26,14 USD para el mismo starter — el resultado congelado
// de dividir esos 40.000 por el dólar de un día de agosto. Dos pantallas del
// mismo panel mostrando dos precios distintos para lo mismo.
//
// Los CUPOS de IA tampoco: vienen del mismo catálogo (`limits`).
//
// Lo que esta pantalla afirma sale del producto: el recorrido (el alta recibe el plan
// elegido y el checkout cobra con Mercado Pago), lo incluido en los dos planes y lo que
// dice cada plan en constants/plans.js. No se anuncia la prueba gratis aunque el backend
// la da: es una decisión comercial que no está acá.

// Lo que trae CUALQUIER plan. Cada ítem vale para los dos: lo que es de un solo plan
// está en PLAN_PRESENTATION[plan].features.
const INCLUIDO = [
  {
    icon: ShopOutlined,
    title: 'Tienda con tu marca',
    text: 'Diseño editable, tu logo y un subdominio de Henkart.',
  },
  {
    icon: CreditCardOutlined,
    title: 'Cobros con Mercado Pago',
    text: 'Conectás tu propia cuenta y cobrás desde tu tienda.',
  },
  {
    icon: RobotOutlined,
    title: 'IA para vender',
    text: 'Fichas de producto, asistente de ventas y análisis de mercado, con cupos según el plan.',
  },
  {
    icon: DashboardOutlined,
    title: 'Todo en un panel',
    text: 'Pedidos, clientes, stock y métricas en español.',
  },
]

const PREGUNTAS = [
  {
    pregunta: '¿Cómo se paga la suscripción?',
    respuesta:
      'Todos los meses, con Mercado Pago. Los datos de tu tarjeta los procesa Mercado Pago directamente.',
  },
  {
    pregunta: '¿Puedo cambiar de plan después?',
    respuesta:
      'Sí. Desde «Mi suscripción», dentro del panel, podés administrar tu plan cuando tu operación cambie.',
  },
  {
    pregunta: '¿Qué son los cupos de IA?',
    respuesta:
      'Cada plan incluye una cantidad mensual de análisis de imágenes, mensajes del asistente de ventas, fondos generados y análisis de mercado. Los cupos se renuevan todos los meses.',
  },
]

const urlDelSitio = () => {
  const dominio = String(env?.publicBaseDomain || '').trim()

  if (!dominio) return null
  if (/^https?:\/\//i.test(dominio)) return dominio

  return `${window.location.protocol}//${dominio}`
}

const PlanCard = ({ planId, entrada, estado, onSelect }) => {
  const plan = PLAN_PRESENTATION[planId]
  const PlanIcon = plan.icon
  const priceArs = entrada?.price
  // Un 0 no es «gratis»: es un precio sin cargar. Se muestra igual que null.
  const precioContratable = isPlanContratable(priceArs)
  const contratable = estado === 'listo' && precioContratable
  const cupos = getPlanQuotaLines(entrada?.limits)

  return (
    <article
      className={`hk-sub-card${plan.featured ? ' is-featured' : ''}`}
      aria-label={`Plan ${plan.name}`}
    >
      {plan.featured && <span className="hk-sub-badge">Más completo</span>}

      <span className="hk-sub-card-icon" aria-hidden="true">
        <PlanIcon />
      </span>

      <h3 className="hk-sub-card-name">{plan.name}</h3>
      <p className="hk-sub-card-desc">{plan.description}</p>

      <div className="hk-sub-price" aria-live="polite">
        {estado === 'error' ? (
          <span className="hk-sub-price-na">Precio no disponible</span>
        ) : (
          <>
            <strong>{precioContratable ? formatArs(priceArs) : 'A definir'}</strong>
            {precioContratable && <span>por mes</span>}
          </>
        )}
      </div>

      <button
        type="button"
        className="hk-sub-cta"
        onClick={() => onSelect(planId)}
        disabled={!contratable}
        aria-label={
          contratable
            ? `${plan.actionLabel}, ${formatArs(priceArs)} por mes`
            : `${plan.name}: precio no disponible`
        }
      >
        {contratable ? plan.actionLabel : estado === 'error' ? 'No disponible' : 'Precio a definir'}
        {contratable && <ArrowRightOutlined aria-hidden="true" />}
      </button>

      <ul className="hk-sub-features">
        {plan.features.map(feature => (
          <li key={feature}>
            <CheckOutlined aria-hidden="true" /> {feature}
          </li>
        ))}
      </ul>

      {cupos.length > 0 && (
        <div className="hk-sub-quotas">
          <span className="hk-sub-quotas-title">Cada mes incluye</span>
          <ul>
            {cupos.map(cupo => (
              <li key={cupo.key}>
                <b>{formatCount(cupo.amount)}</b> {cupo.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

const SubscriptionPage = () => {
  const navigate = useNavigate()
  const isAuthenticated = useSelector(state => state.user?.isAuthenticated)

  const [catalogo, setCatalogo] = useState({})
  const [estado, setEstado] = useState('cargando')
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vigente = true

    setEstado('cargando')

    getPlanCatalog()
      .then(respuesta => {
        if (!vigente) return

        setCatalogo(
          Object.fromEntries(
            (respuesta?.plans || []).map(p => [
              p.plan,
              { price: p.monthlyPriceArs, limits: p.limits },
            ]),
          ),
        )
        setEstado('listo')
      })
      .catch(() => {
        if (!vigente) return

        // Sin precios no se muestran precios. Inventar uno de respaldo sería
        // volver al problema: una pantalla afirmando un número que el cobro no
        // va a respetar. Y tampoco se muestra «A definir», que quiere decir
        // «el dueño no lo cargó»: acá lo que pasó es que no se pudo leer.
        setCatalogo({})
        setEstado('error')
      })

    return () => {
      vigente = false
    }
  }, [intento])

  // Esta pantalla es pública, así que el visitante puede no tener comercio
  // todavía. El checkout cobra sobre un comercio ya identificado: sin sesión
  // no hay a qué cobrarle, así que primero pasa por el alta y vuelve con el
  // plan elegido. Con sesión va derecho a pagar.
  const handleSelectPlan = useCallback(
    planId => {
      if (!PLAN_PRESENTATION[planId]) return

      const plan = encodeURIComponent(planId)
      const destination = isAuthenticated ? `/checkout?plan=${plan}` : `/signup?plan=${plan}`

      navigate(destination, {
        state: { planId },
      })
    },
    [navigate, isAuthenticated],
  )

  const sitio = urlDelSitio()
  const logo = (
    <img className="hk-sub-logo" src={logoHenkart} alt="Henkart" width="156" height="35" />
  )

  // El recorrido real: sin sesión, el alta recibe el plan y después viene el pago.
  const pasos = isAuthenticated
    ? ['Elegí tu plan', 'Activá la suscripción con Mercado Pago']
    : ['Elegí tu plan', 'Creá tu cuenta y tu tienda', 'Activá la suscripción con Mercado Pago']

  return (
    <main className="hk-sub">
      <header className="hk-sub-top">
        <div className="hk-sub-wrap hk-sub-top-inner">
          {sitio ? (
            <a href={sitio} aria-label="Henkart, volver al sitio">
              {logo}
            </a>
          ) : (
            logo
          )}
          {!isAuthenticated && (
            <Link className="hk-sub-login" to="/login">
              Ya tengo cuenta · Ingresar
            </Link>
          )}
        </div>
      </header>

      <section className="hk-sub-hero" aria-labelledby="subscription-title">
        <div className="hk-sub-wrap">
          <span className="hk-sub-eyebrow">PLANES</span>
          <h1 id="subscription-title">
            Elegí el plan
            <br />
            <span className="hk-sub-gradient">que acompaña tu negocio.</span>
          </h1>
          <p className="hk-sub-lead">
            Precios en pesos argentinos, con facturación mensual. Empezás con lo que necesitás hoy y
            lo ajustás cuando tu operación crezca.
          </p>

          <ol className="hk-sub-steps" aria-label="Cómo sigue">
            {pasos.map((paso, index) => (
              <li key={paso}>
                <span className="hk-sub-step-num">{index + 1}</span>
                {paso}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="hk-sub-plans" aria-label="Planes disponibles">
        <div className="hk-sub-wrap">
          {estado === 'error' && (
            <Alert
              type="warning"
              showIcon
              className="hk-sub-alert"
              message="No se pudieron cargar los precios. Volvé a intentar en un momento."
              action={
                <button
                  type="button"
                  className="hk-sub-retry"
                  onClick={() => setIntento(n => n + 1)}
                >
                  Reintentar
                </button>
              }
            />
          )}

          <div className="hk-sub-grid">
            {SELLABLE_PLANS.map(planId =>
              estado === 'cargando' ? (
                <div className="hk-sub-card is-loading" key={planId}>
                  <Skeleton active paragraph={{ rows: 7 }} />
                </div>
              ) : (
                <PlanCard
                  key={planId}
                  planId={planId}
                  entrada={catalogo[planId]}
                  estado={estado}
                  onSelect={handleSelectPlan}
                />
              ),
            )}
          </div>
        </div>
      </section>

      <section className="hk-sub-included" aria-labelledby="hk-sub-included-title">
        <div className="hk-sub-wrap">
          <h2 id="hk-sub-included-title">Incluido en los dos planes</h2>
          <ul>
            {INCLUIDO.map(item => {
              const Icon = item.icon

              return (
                <li key={item.title}>
                  <span className="hk-sub-included-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span>
                    <b>{item.title}</b>
                    <small>{item.text}</small>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <section className="hk-sub-faq" aria-labelledby="hk-sub-faq-title">
        <div className="hk-sub-wrap hk-sub-faq-wrap">
          <h2 id="hk-sub-faq-title">Antes de elegir</h2>
          <div>
            {PREGUNTAS.map(item => (
              <details key={item.pregunta}>
                <summary>
                  <span>{item.pregunta}</span>
                  <DownOutlined aria-hidden="true" />
                </summary>
                <p>{item.respuesta}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="hk-sub-foot">
        <div className="hk-sub-wrap">
          <LockOutlined aria-hidden="true" />
          <span>Tu tarjeta se procesa directamente con Mercado Pago.</span>
        </div>
      </footer>
    </main>
  )
}

export default SubscriptionPage
