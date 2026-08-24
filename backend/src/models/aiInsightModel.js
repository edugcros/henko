// 📁 src/models/aiInsightModel.js
//
// Motor de diagnóstico (Bloque 8.4-8.9) — mismo patrón que
// aiLearningSuggestionModel.js: cola de sugerencias que un humano revisa,
// fingerprint único por tenant para no duplicar en re-escaneos, y un guard
// que no pisa un insight que un humano ya tocó (ver aiInsightService.js).
//
// Recomienda, nunca actúa solo — 8.8 (acciones automáticas) queda fuera a
// propósito, es una decisión de negocio aparte.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

const aiInsightSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        'product_underperformance',
        'cart_conversion_drop',
        'campaign_underperformance',
        'customer_inactivity',
      ],
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['pending_review', 'acknowledged', 'measuring', 'resolved', 'dismissed', 'archived'],
      default: 'pending_review',
      index: true,
    },

    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Diagnóstico (8.6) + recomendación (8.7) en un solo texto ya armado por
    // la plantilla del detector — qué cambiar, por qué, sobre qué, qué se
    // espera, cómo se mide. No se guardan por separado porque no hay nada
    // que recombinar después.
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    entity: {
      kind: {
        type: String,
        enum: ['product', 'campaign', 'customer', null],
        default: null,
      },
      // productId / nombre de campaña / userId — heterogéneo a propósito,
      // cada tipo de insight sabe cómo interpretar su propio id.
      id: { type: String, default: '' },
      label: { type: String, default: '', trim: true, maxlength: 200 },
    },

    // Los números reales detrás del diagnóstico — lo que hace que esto no
    // sea una afirmación sin sustento (ver regla de 8.6: no inventar causas).
    evidence: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // tenantId+type+entity.id+período — dedup en re-escaneos, ver
    // aiInsightService.js::runInsightScanForTenant.
    fingerprint: {
      type: String,
      required: true,
    },

    measurement: {
      metricName: { type: String, default: '' },
      beforeValue: { type: Number, default: null },
      afterValue: { type: Number, default: null },
      // Se setea al acknowledgear — cuándo volver a medir la métrica.
      measureAfterDate: { type: Date, default: null },
      measuredAt: { type: Date, default: null },
    },

    acknowledgedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    acknowledgedAt: { type: Date, default: null },

    dismissedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    dismissedAt: { type: Date, default: null },
    dismissReason: { type: String, trim: true, maxlength: 500, default: '' },

    detectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

aiInsightSchema.index({ tenantId: 1, fingerprint: 1 }, { unique: true })
aiInsightSchema.index({ tenantId: 1, status: 1, priority: 1, updatedAt: -1 })
// Cross-tenant a propósito — el barrido de remedición (aiInsightService.js::
// remeasureDueInsights) recorre insights vencidos de todos los comercios en
// una sola pasada, igual que el worker de recuperación de carritos.
aiInsightSchema.index({ status: 1, 'measurement.measureAfterDate': 1 })

aiInsightSchema.plugin(tenantPlugin, { addTenantField: false })

export default mongoose.model('AiInsight', aiInsightSchema)
