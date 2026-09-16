// 📁 src/services/ai/aiModelPricing.js
//
// Catálogo central de precios de los modelos de IA.
//
// Antes de esto el costo salía de una sola tarifa mezclada
// (AI_COST_USD_PER_1M_TOKENS) que no distinguía entrada de salida ni un modelo
// de otro. Servía para el panel; no para contabilidad.
//
// Las tarifas tienen VIGENCIA. Google ya anunció que los modelos 3.x duplican
// precio el 1/1/2027, así que un catálogo sin fechas haría que una operación
// de agosto cambie de costo retroactivamente el día que suba la tarifa. Por eso
// getModelPrice recibe la fecha del consumo, y por eso el ledger guarda el
// precio que se usó en vez de una referencia al catálogo.
//
// Verificado contra ai.google.dev/gemini-api/docs/pricing el 07/09/2026.
// Los precios son USD por millón de tokens.

import logger from '../../../config/logger.js'

const M = 1_000_000

/**
 * Una entrada por modelo y ventana de vigencia.
 *
 * `until: null` significa "hasta nuevo aviso". Cuando Google anuncie otro
 * cambio, se cierra la ventana abierta y se agrega la nueva — no se edita la
 * vieja, o se reescribe la historia.
 */
const CATALOG = [
  // Familia 3.x — la tarifa vigente hasta fin de 2026.
  {
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'],
    from: null,
    until: '2027-01-01T00:00:00.000Z',
    input: 0.75,
    output: 3.75,
  },
  // La duplicación ya anunciada. Entra sola el 1/1/2027 sin tocar código.
  {
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'],
    from: '2027-01-01T00:00:00.000Z',
    until: null,
    input: 1.5,
    output: 7.5,
  },

  { models: ['gemini-3.5-flash'], from: null, until: null, input: 1.5, output: 9.0 },
  { models: ['gemini-3.5-flash-lite'], from: null, until: null, input: 0.3, output: 2.5 },
  { models: ['gemini-3.1-flash-lite'], from: null, until: null, input: 0.25, output: 1.5 },
  { models: ['gemini-2.5-flash'], from: null, until: null, input: 0.3, output: 2.5 },
  { models: ['gemini-2.5-flash-lite'], from: null, until: null, input: 0.1, output: 0.4 },
]


/**
 * Herramientas: lo que se paga POR LLAMADA, no por token.
 *
 * POR QUÉ HACE FALTA, CON EL NÚMERO QUE LO JUSTIFICA
 *
 * Toda la contabilidad de este archivo asumía que la IA se cobra por tokens.
 * Para el análisis de mercado eso deja afuera lo que más cuesta. Sobre
 * 2026-09, con el consumo de herramientas ya medido:
 *
 *   tokens de mercado               48 llamadas · USD 0,0585
 *   créditos de Tavily             192          · USD 1,5360   ← era invisible
 *
 * La herramienta cuesta 26 VECES lo que los tokens, y no aparecía en ningún
 * lado: ni en el ledger, ni en el disyuntor, ni en el reporte. Con eso ya se
 * iba el 19% del cupo gratis mensual sin que nadie lo viera.
 *
 * EL CONSUMO POR ANÁLISIS ES MEDIDO, NO ESTIMADO
 *
 * La primera versión de este comentario decía "~5 créditos" y salía de leer el
 * código: una búsqueda de shopping, una de research y una extracción de hasta
 * 12 URLs. Las tres primeras corridas reales, ya con las filas en la base,
 * dieron 4,00 créditos las tres:
 *
 *   tavily_search   3   shopping busca una vez y REINTENTA con filtro de país
 *                       cuando la primera trae pocas ofertas, más la de
 *                       research
 *   tavily_extract  1   las páginas que resolvieron entraron en un solo tramo
 *                       de cinco, no en tres
 *
 * O sea que la lectura del código se equivocaba de los dos lados a la vez:
 * de menos en las búsquedas y de más en la extracción. Por eso el número que
 * queda acá es el de la base y no el del razonamiento.
 *
 * EL PRECIO SALE DE LA TARIFA PUBLICADA, NO DE UN SUPUESTO
 *
 * Tavily: 1.000 créditos gratis por mes; pay-as-you-go a USD 0,008 el crédito
 * (los planes mensuales bajan de 0,0075 a 0,005). Se costea al precio de
 * pay-as-you-go a propósito: es el techo, y para un disyuntor conviene el
 * número que no subestima. Los créditos dentro del cupo gratis no se facturan,
 * pero sí se gastan, y un cupo que se agota a mitad de mes deja sin análisis a
 * todos los comercios — exactamente lo que el disyuntor existe para anticipar.
 *
 * Google Search grounding está declarado y hoy vale cero porque NO SE USA: el
 * parámetro `tools` de callGemini no lo pasa ningún llamador, y el grounding
 * se probó y se abandonó (con `tools`, la API devuelve 429 en todos los
 * modelos de la cadena — ver webResearchSource.js). Queda con su entrada lista
 * para el día que se reactive, con cantidad cero mientras tanto.
 *
 * Lleva vigencia por el mismo motivo que los modelos: corregir una tarifa
 * hacia adelante no puede reescribir lo que costó el mes pasado.
 */
/**
 * Familias de herramientas.
 *
 * POR QUÉ UNA FAMILIA Y NO UN CAMPO POR HERRAMIENTA.
 *
 * El pedido era una estructura tipo toolCost.googleSearch / .maps /
 * .grounding / .function, con la consigna correcta al lado: "no agregar
 * campos aislados cada vez que aparece una nueva herramienta".
 *
 * Esa consigna es justo la que rompe esa estructura: cada herramienta nueva
 * sería una clave nueva —o sea, un campo aislado— más una migración, más cada
 * consulta del reporte tocada. Por eso la herramienta viaja como VALOR y no
 * como campo: `tool: 'tavily_search'`. Sumar una es agregar una fila a este
 * catálogo y nada más; el esquema, el reporte y la reconciliación no se
 * enteran.
 *
 * Lo que sí faltaba de ese pedido, y es lo que aporta, es poder agrupar sin
 * enumerar nombres: "cuánto se fue en buscar" no debería obligar a acordarse
 * de que existen tavily_search y google_search. Para eso está la familia.
 *
 * Las familias describen QUÉ HACE la herramienta, no quién la vende: el día
 * que se cambie de proveedor de búsqueda, la serie histórica sigue siendo
 * comparable.
 */
export const TOOL_FAMILY = Object.freeze({
  WEB_SEARCH: 'webSearch',
  CONTENT_EXTRACTION: 'contentExtraction',
  MAPS: 'maps',
  FUNCTION_CALLING: 'functionCalling',
  OTHER: 'other',
})

const TOOL_CATALOG = [
  // Tavily — https://docs.tavily.com/documentation/api-credits
  // La unidad es el CRÉDITO, no la llamada: una búsqueda basic gasta 1, una
  // advanced 2, y una extracción 1 cada 5 URLs resueltas. Quien llama cuenta
  // los créditos; acá solo se los pone precio.
  {
    tools: ['tavily_search'],
    family: TOOL_FAMILY.WEB_SEARCH,
    from: null,
    until: null,
    unitCostUsd: 0.008,
  },
  {
    tools: ['tavily_extract'],
    family: TOOL_FAMILY.CONTENT_EXTRACTION,
    from: null,
    until: null,
    unitCostUsd: 0.008,
  },

  /**
   * Google Search grounding. USD 35 por 1.000 consultas = 0,035 cada una.
   *
   * LA UNIDAD ES LA CONSULTA, Y ESO CAMBIÓ CON LA GENERACIÓN 3.
   *
   * En Gemini 2.5 y anteriores se facturaba POR PROMPT: una request con tres
   * búsquedas adentro costaba una. Desde la 3 se factura por cada consulta que
   * el modelo decide ejecutar, y HENKO corre 3.x — así que una sola respuesta
   * puede costar varias veces esto.
   *
   * Hoy la cantidad es siempre cero: el parámetro `tools` de callGemini no lo
   * pasa ningún llamador. Y no es por olvido — verificado contra la API con la
   * key de producción HOY, los tres modelos de la cadena devuelven 429 con
   * `tools` puesto y 200 sin él. El precio queda cargado para el día que eso
   * cambie, y contarlo ya es automático (ver readUsage).
   */
  {
    tools: ['google_search'],
    family: TOOL_FAMILY.WEB_SEARCH,
    from: null,
    until: null,
    unitCostUsd: 0.035,
  },
]

/** Tarifa a aplicar si la herramienta no está en el catálogo. */
const TOOL_FALLBACK_UNIT_COST = 0.05

const warnedTools = new Set()

/**
 * Precio por unidad de una herramienta, a la fecha del consumo.
 *
 * @param {string} tool
 * @param {Date} [at=new Date()]
 * @returns {{tool:string, unitCostUsd:number, fallback?:boolean}}
 */
export const getToolPrice = (tool, at = new Date()) => {
  const name = String(tool || '').trim().toLowerCase()
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()

  const entry = TOOL_CATALOG.find(e => e.tools.includes(name) && inWindow(e, when))

  if (entry) {
    return {
      tool: name,
      family: entry.family || TOOL_FAMILY.OTHER,
      unitCostUsd: entry.unitCostUsd,
    }
  }

  if (name && !warnedTools.has(name)) {
    warnedTools.add(name)
    logger.warn('[AI PRICING] Herramienta fuera del catálogo, se usa la tarifa conservadora', {
      tool: name,
      assumedUnitCostUsd: TOOL_FALLBACK_UNIT_COST,
    })
  }

  return {
    tool: name,
    family: TOOL_FAMILY.OTHER,
    unitCostUsd: TOOL_FALLBACK_UNIT_COST,
    fallback: true,
  }
}

/**
 * Costo de N unidades de una herramienta.
 *
 * SEPARADO DEL COSTO POR TOKENS, Y ES EL PUNTO.
 *
 * Mezclarlos en un solo número hace imposible contestar la pregunta que
 * importa —"¿esto se va en modelo o en herramientas?"— y esa pregunta tiene
 * respuestas opuestas: si se va en tokens, la palanca es el modelo o el
 * prompt; si se va en herramientas, es cuántas páginas se extraen.
 *
 * @param {Object} params
 * @param {string} params.tool     - 'tavily_search', 'google_search'…
 * @param {number} params.quantity - unidades (créditos, consultas)
 * @param {Date}   [params.at]     - fecha del consumo, no del cálculo
 * @returns {{tool:string, quantity:number, unitCostUsd:number, costUsd:number, fallback:boolean}}
 */
export const computeToolCostUsd = ({ tool, quantity, at = new Date() } = {}) => {
  const price = getToolPrice(tool, at)
  const amount = Number(quantity)
  const unidades = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0

  return {
    tool: price.tool,
    // Para poder preguntar "cuánto se fue en buscar" sin tener que acordarse
    // de qué herramientas hacen eso.
    family: price.family,
    quantity: unidades,
    unitCostUsd: price.unitCostUsd,
    costUsd: Number((unidades * price.unitCostUsd).toFixed(6)),
    fallback: Boolean(price.fallback),
  }
}

/**
 * Generación de imágenes, que NO se cobra por token.
 *
 * Replicate y HuggingFace cobran por imagen, así que no entra en la tabla de
 * arriba: no hay entrada ni salida que separar. Pero es un PRECIO, y los
 * precios viven en este archivo — estaba en aiPlanPolicy.js, que es el archivo
 * de planes y topes, o sea de lo que el comercio RECIBE. Cuánto le cuesta a
 * HENKO es otra pregunta y tenía su propia respuesta suelta.
 *
 * Lleva vigencia por el mismo motivo que los modelos: el día que se corrija la
 * tarifa con datos reales de facturación, las imágenes de agosto tienen que
 * seguir costando lo que costaron. Sin fechas, corregir el número hacia
 * adelante reescribe la historia hacia atrás.
 *
 * El 0,02 es una estimación conservadora sobre el costo documentado de
 * Replicate (flux-schnell más el respaldo ocasional de quitar fondo), no una
 * factura. AI_COST_USD_PER_IMAGE_EDIT lo corrige sin tocar código, y cuando
 * haya una cifra real conviene cerrar esta ventana y abrir una nueva en vez de
 * editar esta.
 */
const IMAGE_CATALOG = [
  { from: null, until: null, perImage: 0.02 },
]

/**
 * Precio de UNA generación de imagen, a la fecha del consumo.
 *
 * @param {Date} [at=new Date()] - fecha del consumo, no del cálculo
 * @returns {{perImage:number, source:'env'|'catalog'}}
 */
export const getImagePrice = (at = new Date()) => {
  // El override de entorno gana, y se informa como tal: un número que no salió
  // del catálogo tiene que poder distinguirse cuando alguien audite el gasto.
  const override = Number(process.env.AI_COST_USD_PER_IMAGE_EDIT)
  if (Number.isFinite(override) && override >= 0) {
    return { perImage: override, source: 'env' }
  }

  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()
  const entry = IMAGE_CATALOG.find(e => inWindow(e, when))

  return { perImage: entry ? entry.perImage : 0, source: 'catalog' }
}

/**
 * Costo de N generaciones de imagen.
 *
 * Vivía en aiPlanPolicy.js como estimateImageCostUsd. Se mudó acá sin cambiar
 * el número: dos archivos que saben precios es exactamente la forma en que
 * vuelve el problema que el catálogo vino a resolver.
 */
export const computeImageCostUsd = (count, at = new Date()) => {
  const amount = Number(count)
  if (!Number.isFinite(amount) || amount <= 0) return 0

  return amount * getImagePrice(at).perImage
}

/**
 * Tarifa a aplicar por defecto cuando el modelo no está en el catálogo.
 *
 * Se usa la MÁS CARA de la familia en uso, no un promedio: si aparece un modelo
 * desconocido, sobreestimar el costo hace que el presupuesto corte antes de
 * tiempo, y subestimarlo hace que se pase sin avisar. De los dos errores, el
 * primero se nota y el segundo llega en la factura.
 */
const FALLBACK = { input: 1.5, output: 9.0, fallback: true }

/**
 * Los tokens de entrada servidos desde caché se cobran al 10% de la entrada.
 *
 * NO ES UN SUPUESTO: sale de la tabla de precios de Google, donde la línea de
 * caché de contexto es exactamente la décima parte de la de entrada, modelo
 * por modelo.
 *
 *   gemini-3.8-flash       entrada 0,75   caché 0,075
 *   gemini-3.5-flash-lite  entrada 0,30   caché 0,030
 *
 * Y NO HACE FALTA PEDIRLO. El caché implícito viene encendido por defecto en
 * Gemini 2.5 en adelante y Google pasa el ahorro solo: si el prompt repite
 * contexto reciente, la parte repetida se factura barata sin tocar una línea.
 *
 * Por eso importa. HENKO no configura caché ninguno y lo estaba usando igual,
 * sin verlo: medido en producción apenas se empezó a leer la clave, la llamada
 * de REPARACIÓN del agente —que reenvía la conversación entera— llegó con
 * 4.075 de sus 8.525 tokens de entrada servidos desde caché. Cobrándolos a
 * tarifa plena, esa fila salía USD 0,002236 contra 0,001319 reales: 41% de
 * MÁS.
 *
 * Y de más es tan malo como de menos, por otro motivo: el disyuntor de
 * plataforma corta cuando el gasto acumulado llega al techo. Sobrestimarlo
 * deja sin IA a todos los comercios antes de tiempo.
 *
 * El caché implícito no tiene costo de almacenamiento, así que no hay una
 * tercera línea que sumar. El explícito sí lo tiene, y el día que se use habrá
 * que contarlo aparte — no existe hoy en el código.
 */
const CACHED_INPUT_RATIO = 0.1

/**
 * Proporción de ENTRADA supuesta cuando el proveedor no desglosó.
 *
 * ES UN CAMINO EXCEPCIONAL Y NO DEBERÍA RECORRERSE NUNCA. Gemini devuelve
 * promptTokenCount en toda respuesta —verificado incluso en una cortada a un
 * token de salida— así que desde que readUsage dejó de confundir un cero
 * medido con una ausencia, no queda caso conocido que llegue acá. Si alguno
 * llega, sale por log con tenant, métrica, modelo y operación, y la fila queda
 * marcada con costEstimated para poder encontrarla.
 *
 * VA POR FEATURE PORQUE LA MEDICIÓN DICE QUE IMPORTA.
 *
 * Había un único 0,8 global. Medido sobre las 119 filas con desglose real de
 * producción, al 16/09/2026:
 *
 *   agentTokens    69 filas · entrada 510.200 · salida  6.365 → 0,988
 *   marketTokens   42 filas · entrada  91.848 · salida  5.751 → 0,941
 *   vision          8 filas · entrada  67.519 · salida 10.942 → 0,861
 *   global                                                    → 0,967
 *
 * El 0,8 se equivocaba en todas, y hacia arriba: suponer 20% de salida donde
 * la realidad es 1,2% casi duplica el costo de una fila del agente. No es
 * inocuo — el disyuntor de plataforma corta con ese número.
 *
 * Y TAMBIÉN POR MODELO, PERO SOLO DONDE HAY CON QUÉ.
 *
 * La proporción es sobre todo una propiedad del TRABAJO: un prompt del agente
 * es largo y su respuesta corta, conteste quien conteste. La medición por
 * (feature, modelo) lo confirma — donde hay muestra, el modelo no mueve la
 * aguja:
 *
 *   agentTokens   gemini-3.1-flash-lite   33 filas   0,987   (feature: 0,988)
 *   agentTokens   gemini-3.6-flash        28 filas   0,989
 *   marketTokens  gemini-3.1-flash-lite   20 filas   0,938   (feature: 0,941)
 *   marketTokens  gemini-3.5-flash-lite   18 filas   0,950
 *
 * Las divergencias que parecen grandes salen todas de muestras ínfimas:
 * agentTokens con gemini-3.5-flash-lite da 0,748 con UNA fila, y marketTokens
 * con gemini-3.6-flash da 0,827 con cuatro. Meter esos números en la tabla
 * sería precisión inventada, que es peor que el promedio de la feature.
 *
 * Por eso la dimensión por modelo EXISTE y se respeta, con una regla: solo
 * entra a la tabla el par que llegó a MUESTRA_MINIMA filas medidas. El que no
 * llega cae a la proporción de su feature, y una feature sin medición propia
 * cae al global. Tres niveles, del más específico al más general, y el
 * resultado informa cuál se usó para que un costo repartido se pueda auditar
 * sin adivinar de dónde salió el número.
 *
 * Al día de hoy los cuatro pares que califican difieren de su feature en menos
 * de 0,01 — o sea que la dimensión por modelo casi no cambia el número. Está
 * igual porque el día que un modelo nuevo tenga un perfil distinto de verdad,
 * la tabla ya tiene dónde ponerlo y la regla ya dice cuándo creerle.
 *
 * Estos números salen de una medición con fecha y hay que recalibrarlos si el
 * uso cambia. Por eso están acá, con el catálogo, y no escondidos en un
 * parámetro por defecto.
 */

/** Filas medidas que hace falta juntar antes de creerle a un par. */
const MUESTRA_MINIMA = 15

const ASSUMED_INPUT_RATIO = Object.freeze({
  agentTokens: 0.988,
  marketTokens: 0.941,
  vision: 0.861,
})

/**
 * Por (feature, modelo). Clave `${metric}|${model}`.
 *
 * Solo pares con MUESTRA_MINIMA filas medidas o más; el conteo va al lado
 * para que se pueda revisar si el número sigue mereciendo estar acá.
 */
const ASSUMED_INPUT_RATIO_BY_MODEL = Object.freeze({
  'agentTokens|gemini-3.1-flash-lite': 0.987, // 33 filas
  'agentTokens|gemini-3.6-flash': 0.989, //     28 filas
  'marketTokens|gemini-3.1-flash-lite': 0.938, // 20 filas
  'marketTokens|gemini-3.5-flash-lite': 0.95, //  18 filas
})

/** El global, para una métrica sin medición propia. */
const ASSUMED_INPUT_RATIO_DEFAULT = 0.967

/**
 * Proporción de entrada a suponer, del dato más específico al más general.
 *
 *   metric+model  el par medido, si junta muestra suficiente
 *   metric        el promedio de la feature
 *   default       el global, para una feature sin medir
 *
 * @param {string} [metric] - la métrica del consumo (agentTokens, vision…)
 * @param {string} [model]  - el modelo que respondió
 * @returns {{ratio:number, source:'metric+model'|'metric'|'default'}}
 */
export const getAssumedInputRatio = (metric, model) => {
  // normalize() es la misma forma canónica con la que se busca el precio: sin
  // esto 'models/Gemini-3.6-Flash' no encontraría su par y caería un nivel.
  const porModelo =
    metric && model
      ? ASSUMED_INPUT_RATIO_BY_MODEL[`${metric}|${normalize(model)}`]
      : undefined

  if (porModelo !== undefined) return { ratio: porModelo, source: 'metric+model' }

  const porMetrica = ASSUMED_INPUT_RATIO[metric]
  if (porMetrica !== undefined) return { ratio: porMetrica, source: 'metric' }

  return { ratio: ASSUMED_INPUT_RATIO_DEFAULT, source: 'default' }
}

/**
 * Forma canónica del nombre de un modelo.
 *
 * Se exporta porque el nombre viaja a dos lados —al catálogo para buscar el
 * precio, y al ledger como dato del movimiento— y tienen que coincidir. Con
 * dos criterios distintos, 'models/Gemini-3.6-Flash' y 'gemini-3.6-flash'
 * quedan como dos filas del mismo modelo y el reporte por modelo los muestra
 * como dos gastos separados.
 */
export const normalizeModelName = model =>
  String(model || '')
    .trim()
    .replace(/^models\//, '')
    .toLowerCase()

const normalize = normalizeModelName

const inWindow = (entry, at) => {
  const t = at.getTime()
  if (entry.from && t < Date.parse(entry.from)) return false
  if (entry.until && t >= Date.parse(entry.until)) return false
  return true
}

const warnedModels = new Set()

/**
 * Precio vigente de un modelo en una fecha.
 *
 * @param {string} model
 * @param {Date} [at=new Date()] - fecha del consumo, no del cálculo
 * @returns {{input:number, output:number, fallback?:boolean, model:string}}
 */
export const getModelPrice = (model, at = new Date()) => {
  const name = normalize(model)
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()

  const entry = CATALOG.find(e => e.models.includes(name) && inWindow(e, when))

  if (entry) {
    return {
      model: name,
      input: entry.input,
      output: entry.output,
      // Por modelo si alguna vez Google rompe la regla del 10%; derivada
      // mientras tanto, para no repetir el mismo número siete veces.
      cachedInput: entry.cachedInput ?? entry.input * CACHED_INPUT_RATIO,
    }
  }

  // Una sola advertencia por modelo y proceso: si aparece uno nuevo conviene
  // enterarse, pero no a razón de una línea de log por request.
  if (name && !warnedModels.has(name)) {
    warnedModels.add(name)
    logger.warn('[AI PRICING] Modelo fuera del catálogo, se usa la tarifa conservadora', {
      model: name,
      assumedInputPerMillion: FALLBACK.input,
      assumedOutputPerMillion: FALLBACK.output,
    })
  }

  return {
    model: name,
    ...FALLBACK,
    cachedInput: FALLBACK.input * CACHED_INPUT_RATIO,
  }
}

/**
 * Costo en USD de un consumo, con el desglose que lo justifica.
 *
 * Devuelve también la tarifa aplicada para que el ledger la congele: sin eso,
 * recalcular un costo histórico daría un número distinto en cuanto cambie el
 * catálogo.
 *
 * Cuando solo se conoce el total de tokens hay que repartirlo, y eso es un
 * ÚLTIMO RECURSO, no el camino normal: ver ASSUMED_INPUT_RATIO. El resultado
 * viaja con `estimated: true` y con la proporción que se usó, para que un
 * costo repartido no se confunda nunca con uno medido.
 */
export const computeCostUsd = ({
  model,
  inputTokens = null,
  outputTokens = null,
  // Parte de inputTokens —no se suma aparte— que vino de caché y se cobra al
  // 10%. Ver CACHED_INPUT_RATIO.
  cachedInputTokens = null,
  totalTokens = null,
  at = new Date(),
  // De qué feature es el consumo. Solo se usa si hay que estimar, y ahí decide
  // con qué proporción: medida por feature, no una global para todas.
  metric = null,
  // El llamador puede imponer una, pero por defecto manda la medición.
  assumedInputRatio = null,
} = {}) => {
  const price = getModelPrice(model, at)

  let input = Number(inputTokens)
  let output = Number(outputTokens)
  let estimated = false
  let assumedRatio = null

  // Se pregunta si el dato VINO, no si su conversión es finita: Number(null)
  // es 0 y 0 es finito, así que confiar en Number.isFinite tomaba los defaults
  // en null por un desglose real de cero entrada y cero salida, y el costo
  // salía 0 con el precio correcto al lado.
  const given = v => v !== null && v !== undefined && Number.isFinite(Number(v))
  const hasDetail = given(inputTokens) && given(outputTokens)

  if (!hasDetail) {
    const total = Number(totalTokens ?? inputTokens ?? 0)

    if (!Number.isFinite(total) || total <= 0) {
      return {
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        price,
        estimated: false,
      }
    }

    const supuesto =
      assumedInputRatio !== null && Number.isFinite(Number(assumedInputRatio))
        ? { ratio: Number(assumedInputRatio), source: 'caller' }
        : getAssumedInputRatio(metric, model)

    input = Math.round(total * supuesto.ratio)
    output = total - input
    estimated = true
    assumedRatio = supuesto
  }

  input = Math.max(0, input)
  output = Math.max(0, output)

  // RED DE SEGURIDAD: el total manda sobre la suma del desglose.
  //
  // Así se descubrió que los tokens de pensamiento no se contaban: 40 filas de
  // producción tenían totalTokenCount mayor que promptTokenCount +
  // candidatesTokenCount, porque thoughtsTokenCount viajaba en una clave que
  // nadie leía. 23.836 tokens desaparecidos, 21,2% del costo histórico.
  //
  // aiUsageMetadata.js ya cierra ESE hueco por nombre. Esto cierra el próximo,
  // sea cual sea la clave que Google agregue: si el proveedor dice que el total
  // es mayor que lo que desglosó, el remanente se cobra, y se cobra como
  // SALIDA. No es arbitrario — es la categoría cara, y equivocarse hacia
  // abajo en el costo propio es el error que no se nota hasta la factura.
  const declaredTotal = Number(totalTokens)
  const residualTokens =
    hasDetail && Number.isFinite(declaredTotal) && declaredTotal > input + output
      ? declaredTotal - input - output
      : 0

  output += residualTokens

  // La parte cacheada sale de la entrada, no se suma: cachedContentTokenCount
  // es un SUBCONJUNTO de promptTokenCount. Sumarla contaría dos veces los
  // mismos tokens; el tope contra `input` es por si un proveedor informa algo
  // incoherente, porque cobrar entrada negativa sería peor que el bug.
  const cached = Math.min(Math.max(0, Number(cachedInputTokens) || 0), input)
  const freshInput = input - cached

  const costUsd =
    (freshInput * price.input + cached * price.cachedInput + output * price.output) / M

  return {
    costUsd: Number(costUsd.toFixed(6)),
    inputTokens: input,
    cachedInputTokens: cached || null,
    outputTokens: output,
    totalTokens: input + output,
    // Tokens que el proveedor cobró y no desglosó. Distinto de `estimated`:
    // acá el desglose vino, pero incompleto. Un valor > 0 sostenido es un
    // campo nuevo del proveedor que conviene leer por su nombre.
    residualTokens,
    price,
    estimated,
    // Con qué proporción se repartió, y de dónde salió. null cuando no hubo
    // que repartir, que es como debería ser siempre.
    assumedRatio,
  }
}

/** Todo el catálogo, para el panel y para diagnóstico. */
export const listModelPricing = (at = new Date()) =>
  CATALOG.filter(e => inWindow(e, at)).flatMap(e =>
    e.models.map(model => ({
      model,
      inputPerMillion: e.input,
      outputPerMillion: e.output,
      until: e.until,
    })),
  )
