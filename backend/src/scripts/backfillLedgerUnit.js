// 📁 src/scripts/backfillLedgerUnit.js
//
// Completa el campo `unit` en las filas del ledger que se escribieron sin él.
//
// POR QUÉ EXISTE
//
// El ledger salió a producción en c0b141e (08/09/2026 18:46 GMT-3) sin el campo
// `unit`, que se agregó en f4c2855 (19:54 del mismo día). Las filas escritas en
// esa hora y ocho minutos no lo tienen, y aiSpendReportService suma tokens con
// un $cond sobre `unit`: sin el campo, esas filas cuentan como CERO tokens. El
// costo sí las incluye, así que el reporte quedaría con dólares sin tokens que
// los expliquen.
//
// POR QUÉ SE PUEDE DEDUCIR SIN AMBIGÜEDAD
//
// `unit` hizo falta porque recordTokenSpend hizo que 'vision' tuviera filas de
// las dos clases: la unidad reservada al comercio y los tokens que esa unidad
// gastó. Pero recordTokenSpend NO existía en c0b141e — llegó en el mismo commit
// que el campo. O sea que en las filas sin `unit` la métrica todavía determina
// la unidad sin excepciones: las de tokens son tokens y el resto son unidades.
//
// Es idempotente: solo toca documentos donde el campo no existe. Correrlo dos
// veces no hace nada la segunda.
//
// Uso (por defecto NO escribe nada, solo informa):
//   npm run migrate:ledger-unit
//   npm run migrate:ledger-unit:apply
//   npm run migrate:ledger-unit:prod

import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import AiConsumptionLedger from '../models/aiConsumptionLedgerModel.js'

// Las mismas de aiBudgetService.TOKEN_METRICS. Se repiten literales a propósito:
// una migración describe el pasado, así que no debe cambiar de comportamiento si
// mañana alguien agrega una métrica de tokens nueva.
const TOKEN_METRICS = ['agentTokens', 'marketTokens']

const run = async () => {
  const applyChanges = process.argv.includes('--apply')

  await connectDB()

  // Se usa el driver crudo y no el modelo: esto cruza todos los tenants a
  // propósito —es una corrección de plataforma— y el tenantPlugin rechazaría
  // un updateMany sin tenantId, que es exactamente lo que tiene que hacer en
  // el código normal.
  const collection = AiConsumptionLedger.collection
  const filter = { unit: { $exists: false } }

  const pending = await collection.countDocuments(filter)

  if (pending === 0) {
    logger.info('[MIGRACIÓN unit] No hay filas sin unidad. Nada que hacer.')
    await mongoose.disconnect()
    return
  }

  const tokenFilter = { ...filter, metric: { $in: TOKEN_METRICS } }
  const unitFilter = { ...filter, metric: { $nin: TOKEN_METRICS } }

  const tokenRows = await collection.countDocuments(tokenFilter)
  const unitRows = pending - tokenRows

  logger.info('[MIGRACIÓN unit] Filas sin unidad encontradas', {
    total: pending,
    seMarcanComoTokens: tokenRows,
    seMarcanComoUnidades: unitRows,
    modo: applyChanges ? 'APLICANDO' : 'simulación (usar --apply para escribir)',
  })

  if (!applyChanges) {
    logger.info('[MIGRACIÓN unit] Simulación terminada. No se escribió nada.')
    await mongoose.disconnect()
    return
  }

  const tokenResult = await collection.updateMany(tokenFilter, {
    $set: { unit: 'tokens' },
  })
  const unitResult = await collection.updateMany(unitFilter, {
    $set: { unit: 'units' },
  })

  const remaining = await collection.countDocuments(filter)

  logger.info('[MIGRACIÓN unit] Listo', {
    marcadasComoTokens: tokenResult.modifiedCount,
    marcadasComoUnidades: unitResult.modifiedCount,
    quedanSinUnidad: remaining,
  })

  await mongoose.disconnect()
}

run().catch(async error => {
  logger.error('[MIGRACIÓN unit] Falló', { error: error.message })
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
