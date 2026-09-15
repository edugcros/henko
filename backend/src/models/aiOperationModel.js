// 📁 src/models/aiOperationModel.js
//
// La identidad de una operación de IA, desde que empieza hasta que termina.
//
// QUÉ PROBLEMA RESUELVE
//
// `operationId` ya existía, pero solo gobernaba el ledger. Medido contra una
// base real, llamando dos veces con la MISMA clave:
//
//   reserveAiBudget x2   → ledger 1 fila ✓   counters.agentMessages 2 ✗
//   recordTokenSpend x2  → ledger 1 fila ✓   AiPlatformUsage.tokens 3000 ✗
//                                             (1500 reales)
//
// El ledger rechazaba la fila repetida y los contadores subían igual, porque
// el `$inc` corría antes y la escritura del ledger ni siquiera se esperaba.
//
// Eso no es solo cobrarle de más a un comercio. `AiPlatformUsage.tokens` es lo
// que mide el disyuntor de plataforma: un reintento puede dispararlo antes de
// tiempo y dejar sin IA a TODOS los comercios.
//
// CÓMO LO RESUELVE
//
// Esta colección se escribe PRIMERO, antes de tocar cualquier contador, y su
// índice único (tenantId, operationId) es el candado. Si el insert entra, la
// operación es nueva y el cobro procede. Si choca con 11000, ese cobro ya
// ocurrió y se saltea entero.
//
// La unicidad la impone la base, no una comprobación previa en el código:
// "¿ya existe?" seguido de "insertá" es la misma carrera que uno intenta
// evitar, un nivel más arriba. Mismo patrón que usan las plataformas de pago.
//
// QUÉ NO HACE
//
// No reemplaza al ledger. El ledger es el libro contable —una fila por
// movimiento, con el precio congelado adentro, append-only— y sigue siendo la
// fuente de la plata. Esto es el estado de la operación: una fila por
// operación, que se actualiza. Son dos preguntas distintas: "¿cuánto se gastó
// y a qué precio?" la contesta el ledger; "¿esta operación ya corrió, y cómo
// terminó?" la contesta esta.
//
// FALLA ABIERTA, A PROPÓSITO
//
// Si esta colección no responde por un motivo que NO sea la clave repetida
// —la base caída—, la operación de IA sigue adelante y se loguea en error. El
// contrato heredado del ledger se conserva: la contabilidad nunca puede ser el
// motivo por el que un comercio se queda sin poder usar la IA. Lo que se cierra
// es el caso común, que es el reintento.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

/**
 * Estados de una operación.
 *
 *   pending   — registrada, todavía sin reservar cupo. Es el estado para quien
 *               pre-registra la operación antes de ejecutarla, como un job
 *               encolado que quiere su identidad desde que entra a la cola.
 *   running   — cupo reservado, llamada al proveedor en curso. Es el estado
 *               con el que nacen las operaciones que reservan y ejecutan en el
 *               mismo acto, que hoy son todas.
 *   completed — terminó bien y el consumo quedó registrado.
 *   failed    — no llegó a correr: sin cupo, sin suscripción, o el proveedor
 *               falló sin que hubiera nada que devolver.
 *   refunded  — corrió, falló, y la reserva se devolvió.
 */
export const AI_OPERATION_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
})

/** Los que ya no van a cambiar. Una operación acá es historia, no trabajo. */
export const TERMINAL_STATUSES = Object.freeze([
  AI_OPERATION_STATUS.COMPLETED,
  AI_OPERATION_STATUS.FAILED,
  AI_OPERATION_STATUS.REFUNDED,
])

/**
 * Estados en los que HAY cupo reservado a nombre de esta operación.
 *
 * Es la regla que decide qué hace un reintento, y la distinción importa más de
 * lo que parece. Si la operación está en uno de estos, algo ya se cobró y
 * volver a cobrarlo es el bug que todo esto vino a cerrar. Si NO está —porque
 * se denegó por falta de cupo, o porque falló y se devolvió la reserva—
 * entonces no hay nada cobrado y el reintento tiene que poder reservar de
 * nuevo, que es el caso normal de "el proveedor se cayó, probá otra vez".
 *
 * La primera versión de esto trataba todo reintento igual y devolvía
 * `allowed: true` sobre una reserva DENEGADA: un comercio sin cupo que
 * reintentara con la misma clave pasaba igual, sin haber reservado nada.
 */
export const HOLDS_QUOTA = Object.freeze([
  AI_OPERATION_STATUS.RUNNING,
  AI_OPERATION_STATUS.COMPLETED,
])

/**
 * De dónde salió la operación. Responde "¿qué función me está costando la
 * plata?", que `metric` no contesta: el agente de WhatsApp, la recuperación de
 * carritos y la promoción social comparten AGENT_MESSAGES y son tres negocios
 * distintos.
 *
 * Es un enum y no texto libre a propósito: un typo en una función poco usada
 * no se nota, y parte el reporte en dos categorías que deberían ser una.
 */
export const AI_FEATURES = Object.freeze({
  IMAGE_AI: 'imageAi',
  SOCIAL_PROMOTION: 'socialPromotion',
  AI_AGENT: 'aiAgent',
  CART_RECOVERY: 'cartRecovery',
  VISION: 'vision',
  INSIGHTS: 'insights',
  MARKET_INTELLIGENCE: 'marketIntelligence',
  PRICING: 'pricing',
})

/**
 * Quién cobra. Sin esto, un corte de un proveedor se ve como "fallaron varias
 * operaciones sueltas" y no como "se cayó Replicate".
 *
 * Es el proveedor DECLARADO al reservar. La generación de imágenes puede caer
 * de Replicate a HuggingFace en la misma llamada, así que ahí este campo dice
 * contra quién se presupuestó, no necesariamente quién respondió — igual que
 * requestedModel frente a actualModel.
 */
export const AI_PROVIDERS = Object.freeze({
  GEMINI: 'gemini',
  REPLICATE: 'replicate',
  HUGGINGFACE: 'huggingface',
  TAVILY: 'tavily',
})

const aiOperationSchema = new mongoose.Schema(
  {
    // La clave de idempotencia. La provee quien llama cuando puede derivar una
    // estable —el id de un job, el hash de una imagen, el id del mensaje de
    // WhatsApp— y si no, reserveAiBudget genera una y la devuelve para que los
    // pasos siguientes usen la misma.
    operationId: { type: String, required: true, trim: true },

    // Qué parte del producto la pidió: 'imageAi', 'marketIntelligence',
    // 'aiAgent', 'vision'. Responde "¿qué función me está costando la plata?",
    // que `metric` no contesta: dos features distintas comparten métrica.
    feature: {
      type: String,
      enum: [...Object.values(AI_FEATURES), null],
      default: null,
      index: true,
    },

    // La métrica de presupuesto contra la que se cobra. Es la que tiene tope
    // por plan y la que mira el disyuntor.
    metric: { type: String, required: true, trim: true, index: true },

    // 'gemini' | 'replicate' | 'stability' | 'tavily'. Sin esto, un corte de un
    // proveedor se ve como "fallaron varias operaciones" y no como "se cayó
    // Replicate".
    provider: {
      type: String,
      enum: [...Object.values(AI_PROVIDERS), null],
      default: null,
      index: true,
    },

    // El modelo que se PIDIÓ y el que efectivamente respondió.
    //
    // Hoy esta diferencia se pierde y es justo la que explica una factura rara:
    // el agente pide gemini-3.8-flash, ese modelo está saturado o sin cupo, la
    // cadena de fallback entrega gemini-3.1-flash-lite, y el costo que aparece
    // es el del segundo. Con un solo campo `model` no hay forma de ver cuántas
    // veces el fallback está decidiendo lo que se paga.
    requestedModel: { type: String, trim: true, default: null },
    actualModel: { type: String, trim: true, default: null, index: true },

    status: {
      type: String,
      enum: Object.values(AI_OPERATION_STATUS),
      required: true,
      default: AI_OPERATION_STATUS.PENDING,
      index: true,
    },

    // Mismo formato que AiUsage.period y que el ledger, para cruzar los tres
    // sin convertir.
    period: { type: String, required: true, trim: true, index: true },

    // Cuánto cupo reservó, para poder devolverlo sin releer el ledger.
    amount: { type: Number, default: 0, min: 0 },

    /**
     * Plata comprometida al reservar, todavía no liquidada.
     *
     * Se guarda acá porque es lo que hay que devolver: al liquidar contra el
     * costo real, al devolver la operación, o al barrerla si quedó colgada.
     * Sin este número habría que adivinar cuánto liberar.
     *
     * Vuelve a cero apenas se libera, así que una operación con esto en cero
     * no tiene plata retenida a su nombre.
     */
    reservedCostUsd: { type: Number, default: 0, min: 0 },

    // Por qué falló, en el lenguaje del sistema (DENY_REASONS o el código del
    // proveedor). No es para mostrarle al comercio: para eso está
    // buildBudgetDenialMessage.
    failureReason: { type: String, trim: true, default: null },

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  },
)

/**
 * EL CANDADO.
 *
 * Es lo único que impide que un reintento cobre dos veces. Lleva tenantId
 * porque dos comercios pueden derivar la misma clave de sus propios datos —el
 * id de un job, el hash de una imagen— sin tener nada que ver entre sí.
 *
 * No es parcial, a diferencia del índice del ledger: acá `operationId` es
 * obligatorio, así que no hay filas viejas sin clave que puedan colisionar. La
 * colección nace con este índice.
 *
 * La violación de este índice NO es un error: es la respuesta correcta a un
 * reintento, y aiBudgetService la trata como tal.
 */
aiOperationSchema.index({ tenantId: 1, operationId: 1 }, { unique: true })

// Reservas colgadas: un proceso que murió entre reservar y consumir deja al
// comercio cobrado para siempre. Este índice es el que hace barata esa
// pregunta — "running desde hace más de N minutos" — que era el argumento más
// fuerte para tener esta colección y no derivar el estado del ledger.
aiOperationSchema.index({ status: 1, startedAt: 1 })

// El acceso del panel: qué hizo este comercio, de lo más nuevo a lo más viejo.
aiOperationSchema.index({ tenantId: 1, createdAt: -1 })

// "¿Cuántas veces el fallback decidió el modelo este mes?"
aiOperationSchema.index({ period: 1, actualModel: 1 })

aiOperationSchema.plugin(tenantPlugin)

const AiOperation =
  mongoose.models.AiOperation || mongoose.model('AiOperation', aiOperationSchema)

export default AiOperation
