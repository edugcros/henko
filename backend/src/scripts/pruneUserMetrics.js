// 📁 src/scripts/pruneUserMetrics.js
//
// Pone en marcha la retención de userMetricEvent: borra los eventos vencidos
// en lotes y deja activo el índice TTL que mantiene la colección acotada de
// ahí en adelante.
//
// POR QUÉ HACE FALTA UN SCRIPT SI YA HAY UN TTL
//
// El TTL vive en el modelo y es el estado estable correcto para telemetría de
// este volumen (cinco inserts por carga de página, de cada visitante, de cada
// tienda). Pero crear ese índice sobre una colección que ya tiene historia
// dispara el borrado de TODO lo vencido de una sola vez, y Mongo lo hace sin
// pedir permiso ni avisar cuánto. Sobre millones de documentos eso es un pico
// de carga sobre el primario justo cuando nadie lo está mirando.
//
// Acá el borrado va en lotes, se puede ver antes qué se pierde, y el índice se
// crea al final, cuando ya no queda nada vencido que borrar de golpe.
//
// En producción autoIndex está apagado (config/connectDB.js), así que el
// índice NO aparece solo al deployar: este script es la única puerta.
//
// Uso (por defecto NO borra, solo informa):
//   npm run prune:user-metrics
//   npm run prune:user-metrics -- --apply
//   npm run prune:user-metrics:prod            (informa contra producción)
//   npm run prune:user-metrics:prod -- --apply
//
// El plazo sale de METRICS_RETENTION_DAYS (90 por defecto) para que el script
// y el índice no puedan discrepar. --dias= lo pisa solo para la simulación.

import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import UserMetricEvent from '../models/userMetricEventModel.js'

const LOTE = 5000

const leerDias = () => {
  const arg = process.argv.find(a => a.startsWith('--dias='))
  const valor = Number(arg?.split('=')[1])

  if (Number.isFinite(valor) && valor >= 1) return Math.floor(valor)

  return Math.max(1, Number(env?.metrics?.retentionDays || 90))
}

const run = async () => {
  const dias = leerDias()
  const applyChanges = process.argv.includes('--apply')

  await connectDB()

  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

  // Driver crudo a propósito: esto cruza todos los comercios porque es
  // mantenimiento de plataforma, y el tenantPlugin rechazaría un deleteMany
  // sin tenantId — que es exactamente lo que tiene que hacer en el código
  // normal.
  const collection = UserMetricEvent.collection
  const filtro = { createdAt: { $lt: corte } }

  const total = await collection.countDocuments({})
  const vencidos = await collection.countDocuments(filtro)

  // Qué se pierde, no sólo cuánto. El rango de fechas y los comercios
  // afectados son lo que permite decidir si el plazo elegido era el correcto
  // ANTES de borrar.
  const [resumen] = vencidos
    ? await collection
        .aggregate([
          { $match: filtro },
          {
            $group: {
              _id: null,
              desde: { $min: '$createdAt' },
              hasta: { $max: '$createdAt' },
              comercios: { $addToSet: '$tenantId' },
            },
          },
        ])
        .toArray()
    : []

  logger.info('[PODA MÉTRICAS] Situación', {
    dias,
    corte: corte.toISOString(),
    documentosTotales: total,
    documentosVencidos: vencidos,
    porcentajeAVencer: total ? `${((vencidos / total) * 100).toFixed(1)}%` : '0%',
    desde: resumen?.desde?.toISOString(),
    hasta: resumen?.hasta?.toISOString(),
    comerciosAfectados: resumen?.comercios?.length || 0,
    modo: applyChanges ? 'BORRANDO' : 'simulación (usar --apply para borrar)',
  })

  if (!applyChanges) {
    logger.info('[PODA MÉTRICAS] Simulación terminada. No se borró nada.')
    await mongoose.disconnect()
    return
  }

  // En lotes y no de un deleteMany: un borrado masivo sobre millones de
  // documentos bloquea el primario y hace esperar a todas las tiendas.
  let borradasTotal = 0

  for (;;) {
    const lote = await collection
      .find(filtro, { projection: { _id: 1 }, limit: LOTE })
      .toArray()

    if (lote.length === 0) break

    const { deletedCount } = await collection.deleteMany({
      _id: { $in: lote.map(d => d._id) },
    })

    borradasTotal += deletedCount || 0

    logger.info('[PODA MÉTRICAS] Lote borrado', {
      lote: lote.length,
      acumulado: borradasTotal,
    })

    // Si el lote vino incompleto, no queda nada más que borrar.
    if (lote.length < LOTE) break
  }

  // El índice recién ahora: con la colección ya podada no hay un borrado
  // masivo esperando a que el índice termine de construirse.
  const segundos = Math.max(1, Number(env?.metrics?.retentionDays || 90)) * 24 * 60 * 60

  await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: segundos })

  logger.info('[PODA MÉTRICAS] Listo', {
    borradas: borradasTotal,
    quedan: await collection.countDocuments({}),
    ttlDias: segundos / (24 * 60 * 60),
    nota: 'El índice TTL queda activo: de acá en adelante Mongo vence solo.',
  })

  await mongoose.disconnect()
}

run().catch(async error => {
  logger.error('[PODA MÉTRICAS] Falló', { error: error.message })
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
