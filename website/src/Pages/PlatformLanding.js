import React, { useMemo, useState } from 'react'
import {
  FiArrowRight,
  FiBarChart2,
  FiCheck,
  FiChevronDown,
  FiCreditCard,
  FiGlobe,
  FiLayers,
  FiMenu,
  FiPackage,
  FiSliders,
  FiShoppingBag,
  FiSmartphone,
  FiTrendingUp,
  FiX,
  FiZap,
} from 'react-icons/fi'

import Meta from '@components/Meta'
import { buildAdminUrl, SUBSCRIPTION_PATH } from '@utils/adminUrl'

import './PlatformLanding.css'

const features = [
  {
    icon: FiShoppingBag,
    eyebrow: 'TU VIDRIERA',
    title: 'Una tienda que lleva tu marca',
    description:
      'Mostrá tus productos con una experiencia de compra clara, una identidad propia y un diseño que puedas adaptar a tu negocio.',
  },
  {
    icon: FiPackage,
    eyebrow: 'CATÁLOGO',
    title: 'Productos y stock bajo control',
    description:
      'Organizá tu catálogo, categorías, variantes y disponibilidad desde un solo panel, sin depender de planillas dispersas.',
  },
  {
    icon: FiLayers,
    eyebrow: 'OPERACIÓN',
    title: 'Pedidos, clientes y gestión',
    description:
      'Centralizá el trabajo diario de tu tienda y encontrá la información importante sin saltar entre herramientas.',
  },
  {
    icon: FiCreditCard,
    eyebrow: 'COBROS',
    title: 'Configurá tus medios de pago',
    description:
      'Conectá Mercado Pago con la configuración de tu comercio y administrá la integración desde el panel.',
  },
  {
    icon: FiSliders,
    eyebrow: 'PERSONALIZACIÓN',
    title: 'Diseñá una tienda a tu estilo',
    description:
      'Adaptá colores, secciones y contenido para que tu tienda no parezca una copia de cualquier otra.',
  },
  {
    icon: FiBarChart2,
    eyebrow: 'VISIBILIDAD',
    title: 'Información para decidir mejor',
    description:
      'Consultá estadísticas de la operación y usá los datos disponibles para entender cómo se mueve tu negocio.',
  },
]

const steps = [
  {
    number: '01',
    title: 'Creá tu cuenta y tu tienda',
    description:
      'Completá los datos de tu negocio y elegí el identificador con el que vas a presentar tu tienda.',
  },
  {
    number: '02',
    title: 'Armá tu catálogo y tu imagen',
    description:
      'Cargá productos, ordená las categorías y personalizá el diseño desde el panel administrativo.',
  },
  {
    number: '03',
    title: 'Configurá y empezá a vender',
    description:
      'Revisá los medios de pago y la información de tu tienda antes de compartirla con tus clientes.',
  },
]

const questions = [
  {
    question: '¿Necesito saber programación para usar Henkart?',
    answer:
      'No para las tareas habituales de tu comercio. La gestión del catálogo, los pedidos y la personalización disponible se realiza desde el panel administrativo.',
  },
  {
    question: '¿Puedo usar mi propio dominio?',
    answer:
      'La plataforma contempla dominios de tienda y dominios personalizados. La configuración y los requisitos dependen del dominio que quieras conectar.',
  },
  {
    question: '¿Cómo elijo un plan?',
    answer:
      'Entrá a “Ver planes y precios”. Los valores se cargan desde el catálogo de suscripciones vigente y podés continuar con el alta desde allí.',
  },
  {
    question: '¿Las herramientas de IA están incluidas en todas las tiendas?',
    answer:
      'Las funciones inteligentes dependen del plan, de la disponibilidad del servicio y de la configuración de cada comercio. No hace falta basar toda tu tienda en IA para administrar tu catálogo y tus ventas.',
  },
]

const DashboardPreview = () => (
  <div className="hk-dashboard" aria-label="Vista ilustrativa del panel de Henkart">
    <div className="hk-dashboard-topbar">
      <div className="hk-window-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="hk-dashboard-address">panel.henkart.com.ar</div>
      <div className="hk-dashboard-avatar" aria-hidden="true">
        M
      </div>
    </div>

    <div className="hk-dashboard-body">
      <aside className="hk-dashboard-sidebar" aria-hidden="true">
        <div className="hk-sidebar-brand">
          <span>h.</span>
        </div>
        <span className="hk-sidebar-icon is-active">
          <FiBarChart2 />
        </span>
        <span className="hk-sidebar-icon">
          <FiPackage />
        </span>
        <span className="hk-sidebar-icon">
          <FiShoppingBag />
        </span>
        <span className="hk-sidebar-icon">
          <FiLayers />
        </span>
        <span className="hk-sidebar-icon">
          <FiZap />
        </span>
      </aside>

      <div className="hk-dashboard-content">
        <div className="hk-dashboard-heading">
          <div>
            <span className="hk-dashboard-kicker">TU NEGOCIO, EN UN SOLO LUGAR</span>
            <h3>Panel general</h3>
          </div>
          <span className="hk-live-status">
            <i /> Tienda activa
          </span>
        </div>

        <div className="hk-metric-grid">
          <div className="hk-metric-card">
            <span>Pedidos</span>
            <strong>38</strong>
            <small>
              <FiTrendingUp /> Seguimiento simple
            </small>
          </div>
          <div className="hk-metric-card">
            <span>Productos</span>
            <strong>126</strong>
            <small>
              <FiPackage /> Catálogo organizado
            </small>
          </div>
          <div className="hk-metric-card hk-metric-card-accent">
            <span>Estado de tienda</span>
            <strong>Lista</strong>
            <small>
              <FiCheck /> Configuración visible
            </small>
          </div>
        </div>

        <div className="hk-dashboard-lower">
          <div className="hk-orders-card">
            <div className="hk-card-title">
              <div>
                <span>ACTIVIDAD</span>
                <h4>Últimos pedidos</h4>
              </div>
              <span className="hk-mini-dots">•••</span>
            </div>
            <div className="hk-order-row">
              <span className="hk-order-icon">
                <FiShoppingBag />
              </span>
              <div>
                <strong>Pedido #1048</strong>
                <small>Hace unos minutos</small>
              </div>
              <span className="hk-order-tag">Nuevo</span>
            </div>
            <div className="hk-order-row">
              <span className="hk-order-icon is-lilac">
                <FiPackage />
              </span>
              <div>
                <strong>Pedido #1047</strong>
                <small>Hoy</small>
              </div>
              <span className="hk-order-tag is-muted">En curso</span>
            </div>
            <div className="hk-order-row">
              <span className="hk-order-icon is-gold">
                <FiCreditCard />
              </span>
              <div>
                <strong>Pago confirmado</strong>
                <small>Hoy</small>
              </div>
              <span className="hk-order-tag">Registrado</span>
            </div>
          </div>
          <div className="hk-store-card">
            <div className="hk-store-card-head">
              <span>VISTA DE TU TIENDA</span>
              <FiGlobe aria-hidden="true" />
            </div>
            <div className="hk-store-visual">
              <div className="hk-store-visual-orb" />
              <span className="hk-store-label">NUEVA COLECCIÓN</span>
              <strong>
                Tu estilo.
                <br />
                Tu espacio.
              </strong>
              <span className="hk-store-visual-button">
                Explorar productos <FiArrowRight />
              </span>
            </div>
            <div className="hk-store-card-foot">
              <span /> Diseño adaptable a tu marca
            </div>
          </div>
        </div>
        <p className="hk-dashboard-caption">
          Maqueta ilustrativa · los datos y productos no son reales.
        </p>
      </div>
    </div>
  </div>
)

const PlatformLanding = () => {
  const [menuOpen, setMenuOpen] = useState(false)
  const plansUrl = useMemo(() => buildAdminUrl(SUBSCRIPTION_PATH), [])
  const signupUrl = useMemo(() => buildAdminUrl('/signup'), [])
  const loginUrl = useMemo(() => buildAdminUrl('/login'), [])

  const closeMenu = () => setMenuOpen(false)

  const navLinks = [
    { href: '#soluciones', label: 'La plataforma' },
    { href: '#como-funciona', label: 'Cómo funciona' },
    { href: '#preguntas', label: 'Preguntas frecuentes' },
  ]

  return (
    <div className="hk-landing">
      <Meta
        title="Henkart | Tu tienda online, a tu manera"
        description="Creá y administrá tu tienda online con Henkart. Catálogo, pedidos, medios de pago, diseño personalizable y herramientas para acompañar el crecimiento de tu negocio."
      />

      <div className="hk-announcement">
        <span className="hk-announcement-dot" aria-hidden="true" />
        Una plataforma para construir tu negocio online
        <a href="#soluciones">
          Conocé Henkart <FiArrowRight aria-hidden="true" />
        </a>
      </div>

      <header className="hk-site-header">
        <div className="hk-container hk-nav">
          <a className="hk-logo" href="#inicio" aria-label="Henkart, inicio" onClick={closeMenu}>
            <span className="hk-logo-mark">
              h<span>.</span>
            </span>
            <span className="hk-logo-word">henkart</span>
          </a>

          <nav className="hk-desktop-nav" aria-label="Navegación principal">
            {navLinks.map(link => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hk-nav-actions">
            <a className="hk-login-link" href={loginUrl}>
              Ingresar
            </a>
            <a className="hk-button hk-button-small" href={plansUrl}>
              Ver planes <FiArrowRight aria-hidden="true" />
            </a>
          </div>

          <button
            className="hk-mobile-menu-toggle"
            type="button"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={menuOpen}
            aria-controls="hk-mobile-navigation"
            onClick={() => setMenuOpen(open => !open)}
          >
            {menuOpen ? <FiX aria-hidden="true" /> : <FiMenu aria-hidden="true" />}
          </button>
        </div>

        {menuOpen && (
          <nav className="hk-mobile-nav" id="hk-mobile-navigation" aria-label="Navegación móvil">
            {navLinks.map(link => (
              <a key={link.href} href={link.href} onClick={closeMenu}>
                {link.label}
              </a>
            ))}
            <a href={loginUrl} onClick={closeMenu}>
              Ingresar al panel
            </a>
            <a href={plansUrl} className="hk-mobile-nav-cta" onClick={closeMenu}>
              Ver planes y precios
            </a>
          </nav>
        )}
      </header>

      <main>
        <section className="hk-hero" id="inicio">
          <div className="hk-hero-glow hk-hero-glow-one" aria-hidden="true" />
          <div className="hk-hero-glow hk-hero-glow-two" aria-hidden="true" />
          <div className="hk-container hk-hero-grid">
            <div className="hk-hero-copy">
              <div className="hk-eyebrow">
                <span /> E-COMMERCE PARA NEGOCIOS QUE QUIEREN CRECER
              </div>
              <h1>
                Tu tienda online.
                <br />
                <span>Tu marca. Tu manera.</span>
              </h1>
              <p className="hk-hero-lead">
                Creá una experiencia de compra propia y gestioná tu negocio desde un solo lugar.
                Henkart reúne las herramientas para vender online, ordenar tu operación y seguir
                creciendo.
              </p>

              <div className="hk-hero-actions">
                <a className="hk-button hk-button-primary" href={plansUrl}>
                  Crear mi tienda <FiArrowRight aria-hidden="true" />
                </a>
                <a className="hk-button hk-button-secondary" href="#soluciones">
                  Explorar la plataforma <FiArrowRight aria-hidden="true" />
                </a>
              </div>

              <div className="hk-hero-notes">
                <span>
                  <FiCheck aria-hidden="true" /> Administración desde un panel
                </span>
                <span>
                  <FiCheck aria-hidden="true" /> Diseño adaptable a tu marca
                </span>
                <span>
                  <FiCheck aria-hidden="true" /> Preparada para múltiples tiendas
                </span>
              </div>

              <div className="hk-hero-footnote">
                <span className="hk-footnote-icon">
                  <FiGlobe aria-hidden="true" />
                </span>
                <span>
                  <strong>Tu negocio, tu espacio digital.</strong>
                  <br />
                  La plataforma crece con las necesidades de tu comercio.
                </span>
              </div>
            </div>

            <div className="hk-hero-visual">
              <div className="hk-visual-orbit hk-visual-orbit-one" aria-hidden="true" />
              <div className="hk-visual-orbit hk-visual-orbit-two" aria-hidden="true" />
              <div className="hk-dashboard-badge">
                <span className="hk-badge-check">
                  <FiCheck aria-hidden="true" />
                </span>
                <span>
                  <strong>Todo conectado</strong>
                  <small>Tu operación, más clara</small>
                </span>
              </div>
              <DashboardPreview />
              <div className="hk-floating-note">
                <span className="hk-floating-note-icon">
                  <FiTrendingUp aria-hidden="true" />
                </span>
                <span>
                  <strong>Información para decidir</strong>
                  <small>Consultá la actividad de tu tienda</small>
                </span>
              </div>
            </div>
          </div>
          <div className="hk-container hk-hero-bottom">
            <span>HECHA PARA EL DÍA A DÍA DE TU NEGOCIO</span>
            <div className="hk-hero-bottom-divider" />
            <span>CATÁLOGO</span>
            <span>PEDIDOS</span>
            <span>DISEÑO</span>
            <span>MEDIOS DE PAGO</span>
          </div>
        </section>

        <section className="hk-value-strip" aria-label="Beneficios de Henkart">
          <div className="hk-container hk-value-strip-inner">
            <div>
              <span className="hk-value-icon">
                <FiLayers aria-hidden="true" />
              </span>
              <span>
                <strong>Todo más organizado</strong>
                <small>Catálogo y operación en un mismo panel</small>
              </span>
            </div>
            <div>
              <span className="hk-value-icon">
                <FiSmartphone aria-hidden="true" />
              </span>
              <span>
                <strong>Experiencia adaptable</strong>
                <small>Tu tienda acompaña a tus clientes</small>
              </span>
            </div>
            <div>
              <span className="hk-value-icon">
                <FiZap aria-hidden="true" />
              </span>
              <span>
                <strong>Herramientas que evolucionan</strong>
                <small>Funciones según plan y configuración</small>
              </span>
            </div>
          </div>
        </section>

        <section className="hk-section hk-solutions" id="soluciones">
          <div className="hk-container">
            <div className="hk-section-heading">
              <span className="hk-section-eyebrow">UNA PLATAFORMA, MUCHAS POSIBILIDADES</span>
              <h2>
                Lo necesario para vender.
                <br />
                <span>Y para hacerlo crecer.</span>
              </h2>
              <p>
                Tu tienda no es solo una vidriera. También es catálogo, pedidos, pagos y decisiones
                de todos los días.
              </p>
            </div>

            <div className="hk-feature-grid">
              {features.map(feature => {
                const Icon = feature.icon

                // Fail closed instead of crashing the entire public landing if a
                // future feature is configured with an unavailable icon component.
                if (typeof Icon !== 'function') {
                  console.error('[PlatformLanding] Icono de feature inválido:', feature.title)
                  return null
                }

                return (
                  <article className="hk-feature-card" key={feature.title}>
                    <div className="hk-feature-icon">
                      <Icon aria-hidden="true" />
                    </div>
                    <span className="hk-feature-eyebrow">{feature.eyebrow}</span>
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                    <a href={plansUrl} aria-label={'Conocer planes para: ' + feature.title}>
                      Conocer más <FiArrowRight aria-hidden="true" />
                    </a>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section className="hk-showcase">
          <div className="hk-container hk-showcase-grid">
            <div className="hk-showcase-visual">
              <div className="hk-showcase-card hk-showcase-card-back">
                <span className="hk-showcase-sticker">
                  <FiCheck aria-hidden="true" /> Catálogo organizado
                </span>
                <div className="hk-showcase-product-grid">
                  <div className="hk-showcase-product hk-product-one">
                    <span>01</span>
                    <i />
                  </div>
                  <div className="hk-showcase-product hk-product-two">
                    <span>02</span>
                    <i />
                  </div>
                  <div className="hk-showcase-product hk-product-three">
                    <span>03</span>
                    <i />
                  </div>
                </div>
                <div className="hk-showcase-product-footer">
                  <span>Productos destacados</span>
                  <span>
                    Ver catálogo <FiArrowRight />
                  </span>
                </div>
              </div>
              <div className="hk-showcase-insight">
                <span className="hk-insight-icon">
                  <FiBarChart2 aria-hidden="true" />
                </span>
                <span>
                  <strong>Una mirada más clara</strong>
                  <small>La actividad de tu tienda, a mano</small>
                </span>
              </div>
            </div>

            <div className="hk-showcase-copy">
              <span className="hk-section-eyebrow">MÁS CONTROL, MENOS FRICCIÓN</span>
              <h2>
                Vos te ocupás de tu negocio.
                <br />
                <span>Henkart ordena las herramientas.</span>
              </h2>
              <p>
                Pasá de gestionar tareas sueltas a trabajar desde un espacio pensado para la
                operación de una tienda: mantené el catálogo, revisá pedidos, adaptá la imagen y
                consultá la información disponible sin perder de vista el conjunto.
              </p>
              <ul className="hk-check-list">
                <li>
                  <FiCheck aria-hidden="true" /> Administrá productos, categorías y variantes.
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> Personalizá la experiencia y las secciones de tu
                  tienda.
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> Configurá medios de pago desde el área
                  administrativa.
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> Accedé a estadísticas y herramientas habilitadas
                  para tu plan.
                </li>
              </ul>
              <a className="hk-text-link" href={plansUrl}>
                Conocer planes y funcionalidades <FiArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="hk-section hk-steps-section" id="como-funciona">
          <div className="hk-container">
            <div className="hk-section-heading hk-centered-heading">
              <span className="hk-section-eyebrow">EMPEZÁ EN TRES PASOS</span>
              <h2>
                De la idea a tu tienda.
                <br />
                <span>Con un camino claro.</span>
              </h2>
              <p>Un proceso simple para preparar tu comercio y avanzar a tu ritmo.</p>
            </div>

            <div className="hk-steps-grid">
              {steps.map(step => (
                <article className="hk-step-card" key={step.number}>
                  <span className="hk-step-number">{step.number}</span>
                  <div className="hk-step-line" aria-hidden="true" />
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </article>
              ))}
            </div>
            <div className="hk-steps-cta">
              <a className="hk-button hk-button-primary" href={plansUrl}>
                Elegir un plan <FiArrowRight aria-hidden="true" />
              </a>
              <span>Podés revisar los planes y precios vigentes antes de comenzar.</span>
            </div>
          </div>
        </section>

        <section className="hk-smart-section">
          <div className="hk-container hk-smart-card">
            <div className="hk-smart-graphic" aria-hidden="true">
              <div className="hk-smart-ring hk-smart-ring-one" />
              <div className="hk-smart-ring hk-smart-ring-two" />
              <div className="hk-smart-center">
                <FiZap />
              </div>
              <span className="hk-smart-node hk-smart-node-one">
                <FiPackage />
              </span>
              <span className="hk-smart-node hk-smart-node-two">
                <FiBarChart2 />
              </span>
              <span className="hk-smart-node hk-smart-node-three">
                <FiShoppingBag />
              </span>
            </div>
            <div className="hk-smart-copy">
              <span className="hk-smart-pill">
                <FiZap aria-hidden="true" /> HERRAMIENTAS INTELIGENTES
              </span>
              <h2>
                Tecnología que acompaña.
                <br />
                <span>Vos seguís al mando.</span>
              </h2>
              <p>
                Henkart incorpora herramientas inteligentes para tareas comerciales y de catálogo
                cuando están disponibles para tu plan y tu configuración. Son un apoyo para trabajar
                mejor, no una caja negra que decide por tu negocio.
              </p>
              <a className="hk-button hk-button-light" href={plansUrl}>
                Explorar funcionalidades <FiArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="hk-section hk-plan-section" id="planes">
          <div className="hk-container hk-plan-banner">
            <div>
              <span className="hk-section-eyebrow">TU PRÓXIMO PASO</span>
              <h2>
                Tu negocio merece
                <br />
                un lugar propio en internet.
              </h2>
              <p>
                Conocé las opciones disponibles y elegí la base que mejor se adapte a tu comercio.
              </p>
            </div>
            <div className="hk-plan-actions">
              <a className="hk-button hk-button-primary" href={plansUrl}>
                Ver planes y precios <FiArrowRight aria-hidden="true" />
              </a>
              <a className="hk-secondary-text-link" href={signupUrl}>
                Ya sé lo que necesito: crear mi tienda
              </a>
              <small>Los precios vigentes se consultan en la pantalla de suscripción.</small>
            </div>
            <div className="hk-plan-watermark" aria-hidden="true">
              h.
            </div>
          </div>
        </section>

        <section className="hk-section hk-faq-section" id="preguntas">
          <div className="hk-container hk-faq-layout">
            <div className="hk-faq-intro">
              <span className="hk-section-eyebrow">PREGUNTAS FRECUENTES</span>
              <h2>
                Antes de empezar,
                <br />
                <span>aclaramos lo importante.</span>
              </h2>
              <p>Revisá las respuestas rápidas o pasá directamente a conocer los planes.</p>
              <a className="hk-text-link" href={plansUrl}>
                Ir a planes y precios <FiArrowRight aria-hidden="true" />
              </a>
            </div>
            <div className="hk-faq-list">
              {questions.map(item => (
                <details className="hk-faq-item" key={item.question}>
                  <summary>
                    <span>{item.question}</span>
                    <FiChevronDown aria-hidden="true" />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="hk-final-cta" id="contacto">
          <div className="hk-container hk-final-cta-inner">
            <div>
              <span>EL COMIENZO DE ALGO PROPIO</span>
              <h2>
                Hacé lugar para
                <br />
                tu próxima etapa.
              </h2>
              <p>Tu tienda empieza con una decisión. El resto, paso a paso.</p>
            </div>
            <a className="hk-button hk-button-lime" href={plansUrl}>
              Empezar con Henkart <FiArrowRight aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="hk-footer">
        <div className="hk-container hk-footer-main">
          <div className="hk-footer-brand">
            <a
              className="hk-logo hk-logo-footer"
              href="#inicio"
              aria-label="Henkart, volver al inicio"
            >
              <span className="hk-logo-mark">
                h<span>.</span>
              </span>
              <span className="hk-logo-word">henkart</span>
            </a>
            <p>
              Herramientas claras para vender online y gestionar tu negocio con una visión más
              completa.
            </p>
          </div>
          <div className="hk-footer-links">
            <strong>Henkart</strong>
            <a href="#soluciones">La plataforma</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#preguntas">Preguntas frecuentes</a>
          </div>
          <div className="hk-footer-links">
            <strong>Tu tienda</strong>
            <a href={plansUrl}>Planes y precios</a>
            <a href={signupUrl}>Crear una tienda</a>
            <a href={loginUrl}>Ingresar al panel</a>
          </div>
        </div>
        <div className="hk-container hk-footer-bottom">
          <span>© {new Date().getFullYear()} Henkart. Todos los derechos reservados.</span>
          <span>Una plataforma para tu próximo paso.</span>
          <a href="#inicio">Volver arriba ↑</a>
        </div>
      </footer>
    </div>
  )
}

export default PlatformLanding
