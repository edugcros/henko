// 📁 src/models/aiUsageModel.js
import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

// Un documento por tenant por período (mensual, 'YYYY-MM' en UTC).
// Separado del modelo Tenant a propósito: Tenant se lee en cada resolución
// de dominio (tráfico alto), y este contador se escribe en cada análisis
// IA — mezclarlos generaría contención de escritura sobre un documento
// que el resto del sistema necesita leer rápido y seguido.
const aiUsageSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    period: {
      type: String,
      required: true,
      trim: true,
    },

    // Contador histórico de análisis de imagen. Se mantiene sincronizado con
    // counters.vision porque el panel viejo y los snapshots guardados lo leen
    // por este nombre; el que manda para cobrar cuota es counters.vision.
    analysisCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Cuánto se gastó contra la key de la plataforma, en USD aproximados.
    // Es la única forma de contestar "¿qué tenant me está quemando la
    // factura?" sin exportar nada desde Google.
    estimatedCostUsd: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Plata comprometida por operaciones en vuelo de ESTE comercio.
     *
     * POR QUÉ HACE FALTA, Y POR QUÉ NO ALCANZABA CON estimatedCostUsd
     *
     * El tope por comercio existía sólo en TOKENS, y el propio catálogo de
     * precios explica por qué eso no controla el gasto: entre un modelo y otro
     * de la cadena hay 5x de diferencia de tarifa, así que el mismo tope de
     * tokens puede costar veinte dólares o cien según quién conteste — y eso lo
     * decide la cadena de respaldo, no una política. El techo en plata existía
     * sólo a nivel plataforma, o sea que cuando UN comercio se desbocaba el
     * disyuntor cortaba para TODOS.
     *
     * Para poner un techo en plata por comercio hace falta comprometer antes de
     * gastar: el costo real recién se conoce después de la respuesta, y
     * comprobar-y-después-gastar deja pasar cien pedidos simultáneos. Es el
     * mismo razonamiento —y el mismo campo— que ya tiene AiPlatformUsage.
     *
     * Se libera apenas se sabe el costo real, en liquidarReserva.
     */
    reservedCostUsd: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Consumo que corrió con la API key propia del tenant (BYOK). No cuenta
    // contra los topes del plan, pero se registra igual: sin este número no
    // se puede dimensionar a qué plan corresponde un comercio.
    byokTokens: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastAnalysisAt: {
      type: Date,
      default: null,
    },

    lastActivityAt: {
      type: Date,
      default: null,
    },
    // Un contador por métrica de aiPlanPolicy. Van en el mismo documento
    // (y no en uno por métrica) para que el mes de un tenant se lea con una
    // sola query: el panel los muestra siempre juntos.
    //
    // `counters` estaba declarado DOS veces. En un objeto de JavaScript gana el
    // último, así que este —el completo— era el que valía y todo funcionaba. Pero
    // el primero tenía solo cuatro métricas: si alguien reordenaba o borraba
    // este bloque, el schema perdía marketAnalyses y marketTokens sin un solo
    // error, y el consumo de los análisis de mercado dejaba de contarse.
    counters: {
      vision: { type: Number, default: 0, min: 0 },
      agentMessages: { type: Number, default: 0, min: 0 },
      agentTokens: { type: Number, default: 0, min: 0 },
      imageEdits: { type: Number, default: 0, min: 0 },
      marketAnalyses: { type: Number, default: 0, min: 0 },
      marketTokens: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true },
)

aiUsageSchema.plugin(tenantPlugin)
aiUsageSchema.index({ tenantId: 1, period: 1 }, { unique: true })

// Para el ranking de gasto del mes en el panel de plataforma.
aiUsageSchema.index({ period: 1, estimatedCostUsd: -1 })

export default mongoose.model('AiUsage', aiUsageSchema)
