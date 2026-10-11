import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getPlatformMarginReport = async period => {
  const response = await api.get('/platform/margin', {
    params: period ? { period } : undefined,
  })

  return unwrap(response)
}

export const getPlatformAiSpend = async period => {
  const response = await api.get('/platform/ai-spend', {
    params: period ? { period } : undefined,
  })

  return unwrap(response)
}

/**
 * Mueve el techo de gasto. `tokens: null` quita el override y devuelve el mando
 * a la variable de entorno. Responde con el reporte ya actualizado.
 */
/**
 * Mueve los frenos de gasto de IA.
 *
 * Cada campo es OPCIONAL y se manda solo si se quiere cambiar; `null` quita el
 * override y le devuelve el mando a la variable de entorno.
 *
 * Son tres y no uno porque miden cosas distintas: entre gemini-3.6-flash y
 * 3.1-flash-lite hay 5x de tarifa, asi que el mismo tope de tokens puede
 * costar veinte dolares o cien segun que modelo responda — y eso lo decide la
 * cadena de respaldo, no nosotros.
 */
export const updatePlatformAiBudget = async ({ tokens, usd, perTenantShare, reason }) => {
  const response = await api.put('/platform/ai-spend/budget', {
    // undefined no viaja en JSON, asi que un campo que no se toca no llega al
    // backend y no se escribe. Es lo que permite mover uno sin pisar los otros.
    ...(tokens !== undefined ? { tokens } : {}),
    ...(usd !== undefined ? { usd } : {}),
    ...(perTenantShare !== undefined ? { perTenantShare } : {}),
    reason,
  })

  return unwrap(response)
}

/**
 * Acota o apaga la IA de UN comercio.
 *
 * Las otras tres palancas son globales: para frenar a uno había que bajarle el
 * reparto a todos. `share: null` lo devuelve a la fracción global y `suspended`
 * lo apaga; cada campo es opcional, así que mover uno no pisa el otro.
 *
 * Responde con el reporte entero ya actualizado, igual que el techo: la tabla
 * tiene que mostrar el efecto sin una segunda vuelta que pueda fallar.
 */
export const updateTenantAiPolicy = async ({
  tenantId,
  share,
  suspended,
  suspendedReason,
  reason,
}) => {
  const response = await api.put(`/platform/ai-spend/tenant/${tenantId}`, {
    ...(share !== undefined ? { share } : {}),
    ...(suspended !== undefined ? { suspended } : {}),
    ...(suspendedReason !== undefined ? { suspendedReason } : {}),
    reason,
  })

  return unwrap(response)
}

/** Precios vigentes de los planes, con su historial de cambios. */
export const getPlanPrices = async () => {
  const response = await api.get('/platform/plan-prices')
  return unwrap(response)
}

/**
 * Cambia el precio de un plan, en pesos. `priceArs: null` quita el override y
 * devuelve el mando al valor por defecto. Responde con el catálogo actualizado.
 */
export const updatePlanPrice = async ({ plan, priceArs, reason }) => {
  const response = await api.put('/platform/plan-prices', {
    plan,
    priceArs,
    reason,
  })

  return unwrap(response)
}

export default {
  getPlatformMarginReport,
  getPlatformAiSpend,
  updatePlatformAiBudget,
  updateTenantAiPolicy,
  getPlanPrices,
  updatePlanPrice,
}

/**
 * El tipo de cambio con el que se convierten los costos de IA a pesos.
 *
 * Trae además de dónde sale, quién lo puso y hace cuántos días. El número solo
 * no alcanza: un 1530 cargado hoy y un 1530 que quedó de hace tres meses se
 * leen igual en la pantalla y significan cosas opuestas.
 */
export const getUsdRate = async () => {
  const response = await api.get('/platform/usd-rate')

  return unwrap(response)
}

/** Carga a mano los pesos por dólar. `rate: null` vuelve al valor por defecto. */
export const updateUsdRate = async ({ rate, reason }) => {
  const response = await api.put('/platform/usd-rate', { rate, reason })

  return unwrap(response)
}

/**
 * Suspende o reactiva un comercio ENTERO.
 *
 * No borra nada: mueve `status` entre 'active' y 'suspended'. El corte lo aplica
 * tenantMiddleware, que resuelve únicamente comercios activos, así que un
 * suspendido deja de responder tanto en su tienda como en su panel — y sus
 * productos, órdenes, clientes e historial quedan intactos.
 *
 * Distinto de updateTenantAiPolicy({ suspended }), que corta SOLO la IA y deja
 * al comercio vendiendo.
 */
export const updateTenantStatus = async ({ tenantId, suspended, reason }) => {
  const response = await api.put(`/platform/tenant/${tenantId}/status`, { suspended, reason })

  return unwrap(response)
}
