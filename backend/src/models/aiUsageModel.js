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

    // Un contador por métrica de aiPlanPolicy. Van en el mismo documento
    // (y no en uno por métrica) para que el mes de un tenant se lea con una
    // sola query: el panel los muestra siempre juntos.
    counters: {
      vision: { type: Number, default: 0, min: 0 },
      agentMessages: { type: Number, default: 0, min: 0 },
      agentTokens: { type: Number, default: 0, min: 0 },
      imageEdits: { type: Number, default: 0, min: 0 },
    },

    // Cuánto se gastó contra la key de la plataforma, en USD aproximados.
    // Es la única forma de contestar "¿qué tenant me está quemando la
    // factura?" sin exportar nada desde Google.
    estimatedCostUsd: {
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
  },
  { timestamps: true },
)

aiUsageSchema.plugin(tenantPlugin)
aiUsageSchema.index({ tenantId: 1, period: 1 }, { unique: true })

// Para el ranking de gasto del mes en el panel de plataforma.
aiUsageSchema.index({ period: 1, estimatedCostUsd: -1 })

export default mongoose.model('AiUsage', aiUsageSchema)
