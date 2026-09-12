// 📁 src/services/subscriptionMetricsService.js
//
// La suscripción del comercio, como la muestra el panel.
//
// QUÉ SE SACÓ DE ACÁ
//
// Tres funciones exportadas —getPlatformSubscriptionMetrics, getRevenueByPlan y
// getSubscriptionHistory— que no las importaba nadie. No eran inofensivas: las
// tres calculaban plata con los precios ESCRITOS A MANO Y EN DÓLARES (99 y
// 26,14), los mismos que se sacaron de todo el resto del sistema cuando el
// precio pasó a ser una decisión del dueño, en pesos y cargada desde el panel.
// Un reporte muerto con precios viejos es una trampa esperando a que alguien lo
// enchufe a una pantalla.
//
// getSubscriptionHistory además prometía un historial que no existe: devolvía
// `previousPlans: []` y `statusChanges: []` fijos, con un TODO. Cuando haga
// falta se escribe leyendo una tabla de auditoría real.

import Tenant from '../models/tenantModel.js'
import { getPlanMonthlyPriceArs } from './ai/aiPlanPolicy.js'
import logger from '../../config/logger.js'

/**
 * Estado de la suscripción del comercio para el panel.
 *
 * Todas las salidas —incluidas las de error— tienen la MISMA forma. Antes no:
 * el camino feliz devolvía `lastPaymentAt` y los de error devolvían
 * `nextBillingDate`, una clave que nadie más producía, así que el panel leía
 * undefined justo cuando algo había fallado.
 */
const emptySummary = {
  currentPlan: null,
  status: 'none',
  isActive: false,
  mrr: 0,
  currency: 'ARS',
  pastDueAt: null,
  lastPaymentAt: null,
  nextBillingAt: null,
}

export const getSubscriptionSummary = async tenantId => {
  try {
    const tenant = await Tenant.findById(tenantId)
      .select('plan subscriptionStatus subscriptionPastDueAt integrations.subscriptionMercadoPago')
      .lean()

    if (!tenant) return { ...emptySummary }

    const isActive = tenant.subscriptionStatus === 'active'

    // EL MRR SALE DEL PRECIO VIGENTE, NO DE UNA TABLA ACÁ ADENTRO.
    //
    // Había un `{ starter: 26.14, pro: 99, free: 0 }` escrito en este archivo, y
    // el panel lo mostraba con formato de pesos: "Ingreso recurrente mensual:
    // $26,14" para un plan que se cobra en miles de pesos. Eran los precios en
    // DÓLARES de una lista vieja, con el signo $ prestado del formateador.
    //
    // getPlanMonthlyPriceArs es la única fuente: override del panel → variable
    // de entorno → nada. `null` significa "sin precio configurado", y en ese
    // caso el MRR es 0 porque no hay número que cobrar, no porque sea gratis.
    const priceArs = getPlanMonthlyPriceArs(tenant.plan)
    const mrr = isActive && Number.isFinite(priceArs) ? priceArs : 0

    const provider = tenant.integrations?.subscriptionMercadoPago || {}

    return {
      currentPlan: tenant.plan || null,
      status: tenant.subscriptionStatus || 'none',
      isActive,
      mrr,
      currency: 'ARS',
      pastDueAt: tenant.subscriptionPastDueAt || null,
      lastPaymentAt: provider.lastPaymentAt || null,
      // El próximo cobro tal como lo informa Mercado Pago. El panel tenía una
      // tarjeta "Próximo pago" que mostraba lastPaymentAt: el título decía una
      // fecha futura y el número era la del último cobro. Este campo existe en
      // el tenant desde que el webhook lo guarda; nadie lo estaba sirviendo.
      nextBillingAt: provider.nextBillingAt || null,
    }
  } catch (error) {
    logger.error('Error calculando resumen de suscripciones', {
      tenantId,
      error: error.message,
    })

    return { ...emptySummary }
  }
}

export default {
  getSubscriptionSummary,
}
