// 📁 src/scripts/pruneAiLedger.js
//
// Borra movimientos viejos del ledger de consumo de IA.
//
// POR QUÉ ES UN SCRIPT Y NO UN ÍNDICE TTL
//
// Un índice TTL habría sido menos código y peor decisión: borra solo, en
// silencio, y el ledger es la materia prima del análisis de rentabilidad por
// comercio. El día que alguien quiera saber cuánto costó atender a un cliente
// en su primer trimestre, ese dato tiene que seguir estando o no estar por una
// decisión tomada a propósito.
//
// Acá no se borra nada hasta que alguien lo pide, y antes de pedirlo puede ver
// exactamente qué se va a perder.
//
// CUÁNDO HACE FALTA
//
// Hoy no. Con los volúmenes actuales son miles de filas por mes. Con diez mil
// comercios son millones, y ahí empieza a costar en almacenamiento y a hacer
// lentas las consultas del panel. Esto existe para ese momento, no para este.
//
// SOBRE LAS CLAVES DE IDEMPOTENCIA
//
// Viven en las mismas filas, así que borrar historia vieja también las vence.
// Es correcto: un reintento llega en segundos o minutos, nunca meses después.
// Stripe expira las suyas a las 24 horas por el mismo motivo.
//
// Uso (por defecto NO borra, solo informa):
//   npm run prune:ai-ledger -- --meses=12
//   npm run prune:ai-ledger -- --meses=12 --apply

import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import AiConsumptionLedger from '../models/aiConsumptionLedgerModel.js'

const leerMeses = () => {
  const arg = process.argv.find(a => a.startsWith('--meses='))
  const valor = Number(arg?.split('=')[1])

  // Un piso de 3 meses no es capricho: borrar el trimestre en curso deja el
  // panel de costos mostrando un mes incompleto sin que nada lo explique.
  return Number.isFinite(valor) && valor >= 3 ? Math.floor(valor) : 12
}

const run = async () => {
  const meses = leerMeses()
  const applyChanges = process.argv.includes('--apply')

  await connectDB()

  const corte = new Date()
  corte.setUTCMonth(corte.getUTCMonth() - meses)

  const collection = AiConsumptionLedger.collection
  const filtro = { createdAt: { $lt: corte } }

  // Se usa el driver crudo: esto cruza todos los comercios a propósito —es
  // mantenimiento de plataforma— y el tenantPlugin rechazaría un deleteMany
  // sin tenantId, que es justo lo que tiene que hacer en el código normal.
  const total = await collection.countDocuments(filtro)

  if (total === 0) {
    logger.info('[PODA LEDGER] No hay movimientos anteriores al corte', {
      corte: corte.toISOString(),
      meses,
    })
    await mongoose.disconnect()
    return
  }

  // Qué se pierde, no solo cuánto. Un número de filas no dice si lo que se va
  // a borrar era relevante; el costo acumulado y el rango de fechas sí.
  const [resumen] = await collection
    .aggregate([
      { $match: filtro },
      {
        $group: {
          _id: null,
          costoUsd: { $sum: '$costUsd' },
          desde: { $min: '$createdAt' },
          hasta: { $max: '$createdAt' },
          comercios: { $addToSet: '$tenantId' },
        },
      },
    ])
    .toArray()

  logger.info('[PODA LEDGER] Movimientos anteriores al corte', {
    corte: corte.toISOString(),
    meses,
    filas: total,
    costoAcumuladoUsd: Number(resumen?.costoUsd || 0).toFixed(2),
    desde: resumen?.desde?.toISOString(),
    hasta: resumen?.hasta?.toISOString(),
    comerciosAfectados: resumen?.comercios?.length || 0,
    modo: applyChanges ? 'BORRANDO' : 'simulación (usar --apply para borrar)',
  })

  if (!applyChanges) {
    logger.info('[PODA LEDGER] Simulación terminada. No se borró nada.')
    await mongoose.disconnect()
    return
  }

  const { deletedCount } = await collection.deleteMany(filtro)

  logger.info('[PODA LEDGER] Listo', {
    borradas: deletedCount,
    quedan: await collection.countDocuments({}),
  })

  await mongoose.disconnect()
}

run().catch(async error => {
  logger.error('[PODA LEDGER] Falló', { error: error.message })
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
