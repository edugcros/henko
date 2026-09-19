// 📁 src/services/pricing/priceHistoryAuditService.js
//
// Integridad del historial de precios.
//
// POR QUÉ HACE FALTA UNA AUDITORÍA SI EL HISTORIAL YA ES TRANSACCIONAL
//
// Desde que productModel engancha el hook a la sesión del save, el precio y su
// fila entran juntos o no entra ninguno. Eso cubre de acá en adelante y solo
// por los caminos que abren transacción: la edición del panel y la aplicación
// de una recomendación. Los otros save() de producto siguen fallando abiertos
// a propósito —perder una fila duele menos que perder la edición del
// comerciante— y todo lo que se escribió antes de ese cambio se escribió sin
// ninguna garantía.
//
// O sea que hay dos fuentes de huecos: el pasado, que ya está, y los caminos
// que siguen sin transacción. Un log de error no alcanza para ninguna de las
// dos: nadie lee los logs de hace un mes.
//
// CÓMO SE DETECTA UN HUECO SIN UNA SEGUNDA FUENTE
//
// La contabilidad de IA puede reconstruir su libro porque AiProviderCall
// guarda lo mismo por otro lado. Acá no hay segunda fuente: si la fila no se
// escribió, el precio viejo no quedó en ningún lado.
//
// Pero el historial se valida solo, porque es una CADENA. Cada fila dice de
// dónde venía el precio y a dónde fue, así que dos invariantes tienen que
// cumplirse sin mirar nada más:
//
//   1. Continuidad — fila[n].previousPrice === fila[n-1].newPrice
//   2. Cabeza      — la última fila.newPrice === el precio actual del producto
//
// Si falta una fila del medio, se rompe (1). Si falta la última, se rompe (2)
// — y esa se puede reconstruir entera, porque sus dos extremos son justamente
// los dos valores que quedaron: el newPrice de la anterior y el precio de hoy.
//
// HUECOS ESPERADOS
//
// buildEntry (productModel) no registra cuando el precio anterior es <= 0:
// sin precio anterior no hay cambio, hay un alta. Así que después de una fila
// que termina en 0, el cambio siguiente NO deja fila y la cadena se corta
// legítimamente. Esos se reportan aparte, en `expected`, y no cuentan como
// hueco: llamarlos error entrenaría a ignorar la auditoría entera.
//
// NO CORRIGE NADA. Escribir una fila reconstruida le pondría al historial un
// createdAt inventado y un autor que no existió, y el historial es el único
// lugar contra el que después se mide si una recomendación sirvió. Se informa
// y se decide a mano.

import mongoose from 'mongoose'

import Product from '../../models/productModel.js'
import ProductPriceHistory from '../../models/productPriceHistoryModel.js'
import logger from '../../../config/logger.js'

const ALCANCE = 'platform:auditoria-historial-de-precios'

const envEnteroPositivo = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre])
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}

/**
 * El precio que el producto tiene HOY para esa cadena.
 *
 * Una cadena es un producto (variantId null) o una variante concreta. Devuelve
 * undefined cuando la variante ya no existe: eso no es un hueco del historial,
 * es una variante borrada, y su historia queda cerrada donde quedó.
 */
const precioActualDeLaCadena = (producto, variantId) => {
  if (!variantId) return producto.price

  const variante = (producto.variants || []).find(
    v => String(v?.key) === String(variantId),
  )

  return variante ? variante.price : undefined
}

const mismoPrecio = (a, b) => Number(a) === Number(b)

/**
 * Recorre el historial entero y devuelve los cortes de cadena.
 *
 * Solo lectura. No escribe, no corrige y no depende de ninguna otra colección
 * más que de products, para poder comparar la cabeza contra el precio de hoy.
 *
 * @returns {Promise<{
 *   chains: number, rows: number, balanced: boolean,
 *   gaps: Array<object>, expected: Array<object>, orphans: Array<object>,
 * }>}
 */
export const auditPriceHistory = async ({ tenantId = null } = {}) => {
  const filtro = tenantId
    ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)) }
    : {}

  // Ordenar ANTES de agrupar: $push conserva el orden que traiga la etapa
  // anterior, y sin eso la cadena se arma en el orden que devuelva el índice.
  // El _id desempata dos cambios del mismo milisegundo.
  const cadenas = await ProductPriceHistory.aggregate([
    { $match: filtro },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: { productId: '$productId', variantId: '$variantId' },
        tenantId: { $first: '$tenantId' },
        rows: {
          $push: {
            previousPrice: '$previousPrice',
            newPrice: '$newPrice',
            createdAt: '$createdAt',
            source: '$source',
          },
        },
      },
    },
  ]).option({ ignoreTenant: !tenantId, platformScope: ALCANCE })

  if (!cadenas.length) {
    return { chains: 0, rows: 0, balanced: true, gaps: [], expected: [], orphans: [] }
  }

  const idsDeProducto = [...new Set(cadenas.map(c => String(c._id.productId)))]

  const productos = await Product.find(
    { _id: { $in: idsDeProducto.map(id => new mongoose.Types.ObjectId(id)) } },
    'price variants.key variants.price title tenantId isDeleted',
  )
    .setOptions({ ignoreTenant: !tenantId, platformScope: ALCANCE })
    .lean()

  const porId = new Map(productos.map(p => [String(p._id), p]))

  const gaps = []
  const expected = []
  const orphans = []
  let filasTotales = 0

  for (const cadena of cadenas) {
    const productId = String(cadena._id.productId)
    const variantId = cadena._id.variantId || null
    const filas = cadena.rows || []
    filasTotales += filas.length

    const base = {
      tenantId: cadena.tenantId ? String(cadena.tenantId) : null,
      productId,
      variantId,
    }

    // 1. CONTINUIDAD
    for (let i = 1; i < filas.length; i += 1) {
      const anterior = filas[i - 1]
      const actual = filas[i]

      if (mismoPrecio(actual.previousPrice, anterior.newPrice)) continue

      const registro = {
        ...base,
        kind: 'broken-chain',
        expectedPrevious: anterior.newPrice,
        actualPrevious: actual.previousPrice,
        at: actual.createdAt,
      }

      // Después de un precio 0 el hook no registra el cambio siguiente.
      if (Number(anterior.newPrice) <= 0) expected.push(registro)
      else gaps.push(registro)
    }

    // 2. CABEZA
    const producto = porId.get(productId)

    if (!producto) {
      // Historial de un producto que ya no está. No es un hueco: es historia
      // de algo borrado, y no hay precio actual contra el cual compararla.
      orphans.push({ ...base, rows: filas.length })
      continue
    }

    const ultima = filas[filas.length - 1]
    const precioHoy = precioActualDeLaCadena(producto, variantId)

    if (precioHoy === undefined) {
      orphans.push({ ...base, rows: filas.length, reason: 'variant-gone' })
      continue
    }

    if (mismoPrecio(ultima.newPrice, precioHoy)) continue

    const registro = {
      ...base,
      title: producto.title,
      kind: 'head-mismatch',
      // La fila que falta, entera: sus dos extremos son los únicos dos
      // valores que sobrevivieron.
      lost: { previousPrice: ultima.newPrice, newPrice: precioHoy },
      lastRecordedAt: ultima.createdAt,
    }

    if (Number(ultima.newPrice) <= 0) expected.push(registro)
    else gaps.push(registro)
  }

  return {
    chains: cadenas.length,
    rows: filasTotales,
    balanced: gaps.length === 0,
    gaps,
    expected,
    orphans,
  }
}

let cicloRef = null
let arranqueRef = null

export const runPriceHistoryAudit = async () => {
  try {
    const auditoria = await auditPriceHistory()

    if (auditoria.balanced) {
      logger.info('[PRICE HISTORY] La cadena de precios está entera', {
        chains: auditoria.chains,
        rows: auditoria.rows,
        orphans: auditoria.orphans.length,
      })
      return auditoria
    }

    // Nivel error y no warn: un hueco significa que hubo un cambio de precio
    // del que no quedó registro, y ese registro es lo único contra lo que
    // después se puede medir si una recomendación sirvió.
    logger.error('[PRICE HISTORY] Faltan cambios de precio en el historial', {
      chains: auditoria.chains,
      huecos: auditoria.gaps.length,
      // El detalle en el log alcanza para reponer a mano las de cabeza, que
      // son las reconstruibles.
      detalle: auditoria.gaps.slice(0, 20),
    })

    const { notifyPriceHistoryGaps } = await import('../ai/aiBudgetNotifier.js')
    await notifyPriceHistoryGaps(auditoria)

    return auditoria
  } catch (error) {
    logger.error('[PRICE HISTORY] La auditoría de la cadena falló', {
      error: error.message,
    })
    return null
  }
}

export const startPriceHistoryAudit = ({ logger: log = logger } = {}) => {
  if (process.env.PRICE_HISTORY_AUDIT_ENABLED === 'false') {
    log.info?.('[PRICE HISTORY] Auditoría automática deshabilitada')
    return
  }

  if (cicloRef) return

  // Diaria y no horaria: los huecos no aparecen solos. Con el historial ya
  // transaccional, un hueco nuevo significa que alguien tocó un precio por un
  // camino sin transacción y justo falló la escritura. Mirarlo cada hora
  // reportaría veinticuatro veces el mismo hueco viejo.
  const intervalMs = envEnteroPositivo(
    'PRICE_HISTORY_AUDIT_INTERVAL_MS',
    24 * 60 * 60 * 1000,
  )
  const arranqueMs = envEnteroPositivo('PRICE_HISTORY_AUDIT_ON_START_MS', 180 * 1000)

  arranqueRef = setTimeout(() => {
    runPriceHistoryAudit().catch(error => {
      log.error?.('[PRICE HISTORY] La pasada de arranque falló', { error: error.message })
    })
  }, arranqueMs)

  arranqueRef.unref?.()

  cicloRef = setInterval(() => {
    runPriceHistoryAudit().catch(error => {
      log.error?.('[PRICE HISTORY] El ciclo falló', { error: error.message })
    })
  }, intervalMs)

  cicloRef.unref?.()

  log.info?.('[PRICE HISTORY] Auditoría automática iniciada', {
    intervalHours: Math.round(intervalMs / 3600000),
    primeraPasadaEnSegundos: Math.round(arranqueMs / 1000),
  })
}

export const stopPriceHistoryAudit = () => {
  if (arranqueRef) {
    clearTimeout(arranqueRef)
    arranqueRef = null
  }

  if (cicloRef) {
    clearInterval(cicloRef)
    cicloRef = null
  }
}

export default {
  auditPriceHistory,
  runPriceHistoryAudit,
  startPriceHistoryAudit,
  stopPriceHistoryAudit,
}
