import mongoose from 'mongoose'

/**
 * Ejecuta un callback con o sin transacción según el tipo de MongoDB.
 * - ReplicaSet / Atlas → usa transacción
 * - Standalone (local) → ejecuta directo
 */
export const withOptionalTransaction = async callback => {
  const topologyType =
    mongoose.connection?.db?.topology?.description?.type

  const supportsTransactions =
    topologyType === 'ReplicaSetWithPrimary' ||
    topologyType === 'Sharded'

  if (!supportsTransactions) {
    // Mongo standalone → sin sesión
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
