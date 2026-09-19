import mongoose from 'mongoose'

import logger from '../../config/logger.js'

/**
 * De dónde sale el tipo de topología.
 *
 * ESTO ESTABA LEYENDO EL LUGAR EQUIVOCADO Y NADIE SE ENTERÓ
 *
 * La versión anterior miraba `connection.db.topology.description.type`. En el
 * driver 3 esa propiedad existía; en el 4 —el que trae mongoose 6, el que
 * corre acá— `db.topology` es `undefined`. Medido contra la base de
 * producción, que es un replica set de Atlas:
 *
 *   db.topology?.description?.type      -> undefined
 *   client.topology?.description?.type  -> 'ReplicaSetWithPrimary'
 *
 * O sea que `supportsTransactions` daba false SIEMPRE y todos los callers
 * venían corriendo sin transacción, creyendo que tenían una. El helper no
 * fallaba: hacía silenciosamente lo contrario de lo que promete su nombre.
 *
 * Se consultan las tres formas porque `db.topology` sigue siendo la válida en
 * drivers viejos y no cuesta nada dejarla al final.
 */
const resolveTopologyType = connection =>
  connection?.client?.topology?.description?.type ||
  connection?.getClient?.()?.topology?.description?.type ||
  connection?.db?.topology?.description?.type ||
  null

let yaAvisoSinTransacciones = false

/**
 * Ejecuta un callback con o sin transacción según el tipo de MongoDB.
 * - ReplicaSet / Atlas → usa transacción
 * - Standalone (local) → ejecuta directo, con el callback recibiendo null
 *
 * El callback SIEMPRE tiene que contemplar que `session` sea null: sobre
 * standalone no hay atomicidad posible y lo único honesto es correr igual.
 */
export const withOptionalTransaction = async callback => {
  const topologyType = resolveTopologyType(mongoose.connection)

  const supportsTransactions =
    topologyType === 'ReplicaSetWithPrimary' ||
    topologyType === 'Sharded'

  if (!supportsTransactions) {
    // Sobre standalone esto es lo esperado y no hay nada que reportar. En
    // producción la base es un replica set, así que llegar acá significa que
    // la detección volvió a romperse — que es justamente lo que pasó durante
    // toda la vida de este archivo sin que ninguna prueba lo notara.
    if (process.env.NODE_ENV === 'production' && !yaAvisoSinTransacciones) {
      yaAvisoSinTransacciones = true
      logger.error(
        '[TRANSACCIONES] La base no informa soporte de transacciones en producción: todo lo que depende de withOptionalTransaction está corriendo sin atomicidad',
        { topologyType },
      )
    }

    return callback(null)
  }

  const session = await mongoose.startSession()

  try {
    session.startTransaction()
    const result = await callback(session)
    await session.commitTransaction()
    return result
  } catch (error) {
    await session.abortTransaction()
    throw error
  } finally {
    session.endSession()
  }
}
