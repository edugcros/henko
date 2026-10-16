import React, { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet'
import { env } from '../config/env'
import { buildAdminUrl, SUBSCRIPTION_PATH } from '../Utils/adminUrl'
import './PlatformLanding.css'

const PLAN_INFO = {
  starter: {
    name: 'Emprendedor',
    description: 'Todo lo esencial para comenzar a vender con tu propia tienda.',
    features: [
      'Hasta 100 productos',
      'Dominio personalizado',
      'Estadísticas esenciales',
      'Soporte por correo electrónico',
    ],
  },
  pro: {
    name: 'Profesional',
    description: 'Más herramientas para una operación comercial en crecimiento.',
    features: [
      'Productos ilimitados',
      'Analizador de productos con IA',
      'Múltiples administradores',
      'Reportes avanzados',
      'Soporte prioritario',
    ],
  },
}

const FEATURES = [
  {
    icon: 'store',
    eyebrow: 'Tu marca',
    title: 'Una tienda que se siente tuya',
    description:
      'Personalizá la identidad visual y la presentación de tus productos para ofrecer una experiencia coherente con tu negocio.',
  },
  {
    icon: 'box',
    eyebrow: 'Tu catálogo',
    title: 'Productos y pedidos en orden',
    description:
      'Administrá productos, categorías, variantes y pedidos desde un panel pensado para el trabajo cotidiano.',
  },
  {
    icon: 'credit',
    eyebrow: 'Tus ventas',
    title: 'Un checkout preparado para cobrar',
    description:
      'Configurá los medios de pago compatibles, incluida la integración de Mercado Pago, según las condiciones de tu cuenta.',
  },
  {
    icon: 'chart',
    eyebrow: 'Tu operación',
    title: 'Datos para decidir mejor',
    description:
      'Consultá métricas comerciales y reportes para entender la actividad de tu tienda y detectar oportunidades.',
  },
  {
    icon: 'promo',
    eyebrow: 'Tu marketing',
    title: 'Promociones donde importan',
    description:
      'Organizá bloques promocionales y herramientas de catálogo para destacar productos y campañas.',
  },
  {
    icon: 'spark',
    eyebrow: 'Funciones inteligentes',
    title: 'Herramientas que acompañan tu crecimiento',
    description:
      'Accedé a capacidades de análisis asistido por IA en los planes que las incluyen, sin prometer resultados automáticos.',
  },
]

const normalizePlansResponse = payload => {
  const rows = payload?.data?.plans

  if (payload?.success !== true || !Array.isArray(rows)) {
    throw new Error('Formato de catálogo de planes inválido')
  }

  return rows.reduce((prices, row) => {
    if (!['starter', 'pro'].includes(row?.plan)) return prices

    const value = row.monthlyPriceArs
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
      const price = Number(value)
      if (price > 0) prices[row.plan] = price
    }

    return prices
  }, {})
}

const formatArs = value =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)

const Icon = ({ name, size = 22 }) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    focusable: 'false',
    'aria-hidden': true,
  }

  if (name === 'store') {
    return (
      <svg {...common}>
        <path d="M3 10.5 4.5 4h15L21 10.5" />
        <path d="M4 10.5v9h16v-9" />
        <path d="M3 10.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
        <path d="M9 19.5v-5h6v5" />
      </svg>
    )
  }

  if (name === 'box') {
    return (
      <svg {...common}>
        <path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Z" />
        <path d="m3.3 7.7 8.7 4.5 8.7-4.5M12 12.2V21" />
        <path d="m7.5 5.3 9 4.7" />
      </svg>
    )
  }

  if (name === 'credit') {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M3 10h18M7 15h3" />
      </svg>
    )
  }

  if (name === 'chart') {
    return (
      <svg {...common}>
        <path d="M4 19V5M4 19h17" />
        <path d="m7 15 4-4 3 2 5-6" />
        <path d="M16 7h3v3" />
      </svg>
    )
  }

  if (name === 'promo') {
    return (
      <svg {...common}>
        <path d="M4 14.5V9.2a1.7 1.7 0 0 1 1.7-1.7H9l7-3v14l-7-3H5.7A1.7 1.7 0 0 1 4 14.5Z" />
        <path d="m8 15.5 1.5 4h3l-2-4M19 9l2-1M19 15l2 1" />
      </svg>
    )
  }

  if (name === 'spark') {
    return (
      <svg {...common}>
        <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
        <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
      </svg>
    )
  }

  if (name === 'check') {
    return (
      <svg {...common}>
        <path d="m5 12.5 4.2 4.2L19 7" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

const PlatformLanding = () => {
  const subscriptionsUrl = useMemo(() => buildAdminUrl(SUBSCRIPTION_PATH), [])
  const loginUrl = useMemo(() => buildAdminUrl('/login'), [])
  const [pricing, setPricing] = useState({ status: 'loading', prices: {} })

  useEffect(() => {
    const controller = new AbortController()
    const apiBase = String(env.apiBaseUrl || '').trim().replace(/\/+$/, '')

    if (!apiBase) {
      setPricing({ status: 'unavailable', prices: {} })
      return () => controller.abort()
    }

    fetch(apiBase + '/subscriptions/plans', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) throw new Error('No se pudo consultar el catálogo')
        return response.json()
      })
      .then(payload => {
        const prices = normalizePlansResponse(payload)
        setPricing({ status: 'ready', prices })
      })
      .catch(error => {
        if (error?.name === 'AbortError') return
        setPricing({ status: 'unavailable', prices: {} })
      })

    return () => controller.abort()
  }, [])

  const pricingLabel = planId => {
    if (pricing.status === 'loading') return 'Consultando…'

    const amount = pricing.prices[planId]
    return amount ? formatArs(amount) : 'Consultar precio'
  }

  const pricingCaption = planId => {
    if (pricing.status === 'loading') return 'Cargando precio vigente'
    return pricing.prices[planId] ? 'por mes · pesos argentinos' : 'Precio vigente en el panel'
  }

  return (
    <div className="hk-landing">
      <Helmet>
        <html lang="es-AR" />
        <title>Henkart | Tu tienda online, lista para crecer</title>
        <meta
          name="description"
          content="Creá y administrá tu tienda online con Henkart: catálogo, pedidos, pagos, promociones y métricas desde una plataforma preparada para crecer."
        />
        <meta property="og:title" content="Henkart | Tu tienda online, lista para crecer" />
        <meta
          property="og:description"
          content="Todo lo esencial para crear tu tienda online y gestionar tu negocio desde un solo lugar."
        />
        <meta property="og:type" content="website" />
      </Helmet>

      <header className="hk-header">
        <div className="hk-container hk-nav">
          <a className="hk-brand" href="#inicio" aria-label="Henkart, inicio">
            <span className="hk-brand-mark" aria-hidden="true">h</span>
            <span>henk<span className="hk-brand-accent">art</span></span>
          </a>

          <nav className="hk-desktop-nav" aria-label="Navegación principal">
            <a href="#plataforma">Plataforma</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#planes">Planes</a>
            <a href="#preguntas">Preguntas</a>
          </nav>

          <div className="hk-nav-actions">
            <a className="hk-login" href={loginUrl}>Ingresar</a>
            <a className="hk-button hk-button-small" href={subscriptionsUrl}>
              Crear mi tienda <Icon name="arrow" size={16} />
            </a>
          </div>

          <details className="hk-mobile-menu">
            <summary aria-label="Abrir navegación">Menú <span aria-hidden="true">+</span></summary>
            <nav aria-label="Navegación móvil">
              <a href="#plataforma">Plataforma</a>
              <a href="#como-funciona">Cómo funciona</a>
              <a href="#planes">Planes</a>
              <a href="#preguntas">Preguntas frecuentes</a>
              <a href={loginUrl}>Ingresar al panel</a>
            </nav>
          </details>
        </div>
      </header>

      <main id="inicio">
        <section className="hk-hero">
          <div className="hk-container hk-hero-grid">
            <div className="hk-hero-copy">
              <div className="hk-eyebrow">
                <span className="hk-eyebrow-dot" />
                Comercio online, sin dar vueltas
              </div>
              <h1>Tu negocio merece una tienda <span>que crezca con vos.</span></h1>
              <p className="hk-hero-description">
                Creá tu tienda online, mostrale al mundo tu marca y organizá tus ventas
                desde un mismo lugar. La tecnología acompaña; vos te enfocás en tu negocio.
              </p>

              <div className="hk-hero-actions">
                <a className="hk-button hk-button-primary" href={subscriptionsUrl}>
                  Ver planes y empezar <Icon name="arrow" size={18} />
                </a>
                <a className="hk-button hk-button-quiet" href="#plataforma">
                  Conocer la plataforma
                </a>
              </div>

              <div className="hk-hero-notes" aria-label="Capacidades principales">
                <span><Icon name="check" size={16} /> Catálogo y pedidos</span>
                <span><Icon name="check" size={16} /> Gestión desde un panel</span>
                <span><Icon name="check" size={16} /> Planes claros</span>
              </div>
            </div>

            <div className="hk-hero-visual" aria-label="Vista ilustrativa del panel de Henkart">
              <div className="hk-orbit hk-orbit-one" />
              <div className="hk-orbit hk-orbit-two" />
              <div className="hk-float-card hk-float-card-top">
                <span className="hk-float-icon"><Icon name="box" size={18} /></span>
                <span><strong>Tu catálogo</strong><small>Productos organizados</small></span>
                <span className="hk-float-check"><Icon name="check" size={14} /></span>
              </div>

              <div className="hk-dashboard">
                <div className="hk-dashboard-top">
                  <div className="hk-dashboard-brand">
                    <span className="hk-mini-mark">h</span>
                    <span>Panel de tu tienda</span>
                  </div>
                  <span className="hk-status-pill"><span /> Panel ilustrativo</span>
                </div>

                <div className="hk-dashboard-body">
                  <aside className="hk-dashboard-sidebar" aria-hidden="true">
                    <span className="hk-side-item hk-side-active"><i>⌂</i></span>
                    <span className="hk-side-item"><i>▦</i></span>
                    <span className="hk-side-item"><i>▤</i></span>
                    <span className="hk-side-item"><i>◷</i></span>
                    <span className="hk-side-item"><i>⚙</i></span>
                  </aside>

                  <div className="hk-dashboard-content">
                    <div className="hk-dashboard-heading">
                      <div>
                        <small>RESUMEN DEL NEGOCIO</small>
                        <h2>Todo en un solo lugar</h2>
                      </div>
                      <span className="hk-avatar">T</span>
                    </div>

                    <div className="hk-stat-grid">
                      <div className="hk-stat-card">
                        <span>Productos</span>
                        <strong>Catálogo</strong>
                        <small><i className="hk-positive-dot" /> Fácil de administrar</small>
                      </div>
                      <div className="hk-stat-card">
                        <span>Pedidos</span>
                        <strong>En gestión</strong>
                        <small><i className="hk-blue-dot" /> Seguimiento centralizado</small>
                      </div>
                    </div>

                    <div className="hk-chart-card">
                      <div className="hk-chart-title">
                        <span>Actividad de la tienda</span>
                        <small>Vista de ejemplo</small>
                      </div>
                      <svg className="hk-chart" viewBox="0 0 340 104" role="img" aria-label="Gráfico ilustrativo de actividad">
                        <defs>
                          <linearGradient id="hk-chart-fill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="#b8ef6a" stopOpacity=".38" />
                            <stop offset="100%" stopColor="#b8ef6a" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d="M0 80H340M0 54H340M0 28H340" stroke="#e8eee9" strokeDasharray="4 5" />
                        <path d="M0 83 C24 75 28 58 50 63 S76 73 94 54 S123 59 145 43 S178 55 199 37 S231 44 253 24 S286 40 308 17 S328 22 340 9 L340 104 L0 104 Z" fill="url(#hk-chart-fill)" />
                        <path d="M0 83 C24 75 28 58 50 63 S76 73 94 54 S123 59 145 43 S178 55 199 37 S231 44 253 24 S286 40 308 17 S328 22 340 9" fill="none" stroke="#39865f" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    </div>

                    <div className="hk-dashboard-footer">
                      <span><i /> Productos</span>
                      <span><i /> Pedidos</span>
                      <span><i /> Métricas</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="hk-float-card hk-float-card-bottom">
                <span className="hk-payment-mark">✓</span>
                <span><strong>Una operación más clara</strong><small>Tu tienda, tu catálogo y tus pedidos</small></span>
              </div>
              <p className="hk-visual-caption">Interfaz ilustrativa. No representa datos reales de ventas.</p>
            </div>
          </div>
        </section>

        <section className="hk-trust-strip" aria-label="Áreas de la plataforma">
          <div className="hk-container hk-trust-inner">
            <span>Una plataforma para gestionar</span>
            <strong><Icon name="store" size={17} /> Tu tienda</strong>
            <strong><Icon name="box" size={17} /> Tu catálogo</strong>
            <strong><Icon name="credit" size={17} /> Tus pagos</strong>
            <strong><Icon name="chart" size={17} /> Tus métricas</strong>
          </div>
        </section>

        <section id="plataforma" className="hk-section hk-features-section">
          <div className="hk-container">
            <div className="hk-section-heading">
              <span className="hk-section-kicker">La plataforma</span>
              <h2>Menos herramientas dispersas.<br /><span>Más claridad para vender.</span></h2>
              <p>
                Lo esencial del comercio online reunido en un entorno que podés administrar
                sin depender de una operación técnica para cada cambio cotidiano.
              </p>
            </div>

            <div className="hk-feature-grid">
              {FEATURES.map((feature, index) => (
                <article className="hk-feature-card" key={feature.title}>
                  <div className={'hk-feature-icon hk-feature-icon-' + (index + 1)}>
                    <Icon name={feature.icon} size={23} />
                  </div>
                  <span className="hk-feature-eyebrow">{feature.eyebrow}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="hk-management-section">
          <div className="hk-container hk-management-grid">
            <div className="hk-management-visual">
              <div className="hk-products-window">
                <div className="hk-products-window-top">
                  <span className="hk-window-dot" />
                  <span className="hk-window-dot" />
                  <span className="hk-window-dot" />
                  <span className="hk-window-label">Catálogo de productos</span>
                </div>
                <div className="hk-products-content">
                  <div className="hk-products-heading">
                    <div><small>GESTIÓN DE TIENDA</small><h3>Tu catálogo, a mano</h3></div>
                    <span className="hk-filter-chip">Categorías</span>
                  </div>
                  <div className="hk-product-row">
                    <div className="hk-product-art hk-art-one"><span>01</span></div>
                    <div className="hk-product-info"><strong>Producto destacado</strong><small>Descripción y variantes</small></div>
                    <span className="hk-product-tag">Publicado</span>
                  </div>
                  <div className="hk-product-row">
                    <div className="hk-product-art hk-art-two"><span>02</span></div>
                    <div className="hk-product-info"><strong>Nuevo lanzamiento</strong><small>Precio y disponibilidad</small></div>
                    <span className="hk-product-tag">Publicado</span>
                  </div>
                  <div className="hk-product-row">
                    <div className="hk-product-art hk-art-three"><span>03</span></div>
                    <div className="hk-product-info"><strong>Colección especial</strong><small>Organizado por categoría</small></div>
                    <span className="hk-product-tag hk-tag-muted">Borrador</span>
                  </div>
                </div>
              </div>
              <div className="hk-side-note">
                <span className="hk-side-note-icon"><Icon name="spark" size={19} /></span>
                <span><strong>Preparada para evolucionar</strong><small>Sumá capacidades a medida que las necesites.</small></span>
              </div>
            </div>

            <div className="hk-management-copy">
              <span className="hk-section-kicker">Para el día a día</span>
              <h2>Administrá tu negocio con una visión más completa.</h2>
              <p>
                Desde la presentación de tus productos hasta el seguimiento de pedidos y la
                revisión de la actividad, Henkart te ayuda a darle estructura a la operación.
              </p>
              <ul className="hk-check-list">
                <li><Icon name="check" size={18} /> Configuración visual para tu marca</li>
                <li><Icon name="check" size={18} /> Categorías, productos y variantes</li>
                <li><Icon name="check" size={18} /> Promociones y herramientas de catálogo</li>
                <li><Icon name="check" size={18} /> Métricas para acompañar tus decisiones</li>
              </ul>
              <a className="hk-text-link" href={subscriptionsUrl}>Conocé los planes <Icon name="arrow" size={17} /></a>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="hk-section hk-steps-section">
          <div className="hk-container">
            <div className="hk-section-heading hk-centered">
              <span className="hk-section-kicker">Empezá en tres pasos</span>
              <h2>De la idea a tu tienda online.</h2>
              <p>Un recorrido claro para poner tu negocio en marcha.</p>
            </div>
            <div className="hk-steps-grid">
              <article className="hk-step">
                <span className="hk-step-number">01</span>
                <div className="hk-step-line" />
                <h3>Elegí tu plan</h3>
                <p>Compará las opciones y seleccioná la que se adapte al momento de tu negocio.</p>
              </article>
              <article className="hk-step">
                <span className="hk-step-number">02</span>
                <div className="hk-step-line" />
                <h3>Creá tu comercio</h3>
                <p>Registrá tus datos, verificá tu correo y entrá al panel de administración.</p>
              </article>
              <article className="hk-step">
                <span className="hk-step-number">03</span>
                <div className="hk-step-line" />
                <h3>Prepará tu tienda</h3>
                <p>Configurá tu marca, cargá productos y revisá los ajustes antes de empezar a vender.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="planes" className="hk-pricing-section">
          <div className="hk-container">
            <div className="hk-section-heading hk-centered">
              <span className="hk-section-kicker">Planes de Henkart</span>
              <h2>Elegí la base para tu próximo paso.</h2>
              <p>
                Precios consultados desde el catálogo de la plataforma. Si no se pueden cargar,
                no mostramos importes estimados.
              </p>
            </div>

            {pricing.status === 'unavailable' && (
              <p className="hk-price-notice" role="status">
                No pudimos consultar los precios en este momento. Podés abrir el catálogo actualizado desde el panel.
              </p>
            )}

            <div className="hk-pricing-grid">
              {Object.keys(PLAN_INFO).map(planId => {
                const plan = PLAN_INFO[planId]
                const price = pricing.prices[planId]
                const featured = planId === 'pro'

                return (
                  <article className={'hk-plan-card' + (featured ? ' hk-plan-featured' : '')} key={planId}>
                    {featured && <div className="hk-plan-ribbon">Para crecer</div>}
                    <span className="hk-plan-overline">{featured ? 'MÁS CAPACIDAD' : 'PARA EMPEZAR'}</span>
                    <h3>{plan.name}</h3>
                    <p className="hk-plan-description">{plan.description}</p>
                    <div className="hk-plan-price">
                      <strong>{price ? formatArs(price) : pricingLabel(planId)}</strong>
                      <span>{pricingCaption(planId)}</span>
                    </div>
                    <a
                      className={'hk-button hk-plan-button' + (featured ? ' hk-button-primary' : ' hk-button-outline')}
                      href={subscriptionsUrl}
                      aria-label={'Ver planes y elegir ' + plan.name}
                    >
                      Ver plan y contratar <Icon name="arrow" size={17} />
                    </a>
                    <div className="hk-plan-divider" />
                    <span className="hk-plan-features-label">Incluye</span>
                    <ul className="hk-plan-features">
                      {plan.features.map(feature => (
                        <li key={feature}><Icon name="check" size={17} /> {feature}</li>
                      ))}
                    </ul>
                  </article>
                )
              })}
            </div>
            <p className="hk-pricing-footnote">
              Los importes definitivos y la disponibilidad de cada plan se confirman en el catálogo de contratación.
            </p>
          </div>
        </section>

        <section className="hk-faq-section" id="preguntas">
          <div className="hk-container hk-faq-grid">
            <div className="hk-faq-intro">
              <span className="hk-section-kicker">Preguntas frecuentes</span>
              <h2>Lo importante, antes de empezar.</h2>
              <p>Información útil para dar el primer paso con tranquilidad.</p>
              <a className="hk-text-link" href={subscriptionsUrl}>Ir a planes y precios <Icon name="arrow" size={17} /></a>
            </div>
            <div className="hk-faq-list">
              <details>
                <summary>¿Cómo empiezo a contratar Henkart?<span aria-hidden="true">+</span></summary>
                <p>Entrá a planes, elegí una opción y seguí el flujo de registro y contratación. Para completar el alta puede ser necesario verificar tu correo y acceder al panel.</p>
              </details>
              <details>
                <summary>¿Puedo personalizar mi tienda?<span aria-hidden="true">+</span></summary>
                <p>La plataforma incluye herramientas para configurar el tema y la presentación de tu tienda. Las opciones disponibles pueden variar según la configuración y el plan.</p>
              </details>
              <details>
                <summary>¿Henkart incluye pagos online?<span aria-hidden="true">+</span></summary>
                <p>El sistema contempla integración con Mercado Pago. Para cobrar, tendrás que configurar y verificar las credenciales de tu propio comercio y cumplir las condiciones del proveedor.</p>
              </details>
              <details>
                <summary>¿Los precios que aparecen están actualizados?<span aria-hidden="true">+</span></summary>
                <p>La landing consulta el catálogo público de planes de Henkart. La pantalla de contratación del panel es la referencia final; si el servicio de precios no responde, la landing no inventa importes.</p>
              </details>
              <details>
                <summary>¿Las funciones de IA están en todos los planes?<span aria-hidden="true">+</span></summary>
                <p>No necesariamente. Algunas herramientas inteligentes dependen del plan contratado y de la configuración activa del comercio.</p>
              </details>
            </div>
          </div>
        </section>

        <section className="hk-final-cta">
          <div className="hk-container hk-final-cta-inner">
            <div>
              <span className="hk-final-kicker">Tu próximo paso empieza acá</span>
              <h2>Hacé lugar para tu próxima etapa.</h2>
              <p>Elegí un plan y empezá a darle forma a tu tienda online.</p>
            </div>
            <a className="hk-button hk-button-light" href={subscriptionsUrl}>
              Empezar con Henkart <Icon name="arrow" size={18} />
            </a>
          </div>
        </section>
      </main>

      <footer className="hk-footer">
        <div className="hk-container hk-footer-inner">
          <a className="hk-brand hk-footer-brand" href="#inicio" aria-label="Henkart, volver al inicio">
            <span className="hk-brand-mark" aria-hidden="true">h</span>
            <span>henk<span className="hk-brand-accent">art</span></span>
          </a>
          <p>Una plataforma para organizar tu tienda y acompañar tu crecimiento.</p>
          <div className="hk-footer-links">
            <a href="#plataforma">Plataforma</a>
            <a href="#planes">Planes</a>
            <a href="#preguntas">Preguntas frecuentes</a>
            <a href={loginUrl}>Ingresar</a>
          </div>
          <small>© {new Date().getFullYear()} Henkart. Todos los derechos reservados.</small>
        </div>
      </footer>
    </div>
  )
}

export default PlatformLanding
