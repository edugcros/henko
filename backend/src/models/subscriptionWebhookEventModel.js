// 📁 src/models/subscriptionWebhookEventModel.js
//
// Registro de eventos de webhook de suscripción, para no aplicar dos veces la
// misma transición.
//
// POR QUÉ NO SE REUSA WebhookLog
//
// El de pagos existe y hace el mismo trabajo, pero exige `paymentId` y
// `orderId` como requeridos y un evento de suscripción no tiene ninguno de los
// dos. Además expira a las 24 horas: para un pago es suficiente, para una
// suscripción no — Mercado Pago reintenta durante días, y un evento que vuelve
// al tercer día contra una tabla que ya lo olvidó se procesa de nuevo.
//
// QUIÉN IMPONE LA UNICIDAD
//
// El índice único, no una comprobación previa en el código. Preguntar "¿ya
// existe?" y después insertar es exactamente la carrera que esto evita: dos
// entregas simultáneas del mismo evento pasan las dos por el `if` antes de que
// ninguna escriba. Mismo criterio que el ledger de consumo de IA.

import mongoose from 'mongoose'

const { Schema } = mongoose

export const WEBHOOK_EVENT_STATUS = Object.freeze({
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
})

const subscriptionWebhookEventSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      default: 'mercadopago',
      trim: true,
    },

    // La clave de deduplicación. Mercado Pago no manda un id de evento estable
    // en el body de suscripciones, así que se compone: tipo + id del recurso.
    // Ver buildEventId en el controlador.
    eventId: { type: String, required: true, trim: true },

    eventType: { type: String, default: '', trim: true },

    // Puede quedar vacío: un evento de una suscripción que no corresponde a
    // ningún tenant se registra igual, para que un reintento no lo reprocese y
    // para poder investigar por qué llegó.
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },

    subscriptionId: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: Object.values(WEBHOOK_EVENT_STATUS),
      default: WEBHOOK_EVENT_STATUS.PROCESSING,
      index: true,
    },

    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    error: { type: String, default: null },

    // 90 días. Cubre de sobra la ventana de reintentos de Mercado Pago y deja
    // margen para investigar un cobro discutido sin que la fila ya no esté.
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
  },
  { timestamps: true },
)

subscriptionWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true })

// Sin tenantPlugin a propósito: un webhook llega antes de saber a qué tenant
// pertenece, y a veces no pertenece a ninguno. El scoping por tenant acá
// impediría justamente la búsqueda que hay que hacer.
const SubscriptionWebhookEvent =
  mongoose.models.SubscriptionWebhookEvent ||
  mongoose.model('SubscriptionWebhookEvent', subscriptionWebhookEventSchema)

export default SubscriptionWebhookEvent
