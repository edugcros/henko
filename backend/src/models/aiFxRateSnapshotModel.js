import mongoose from 'mongoose'

/**
 * Snapshot diario de tipos de cambio externos usados en reportes económicos.
 *
 * El _id determinístico (fuente + código + fecha) hace idempotente el upsert
 * entre instancias sin depender de autoIndex ni de una migración de índices.
 */
const aiFxRateSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    dateKey: { type: String, required: true, index: true },
    source: { type: String, required: true, trim: true },
    sourceCode: { type: String, required: true, trim: true },
    baseCurrency: { type: String, required: true, trim: true, default: 'USD' },
    quoteCurrency: { type: String, required: true, trim: true, default: 'ARS' },
    rateType: { type: String, required: true, trim: true },
    rate: { type: Number, required: true, min: 0.00000001 },
    sourceUrl: { type: String, required: true, trim: true },
    capturedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    minimize: false,
  },
)

aiFxRateSnapshotSchema.index({ source: 1, sourceCode: 1, dateKey: -1 })

export default
  mongoose.models.AiFxRateSnapshot ||
  mongoose.model('AiFxRateSnapshot', aiFxRateSnapshotSchema)
