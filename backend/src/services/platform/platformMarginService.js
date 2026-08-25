// 📁 src/services/platform/platformMarginService.js
//
// Margen estimado de HENKO por comercio: precio nominal del plan menos el
// costo real de IA contra la key de la plataforma (BYOK ya cuesta $0 acá,
// ver aiUsageModel.js), menos el costo estimado de comunicaciones (envíos
// reales de email/WhatsApp del período × tarifa configurable). Infraestructura
// y storage son costos de la plataforma entera, no de un comercio puntual —
// se restan del margen total, no prorrateados por tenant (ver nota más abajo
// sobre por qué). Sigue siendo "margen bruto operativo", no el margen
// contable real de HENKO (no incluye soporte, impuestos, etc.).
//
// Única query cross-tenant de todo el código. Tenant no tiene tenantPlugin
// (es la raíz del aislamiento, no puede tener su propio tenantId), pero
// AiUsage/Order/AiCartRecovery sí lo tienen y el plugin SÍ engancha aggregate
// (pre('aggregate'), ver tenantPlugin.js) — sin un tenantId en el pipeline o
// en el contexto de request, tira TENANT_INVALID. `.option({ ignoreTenant:
// true })` es el escape hatch que el propio plugin expone para este caso
// legítimo.

import Tenant from '../../models/tenantModel.js'
import AiUsage from '../../models/aiUsageModel.js'
import Order from '../../models/orderModel.js'
import AiCartRecovery from '../../models/aiCartRecoveryModel.js'
import { getCurrentPeriod } from '../ai/aiBudgetService.js'
import {
  getEmailCostPerSendUsd,
  getPlanMonthlyPriceUsd,
  getPlatformMonthlyInfraCostUsd,
  getPlatformMonthlyStorageCostUsd,
  getWhatsappCostPerSendUsd,
} from '../ai/aiPlanPolicy.js'

const round2 = value => Math.round(value * 100) / 100
// Comunicaciones se calcula con tarifas por envío que suelen ser fracciones
// de centavo (ej. $0.001/email) — redondear a 2 decimales antes de sumar
// volumen puede colapsar el resultado a $0 incluso con volumen real
// (confirmado: 2 envíos × $0.001 = $0.002, que round2 lleva a $0.00).
const round4 = value => Math.round(value * 10000) / 10000

/** 'YYYY-MM' (mismo formato que getCurrentPeriod) → límites del mes en UTC. */
const parsePeriodRange = period => {
  const [yearStr, monthStr] = String(period || '').split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }

  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

export const getPlatformMarginReport = async (period = getCurrentPeriod()) => {
  const range = parsePeriodRange(period)

  const [allTenants, usageRows, emailOrderRows, recoveryRows] = await Promise.all([
    // Sin filtrar por status acá a propósito: el margen (abajo) solo mira
    // comercios no borrados, pero el ciclo de vida (más abajo) necesita ver
    // también los borrados para poder contarlos en el período.
    Tenant.find({})
      .select('name plan status subscriptionStatus createdAt updatedAt')
      .lean(),
    AiUsage.aggregate([
      { $match: { period } },
      { $project: { tenantId: 1, estimatedCostUsd: 1, byokTokens: 1 } },
    ]).option({ ignoreTenant: true }),
    // Emails de confirmación de compra — no cubre recuperación de carrito por
    // email, esa se cuenta aparte vía AiCartRecovery (mismo criterio: cada
    // envío real, no un estimado).
    range
      ? Order.aggregate([
        { $match: { emailSent: true, createdAt: { $gte: range.start, $lt: range.end } } },
        { $group: { _id: '$tenantId', count: { $sum: 1 } } },
      ]).option({ ignoreTenant: true })
      : Promise.resolve([]),
    range
      ? AiCartRecovery.aggregate([
        { $match: { sentAt: { $gte: range.start, $lt: range.end } } },
        { $group: { _id: { tenantId: '$tenantId', channel: '$channel' }, count: { $sum: 1 } } },
      ]).option({ ignoreTenant: true })
      : Promise.resolve([]),
  ])

  const tenants = allTenants.filter(tenant => tenant.status !== 'deleted')

  const costByTenant = new Map(
    usageRows.map(row => [String(row.tenantId), row.estimatedCostUsd || 0]),
  )

  const emailSendsByTenant = new Map(
    emailOrderRows.map(row => [String(row._id), row.count || 0]),
  )

  const recoveryEmailByTenant = new Map()
  const recoveryWhatsappByTenant = new Map()

  for (const row of recoveryRows) {
    const tenantKey = String(row._id?.tenantId || '')
    if (!tenantKey) continue

    if (row._id.channel === 'email') {
      recoveryEmailByTenant.set(tenantKey, (recoveryEmailByTenant.get(tenantKey) || 0) + row.count)
    } else if (row._id.channel === 'whatsapp') {
      recoveryWhatsappByTenant.set(tenantKey, row.count)
    }
  }

  const emailCostPerSend = getEmailCostPerSendUsd()
  const whatsappCostPerSend = getWhatsappCostPerSendUsd()

  const tenantRows = tenants.map(tenant => {
    const tenantKey = String(tenant._id)
    const planPriceUsd = getPlanMonthlyPriceUsd(tenant.plan)
    const aiCostUsd = costByTenant.get(tenantKey) || 0

    const emailSends =
      (emailSendsByTenant.get(tenantKey) || 0) + (recoveryEmailByTenant.get(tenantKey) || 0)
    const whatsappSends = recoveryWhatsappByTenant.get(tenantKey) || 0
    const communicationsCostUsd = round4(
      emailSends * emailCostPerSend + whatsappSends * whatsappCostPerSend,
    )

    const estimatedMarginUsd =
      planPriceUsd === null ? null : round2(planPriceUsd - aiCostUsd - communicationsCostUsd)

    return {
      tenantId: tenant._id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      subscriptionStatus: tenant.subscriptionStatus,
      planPriceUsd,
      aiCostUsd: round2(aiCostUsd),
      emailSends,
      whatsappSends,
      communicationsCostUsd,
      estimatedMarginUsd,
    }
  })

  const billable = tenantRows.filter(row => row.planPriceUsd !== null)

  const byPlan = tenantRows.reduce((acc, row) => {
    const key = row.plan
    if (!acc[key]) acc[key] = { count: 0, aiCostUsd: 0, communicationsCostUsd: 0, planRevenueUsd: 0 }
    acc[key].count += 1
    acc[key].aiCostUsd = round2(acc[key].aiCostUsd + row.aiCostUsd)
    acc[key].communicationsCostUsd = round4(acc[key].communicationsCostUsd + row.communicationsCostUsd)
    if (row.planPriceUsd !== null) {
      acc[key].planRevenueUsd = round2(acc[key].planRevenueUsd + row.planPriceUsd)
    }
    return acc
  }, {})

  const infraCostUsd = getPlatformMonthlyInfraCostUsd()
  const storageCostUsd = getPlatformMonthlyStorageCostUsd()
  const totalCommunicationsCostUsd = round4(
    tenantRows.reduce((sum, row) => sum + row.communicationsCostUsd, 0),
  )

  // Ciclo de vida de comercios — separado del cálculo de margen porque usa
  // allTenants (incluye borrados) y no depende de AiUsage/Order/AiCartRecovery.
  // Solo se reportan acá los números que realmente se pueden medir hoy:
  // altas (createdAt real) y el estado actual (status). "Cancelación" y
  // "comercio que paga" NO tienen una fuente de datos real todavía — no
  // existe flujo de cobro ni un campo que se actualice al cancelar — así que
  // no se inventan, se señalan explícitamente en notes.
  const newTenantsInPeriod = range
    ? allTenants.filter(
      tenant => tenant.createdAt >= range.start && tenant.createdAt < range.end,
    ).length
    : null

  // Aproximación: no existe un campo deletedAt. Se infiere del updatedAt de
  // un tenant que hoy está en status:'deleted' — puede desviarse si ese
  // registro se tocó de nuevo después de borrarse, pero es la única señal
  // disponible sin agregar un campo nuevo al modelo.
  const deletedInPeriodApprox = range
    ? allTenants.filter(
      tenant =>
        tenant.status === 'deleted' &&
        tenant.updatedAt >= range.start &&
        tenant.updatedAt < range.end,
    ).length
    : null

  const lifecycle = {
    newTenantsInPeriod,
    deletedInPeriodApprox,
    activeTenantsCount: allTenants.filter(tenant => tenant.status === 'active').length,
    suspendedTenantsCount: allTenants.filter(tenant => tenant.status === 'suspended').length,
    deletedTenantsCount: allTenants.filter(tenant => tenant.status === 'deleted').length,
    // Plan pago NOMINAL (asignado a mano en el tenant), no comercios que
    // efectivamente estén pagando — ver nota, no existe flujo de cobro.
    nonFreePlanTenantsCount: tenants.filter(tenant => tenant.plan !== 'free').length,
  }

  const totals = {
    tenantCount: tenantRows.length,
    customPricingCount: tenantRows.length - billable.length,
    totalPlanRevenueUsd: round2(billable.reduce((sum, row) => sum + row.planPriceUsd, 0)),
    totalAiCostUsd: round2(tenantRows.reduce((sum, row) => sum + row.aiCostUsd, 0)),
    totalCommunicationsCostUsd,
    // Costos fijos de la plataforma entera — no prorrateados, ver nota.
    infraCostUsd: round2(infraCostUsd),
    storageCostUsd: round2(storageCostUsd),
    totalEstimatedMarginUsd: round2(
      billable.reduce((sum, row) => sum + row.estimatedMarginUsd, 0) - infraCostUsd - storageCostUsd,
    ),
    byPlan,
  }

  return {
    period,
    tenants: tenantRows,
    totals,
    lifecycle,
    notes: [
      'estimatedMarginUsd por comercio es precio del plan menos costo de IA y de comunicaciones de ESE comercio — no incluye la porción de infraestructura/storage (ver los dos puntos siguientes).',
      'infraCostUsd y storageCostUsd son costos totales de la plataforma, no prorrateados por comercio — dividirlos individualmente inventaría una precisión que no existe hoy. Se restan una sola vez en totals.totalEstimatedMarginUsd. Default estimado por investigación de precios públicos de Render/MongoDB Atlas/Cloudinary (ver aiPlanPolicy.js) — no es la factura real de HENKO, sobrescribible con PLATFORM_INFRA_MONTHLY_COST_USD / PLATFORM_STORAGE_MONTHLY_COST_USD en cuanto haya una factura real para comparar.',
      'communicationsCostUsd por comercio sí es medible (volumen real de envíos de email/WhatsApp). La tarifa por envío también es una estimación de precios públicos de SendGrid/Meta WhatsApp (ver aiPlanPolicy.js), configurable con EMAIL_COST_USD_PER_SEND / WHATSAPP_COST_USD_PER_SEND.',
      'planPriceUsd null significa precio a medida (enterprise) — no se estima automáticamente.',
      'subscriptionStatus no refleja cobro real todavía — no existe flujo de facturación (ver aiPlanPolicy.js).',
      'lifecycle.deletedInPeriodApprox es una aproximación (no hay campo deletedAt, se infiere de updatedAt) — no un dato exacto.',
      'No existe hoy un concepto real de "cancelación de suscripción" ni de "comercio que paga": no hay flujo de cobro ni un campo que se actualice al cancelar. lifecycle.nonFreePlanTenantsCount cuenta comercios en un plan pago asignado a mano, no comercios efectivamente facturados.',
    ],
  }
}

export default { getPlatformMarginReport }
