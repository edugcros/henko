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
    /**
     * Plata comprometida y todavía no liquidada.
     *
     * VA APARTE DE estimatedCostUsd A PROPÓSITO, y es la decisión central de
     * este contador: `estimatedCostUsd` significa "esto ya se gastó" y es lo
     * que la auditoría contable compara contra el libro. Si las reservas se
     * sumaran ahí, ese número incluiría plata que todavía no tiene fila en el
     * ledger y la auditoría dispararía una falsa alarma en cada operación en
     * vuelo.
     *
     * El disyuntor mira la SUMA de los dos: lo gastado más lo comprometido es
     * lo que realmente hay que cuidar. La auditoría mira solo el primero.
     *
     * Una reserva que nunca se liquida —el proceso murió— la devuelve el
     * barrido de operaciones colgadas, igual que la cuota.
     */
    reservedCostUsd: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Cuál de los dos controles cortó: 'tokens' o 'usd'. La acción que hay que
    // tomar es distinta — si cortó la plata, hay que decidir si se gasta más;
    // si cortó el volumen, hay algo consumiendo de más— y sin esto las dos se
    // ven igual: "el disyuntor cortó".
    breakerReason: {
      type: String,
      enum: ['tokens', 'usd', null],
      default: null,
    },

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
