/**
 * demandScoreEngine.js
 *
 * Cálculo determinístico del Market Demand Score (0-100), con los pesos de
 * la sección 4 del spec:
 *
 *   Demanda           30%
 *   Tendencia         20%
 *   Competencia       15%
 *   Interés social    10%
 *   Actividad comercial 15%
 *   Oportunidad       10%
 *
 * REDISTRIBUCIÓN DE PESOS (corrección de un bug real observado):
 * Antes, un componente sin datos puntuaba 0 y arrastraba su peso completo
 * hacia abajo. Con MELI y Gemini caídos, un producto real dio 2/100 y se
 * clasificó "Demanda baja" — pero eso NO era una medición de demanda baja,
 * era ausencia de medición presentada como si fuera un resultado.
 *
 * Ahora cada scorer devuelve null cuando no hay datos para evaluarlo, y el
 * score se calcula solo sobre los componentes medibles, renormalizando sus
 * pesos. El resultado se acompaña de `measuredWeight`: qué proporción del
 * modelo se pudo evaluar realmente. Un score calculado sobre el 10% del
 * modelo NO es comparable con uno calculado sobre el 100%, y el
 * confidenceScore + la UI deben reflejarlo.
 *
 * Distinguir "no hay demanda" de "no pude medir la demanda" es el punto
 * central de la sección 14 del spec ("no inventar datos"): puntuar 0 por
 * falta de fuente es, en la práctica, inventar un dato negativo.
 */

/**
 * Versión del modelo de scoring.
 *
 * SUBIR ESTE NÚMERO cada vez que cambie algo que altere el score de los
 * mismos inputs: pesos, multiplicadores de los scorers, umbral de cobertura,
 * o la lógica de qué cuenta como "no medible".
 *
 * El orquestador filtra el cache por esta versión, así que subirla invalida
 * automáticamente todos los análisis calculados con la fórmula anterior. Sin
 * esto, un cambio de fórmula convive hasta 24h con resultados viejos
 * calculados de otra manera, y dos productos idénticos pueden mostrar scores
 * distintos según cuándo se analizaron.
 *
 * Historial:
 *   1 — versión inicial (un componente sin datos puntuaba 0)
 *   2 — redistribución de pesos + umbral mínimo de cobertura (MIN_COVERAGE)
 *   3 — la BI interna alimenta demand y commercial, no solo opportunity
 *   4 — MELI retirado (API cerrada): competencia pasa a medirse con Gemini
 *   5 — no se emite score cuando las señales internas no tienen varianza
 *   6 — las ofertas del buscador de precios alimentan competencia y actividad
 *       comercial. Hasta acá la única fuente externa que funcionaba no entraba
 *       al score: doce análisis reales de producción salieron con 1 a 9 puntos
 *       sobre el 55% del modelo, teniendo ocho a cuarenta ofertas de mercado
 *       medidas y guardadas en el mismo documento.
 */
export const SCORING_VERSION = 6

const WEIGHTS = {
  demand: 0.30,
  trend: 0.20,
  competition: 0.15,
  social: 0.10,
  commercial: 0.15,
  opportunity: 0.10,
}

/**
 * @param {Object} rawSignals - { meli, gemini, internal } de sources/
 * @returns {{ total: number|null, components: Object, measuredWeight: number, unmeasured: string[] }}
 */
export function calculateDemandScore(rawSignals) {
  // null = no medible con las fuentes disponibles (≠ 0 = medido y bajo)
  const components = {
    demand: scoreDemand(rawSignals),
    trend: scoreTrend(rawSignals),
    competition: scoreCompetition(rawSignals),
    social: scoreSocial(rawSignals),
    commercial: scoreCommercial(rawSignals),
    opportunity: scoreOpportunity(rawSignals),
  }

  const measured = Object.entries(components).filter(([, value]) => value !== null)
  const unmeasured = Object.entries(components)
    .filter(([, value]) => value === null)
    .map(([key]) => key)

  // Señales internas sin varianza: el producto está en catálogo, no vendió
  // nada, y su categoría tampoco. Con eso demand=10, commercial=0 y
  // opportunity=20 SIEMPRE, sin importar de qué producto se trate — el
  // score da 9/100 para cualquier consulta.
  //
  // Un número idéntico para todo no es una medición, es un artefacto del
  // cálculo. Y es peor que decir "no sé", porque tiene forma de análisis.
  // Sin fuentes externas y sin historial de ventas, no hay nada que medir.
  if (isDegenerateInternalOnly(rawSignals)) {
    return {
      total: null,
      components,
      measuredWeight: 0,
      unmeasured: Object.keys(components),
      degenerate: true,
    }
  }

  const measuredWeight = measured.reduce((sum, [key]) => sum + WEIGHTS[key], 0)

  // Umbral mínimo de cobertura. No alcanza con que ALGO sea medible: un score
  // calculado sobre el 10% del modelo (solo `opportunity`, con demanda,
  // tendencia y competencia caídas) produce un número que parece una
  // medición de demanda sin serlo — la demanda es justamente lo que no se
  // pudo medir. Por debajo de este umbral no se emite score.
  //
  // 0.35 es deliberado: exige al menos `demand` (0.30) más algo, o alguna
  // combinación con peso comparable. Ningún componente suelto lo alcanza.
  const MIN_COVERAGE = 0.35

  if (measuredWeight < MIN_COVERAGE) {
    return { total: null, components, measuredWeight: Number(measuredWeight.toFixed(2)), unmeasured }
  }

  // Renormalización: los pesos de los componentes medibles se reescalan para
  // sumar 1, de modo que el score refleje la evidencia que sí existe.
  const weightedSum = measured.reduce((sum, [key, value]) => sum + value * WEIGHTS[key], 0)
  const total = weightedSum / measuredWeight

  return {
    total: Math.round(total),
    components,
    measuredWeight: Number(measuredWeight.toFixed(2)),
    unmeasured,
  }
}

// TODO CALIBRACIÓN: los multiplicadores (* 10, / 5, / 10) siguen siendo
// heurísticas sin calibrar contra datos reales. Hasta ajustarlos con un set
// de productos de comportamiento conocido, los scores sirven para ordenar
// productos entre sí, no como valores absolutos.

/**
 * Demanda: intención de búsqueda externa (Gemini) o, si no hay, ventas
 * reales del tenant.
 *
 * Las ventas propias son evidencia de demanda MÁS dura que la intención de
 * búsqueda — alguien que compró pesa más que alguien que buscó. Pero es
 * demanda de ESTE comercio, no del mercado, así que se topea en 70: sin
 * señal externa no hay forma de saber si el mercado la valida más allá de
 * la propia clientela.
 */
function scoreDemand(signals) {
  const intent = signals.gemini?.searchIntent

  if (intent) {
    const weighted =
      (intent.informational || 0) * 0.2 +
      (intent.commercial || 0) * 0.5 +
      (intent.transactional || 0) * 1.0
    return clamp(weighted * 10, 0, 100)
  }

  // Sin intención de búsqueda externa, lo único que queda son las ventas
  // propias — y eso mide la demanda de MI clientela, no la del mercado. Se usa
  // solo cuando no hay ninguna señal externa: ahí el análisis se presenta
  // explícitamente como interno y responde otra pregunta.
  //
  // Mezclarlas era el resultado más falso de la herramienta. Una Coca-Cola de
  // 2,25 L, con decenas de vendedores publicándola, salía "no conviene" porque
  // esta tienda había vendido una sola unidad en 90 días: una venta propia
  // valía 2 puntos sobre 100 y pesaba el 30% del puntaje, así que hundía
  // cualquier producto con un mercado enorme detrás.
  const hasExternal = signals.shopping?.available || signals.gemini?.available
  if (hasExternal) return null

  const internal = signals.internal
  if (!internal?.available || !internal.isInCatalog) return null

  const units = internal.unitsSoldLast90Days
  if (units == null) return null

  // 0 ventas en 90 días CON stock disponible es una medición real de demanda
  // interna baja, no ausencia de dato: el producto estuvo a la venta y nadie
  // lo compró. Sin stock, en cambio, no se puede concluir nada.
  if (units === 0) {
    return internal.currentStock > 0 ? 10 : null
  }

  // TODO CALIBRACIÓN: la escala asume que ~35 unidades/90d es demanda fuerte
  // para un comercio chico. Ajustar con datos reales de varios tenants.
  return clamp(units * 2, 0, 70)
}

function scoreTrend(signals) {
  const direction = signals.gemini?.trendDirection

  // INDETERMINADA significa "no pude determinarlo", no "no hay tendencia".
  if (!direction || direction === 'INDETERMINADA') return null

  const map = { CRECIENTE: 80, ESTABLE: 50, DECRECIENTE: 20 }
  return map[direction] ?? null
}

/**
 * Competencia. Se mide con el conteo real de vendedores que publican el
 * producto —dato duro— y solo si eso no está, con la lectura de Gemini.
 *
 * Esto estaba al revés de lo que la evidencia permitía: la competencia salía
 * únicamente de Gemini, y cuando Gemini no contestaba quedaba "no medible"
 * aunque el buscador de ofertas hubiera devuelto siete vendedores distintos
 * publicando el producto. Un conteo de vendedores es exactamente lo que este
 * componente quiere medir, y es más duro que una opinión del modelo.
 *
 * Más competencia no es automáticamente peor (sección 8 del spec): mide
 * validación de mercado tanto como dificultad de entrada. Por eso la escala
 * sube con la cantidad de vendedores en vez de bajar.
 */
function scoreCompetition(signals) {
  const merchants = signals.shopping?.available
    ? Number(signals.shopping.merchantCount || 0)
    : null

  if (merchants !== null && merchants > 0) {
    // TODO CALIBRACIÓN: los cortes salen de la misma escala cualitativa que
    // usaba Gemini (BAJA 40 → MUY_ALTA 90), traducida a conteos de vendedores.
    if (merchants >= 15) return 90
    if (merchants >= 8) return 85
    if (merchants >= 4) return 70
    return 40
  }

  // Cero vendedores CON el buscador respondiendo es una medición, no un vacío:
  // nadie lo publica en ese mercado.
  if (merchants === 0) return 20

  const level = signals.gemini?.competition?.level

  if (!level || level === 'INDETERMINADA') return null

  const map = { BAJA: 40, MEDIA: 70, ALTA: 85, MUY_ALTA: 90 }
  return map[level] ?? null
}

function scoreSocial(signals) {
  const mentions = signals.gemini?.socialSignals?.mentions
  if (mentions === 'NO_DISPONIBLE' || mentions == null) return null

  return clamp(mentions / 10, 0, 100)
}

/**
 * Actividad comercial: cuánto mercado activo hay alrededor del producto.
 *
 * Sin MELI no hay ventas visibles de marketplace, así que se mide con tres
 * señales, de la más dura a la más blanda:
 *
 *   - ofertas publicadas hoy en el buscador de precios (hay oferta viva, y
 *     cuántas)
 *   - un rango de precios que Gemini haya observado (más blando: dice que hay
 *     mercado, no cuánto)
 *   - la rotación de la categoría en el catálogo propio
 *
 * Antes solo miraba las dos últimas. Con el buscador devolviendo cuarenta
 * ofertas de un producto, "actividad comercial" puntuaba 1 porque la
 * categoría del comercio había vendido una unidad.
 */
function scoreCommercial(signals) {
  const categoryUnits = signals.internal?.categoryUnitsSold
  const offerCount = signals.shopping?.available
    ? Number(signals.shopping.offerCount || 0)
    : null
  const hasPublishedPrices = Boolean(signals.gemini?.priceRange?.min)

  if (offerCount === null && categoryUnits == null && !hasPublishedPrices) {
    return null
  }

  // TODO CALIBRACIÓN: la escala asume que ~20 ofertas simultáneas ya es un
  // mercado plenamente activo.
  const offerSignal =
    offerCount !== null ? clamp(offerCount * 4, 0, 80) : 0

  // Precios publicados = hay mercado activo, pero no dice cuánto se vende.
  const priceSignal = hasPublishedPrices ? 40 : 0

  // Topeado en 60: es actividad de la categoría, no del producto.
  const internalSignal = categoryUnits != null ? clamp(categoryUnits, 0, 60) : 0

  return clamp(Math.max(offerSignal, priceSignal, internalSignal), 0, 100)
}

function scoreOpportunity(signals) {
  const complaints = signals.gemini?.recurringComplaints
  const internal = signals.internal

  if (!Array.isArray(complaints) && !internal?.available) return null

  let score = Array.isArray(complaints) ? clamp(complaints.length * 15, 0, 70) : 0

  // Categoría que rota pero producto que no: hueco en el catálogo propio.
  if (internal?.isInCatalog && internal?.unitsSoldLast90Days === 0 && internal?.categoryUnitsSold > 0) {
    score += 30
  } else if (internal?.isInCatalog && internal?.unitsSoldLast90Days === 0) {
    score += 20
  }

  // Producto que NO está en el catálogo: si alguna fuente externa muestra
  // demanda, es una oportunidad no cubierta.
  if (internal?.available && internal?.isInCatalog === false && signals.gemini?.available) {
    score += 25
  }

  return clamp(score, 0, 100)
}

/**
 * ¿El único aporte son señales internas constantes?
 *
 * Devuelve true cuando no hay ninguna fuente externa Y el tenant no tiene
 * ventas del producto ni de su categoría: ahí todo lo que queda son reglas
 * fijas que no distinguen un producto de otro.
 */
function isDegenerateInternalOnly(signals) {
  const hasExternal = signals.shopping?.available || signals.gemini?.available
  if (hasExternal) return false

  const internal = signals.internal
  if (!internal?.available) return true // ni siquiera hay señal interna

  const productSales = internal.unitsSoldLast90Days
  const categorySales = internal.categoryUnitsSold

  // Con ventas (del producto o de su categoría) el score sí varía entre
  // productos, así que vale emitirlo aunque sea solo interno.
  const hasSalesVariance = productSales > 0 || categorySales > 0

  return !hasSalesVariance
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
