// 📁 src/models/aiConsumptionLedgerModel.js
//
// Registro inmutable de cada movimiento de presupuesto de IA.
//
// AiUsage responde "¿cuánto le queda a este comercio este mes?". Es un
// acumulador por período: sirve para decidir si una operación puede correr, y
// no sirve para contabilidad. No puede responder cuánto costó una operación,
// con qué modelo corrió, ni cuánto gastó HENKO en visión el martes.
//
// Este archivo es lo segundo. Una fila por evento, con el precio del momento
// congelado adentro.
//
// POR QUÉ APPEND-ONLY Y NO UNA MÁQUINA DE ESTADOS
//
// El diseño natural sería reserved → completed | refunded | expired, con una
// fila por operación. Eso exige un id de correlación hilado por los ocho call
// sites que hoy tocan el presupuesto, todos en el camino de la plata.
//
// Con filas autodescriptivas —cada una dice qué pasó, cuánto y cuánto costó—
// se obtiene la misma contabilidad sumando, sin tocar un solo llamador: el
// gasto real de un comercio es la suma de sus 'consumed' menos sus 'refunded'.
// Y si más adelante hace falta reconciliar reservas colgadas, estas filas son
// justo el sustrato que esa máquina necesitaría. Se empieza por lo que da el
// valor completo sin riesgo, no por lo que suena más completo.
//
// La escritura NUNCA puede romper una operación de IA: se registra lo que ya
// pasó. Un fallo acá se loguea con nivel error —un ledger que falla en
// silencio es peor que no tenerlo, porque igual se confía en él— pero no se
// propaga.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

export const LEDGER_EVENT = Object.freeze({
  // Se descontó cupo antes de llamar al proveedor.
  RESERVED: 'reserved',
  // Consumo ya ocurrido: tokens medidos, o unidades de un tenant con key propia.
  CONSUMED: 'consumed',
  // El proveedor falló y se devolvió la reserva.
  REFUNDED: 'refunded',
})

const aiConsumptionLedgerSchema = new mongoose.Schema(
  {
    // Mismo formato que AiUsage.period, para poder cruzar ambos sin convertir.
    period: { type: String, required: true, trim: true, index: true },

    event: {
      type: String,
      enum: Object.values(LEDGER_EVENT),
      required: true,
      index: true,
    },

    metric: { type: String, required: true, trim: true, index: true },

    amount: { type: Number, required: true, min: 0 },

    // Qué mide `amount`. No se deduce de la métrica: 'vision' tiene filas de
    // las dos clases —una unidad reservada al tenant, y los tokens que esa
    // unidad gastó— y sumar las dos juntas daría un número sin sentido. Cada
    // fila dice qué es, que es la propiedad de la que depende todo el diseño.
    unit: {
      type: String,
      enum: ['units', 'tokens'],
      required: true,
      default: 'units',
    },

    model: { type: String, trim: true, default: null, index: true },

    // platform | tenant | none. Un consumo BYOK no le cuesta plata a HENKO,
    // pero sí consume su infraestructura: se registra igual, con costo 0.
    keySource: { type: String, trim: true, default: null, index: true },

    plan: { type: String, trim: true, default: null },

    inputTokens: { type: Number, default: null, min: 0 },
    outputTokens: { type: Number, default: null, min: 0 },
    totalTokens: { type: Number, default: null, min: 0 },

    costUsd: { type: Number, default: 0, min: 0 },

    // El precio vigente cuando ocurrió, congelado. Sin esto, recalcular un
    // costo histórico daría otro número apenas cambie el catálogo — y los
    // modelos 3.x ya tienen anunciada una duplicación para el 1/1/2027.
    priceInputPerMillion: { type: Number, default: null, min: 0 },
    priceOutputPerMillion: { type: Number, default: null, min: 0 },

    // true cuando el reparto entrada/salida se supuso a partir del total,
    // porque el proveedor solo devolvió totalTokenCount. Un costo repartido no
    // debe confundirse con uno medido.
    costEstimated: { type: Boolean, default: false },

    // true cuando el modelo no estaba en el catálogo y se aplicó la tarifa
    // conservadora. Marca una fila que conviene revisar, no un error.
    priceFallback: { type: Boolean, default: false },
  },
  {
    // Sin updatedAt: una fila del ledger no se modifica. Si algo estuvo mal, se
    // corrige con otra fila, como en cualquier libro contable.
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
)

// El acceso principal: qué gastó un comercio, del más reciente al más viejo.
aiConsumptionLedgerSchema.index({ tenantId: 1, createdAt: -1 })

// Cierre mensual por comercio y métrica.
aiConsumptionLedgerSchema.index({ tenantId: 1, period: 1, metric: 1 })

// Costo de plataforma por modelo: "¿cuánto nos costó 3.6-flash este mes?".
// No lleva tenantId porque es justamente la pregunta cross-tenant.
aiConsumptionLedgerSchema.index({ period: 1, model: 1 })

aiConsumptionLedgerSchema.plugin(tenantPlugin)

const AiConsumptionLedger =
  mongoose.models.AiConsumptionLedger ||
  mongoose.model('AiConsumptionLedger', aiConsumptionLedgerSchema)

export default AiConsumptionLedger
