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
    analysisCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastAnalysisAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
)

aiUsageSchema.plugin(tenantPlugin)
aiUsageSchema.index({ tenantId: 1, period: 1 }, { unique: true })

export default mongoose.model('AiUsage', aiUsageSchema)
