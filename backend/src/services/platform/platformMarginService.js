// 📁 src/services/platform/platformMarginService.js
//
// Margen estimado de HENKO por comercio: precio nominal del plan menos el
// costo real de IA contra la key de la plataforma (BYOK ya cuesta $0 acá,
// ver aiUsageModel.js). NO incluye infraestructura, soporte ni otros costos
// operativos — no existe una fuente de datos para eso hoy, y no se inventa.
// Es "margen bruto sobre IA", no el margen real de HENKO.
//
// Única query cross-tenant de todo el código. Tenant no tiene tenantPlugin
// (es la raíz del aislamiento, no puede tener su propio tenantId), pero
// AiUsage sí lo tiene y el plugin SÍ engancha aggregate (pre('aggregate'),
// ver tenantPlugin.js) — sin un tenantId en el pipeline o en el contexto de
// request, tira TENANT_INVALID. `.option({ ignoreTenant: true })` es el
// escape hatch que el propio plugin expone para este caso legítimo.

import Tenant from '../../models/tenantModel.js'
import AiUsage from '../../models/aiUsageModel.js'
import { getCurrentPeriod } from '../ai/aiBudgetService.js'
import { getPlanMonthlyPriceUsd } from '../ai/aiPlanPolicy.js'

const round2 = value => Math.round(value * 100) / 100

export const getPlatformMarginReport = async (period = getCurrentPeriod()) => {
  const [tenants, usageRows] = await Promise.all([
    Tenant.find({ status: { $ne: 'deleted' } })
      .select('name plan status subscriptionStatus createdAt')
      .lean(),
    AiUsage.aggregate([
      { $match: { period } },
      { $project: { tenantId: 1, estimatedCostUsd: 1, byokTokens: 1 } },
    ]).option({ ignoreTenant: true }),
  ])

  const costByTenant = new Map(
    usageRows.map(row => [String(row.tenantId), row.estimatedCostUsd || 0]),
  )

  const tenantRows = tenants.map(tenant => {
    const planPriceUsd = getPlanMonthlyPriceUsd(tenant.plan)
    const aiCostUsd = costByTenant.get(String(tenant._id)) || 0
    const estimatedMarginUsd = planPriceUsd === null ? null : round2(planPriceUsd - aiCostUsd)

    return {
      tenantId: tenant._id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      subscriptionStatus: tenant.subscriptionStatus,
      planPriceUsd,
      aiCostUsd: round2(aiCostUsd),
      estimatedMarginUsd,
    }
  })

  const billable = tenantRows.filter(row => row.planPriceUsd !== null)

  const byPlan = tenantRows.reduce((acc, row) => {
    const key = row.plan
    if (!acc[key]) acc[key] = { count: 0, aiCostUsd: 0, planRevenueUsd: 0 }
    acc[key].count += 1
    acc[key].aiCostUsd = round2(acc[key].aiCostUsd + row.aiCostUsd)
    if (row.planPriceUsd !== null) {
      acc[key].planRevenueUsd = round2(acc[key].planRevenueUsd + row.planPriceUsd)
    }
    return acc
  }, {})

  const totals = {
    tenantCount: tenantRows.length,
    customPricingCount: tenantRows.length - billable.length,
    totalPlanRevenueUsd: round2(billable.reduce((sum, row) => sum + row.planPriceUsd, 0)),
    totalAiCostUsd: round2(tenantRows.reduce((sum, row) => sum + row.aiCostUsd, 0)),
    totalEstimatedMarginUsd: round2(billable.reduce((sum, row) => sum + row.estimatedMarginUsd, 0)),
    byPlan,
  }

  return {
    period,
    tenants: tenantRows,
    totals,
    notes: [
      'estimatedMarginUsd es margen bruto sobre costo de IA únicamente — no incluye infraestructura ni otros costos operativos.',
      'planPriceUsd null significa precio a medida (enterprise) — no se estima automáticamente.',
      'subscriptionStatus no refleja cobro real todavía — no existe flujo de facturación (ver aiPlanPolicy.js).',
    ],
  }
}

export default { getPlatformMarginReport }
