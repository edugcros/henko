// 📁 src/models/aiPlatformUsageModel.js
//
// Consumo agregado de TODA la plataforma contra la API key propia, por mes.
//
// Existe separado de AiUsage porque responde otra pregunta. AiUsage contesta
// "¿cuánto le queda a este comercio?"; este documento contesta "¿cuánto va
// a pagar la plataforma este mes?", que es la única cifra que puede llegar
// como sorpresa a fin de mes.
//
// Sin este contador, el techo de gasto es la SUMA de las cuotas de todos los
// tenants: alcanza con un plan mal cargado, un tenant enterprise o un bug de
// aprovisionamiento para que no haya techo real.
//
// No lleva tenantId a propósito, así que tampoco lleva el tenantPlugin.
import mongoose from 'mongoose'

const { Schema } = mongoose

const aiPlatformUsageSchema = new Schema(
  {
    period: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    tokens: {
      type: Number,
      default: 0,
      min: 0,
    },

    estimatedCostUsd: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Se marca la primera vez que el disyuntor corta, para poder alertar una
    // sola vez y no en cada request del resto del mes.
    breakerTrippedAt: {
      type: Date,
      default: null,
    },

    // El escalón de aviso más alto ya anunciado este mes (0 = ninguno).
    //
    // El corte avisaba recién al saltar, o sea cuando el servicio ya se cayó
    // para todos los que comparten la key. Los avisos previos necesitan
    // recordar cuál ya se dio: sin esto, cada request pasado el 50% escribiría
    // la misma línea, y un aviso que aparece diez mil veces no es un aviso.
    //
    // Es también la marca que hace la carrera segura entre procesos: se avanza
    // con un findOneAndUpdate condicionado a que siga por debajo del escalón,
    // así solo uno gana y avisa una vez.
    alertedThreshold: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastActivityAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
)

export default mongoose.model('AiPlatformUsage', aiPlatformUsageSchema)
