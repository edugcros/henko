/**
 * MarketAnalysis.js
 *
 * Persiste resultados de análisis como cache (TTL nativo de Mongo vía
 * expiresAt). Sigue el patrón tenantPlugin usado en el resto del proyecto
 * para aislamiento multi-tenant (models/tenantPlugin.js).
 */

import { Schema, model } from 'mongoose';
import { tenantPlugin } from '../../../models/tenantPlugin.js';

const marketAnalysisSchema = new Schema(
  {
    product: { type: String, required: true },
    normalizedQuery: { type: String, required: true, index: true },
    country: { type: String, required: true },

    // null cuando ninguna fuente externa pudo medirse — se persiste así a
    // propósito, para no confundir "no medible" con "demanda cero".
    demandScore: { type: Number, default: null, min: 0, max: 100 },
    measuredWeight: { type: Number, default: 0 }, // 0..1: cuánto del modelo se evaluó

    // Versión del modelo de scoring con el que se calculó este documento.
    // El lookup de cache filtra por acá, así que los análisis de versiones
    // anteriores quedan invalidados solos al subir SCORING_VERSION.
    scoringVersion: { type: Number, required: true, index: true },
    unmeasured: [{ type: String }],

    // true = las señales disponibles no distinguen este producto de
    // cualquier otro, así que no se emitió score.
    degenerate: { type: Boolean, default: false },
    confidenceScore: { type: Number, required: true, min: 0, max: 100 },
    trendClassification: { type: String, required: true },

    breakdown: {
      demand: Number,
      trend: Number,
      competition: Number,
      social: Number,
      commercial: Number,
      opportunity: Number,
    },

    // Guardamos las señales crudas para auditoría/debugging — permite
    // reconstruir por qué se llegó a un score sin volver a llamar a las APIs.
    // Los costos NO se persisten: son datos comerciales sensibles del
    // tenant y el cache es por producto, no por escenario de costos. El
    // resultado del cálculo sí, porque es lo que el panel muestra.
    profitability: Schema.Types.Mixed,

    rawSignals: {
      meli: Schema.Types.Mixed,
      shopping: Schema.Types.Mixed,
      gemini: Schema.Types.Mixed,
      internal: Schema.Types.Mixed,
    },

    generatedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL index nativo
  },
  { timestamps: true }
);

marketAnalysisSchema.plugin(tenantPlugin);

// Índice compuesto para el lookup de cache en marketIntelligenceService.js
marketAnalysisSchema.index({ tenantId: 1, normalizedQuery: 1, country: 1, scoringVersion: 1 });

export default model('MarketAnalysis', marketAnalysisSchema);
