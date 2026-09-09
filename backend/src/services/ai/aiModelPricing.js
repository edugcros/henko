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
 * Tarifa a aplicar por defecto cuando el modelo no está en el catálogo.
 *
 * Se usa la MÁS CARA de la familia en uso, no un promedio: si aparece un modelo
 * desconocido, sobreestimar el costo hace que el presupuesto corte antes de
 * tiempo, y subestimarlo hace que se pase sin avisar. De los dos errores, el
 * primero se nota y el segundo llega en la factura.
 */
const FALLBACK = { input: 1.5, output: 9.0, fallback: true }

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
    return { model: name, input: entry.input, output: entry.output }
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

  return { model: name, ...FALLBACK }
}

/**
 * Costo en USD de un consumo, con el desglose que lo justifica.
 *
 * Devuelve también la tarifa aplicada para que el ledger la congele: sin eso,
 * recalcular un costo histórico daría un número distinto en cuanto cambie el
 * catálogo.
 *
 * Cuando solo se conoce el total de tokens —que es el caso de casi todos los
 * call sites hoy, porque Gemini devuelve totalTokenCount— se reparte con
 * `assumedInputRatio`. Queda declarado en el resultado como `estimated: true`
 * para que un costo repartido no se confunda con uno medido.
 */
export const computeCostUsd = ({
  model,
  inputTokens = null,
  outputTokens = null,
  totalTokens = null,
  at = new Date(),
  // 0.8 sale de la medición del prompt de visión: ~3.900 tokens de entrada
  // más la imagen contra ~1.000 de salida. El agente tiene una proporción
  // parecida. Es un supuesto, y por eso viaja marcado.
  assumedInputRatio = 0.8,
} = {}) => {
  const price = getModelPrice(model, at)

  let input = Number(inputTokens)
  let output = Number(outputTokens)
  let estimated = false

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

    input = Math.round(total * assumedInputRatio)
    output = total - input
    estimated = true
  }

  input = Math.max(0, input)
  output = Math.max(0, output)

  const costUsd = (input * price.input + output * price.output) / M

  return {
    costUsd: Number(costUsd.toFixed(6)),
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    price,
    estimated,
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
