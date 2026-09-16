// 📁 src/models/aiProviderCallModel.js
//
// Una fila por LLAMADA al proveedor. Una operación puede hacer varias.
//
// POR QUÉ HACÍA FALTA
//
// El modelo era "una operación = una llamada", y no es cierto. El cerebro del
// agente contesta y, si la respuesta sale mal formada, la repara con una
// SEGUNDA llamada que se paga igual. El análisis de mercado busca con Tavily y
// estructura con Gemini. El de precios hace lo mismo.
//
// Sin un lugar donde poner la segunda llamada, aiAgentBrainService la
// registraba inventándole una operación falsa:
//
//     operationId: operationId ? `${operationId}:repair` : null
//
// Una cadena con un sufijo, para que el índice único del ledger no la
// rechazara. Funcionaba, y mentía: contaba como DOS operaciones lo que es una
// operación con dos llamadas. Cualquier conteo de operaciones quedaba inflado,
// y peor —desde que AiOperation gobierna el cobro— la reparación aparecía como
// una operación sin reserva propia.
//
// QUÉ RESUELVE ADEMÁS
//
// El claim de consumo del Bloque 1 marcaba la operación 'completed' con la
// PRIMERA llamada que registrara consumo. Con dos llamadas legítimas, la
// segunda se habría descartado como reintento y su costo habría desaparecido
// de la contabilidad — justo lo que el sufijo estaba tapando sin querer.
//
// Acá la idempotencia se mide por (operación, llamada), que es la unidad real.
//
// DÓNDE ENCAJA
//
//   AiOperation  → la identidad y el cupo. Una fila por operación.
//   AiProviderCall → qué se le pidió a quién, y qué costó. Una por llamada.
//   AiConsumptionLedger → el libro contable, append-only.
//   AiUsage / AiPlatformUsage → los agregados que deciden el cupo.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

/**
 * Identificador de la llamada dentro de su operación.
 *
 * 'main' es el default y cubre el caso de siempre —una operación, una llamada—
 * sin que ningún llamador tenga que cambiar. Los demás nombran el paso.
 */
export const CALL_ID = Object.freeze({
  MAIN: 'main',
  REPAIR: 'repair',
  EXTRACTION: 'extraction',
})

const aiProviderCallSchema = new mongoose.Schema(
  {
    // A qué operación pertenece. No es una referencia por _id a propósito: la
    // clave de negocio es la que usan todos los llamadores, y unirlas por _id
    // obligaría a leer AiOperation antes de poder registrar una llamada.
    operationId: { type: String, required: true, trim: true },

    // Cuál de las llamadas de esa operación. Ver CALL_ID.
    callId: { type: String, required: true, trim: true, default: CALL_ID.MAIN },

    period: { type: String, required: true, trim: true, index: true },
    metric: { type: String, required: true, trim: true, index: true },

    provider: { type: String, trim: true, default: null, index: true },

    // El que se pidió y el que respondió. La diferencia es lo que explica una
    // factura rara: se pide gemini-3.8-flash, la cadena de fallback entrega
    // gemini-3.1-flash-lite, y lo que se paga es el segundo.
    requestedModel: { type: String, trim: true, default: null },
    actualModel: { type: String, trim: true, default: null, index: true },

    inputTokens: { type: Number, default: null, min: 0 },

    /**
     * Salida FACTURABLE: el texto visible más lo que el modelo razonó.
     *
     * No es candidatesTokenCount. Esa clave cuenta solo lo que se ve, y el
     * razonamiento viaja en thoughtsTokenCount, que Google cobra a tarifa de
     * salida igual. Medido en producción, contarlo de menos escondía 23.836
     * tokens y el 21,2% del costo histórico. Ver aiUsageMetadata.js.
     */
    outputTokens: { type: Number, default: null, min: 0 },

    /**
     * Cuánto de esa salida fue razonamiento y no texto entregado.
     *
     * No cambia el precio —se cobra al mismo ritmo que el resto de la salida—
     * pero es lo único que explica una fila con 111 tokens de respuesta y 1.196
     * de salida. Sin este campo, esa fila parece un error de carga.
     *
     * También es la palanca: si sube de golpe, se baja con thinkingBudget.
     */
    thinkingTokens: { type: Number, default: null, min: 0 },

    /**
     * Entrada servida desde la caché de contexto, que se factura con descuento.
     *
     * Hoy es SIEMPRE null: HENKO no usa caché de contexto y la API ni siquiera
     * devuelve la clave —verificado contra generateContent—. Se guarda porque
     * sale del mismo objeto que ya se lee y el día que se active, cobrarla como
     * entrada plena sería el mismo error que este commit corrige, al revés.
     */
    cachedInputTokens: { type: Number, default: null, min: 0 },

    totalTokens: { type: Number, default: null, min: 0 },

    /**
     * Nivel de servicio con el que el proveedor atendió: 'standard', 'flex'…
     *
     * Viene en toda respuesta de Gemini (medido) y decide tarifa. Hoy es
     * siempre 'standard', y por eso mismo sirve: el día que una llamada salga
     * en otro nivel, esta columna lo dice en vez de que aparezca en la factura.
     */
    serviceTier: { type: String, trim: true, default: null },

    costUsd: { type: Number, default: 0, min: 0 },

    /**
     * La tarifa que se APLICÓ, congelada en la fila.
     *
     * Acá iba a ir un `pricingVersion`. Un número de versión solo sirve si
     * alguien se acuerda de subirlo, y el catálogo no tiene versiones: tiene
     * ventanas de vigencia por modelo. Guardar la tarifa efectiva contesta la
     * misma pregunta —"¿con qué precio se calculó esto?"— sin depender de que
     * nadie se olvide, y deja la fila verificable sola: costUsd tiene que dar
     * con estos dos números y estos tokens.
     *
     * Mismos nombres que el ledger, para que las dos colecciones se lean igual.
     */
    priceInputPerMillion: { type: Number, default: null, min: 0 },
    priceOutputPerMillion: { type: Number, default: null, min: 0 },

    /** true si el modelo no está en el catálogo y se cobró con la tarifa tope. */
    priceFallback: { type: Boolean, default: false },

    /**
     * true cuando el proveedor NO desglosó y hubo que repartir el total con una
     * proporción supuesta (80/20). Distinto de priceFallback —ahí falta el
     * precio, acá faltan los tokens— y distinto de pricingFallback, que es que
     * falta el modelo.
     */
    costEstimated: { type: Boolean, default: false },

    /**
     * true cuando el costo se calculó con un modelo ADIVINADO.
     *
     * Pasa si el llamador no informó con cuál gastó y hubo que caer al
     * configurado. El número que sale es un supuesto: la cadena de respaldo
     * entrega modelos que difieren hasta 3x en tarifa, así que adivinar cuál
     * respondió es adivinar cuánto costó.
     *
     * Es distinto de priceFallback del ledger, que marca "sé qué modelo era,
     * pero no está en el catálogo de precios". Acá ni siquiera se sabe el
     * modelo.
     *
     * En producción esto debería ser SIEMPRE false: de 122 filas de costo,
     * cero llegaron por ese camino. Una fila en true es un llamador que dejó
     * de informar el modelo.
     */
    pricingFallback: { type: Boolean, default: false },

    // false cuando el proveedor falló. Una llamada fallida también se registra:
    // se pagó el intento o, como mínimo, se gastó el tiempo, y sin la fila no
    // hay forma de ver que un proveedor está fallando.
    ok: { type: Boolean, default: true },
    errorCode: { type: String, trim: true, default: null },
  },
  {
    // Sin updatedAt: una llamada al proveedor ya ocurrió y no se modifica.
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
)

/**
 * La unidad real de idempotencia: una llamada, dentro de una operación.
 *
 * Es lo que permite que la respuesta y su reparación convivan —son dos
 * llamadas de la misma operación— sin que una se descarte como reintento de la
 * otra, y sin inventarle una operación falsa a la segunda.
 */
aiProviderCallSchema.index({ tenantId: 1, operationId: 1, callId: 1 }, { unique: true })

// "¿Cuánto nos costó cada modelo este mes?", sin pasar por el ledger.
aiProviderCallSchema.index({ period: 1, actualModel: 1 })

// "¿Está fallando algún proveedor?"
aiProviderCallSchema.index({ provider: 1, ok: 1, createdAt: -1 })

aiProviderCallSchema.plugin(tenantPlugin)

const AiProviderCall =
  mongoose.models.AiProviderCall ||
  mongoose.model('AiProviderCall', aiProviderCallSchema)

export default AiProviderCall
