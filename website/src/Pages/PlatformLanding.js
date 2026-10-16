import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  FiActivity,
  FiArrowRight,
  FiBarChart2,
  FiBookOpen,
  FiCamera,
  FiCheck,
  FiChevronDown,
  FiCreditCard,
  FiDollarSign,
  FiEdit3,
  FiEye,
  FiFileText,
  FiGlobe,
  FiHeart,
  FiImage,
  FiInbox,
  FiLayout,
  FiMail,
  FiMenu,
  FiMessageCircle,
  FiPackage,
  FiSearch,
  FiSend,
  FiShare2,
  FiShield,
  FiShoppingCart,
  FiTag,
  FiTruck,
  FiUserCheck,
  FiUsers,
  FiX,
  FiZap,
} from 'react-icons/fi'

import Meta from '@components/Meta'
import { buildAdminUrl, SUBSCRIPTION_PATH } from '@utils/adminUrl'
import { env } from '../config/env'

import './PlatformLanding.css'

// ─────────────────────────────────────────────────────────────────────────────
// CUÁNDO SE MUESTRA LA LANDING
//
// La landing se monta en el dominio raíz de Henkart. Pero ese dominio NO es solo
// marketing: el diseñador de tienda del admin carga su vista previa en un iframe de
// <dominio raíz>/theme-preview (admin.henkart.com.ar → henkart.com.ar), y esa ruta
// la sigue atendiendo la app del storefront.
//
// La decisión se tomaba solo por el hostname, sin mirar la ruta, así que desde que
// existe la landing el diseñador mostraba la landing en lugar de la tienda que se está
// diseñando: el iframe pedía /theme-preview, caía en el dominio raíz y se montaba la
// página de marketing antes de que el router pudiera intervenir.
//
// Es una función pura, sin window ni env, para poder probarla. index.js la llama.
// ─────────────────────────────────────────────────────────────────────────────
export const normalizeHostname = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')

// Rutas que la app sigue atendiendo en el dominio raíz. Comparación EXACTA, igual que
// App.js, TenantContext y StoreThemeContext, que también preguntan por este path.
const APP_PATHS_ON_PLATFORM_HOST = ['/theme-preview']

export const shouldRenderPlatformLanding = ({ hostname, pathname, platformDomain } = {}) => {
  const host = normalizeHostname(hostname)
  const platform = normalizeHostname(platformDomain)

  if (!host || !platform || host !== platform) return false

  return !APP_PATHS_ON_PLATFORM_HOST.includes(String(pathname || '/'))
}

// ─────────────────────────────────────────────────────────────────────────────
// MARCA
//
// El logo es el ORIGINAL de Henkart —carrito con la H, el nombre y el lema «Tu
// comercio, sin límites»—, no una versión dibujada con texto y CSS:
//
//   /logo-henkart.png  el logo horizontal original, con el fondo azul noche
//                      quitado para que se apoye sobre cualquier superficie oscura
//                      y optimizado (14 KB; el original pesa 1,4 MB)
//   /logo192.png       el ícono con marco, el mismo que usan el favicon y el
//                      manifest
//
// Las dimensiones salen de los atributos de <img>, para que la página no salte
// cuando carga la imagen. El logo está pensado para fondos oscuros: HEN es blanco.
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_RATIO = 443 / 132

const BrandLogo = ({ height = 52, className = '' }) => (
  <img
    className={`hk-logo-img ${className}`.trim()}
    src="/logo-henkart.png"
    alt="Henkart"
    width={Math.round(height * LOGO_RATIO)}
    height={height}
    decoding="async"
  />
)

// ─────────────────────────────────────────────────────────────────────────────
// CONTENIDO
//
// Todo lo que la landing afirma existe en el producto: sale del menú del panel,
// de los modelos del backend y del catálogo de planes. No hay testimonios, cifras
// de clientes ni integraciones con transportistas porque no existen.
// ─────────────────────────────────────────────────────────────────────────────
const NAV_LINKS = [
  { href: '#funciones', label: 'Funciones' },
  { href: '#productos-ia', label: 'Productos con IA' },
  { href: '#asistente', label: 'Asistente con IA' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#planes', label: 'Planes' },
  { href: '#preguntas', label: 'Preguntas' },
]

const TRUST = [
  {
    icon: FiCreditCard,
    title: 'Tu cuenta de Mercado Pago',
    text: 'Cobrás directo desde tu tienda',
  },
  { icon: FiGlobe, title: 'Tu propia dirección', text: 'Subdominio incluido y dominio propio' },
  { icon: FiZap, title: 'IA que trabaja con vos', text: 'Productos, ventas y análisis' },
  { icon: FiLayout, title: 'Todo en un panel', text: 'En español y pensado para vender' },
]

// Los cuatro verbos del logo —«CREA | VENDE | GESTIONA | CRECE»— son el eje de las
// funciones. Un ítem con `plan: 'pro'` figura en el plan Profesional del catálogo
// (admin/src/constants/plans.js); el resto no depende del plan.
const TABS = [
  {
    id: 'crea',
    verb: 'Creá',
    title: 'Una tienda que se ve como tu marca',
    text: 'Armala, personalizala y cargá tu catálogo sin tocar una línea de código.',
    visual: 'tienda',
    items: [
      {
        icon: FiLayout,
        title: 'Diseño a tu medida',
        text: 'Editá colores, encabezado, portada y secciones desde el panel.',
      },
      {
        icon: FiEdit3,
        title: 'Tu logo y tu identidad',
        text: 'Subí tu logo y dale a la tienda el estilo de tu marca.',
      },
      {
        icon: FiGlobe,
        title: 'Tu dirección en internet',
        text: 'Tu tienda sale con su subdominio de Henkart y podés conectar tu dominio.',
      },
      {
        icon: FiCamera,
        title: 'Fichas de producto con IA',
        text: 'Subí una o varias fotos y la IA completa la ficha: título, descripción, categoría, marca, atributos, etiquetas, SEO y precio sugerido.',
      },
      {
        icon: FiImage,
        title: 'Editor de imágenes',
        text: 'Mejorá las fotos del catálogo y generá fondos con IA.',
      },
      {
        icon: FiPackage,
        title: 'Catálogo con variantes',
        text: 'Categorías, variantes y SKU, con stock por cada variante.',
      },
    ],
  },
  {
    id: 'vende',
    verb: 'Vendé',
    title: 'Todo para cobrar y convertir',
    text: 'Un recorrido de compra claro y herramientas para que tus clientes vuelvan.',
    visual: 'checkout',
    items: [
      {
        icon: FiCreditCard,
        title: 'Cobros con Mercado Pago',
        text: 'Conectá tu propia cuenta y cobrale a tus clientes desde tu tienda.',
      },
      {
        icon: FiShoppingCart,
        title: 'Carrito y checkout',
        text: 'Un recorrido de compra simple, del carrito al pago.',
      },
      {
        icon: FiTag,
        title: 'Cupones y promociones',
        text: 'Creá descuentos para mover stock y fidelizar clientes.',
      },
      {
        icon: FiHeart,
        title: 'Favoritos y comparador',
        text: 'Tus clientes guardan productos y los comparan antes de decidir.',
      },
      {
        icon: FiMail,
        title: 'Carritos abandonados',
        text: 'Recordatorios por email y WhatsApp a quienes dejaron una compra a medias.',
      },
      {
        icon: FiShare2,
        title: 'Redes y Meta Pixel',
        text: 'Conectá tus redes sociales y medí tus campañas con Meta Pixel.',
      },
    ],
  },
  {
    id: 'gestiona',
    verb: 'Gestioná',
    title: 'Tu operación, bajo control',
    text: 'Pedidos, clientes y métricas en un solo lugar, sin saltar entre herramientas.',
    visual: 'pedido',
    items: [
      {
        icon: FiTruck,
        title: 'Pedidos con seguimiento',
        text: 'Preparando, listo para enviar, enviado y entregado, con transportista y número de seguimiento.',
      },
      {
        icon: FiUsers,
        title: 'Clientes y consultas',
        text: 'Consultá tus clientes y atendé sus consultas desde el panel.',
      },
      {
        icon: FiBarChart2,
        title: 'Panel con métricas',
        text: 'Mirá cómo viene tu tienda desde el dashboard.',
      },
      {
        icon: FiActivity,
        title: 'Reportes avanzados',
        text: 'Reportes más detallados para decidir con más información.',
        plan: 'pro',
      },
      {
        icon: FiUserCheck,
        title: 'Varios administradores',
        text: 'Sumá a tu equipo para trabajar juntos en el panel.',
        plan: 'pro',
      },
      {
        icon: FiFileText,
        title: 'Políticas de la tienda',
        text: 'Páginas de envíos, devoluciones, términos y privacidad.',
      },
    ],
  },
  {
    id: 'crece',
    verb: 'Crecé',
    title: 'Vendé más con ayuda de la IA',
    text: 'Herramientas inteligentes para atender, entender tu mercado y volver a contactar.',
    visual: 'mercado',
    items: [
      {
        icon: FiMessageCircle,
        title: 'Asistente de ventas',
        text: 'Responde consultas por WhatsApp y por el chat de tu tienda.',
      },
      {
        icon: FiBookOpen,
        title: 'Base de conocimiento',
        text: 'Cargá la información de tu negocio para que responda con tus reglas.',
      },
      {
        icon: FiShield,
        title: 'Aprende con tu aprobación',
        text: 'Podés pedir que todo lo que aprende pase primero por tu revisión.',
      },
      {
        icon: FiInbox,
        title: 'Bandeja y derivación',
        text: 'Ves las conversaciones y definís qué palabras pasan a una persona.',
      },
      {
        icon: FiSend,
        title: 'Campañas',
        text: 'Armá campañas para volver a contactar a tus clientes.',
      },
      {
        icon: FiSearch,
        title: 'Análisis de mercado',
        text: 'Estimá la demanda de tus productos con ayuda de IA.',
      },
    ],
  },
]

const STEPS = [
  {
    number: '01',
    title: 'Creá tu cuenta',
    text: 'Elegí tu plan, registrate y definí el nombre con el que vas a presentar tu tienda.',
  },
  {
    number: '02',
    title: 'Armá tu tienda',
    text: 'Subí tu logo, cargá tus productos y ajustá el diseño desde el panel.',
  },
  {
    number: '03',
    title: 'Vendé con Mercado Pago',
    text: 'Conectá tu cuenta, revisá tu tienda y compartí el link con tus clientes.',
  },
]

// Texto de producto de cada plan. Sale de admin/src/constants/plans.js: si esa
// lista cambia, esta tiene que cambiar con ella. El PRECIO y los CUPOS de IA no
// están acá a propósito: se leen en vivo del catálogo público del backend, que es
// lo único que tiene que coincidir con lo que se cobra.
const PLAN_CARDS = [
  {
    id: 'starter',
    name: 'Emprendedor',
    tagline: 'Las herramientas esenciales para poner en marcha una tienda.',
    features: [
      'Hasta 100 productos',
      'Dominio personalizado',
      'Panel de estadísticas esencial',
      'Soporte por correo electrónico',
    ],
  },
  {
    id: 'pro',
    name: 'Profesional',
    tagline: 'Automatización y capacidad para una operación en crecimiento.',
    featured: true,
    features: [
      'Productos ilimitados',
      'Múltiples administradores',
      'Reportes avanzados',
      'Soporte prioritario',
    ],
  },
]

const QUOTA_LINES = [
  ['vision', 'análisis de imágenes con IA'],
  ['agentMessages', 'mensajes del asistente de ventas'],
  ['imageEdits', 'fondos generados con IA'],
  ['marketAnalyses', 'análisis de mercado con IA'],
]

const FAQ = [
  {
    question: '¿Necesito saber programación para usar Henkart?',
    answer:
      'No. El catálogo, el diseño, los pedidos y los cobros se gestionan desde el panel administrativo, sin escribir código.',
  },
  {
    question: '¿Cómo funciona la carga de productos con IA?',
    answer:
      'Subís una o varias fotos de tus productos y la IA completa la ficha: título, descripción, categoría y subcategoría, marca, material, color, atributos, etiquetas, título y descripción para buscadores, y un precio sugerido. El producto queda como borrador: lo revisás, lo corregís y lo publicás. Los cupos de análisis de imágenes dependen del plan.',
  },
  {
    question: '¿Puedo usar mi propio dominio?',
    answer:
      'Sí. Tu tienda sale con un subdominio de Henkart y podés conectar tu propio dominio. Los requisitos dependen del dominio que quieras usar.',
  },
  {
    question: '¿Cómo les cobro a mis clientes?',
    answer:
      'Con Mercado Pago: conectás tu propia cuenta desde el panel y los pagos de tu tienda van a ella.',
  },
  {
    question: '¿Cómo gestiono los envíos?',
    answer:
      'Cada pedido pasa por estados —preparando, listo para enviar, enviado y entregado— y podés cargar el transportista y el número de seguimiento. El envío lo coordinás vos con el servicio que prefieras.',
  },
  {
    question: '¿Qué hace el asistente de ventas con IA?',
    answer:
      'Responde consultas de tus clientes por WhatsApp y por el chat de tu tienda con la información que cargues. Definís qué conversaciones pasan a una persona y podés revisar lo que aprende. Los cupos de uso dependen del plan.',
  },
  {
    question: '¿Cuántos productos puedo cargar?',
    answer:
      'El plan Emprendedor incluye hasta 100 productos y el plan Profesional no tiene tope de productos.',
  },
  {
    question: '¿Puedo cambiar de plan o dar de baja mi suscripción?',
    answer: 'Podés administrar tu suscripción desde «Mi suscripción», dentro del panel.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// PRECIOS EN VIVO
//
// El catálogo de planes es público y sin sesión (GET /subscriptions/plans: «información
// de vidriera»). La landing lo lee en vez de copiar los números, así que el precio
// que se ve es siempre el que se cobra.
//
// Nunca bloquea la página: el backend puede estar dormido y tardar en responder.
// Mientras tanto se ve un esqueleto, y si falla o no hay precio válido la tarjeta
// manda a la pantalla de planes en lugar de mostrar un número inventado.
// ─────────────────────────────────────────────────────────────────────────────
const PLANS_TIMEOUT_MS = 20000

const formatArs = value =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)

const formatCount = value => new Intl.NumberFormat('es-AR').format(value)

const parsePlans = payload => {
  const list = payload?.data?.plans
  if (!Array.isArray(list)) return null

  return list.reduce((acc, item) => {
    const price = Number(item?.monthlyPriceArs)

    acc[item?.plan] = {
      price: Number.isFinite(price) && price > 0 ? price : null,
      limits: item?.limits && typeof item.limits === 'object' ? item.limits : {},
    }

    return acc
  }, {})
}

const usePlanCatalog = () => {
  const [catalog, setCatalog] = useState({ status: 'loading', plans: {} })

  useEffect(() => {
    const base = String(env?.apiBaseUrl || '').replace(/\/+$/, '')

    if (!base || typeof fetch !== 'function') {
      setCatalog({ status: 'error', plans: {} })
      return undefined
    }

    // `cancelled` distingue las dos razones por las que el pedido puede abortarse:
    // el desmontaje (o el doble efecto de StrictMode), que no debe tocar el estado,
    // y el timeout, que sí tiene que dejar las tarjetas en «error».
    let cancelled = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PLANS_TIMEOUT_MS)

    fetch(`${base}/subscriptions/plans`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('http'))))
      .then(payload => {
        if (cancelled) return
        const plans = parsePlans(payload)
        setCatalog(plans ? { status: 'ready', plans } : { status: 'error', plans: {} })
      })
      .catch(() => {
        if (!cancelled) setCatalog({ status: 'error', plans: {} })
      })
      .finally(() => clearTimeout(timer))

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [])

  return catalog
}

// ─────────────────────────────────────────────────────────────────────────────
// MAQUETAS ILUSTRATIVAS
//
// Dibujadas en CSS con datos de ejemplo. Todas lo dicen: no son pantallas reales
// ni cifras de ningún comercio.
// ─────────────────────────────────────────────────────────────────────────────
const MockWindow = ({ address, children, caption, className = '' }) => (
  <figure className={`hk-mock ${className}`.trim()}>
    <div className="hk-mock-bar" aria-hidden="true">
      <span className="hk-mock-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="hk-mock-address">{address}</span>
    </div>
    <div className="hk-mock-body" aria-hidden="true">
      {children}
    </div>
    <figcaption>{caption}</figcaption>
  </figure>
)

const VisualTienda = () => (
  <MockWindow
    address="tutienda.henkart.com.ar"
    caption="Vista ilustrativa · los productos y colores son de ejemplo."
  >
    <div className="hk-shop-hero">
      <span className="hk-shop-kicker">NUEVA COLECCIÓN</span>
      <strong>Tu estilo, tu espacio</strong>
      <span className="hk-shop-cta">Ver productos</span>
    </div>
    <div className="hk-shop-grid">
      {[1, 2, 3].map(n => (
        <div className="hk-shop-card" key={n}>
          <i className={`hk-shop-thumb hk-shop-thumb-${n}`} />
          <span />
          <b />
        </div>
      ))}
    </div>
    <div className="hk-shop-palette">
      <span>Colores de tu marca</span>
      <i style={{ background: '#0b6bff' }} />
      <i style={{ background: '#7a2cff' }} />
      <i style={{ background: '#14d8ff' }} />
      <i style={{ background: '#e3f0ff' }} />
    </div>
  </MockWindow>
)

const VisualCheckout = () => (
  <MockWindow
    address="tutienda.henkart.com.ar/carrito"
    caption="Vista ilustrativa · los productos y montos son de ejemplo."
  >
    <div className="hk-cart-line">
      <i className="hk-shop-thumb hk-shop-thumb-1" />
      <span>
        <b>Producto de ejemplo</b>
        <small>Variante · Cantidad 1</small>
      </span>
      <em>$ 0.000</em>
    </div>
    <div className="hk-cart-line">
      <i className="hk-shop-thumb hk-shop-thumb-2" />
      <span>
        <b>Otro producto</b>
        <small>Variante · Cantidad 2</small>
      </span>
      <em>$ 0.000</em>
    </div>
    <div className="hk-cart-coupon">
      <FiTag aria-hidden="true" /> Cupón aplicado
    </div>
    <div className="hk-cart-total">
      <span>Envío e impuestos en el checkout</span>
      <strong>Total</strong>
    </div>
    <div className="hk-cart-pay">Continuar con el pago</div>
    <div className="hk-cart-toast">
      <FiMail aria-hidden="true" /> Recordatorio de carrito enviado
    </div>
  </MockWindow>
)

const ORDER_STEPS = ['Preparando', 'Listo para enviar', 'Enviado', 'Entregado']

const VisualPedido = () => (
  <MockWindow
    address="panel · Órdenes"
    caption="Vista ilustrativa · los datos del pedido son de ejemplo."
  >
    <div className="hk-order-head">
      <span>
        <b>Pedido #1048</b>
        <small>Cliente de ejemplo</small>
      </span>
      <em>Enviado</em>
    </div>
    <ol className="hk-order-steps">
      {ORDER_STEPS.map((step, index) => (
        <li key={step} className={index <= 2 ? 'is-done' : ''}>
          <i>{index <= 2 ? <FiCheck /> : null}</i>
          <span>{step}</span>
        </li>
      ))}
    </ol>
    <div className="hk-order-track">
      <FiTruck aria-hidden="true" />
      <span>
        <small>Transportista</small>
        <b>Servicio a elección</b>
      </span>
      <span>
        <small>Nº de seguimiento</small>
        <b>•••• ••••</b>
      </span>
    </div>
  </MockWindow>
)

const VisualMercado = () => (
  <MockWindow
    address="panel · Análisis de mercado"
    caption="Vista ilustrativa · las barras son de ejemplo, no son datos reales."
  >
    <div className="hk-market-head">
      <span>
        <small>ANÁLISIS DE MERCADO</small>
        <b>Demanda estimada</b>
      </span>
      <em>
        <FiZap aria-hidden="true" /> IA
      </em>
    </div>
    <div className="hk-market-bars">
      {[38, 52, 44, 68, 61, 84, 76].map((height, index) => (
        <i key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
    <div className="hk-market-foot">
      <span>
        <FiSearch aria-hidden="true" /> Resultado para revisar antes de decidir
      </span>
    </div>
  </MockWindow>
)

const VISUALS = {
  tienda: VisualTienda,
  checkout: VisualCheckout,
  pedido: VisualPedido,
  mercado: VisualMercado,
}

const DashboardPreview = () => (
  <figure className="hk-dashboard">
    <div className="hk-dashboard-top" aria-hidden="true">
      <span className="hk-mock-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="hk-mock-address">admin.henkart.com.ar</span>
      <span className="hk-dashboard-live">
        <i /> Tienda activa
      </span>
    </div>

    <div className="hk-dashboard-body" aria-hidden="true">
      <div className="hk-kpis">
        <div>
          <small>Pedidos de hoy</small>
          <strong>12</strong>
          <span>
            <FiTruck /> 4 para enviar
          </span>
        </div>
        <div>
          <small>Productos</small>
          <strong>126</strong>
          <span>
            <FiPackage /> Con stock
          </span>
        </div>
        <div className="is-accent">
          <small>Consultas con IA</small>
          <strong>31</strong>
          <span>
            <FiMessageCircle /> Respondidas
          </span>
        </div>
      </div>

      <div className="hk-dashboard-lower">
        <div className="hk-dashboard-orders">
          <small>ÚLTIMOS PEDIDOS</small>
          {[
            ['#1048', 'Nuevo', 'is-new'],
            ['#1047', 'Preparando', ''],
            ['#1046', 'Enviado', 'is-sent'],
          ].map(([code, status, tone]) => (
            <div className="hk-dashboard-order" key={code}>
              <i>
                <FiShoppingCart />
              </i>
              <b>Pedido {code}</b>
              <em className={tone}>{status}</em>
            </div>
          ))}
        </div>
        <div className="hk-dashboard-chart">
          <small>VENTAS DE LA SEMANA</small>
          <div>
            {[34, 48, 41, 63, 57, 78, 70].map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
    <figcaption>Maqueta ilustrativa · los datos y productos no son reales.</figcaption>
  </figure>
)

const AssistantChat = () => (
  <figure className="hk-chat">
    <div className="hk-chat-head" aria-hidden="true">
      <i>
        <FiMessageCircle />
      </i>
      <span>
        <b>Asistente de ventas</b>
        <small>
          <i /> En línea
        </small>
      </span>
    </div>
    <div className="hk-chat-body">
      <p className="hk-bubble is-customer">Hola, ¿tienen el balde azul? ¿Cuánto sale el envío?</p>
      <p className="hk-bubble is-assistant">
        ¡Hola! Sí, el balde azul está disponible. El costo de envío se calcula en el checkout.
        ¿Querés que lo agregue al carrito?
      </p>
      <p className="hk-bubble is-customer">Sí, dale.</p>
      <p className="hk-bubble is-assistant">
        Listo, ya lo sumé a tu carrito. Cuando quieras, seguí con la compra en la tienda.
      </p>
    </div>
    <figcaption>Conversación ilustrativa · los productos son de ejemplo.</figcaption>
  </figure>
)

// ─────────────────────────────────────────────────────────────────────────────
// CARGA DE PRODUCTOS CON IA
//
// Lo que se afirma sale de productAnalysisController (sanitizeAnalysis): título,
// categoría, subcategoría, marca, material, color, atributos, etiquetas, descripción,
// título y descripción para buscadores, y precio sugerido con su rango.
//
// El producto que sale del análisis nace como BORRADOR (status: 'draft'): lo revisa una
// persona antes de publicarlo. Y se pueden subir varias fotos de una vez. NO se dice que
// publique solo: esa opción existe, pero depende de la configuración del servidor.
// ─────────────────────────────────────────────────────────────────────────────
const AI_FIELDS = [
  'Título',
  'Descripción',
  'Categoría y subcategoría',
  'Marca',
  'Material y color',
  'Atributos',
  'Etiquetas',
  'Título y descripción para buscadores',
  'Precio sugerido',
]

const AI_STEPS = [
  { title: 'Subí las fotos', text: 'Una o varias a la vez, directo desde el panel.' },
  {
    title: 'La IA completa la ficha',
    text: 'Analiza la imagen y rellena los campos del producto.',
  },
  {
    title: 'Revisás y publicás',
    text: 'Queda como borrador: lo ajustás y lo publicás cuando quieras.',
  },
]

const AiField = ({ label, children, wide = false }) => (
  <div className={`hk-ai-field${wide ? ' is-wide' : ''}`}>
    <small>
      <FiZap aria-hidden="true" /> {label}
    </small>
    <b>{children}</b>
  </div>
)

const AiProductMock = () => (
  <MockWindow
    className="hk-ai-mock"
    address="panel · Crear producto"
    caption="Vista ilustrativa · los datos del producto son de ejemplo."
  >
    <div className="hk-ai-layout">
      <div className="hk-ai-photo-col">
        <div className="hk-ai-photo">
          <FiCamera />
          <span>foto-producto.jpg</span>
        </div>
        <span className="hk-ai-status">
          <FiCheck /> Análisis listo
        </span>
      </div>

      <div className="hk-ai-fields">
        <AiField label="Título" wide>
          Balde plástico con pico y manija
        </AiField>
        <AiField label="Categoría">Hogar y limpieza</AiField>
        <AiField label="Subcategoría">Baldes</AiField>
        <AiField label="Marca">Marca de ejemplo</AiField>
        <AiField label="Material">Plástico</AiField>
        <AiField label="Color">Azul</AiField>
        <AiField label="Precio sugerido">
          <span className="hk-ai-price">
            <FiDollarSign /> 0.000 – 0.000
          </span>
        </AiField>
        <AiField label="Etiquetas" wide>
          <span className="hk-ai-tags">
            {['balde', 'limpieza', 'hogar', 'manija'].map(tag => (
              <i key={tag}>{tag}</i>
            ))}
          </span>
        </AiField>
        <AiField label="Descripción" wide>
          <span className="hk-ai-lines">
            <i />
            <i />
            <i className="is-short" />
          </span>
        </AiField>
        <AiField label="Para buscadores" wide>
          <span className="hk-ai-lines">
            <i className="is-short" />
            <i />
          </span>
        </AiField>
      </div>
    </div>

    <div className="hk-ai-foot">
      <span className="hk-ai-draft">Borrador</span>
      <span className="hk-ai-publish">
        <FiEye aria-hidden="true" /> Revisar y publicar
      </span>
    </div>
  </MockWindow>
)

const AiProductShowcase = ({ plansUrl }) => (
  <section className="hk-aiproduct" id="productos-ia" aria-labelledby="hk-aiproduct-title">
    <div className="hk-container">
      <div className="hk-aiproduct-panel">
        <div className="hk-aiproduct-copy">
          <span className="hk-pill">
            <FiCamera aria-hidden="true" /> CARGA DE PRODUCTOS CON IA
          </span>
          <h2 id="hk-aiproduct-title">
            Subí una foto.
            <br />
            <span className="hk-gradient-text">La IA arma la ficha completa.</span>
          </h2>
          <p className="hk-aiproduct-lead">
            Olvidate de escribir cada producto a mano. Subís la foto, la IA analiza la imagen y
            completa todos los datos de la ficha; vos revisás, ajustás y publicás.
          </p>

          <ol className="hk-aiproduct-steps">
            {AI_STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="hk-aiproduct-num">{index + 1}</span>
                <span>
                  <b>{step.title}</b>
                  <small>{step.text}</small>
                </span>
              </li>
            ))}
          </ol>

          <div className="hk-aifields">
            <span className="hk-aifields-title">La IA completa por vos</span>
            <ul>
              {AI_FIELDS.map(field => (
                <li key={field}>
                  <FiCheck aria-hidden="true" /> {field}
                </li>
              ))}
            </ul>
          </div>

          <div className="hk-aiproduct-actions">
            <a className="hk-button hk-button-primary" href={plansUrl}>
              Probarlo con mis productos <FiArrowRight aria-hidden="true" />
            </a>
            <span className="hk-aiproduct-note">
              Los productos quedan como borrador hasta que los publicás. Los cupos de análisis
              dependen del plan.
            </span>
          </div>
        </div>

        <div className="hk-aiproduct-visual">
          <AiProductMock />
        </div>
      </div>
    </div>
  </section>
)

// ─────────────────────────────────────────────────────────────────────────────
// PIEZAS
// ─────────────────────────────────────────────────────────────────────────────
const FeatureTabs = ({ active, onChange }) => {
  const baseId = useId()
  const tabRefs = useRef({})

  const handleKeyDown = event => {
    const index = TABS.findIndex(tab => tab.id === active)
    let next = null

    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1

    if (next === null) return

    event.preventDefault()
    onChange(TABS[next].id)
    tabRefs.current[TABS[next].id]?.focus()
  }

  return (
    <div className="hk-tabs">
      <div className="hk-tablist" role="tablist" aria-label="Qué podés hacer con Henkart">
        {TABS.map(tab => (
          <button
            key={tab.id}
            ref={node => {
              tabRefs.current[tab.id] = node
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            className="hk-tab"
            onClick={() => onChange(tab.id)}
            onKeyDown={handleKeyDown}
          >
            {tab.verb}
          </button>
        ))}
      </div>

      {TABS.map(tab => {
        const Visual = VISUALS[tab.visual]

        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-panel-${tab.id}`}
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            className="hk-tabpanel"
            hidden={tab.id !== active}
          >
            <div className="hk-tabpanel-copy">
              <h3>{tab.title}</h3>
              <p>{tab.text}</p>
              <ul className="hk-feature-list">
                {tab.items.map(item => {
                  const Icon = item.icon

                  return (
                    <li key={item.title}>
                      <span className="hk-feature-icon">
                        <Icon aria-hidden="true" />
                      </span>
                      <span>
                        <b>
                          {item.title}
                          {item.plan === 'pro' && <em className="hk-plan-tag">Profesional</em>}
                        </b>
                        <small>{item.text}</small>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="hk-tabpanel-visual">
              <Visual />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const PlanCard = ({ plan, entry, status, plansUrl }) => {
  const price = entry?.price ?? null
  const quotas = QUOTA_LINES.filter(([key]) => Number(entry?.limits?.[key]) > 0)

  return (
    <article className={`hk-plan${plan.featured ? ' is-featured' : ''}`}>
      {plan.featured && <span className="hk-plan-badge">Más completo</span>}
      <h3>{plan.name}</h3>
      <p className="hk-plan-tagline">{plan.tagline}</p>

      <div className="hk-plan-price" aria-live="polite">
        {status === 'loading' && <span className="hk-skeleton" aria-label="Cargando precio" />}
        {status !== 'loading' && price !== null && (
          <>
            <strong>{formatArs(price)}</strong>
            <span>por mes</span>
          </>
        )}
        {status !== 'loading' && price === null && (
          <span className="hk-plan-noprice">Consultá el precio vigente</span>
        )}
      </div>

      <a
        className={`hk-button ${plan.featured ? 'hk-button-primary' : 'hk-button-ghost-dark'}`}
        href={plansUrl}
      >
        Elegir {plan.name} <FiArrowRight aria-hidden="true" />
      </a>

      <ul className="hk-plan-features">
        {plan.features.map(feature => (
          <li key={feature}>
            <FiCheck aria-hidden="true" /> {feature}
          </li>
        ))}
        {quotas.map(([key, label]) => (
          <li key={key}>
            <FiCheck aria-hidden="true" /> {formatCount(entry.limits[key])} {label} por mes
          </li>
        ))}
      </ul>
    </article>
  )
}

const PlatformLanding = () => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(TABS[0].id)
  const catalog = usePlanCatalog()

  const plansUrl = useMemo(() => buildAdminUrl(SUBSCRIPTION_PATH), [])
  const signupUrl = useMemo(() => buildAdminUrl('/signup'), [])
  const loginUrl = useMemo(() => buildAdminUrl('/login'), [])

  const closeMenu = () => setMenuOpen(false)

  const organization = useMemo(
    () =>
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Henkart',
        url: 'https://henkart.com.ar/',
        logo: 'https://henkart.com.ar/logo512.png',
        slogan: 'Tu comercio, sin límites',
      }),
    [],
  )

  return (
    <div className="hk-landing">
      <Meta
        title="Henkart | Tu tienda online, sin límites"
        description="Creá tu tienda online con tu marca, cobrá con Mercado Pago, gestioná pedidos y stock desde un solo panel y vendé más con un asistente de ventas con IA."
      />
      <script type="application/ld+json">{organization}</script>

      <a className="hk-skip" href="#contenido">
        Saltar al contenido
      </a>

      <div className="hk-announcement">
        <span className="hk-announcement-dot" aria-hidden="true" />
        Cobrá con Mercado Pago y gestioná todo desde un solo panel
        <a href="#planes">
          Ver planes <FiArrowRight aria-hidden="true" />
        </a>
      </div>

      <header className="hk-site-header">
        <div className="hk-container hk-nav">
          <a className="hk-logo" href="#inicio" aria-label="Henkart, inicio" onClick={closeMenu}>
            <BrandLogo height={52} />
          </a>

          <nav className="hk-desktop-nav" aria-label="Navegación principal">
            {NAV_LINKS.map(link => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hk-nav-actions">
            <a className="hk-login-link" href={loginUrl}>
              Ingresar
            </a>
            <a className="hk-button hk-button-primary hk-button-small" href={signupUrl}>
              Crear mi tienda <FiArrowRight aria-hidden="true" />
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
            {NAV_LINKS.map(link => (
              <a key={link.href} href={link.href} onClick={closeMenu}>
                {link.label}
              </a>
            ))}
            <a href={loginUrl} onClick={closeMenu}>
              Ingresar al panel
            </a>
            <a href={signupUrl} className="hk-mobile-nav-cta" onClick={closeMenu}>
              Crear mi tienda
            </a>
          </nav>
        )}
      </header>

      <main id="contenido">
        <section className="hk-hero" id="inicio" aria-labelledby="hk-hero-title">
          <div className="hk-container hk-hero-grid">
            <div className="hk-hero-copy">
              <span className="hk-eyebrow">E-COMMERCE PARA VENDER EN SERIO</span>
              <h1 id="hk-hero-title">
                Tu tienda online,
                <br />
                <span className="hk-gradient-text">sin límites.</span>
              </h1>
              <p className="hk-hero-lead">
                Creá tu tienda con tu marca, cobrá con Mercado Pago y cargá tus productos con una
                foto: la IA completa la ficha por vos. Gestioná todo desde un solo panel y vendé más
                con un asistente que atiende a tus clientes.
              </p>

              <div className="hk-hero-actions">
                <a className="hk-button hk-button-primary" href={plansUrl}>
                  Crear mi tienda <FiArrowRight aria-hidden="true" />
                </a>
                <a className="hk-button hk-button-ghost" href="#funciones">
                  Ver qué incluye
                </a>
              </div>

              <ul className="hk-hero-notes">
                <li>
                  <FiCheck aria-hidden="true" /> Cobrás con tu cuenta de Mercado Pago
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> Subdominio incluido y dominio propio
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> La IA completa la ficha de tus productos
                </li>
              </ul>
            </div>

            <div className="hk-hero-visual">
              <div className="hk-hero-glow" aria-hidden="true" />
              <img
                className="hk-hero-icon"
                src="/logo192.png"
                alt=""
                width="96"
                height="96"
                decoding="async"
              />
              <DashboardPreview />
              <div className="hk-hero-chips" aria-hidden="true">
                <div className="hk-chip hk-chip-order">
                  <i>
                    <FiShoppingCart />
                  </i>
                  <span>
                    <b>Nuevo pedido</b>
                    <small>Lo ves en tu panel</small>
                  </span>
                </div>
                <div className="hk-chip hk-chip-ai">
                  <i>
                    <FiMessageCircle />
                  </i>
                  <span>
                    <b>Consulta respondida</b>
                    <small>Por tu asistente con IA</small>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="hk-container hk-verbs" aria-label="Las cuatro etapas de tu tienda">
            {TABS.map(tab => (
              <a key={tab.id} href="#funciones" onClick={() => setActiveTab(tab.id)}>
                {tab.verb}
              </a>
            ))}
          </div>
        </section>

        <section className="hk-trust" aria-label="Lo que incluye Henkart">
          <div className="hk-container hk-trust-grid">
            {TRUST.map(item => {
              const Icon = item.icon

              return (
                <div key={item.title}>
                  <span className="hk-trust-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span>
                    <b>{item.title}</b>
                    <small>{item.text}</small>
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <AiProductShowcase plansUrl={plansUrl} />

        <section
          className="hk-section hk-features"
          id="funciones"
          aria-labelledby="hk-features-title"
        >
          <div className="hk-container">
            <div className="hk-heading hk-heading-center">
              <span className="hk-section-eyebrow">TODO LO QUE NECESITÁS</span>
              <h2 id="hk-features-title">
                Lo necesario para vender.
                <br />
                <span>Y para hacerlo crecer.</span>
              </h2>
              <p>
                Desde el diseño de la tienda hasta la atención de tus clientes: elegí una etapa y
                mirá qué incluye.
              </p>
            </div>

            <FeatureTabs active={activeTab} onChange={setActiveTab} />
          </div>
        </section>

        <section className="hk-assistant" id="asistente" aria-labelledby="hk-assistant-title">
          <div className="hk-container hk-assistant-grid">
            <div className="hk-assistant-copy">
              <span className="hk-pill">
                <FiZap aria-hidden="true" /> ASISTENTE DE VENTAS CON IA
              </span>
              <h2 id="hk-assistant-title">
                Atiende a tus clientes
                <br />
                <span className="hk-gradient-text">cuando vos no podés.</span>
              </h2>
              <p>
                Un asistente que responde consultas por WhatsApp y por el chat de tu tienda con la
                información de tu negocio. Vos definís qué conversaciones pasan a una persona y qué
                aprende.
              </p>
              <ul className="hk-assistant-points">
                <li>
                  <FiCheck aria-hidden="true" /> Responde con la información que cargues en tu base
                  de conocimiento.
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> Pasa a una persona las conversaciones que vos
                  indiques.
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> Podés exigir que todo lo que aprende pase por tu
                  revisión.
                </li>
                <li>
                  <FiCheck aria-hidden="true" /> Sumá campañas y mirá las métricas desde el panel.
                </li>
              </ul>
              <p className="hk-assistant-note">
                Los cupos de uso dependen del plan y se detallan más abajo.
              </p>
            </div>
            <AssistantChat />
          </div>
        </section>

        <section
          className="hk-section hk-steps"
          id="como-funciona"
          aria-labelledby="hk-steps-title"
        >
          <div className="hk-container">
            <div className="hk-heading hk-heading-center">
              <span className="hk-section-eyebrow">EMPEZÁ EN TRES PASOS</span>
              <h2 id="hk-steps-title">
                De la idea a tu primera venta.
                <br />
                <span>Con un camino claro.</span>
              </h2>
            </div>

            <ol className="hk-steps-grid">
              {STEPS.map(step => (
                <li className="hk-step" key={step.number}>
                  <span className="hk-step-number">{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>

            <div className="hk-steps-cta">
              <a className="hk-button hk-button-primary" href={plansUrl}>
                Elegir un plan <FiArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="hk-section hk-plans" id="planes" aria-labelledby="hk-plans-title">
          <div className="hk-container">
            <div className="hk-heading hk-heading-center">
              <span className="hk-section-eyebrow">PLANES</span>
              <h2 id="hk-plans-title">
                Elegí el plan
                <br />
                <span>que acompaña tu negocio.</span>
              </h2>
              <p>Precios en pesos argentinos, con facturación mensual.</p>
            </div>

            <div className="hk-plan-grid">
              {PLAN_CARDS.map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  entry={catalog.plans[plan.id]}
                  status={catalog.status}
                  plansUrl={plansUrl}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="hk-section hk-faq" id="preguntas" aria-labelledby="hk-faq-title">
          <div className="hk-container hk-faq-layout">
            <div className="hk-faq-intro">
              <span className="hk-section-eyebrow">PREGUNTAS FRECUENTES</span>
              <h2 id="hk-faq-title">
                Antes de empezar,
                <br />
                <span>lo importante.</span>
              </h2>
              <p>Las respuestas rápidas, o pasá directo a elegir tu plan.</p>
              <a className="hk-text-link" href={plansUrl}>
                Ir a planes y precios <FiArrowRight aria-hidden="true" />
              </a>
            </div>
            <div className="hk-faq-list">
              {FAQ.map(item => (
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

        <section className="hk-final" id="contacto" aria-labelledby="hk-final-title">
          <div className="hk-container hk-final-inner">
            <img
              className="hk-final-icon"
              src="/logo192.png"
              alt=""
              width="88"
              height="88"
              loading="lazy"
              decoding="async"
            />
            <h2 id="hk-final-title">Tu comercio, sin límites.</h2>
            <p>Creá tu tienda hoy y empezá a vender a tu manera.</p>
            <div className="hk-final-actions">
              <a className="hk-button hk-button-light" href={plansUrl}>
                Crear mi tienda <FiArrowRight aria-hidden="true" />
              </a>
              <a className="hk-secondary-link" href={loginUrl}>
                Ya tengo cuenta: ingresar
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="hk-footer">
        <div className="hk-container hk-footer-main">
          <div className="hk-footer-brand">
            <a className="hk-logo" href="#inicio" aria-label="Henkart, volver al inicio">
              <BrandLogo height={60} />
            </a>
            <p>Creá, vendé, gestioná y crecé desde un solo lugar.</p>
          </div>
          <div className="hk-footer-links">
            <strong>Henkart</strong>
            <a href="#funciones">Funciones</a>
            <a href="#asistente">Asistente con IA</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#preguntas">Preguntas frecuentes</a>
          </div>
          <div className="hk-footer-links">
            <strong>Tu tienda</strong>
            <a href="#planes">Planes y precios</a>
            <a href={signupUrl}>Crear una tienda</a>
            <a href={loginUrl}>Ingresar al panel</a>
          </div>
        </div>
        <div className="hk-container hk-footer-bottom">
          <span>© {new Date().getFullYear()} Henkart. Todos los derechos reservados.</span>
          <a href="#inicio">Volver arriba ↑</a>
        </div>
      </footer>
    </div>
  )
}

export default PlatformLanding
