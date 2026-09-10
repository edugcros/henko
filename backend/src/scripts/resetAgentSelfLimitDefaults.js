// 📁 src/scripts/resetAgentSelfLimitDefaults.js
//
// Borra los autolímites que nadie eligió: los que puso el `default` del schema.
//
// POR QUÉ EXISTE
//
// `quotas.monthlyMessageLimit` y `quotas.monthlyAiTokenLimit` son AUTOLÍMITES —
// existen para que un comercio gaste menos que su plan. Nacieron con
// `default: 3000` y `default: 1000000`, herencia de cuando ESA era la cuota
// real del agente, antes de que el tope lo fijara el plan (aiPlanPolicy.js).
//
// Mongoose materializa los defaults al crear el documento, así que el valor
// quedó ESCRITO en la base de todos los agentes aprovisionados. Y como
// `reserveAiBudget` no puede distinguir un autolímite elegido de uno heredado,
// los cobraba: un comercio Pro con 10.000 mensajes y 50M de tokens vendidos
// terminaba cobrando contra 3.000 y 1M, mientras el panel le seguía mostrando
// los del plan.
//
// El schema ya no trae esos defaults. Este script limpia lo que quedó escrito;
// sin él, cambiar el default no arregla a ningún comercio existente.
//
// QUÉ SE TOCA Y QUÉ NO
//
// Solo los campos cuyo valor es EXACTAMENTE el default viejo, y cada campo por
// separado. El formulario del panel mandaba siempre los dos juntos, así que un
// comercio que eligió 500 mensajes tiene igual 1.000.000 de tokens heredados:
// mirar la pareja completa lo dejaría con un freno de tokens que nunca pidió.
//
// EL FALSO POSITIVO, DICHO EN VOZ ALTA
//
// Un comercio que haya escrito a mano exactamente 3000 o exactamente 1000000 es
// indistinguible de uno que nunca tocó nada — la base guarda el número, no
// quién lo puso. Pierde su autolímite. Se acepta a propósito porque el error
// cae del lado seguro: recibe la cuota completa de su plan en vez de un recorte
// silencioso, lo ve en el panel, y volver a escribirlo ahora sí queda pegado.
// Para free (300) y starter (2.000) el 3.000 nunca hizo nada: ya estaba por
// encima del tope del plan.
//
// Es idempotente: la segunda corrida no encuentra nada.
//
// Uso (por defecto NO escribe nada, solo informa):
//   npm run migrate:agent-self-limits
//   npm run migrate:agent-self-limits:apply
//   npm run migrate:agent-self-limits:prod
//
// OJO CON A QUÉ BASE SE CONECTA
//
// config/env.js resuelve la conexión con getFirstValue(MONGODB_URL, MONGO_URI):
// MONGODB_URL gana. Los archivos .env.<entorno> lo definen, así que exportar
// MONGO_URI para apuntar el script a otra base NO funciona — se conecta igual a
// la del .env y escribe ahí. Para dirigirlo a mano hay que pisar MONGODB_URL.
// Vale para todos los scripts de esta carpeta, no solo para este.

import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import AiAgent from '../models/aiAgentModel.js'

// Los defaults viejos, literales. Una migración describe el pasado: si mañana
// alguien cambia un default, este número no debe seguirlo.
const LEGACY_MESSAGE_LIMIT = 3000
const LEGACY_TOKEN_LIMIT = 1_000_000

const run = async () => {
  const applyChanges = process.argv.includes('--apply')

  await connectDB()

  // Driver crudo y no el modelo: esto cruza todos los tenants a propósito —es
  // una corrección de plataforma— y el tenantPlugin rechazaría un updateMany
  // sin tenantId, que es exactamente lo que tiene que hacer en el código normal.
  const collection = AiAgent.collection

  const messageFilter = { 'quotas.monthlyMessageLimit': LEGACY_MESSAGE_LIMIT }
  const tokenFilter = { 'quotas.monthlyAiTokenLimit': LEGACY_TOKEN_LIMIT }

  const messageRows = await collection.countDocuments(messageFilter)
  const tokenRows = await collection.countDocuments(tokenFilter)

  if (messageRows === 0 && tokenRows === 0) {
    logger.info('[MIGRACIÓN autolímites] No hay defaults heredados. Nada que hacer.')
    await mongoose.disconnect()
    return
  }

  logger.info('[MIGRACIÓN autolímites] Autolímites heredados encontrados', {
    mensajesEn: `${messageRows} agente(s) con ${LEGACY_MESSAGE_LIMIT}`,
    tokensEn: `${tokenRows} agente(s) con ${LEGACY_TOKEN_LIMIT}`,
    modo: applyChanges ? 'APLICANDO' : 'simulación (usar --apply para escribir)',
  })

  if (!applyChanges) {
    logger.info('[MIGRACIÓN autolímites] Simulación terminada. No se escribió nada.')
    await mongoose.disconnect()
    return
  }

  const messageResult = await collection.updateMany(messageFilter, {
    $set: { 'quotas.monthlyMessageLimit': 0 },
  })
  const tokenResult = await collection.updateMany(tokenFilter, {
    $set: { 'quotas.monthlyAiTokenLimit': 0 },
  })

  const remaining =
    (await collection.countDocuments(messageFilter)) +
    (await collection.countDocuments(tokenFilter))

  logger.info('[MIGRACIÓN autolímites] Listo', {
    mensajesLiberados: messageResult.modifiedCount,
    tokensLiberados: tokenResult.modifiedCount,
    quedanHeredados: remaining,
  })

  await mongoose.disconnect()
}

run().catch(async error => {
  logger.error('[MIGRACIÓN autolímites] Falló', { error: error.message })
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
