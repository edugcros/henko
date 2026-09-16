// 📁 src/models/aiRateWindowModel.js
//
// El freno de VELOCIDAD del gasto de IA. Una fila por (comercio, ventana).
//
// POR QUÉ HACE FALTA, Y POR QUÉ EL CUPO MENSUAL NO ALCANZA
//
// Todo el control de gasto de este paquete mide ACUMULADO: cuánto lleva el
// comercio este mes, cuánto lleva la plataforma. Eso no protege contra un bug.
// Un loop en el agente, un reintento mal hecho o un comercio scripteando la
// API pueden quemar el presupuesto entero en una hora, y el disyuntor recién
// se entera cuando ya pasó — porque compara contra un total, no contra un
// ritmo.
//
// Medido: el agente es el 72% del consumo (595.620 de 826.148 tokens del mes)
// y sus rutas NO tienen ningún limitador. La de visión sí lo tiene, en la ruta
// HTTP. El agente entra por WhatsApp, así que un limitador de ruta no lo
// cubre: el freno tiene que estar donde pasa TODO consumo, que es
// reserveAiBudget.
//
// POR QUÉ EN MONGO Y NO EN LA CACHÉ
//
// Existe SharedRateLimitStore, que se apoya en la caché compartida. No sirve
// para esto por dos motivos medidos en producción:
//
//   1. Redis no resuelve (getaddrinfo ENOTFOUND sobre el host de Upstash), así
//      que la caché cae a memoria POR PROCESO. Con dos instancias el límite
//      efectivo se duplica.
//   2. El servicio se reinicia todo el tiempo — 25 veces en seis horas — y un
//      contador en memoria arranca de cero en cada arranque. Un freno que se
//      resetea solo no frena.
//
// Mongo cuesta una escritura por operación de IA, que al lado de una llamada a
// Gemini es ruido, y da el mismo candado atómico que ya usa la reserva de
// cuota: el límite viaja DENTRO del filtro, así que no hay lectura previa que
// pueda perder una carrera.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

/**
 * Las ventanas que se vigilan.
 *
 * Dos y no una: un minuto agarra el loop desbocado, una hora agarra el abuso
 * sostenido que se mantiene justo debajo del límite por minuto. Sin la
 * segunda, 19 operaciones por minuto durante una hora son 1.140 y ninguna
 * dispara nada.
 */
export const RATE_WINDOW = Object.freeze({
  MINUTE: 'minute',
  HOUR: 'hour',
})

export const WINDOW_MS = Object.freeze({
  [RATE_WINDOW.MINUTE]: 60 * 1000,
  [RATE_WINDOW.HOUR]: 60 * 60 * 1000,
})

/** El inicio de la ventana que contiene a `at`. Alinea a bordes fijos. */
export const windowStartFor = (window, at = new Date()) => {
  const ms = WINDOW_MS[window]
  const t = at instanceof Date && !Number.isNaN(at.getTime()) ? at.getTime() : Date.now()

  return new Date(Math.floor(t / ms) * ms)
}

const aiRateWindowSchema = new mongoose.Schema(
  {
    // 'minute' | 'hour'
    window: { type: String, required: true, enum: Object.values(RATE_WINDOW) },

    // El borde de la ventana, no el momento de la operación: es lo que hace
    // que todas las operaciones del mismo minuto caigan en la misma fila.
    windowStart: { type: Date, required: true },

    /**
     * Cuántas operaciones lleva la ventana.
     *
     * Se cuentan OPERACIONES y no tokens a propósito. Los tokens se conocen
     * DESPUÉS de llamar al proveedor, y para entonces ya se gastaron: un freno
     * que necesita el resultado para decidir no es un freno. La operación en
     * cambio se cuenta ANTES, que es el único momento en que negarla ahorra
     * plata.
     */
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
)

/**
 * La unidad del candado: un comercio, una ventana, un borde.
 *
 * El índice único es el mecanismo, no una validación: el contador se
 * incrementa con un findOneAndUpdate que lleva el límite EN EL FILTRO y
 * upsert. Cuando la ventana llegó al tope, el filtro no matchea, el upsert
 * intenta insertar y choca contra este índice con 11000 — y ese error ES la
 * respuesta "no hay lugar", resuelta por la base y no por una comprobación
 * previa que podría perder la carrera.
 */
aiRateWindowSchema.index(
  { tenantId: 1, window: 1, windowStart: 1 },
  { unique: true },
)

/**
 * Las ventanas viejas se borran solas.
 *
 * Dos horas cubre de sobra la más larga (una hora) con margen para relojes
 * desfasados. Sin esto, cada comercio dejaría 1.440 filas por día para
 * siempre, y el freno terminaría costando más que lo que ahorra.
 */
aiRateWindowSchema.index({ windowStart: 1 }, { expireAfterSeconds: 2 * 60 * 60 })

aiRateWindowSchema.plugin(tenantPlugin)

const AiRateWindow =
  mongoose.models.AiRateWindow || mongoose.model('AiRateWindow', aiRateWindowSchema)

export default AiRateWindow
