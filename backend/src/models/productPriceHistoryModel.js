// 📁 src/models/productPriceHistoryModel.js
//
// Registro inmutable de cada cambio de precio de un producto o de una de sus
// variantes.
//
// Por qué existe antes que cualquier motor de pricing: es el único lugar
// contra el que después se puede medir si una recomendación sirvió. Un motor
// que recomienda sin este registro no puede aprender nada — y la historia que
// no se empieza a guardar hoy no se recupera después.
//
// Se escribe desde un hook post('save') de productModel, así que cubre todos
// los caminos que editan un producto sin que cada controlador tenga que
// acordarse de registrar. Ver productModel.js::recordPriceHistory.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

/**
 * De dónde salió el cambio. Importa para el aprendizaje: un cambio manual y
 * uno aplicado desde una recomendación de IA no significan lo mismo cuando
 * después se mide el resultado.
 */
export const PRICE_CHANGE_SOURCE = Object.freeze({
  MANUAL: 'manual',
  AI_RECOMMENDATION: 'ai_recommendation',
  BULK_EDIT: 'bulk_edit',
  IMPORT: 'import',
  API: 'api',
  UNKNOWN: 'unknown',
})

const SOURCES = Object.values(PRICE_CHANGE_SOURCE)

const productPriceHistorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },

    // Null para el precio del producto; el id de la variante cuando el cambio
    // fue sobre una. Las variantes tienen su propio precio y su propio costo,
    // así que su historia es independiente de la del producto padre.
    variantId: { type: String, default: null, trim: true },

    previousPrice: { type: Number, required: true, min: 0 },
    newPrice: { type: Number, required: true, min: 0 },

    // Se guarda calculado en vez de derivarlo al leer: es el campo por el que
    // se filtra ("mostrame los cambios de más del 10%") y calcularlo en cada
    // consulta obliga a traer todo a memoria para poder ordenarlo.
    changePercent: { type: Number, default: 0 },

    currency: { type: String, trim: true, uppercase: true, maxlength: 12, default: 'ARS' },

    // Costo al momento del cambio. Sin esto el margen histórico es
    // irreconstruible: si el costo se actualiza después, mirar el costo actual
    // contra un precio viejo da un margen que nunca existió.
    unitCostAtChange: { type: Number, default: null, min: 0 },

    // Margen bruto sobre el precio nuevo, con el costo de ese momento. Null
    // cuando no había costo cargado — nunca 0, que se leería como "margen cero".
    marginAtChange: { type: Number, default: null },

    source: {
      type: String,
      enum: SOURCES,
      default: PRICE_CHANGE_SOURCE.UNKNOWN,
      index: true,
    },

    // Texto libre: "competencia -4.2%", "stock alto + baja rotación".
    reason: { type: String, trim: true, maxlength: 600, default: '' },

    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Se completa cuando el cambio viene de una recomendación. Es el enganche
    // para el ciclo de aprendizaje: recomendación → cambio → resultado medido.
    recommendationId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    minimize: false,
  },
)

// La línea de tiempo de un producto: el acceso principal de la ficha.
productPriceHistorySchema.index({ tenantId: 1, productId: 1, createdAt: -1 })

// Cambios recientes del comercio entero, para el panel.
productPriceHistorySchema.index({ tenantId: 1, createdAt: -1 })

// "Qué pasó con lo que recomendamos": el acceso del ciclo de aprendizaje.
productPriceHistorySchema.index({ tenantId: 1, source: 1, createdAt: -1 })

productPriceHistorySchema.plugin(tenantPlugin)

const ProductPriceHistory =
  mongoose.models.ProductPriceHistory ||
  mongoose.model('ProductPriceHistory', productPriceHistorySchema)

export default ProductPriceHistory
