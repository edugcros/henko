// 📁 src/models/pricingPolicyModel.js
//
// Los límites que el comerciante le pone al motor de precios.
//
// Existe antes que cualquier recomendación porque es lo que hace segura a la
// IA: Gemini propone, esta política decide si está permitido. Sin este
// documento el motor solo puede sugerir, nunca ejecutar — que es exactamente
// el default y la razón por la que el modo arranca en 'manual'.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

/**
 * Qué está optimizando el comercio. No cambia los topes duros; cambia hacia
 * dónde se inclina una recomendación cuando hay margen para moverse.
 */
export const PRICING_STRATEGY = Object.freeze({
  MARGIN: 'margin',           // proteger rentabilidad
  ROTATION: 'rotation',       // mover stock
  LIQUIDATE: 'liquidate',     // vaciar inventario
  REVENUE: 'revenue',         // maximizar facturación
  COMPETITIVE: 'competitive', // defender posición de precio
})

/**
 * Cuánta libertad tiene el motor.
 *
 * Arranca en MANUAL y no es configurable a AUTOPILOT desde el primer día a
 * propósito: un comerciante que ve un precio moverse solo sin entender por qué
 * apaga la función para siempre. El desbloqueo debería depender de tener
 * recomendaciones aceptadas con resultado medido, no de una casilla.
 */
export const PRICING_MODE = Object.freeze({
  MANUAL: 'manual',       // solo sugiere
  SEMI: 'semi',           // aplica solo dentro de un tope chico, el resto pide aprobación
  AUTOPILOT: 'autopilot', // aplica dentro de la política
})

const pct = (def, max = 100) => ({
  type: Number,
  default: def,
  min: 0,
  max,
})

const pricingPolicySchema = new mongoose.Schema(
  {
    strategy: {
      type: String,
      enum: Object.values(PRICING_STRATEGY),
      default: PRICING_STRATEGY.MARGIN,
    },

    mode: {
      type: String,
      enum: Object.values(PRICING_MODE),
      default: PRICING_MODE.MANUAL,
    },

    // Piso de rentabilidad. Ninguna recomendación puede dejar el margen por
    // debajo de esto, sin importar qué diga el modelo ni qué haga la
    // competencia: una venta bajo el mínimo es una pérdida elegida.
    minMarginPercent: pct(35),

    // Hacia dónde apunta el motor cuando tiene lugar para moverse.
    targetMarginPercent: pct(50),

    // Techo de variación por ajuste. Frena tanto un error de cálculo como una
    // reacción exagerada a una señal ruidosa.
    maxChangePercent: pct(10, 50),

    // Techo acumulado en siete días. Sin esto, varios ajustes chicos seguidos
    // producen el mismo salto que uno grande, sin que ningún tope se active.
    maxWeeklyChangePercent: pct(15, 60),

    // Límites absolutos, opcionales. null = sin límite por ese lado.
    priceFloor: { type: Number, default: null, min: 0 },
    priceCeiling: { type: Number, default: null, min: 0 },

    rounding: {
      enabled: { type: Boolean, default: true },
      // Terminaciones psicológicas habituales en AR. El motor redondea al
      // valor más cercano que termine así, siempre respetando el piso de
      // margen — si redondear hacia abajo lo rompe, redondea hacia arriba.
      endings: { type: [Number], default: [990] },
    },

    // Qué señales puede considerar el motor. Apagar una no la borra del
    // cálculo determinístico: la saca del razonamiento y de la recomendación.
    consider: {
      cost: { type: Boolean, default: true },
      competition: { type: Boolean, default: true },
      stock: { type: Boolean, default: true },
      demand: { type: Boolean, default: true },
      seasonality: { type: Boolean, default: true },
    },

    // En modo SEMI, cambios por encima de esto necesitan aprobación humana.
    autoApplyMaxPercent: pct(5, 20),

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, minimize: false },
)

// Una política por comercio.
pricingPolicySchema.index({ tenantId: 1 }, { unique: true })

pricingPolicySchema.plugin(tenantPlugin)

/**
 * La política del comercio, o la de fábrica si todavía no configuró nada.
 *
 * Devuelve un objeto plano y no un documento: los consumidores solo leen, y
 * un default en memoria evita tener que crear un documento por cada comercio
 * que nunca abrió la pantalla de configuración.
 */
pricingPolicySchema.statics.forTenant = async function forTenant(tenantId) {
  const found = await this.findOne({ tenantId }).lean()
  if (found) return found

  return {
    tenantId,
    strategy: PRICING_STRATEGY.MARGIN,
    mode: PRICING_MODE.MANUAL,
    minMarginPercent: 35,
    targetMarginPercent: 50,
    maxChangePercent: 10,
    maxWeeklyChangePercent: 15,
    priceFloor: null,
    priceCeiling: null,
    rounding: { enabled: true, endings: [990] },
    consider: { cost: true, competition: true, stock: true, demand: true, seasonality: true },
    autoApplyMaxPercent: 5,
    isDefault: true,
  }
}

const PricingPolicy =
  mongoose.models.PricingPolicy || mongoose.model('PricingPolicy', pricingPolicySchema)

export default PricingPolicy
