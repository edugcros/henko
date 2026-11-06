// Lo que un plan es, sin lo que cuesta.
//
// El nombre, la descripción y la lista de funciones son texto de producto y
// viven acá. El PRECIO no: lo sirve el backend en /subscriptions/plans, porque
// es lo único de esto que cambia y que tiene que coincidir con lo que se cobra.
//
// Antes estaba todo mezclado y repetido: SubscriptionPage tenía su lista con
// precios, SubscriptionManagementPage tenía otra con precios distintos —26,14
// USD contra 40.000 ARS para el mismo plan— y CheckoutPage tenía su propia copia
// del tipo de cambio. Tres pantallas del mismo panel mostrando tres números para
// una misma cosa.

import { CrownOutlined, RocketOutlined } from '@ant-design/icons'

// Los dos planes del catálogo, y nada más.
//
// Estaban también 'free' y 'enterprise'. Se sacaron del catálogo del backend
// (ver AI_PLANS en aiPlanPolicy.js) y dejarlos acá no era inofensivo: cualquier
// pantalla que mostrara el plan de un comercio los seguía sabiendo dibujar, así
// que un valor viejo en la base se veía como un plan normal en vez de saltar a
// la vista.
export const PLAN_PRESENTATION = Object.freeze({
  starter: {
    name: 'Emprendedor',
    description: 'Las herramientas esenciales para poner en marcha una tienda.',
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
  pro: {
    name: 'Profesional',
    description: 'Automatización y capacidad para una operación en crecimiento.',
    icon: CrownOutlined,
    features: [
      'Productos ilimitados',
      // «Más créditos de IA» y no «Analizador de productos con IA».
      //
      // Esa línea decía que el análisis de productos era del plan Profesional, y no lo es:
      // los dos planes lo tienen, cada uno con su cupo mensual. Mostrada al lado de los
      // cupos, la pantalla de planes se contradecía a sí misma. Lo que SÍ distingue al
      // Profesional es cuánto trae: más créditos en la misma bolsa. Los números salen del
      // catálogo.
      'Más créditos de IA',
      'Múltiples administradores',
      'Reportes avanzados',
      'Soporte prioritario',
    ],
    actionLabel: 'Elegir Profesional',
    featured: true,
  },
})

/** Los que se pueden contratar desde el panel, en el orden en que se muestran. */
export const SELLABLE_PLANS = Object.freeze(['starter', 'pro'])

export const getPlanName = plan => PLAN_PRESENTATION[plan]?.name || 'Desconocido'

/**
 * Un plan sin precio configurado no se puede contratar.
 *
 * Desde que los precios no viven en el código, `null` en un plan vendible
 * significa "el dueño todavía no lo definió" — no "es gratis" y no "es a
 * medida". Ofrecer el botón igual llevaría a un checkout que no puede cobrar.
 */
export const isPlanContratable = priceArs => typeof priceArs === 'number' && priceArs > 0

/**
 * Pesos, siempre. HENKO cobra en pesos y no hay precio en dólares en ningún
 * lado: el que se mostraba era una traducción congelada de una división vieja.
 */
export const formatArs = (value, { sinPrecio = 'A definir' } = {}) => {
  if (value === null || value === undefined) return sinPrecio

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Los cupos mensuales de IA que trae cada plan, para mostrarlos junto al precio.
 *
 * Los NÚMEROS salen del catálogo del backend (`limits` en /subscriptions/plans), que es
 * lo que el medidor aplica de verdad: escribirlos acá volvería a abrir la puerta a que la
 * pantalla diga una cifra y el cobro de cupo aplique otra. Acá solo está cómo se llama
 * cada cupo. Los tokens se omiten a propósito: a quien elige un plan le dicen «cuántos
 * créditos», no «cuántos millones de tokens».
 */
export const PLAN_QUOTA_LABELS = Object.freeze([
  ['vision', 'análisis de imágenes con IA'],
  ['agentMessages', 'mensajes del asistente de ventas'],
  ['imageEdits', 'fondos generados con IA'],
  ['marketAnalyses', 'análisis de mercado con IA'],
])

export const formatCount = value => new Intl.NumberFormat('es-AR').format(Number(value) || 0)

// Lo que descuenta cada acción de la bolsa. El orden es el mismo de los cupos.
const CREDIT_COST_LABELS = Object.freeze({
  vision: 'por análisis de imagen',
  agentMessages: 'por mensaje del asistente',
  imageEdits: 'por fondo generado',
  marketAnalyses: 'por análisis de mercado',
})

/**
 * Lo que trae un plan: la bolsa de créditos y lo que descuenta cada acción.
 *
 * No se muestran cupos por función porque la bolsa es compartida: «1.333 análisis» y
 * «4.000 mensajes» se leerían como una suma, y no se pueden tener los dos.
 */
export const getPlanQuotaLines = limits => {
  const credits = Number(limits?.credits)

  if (!(credits > 0)) {
    return PLAN_QUOTA_LABELS.filter(([key]) => Number(limits?.[key]) > 0).map(([key, label]) => ({
      key,
      label,
      amount: Number(limits[key]),
    }))
  }

  const costos = PLAN_QUOTA_LABELS.filter(([key]) => Number(limits.creditCosts?.[key]) > 0).map(
    ([key]) => {
      const amount = Number(limits.creditCosts[key])

      return {
        key,
        amount,
        label: `${amount === 1 ? 'crédito' : 'créditos'} ${CREDIT_COST_LABELS[key]}`,
      }
    },
  )

  return [{ key: 'credits', amount: credits, label: 'créditos de IA por mes' }, ...costos]
}

/**
 * Días que le quedan a la prueba gratis, o null si no está en prueba o ya venció.
 *
 * Lo usan el checkout y Mi suscripción. Mi suscripción tenía su propia cuenta,
 * sin el corte en cero: con la prueba vencida decía «termina en -3 días».
 */
export const trialDaysLeft = (subscriptionStatus, trialEndsAt, now = Date.now()) => {
  if (subscriptionStatus !== 'trialing' || !trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}
