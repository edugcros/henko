import mongoose from 'mongoose'

export const connectTestDB = async () => {
  if (mongoose.connection.readyState === 1) return

  const dbUri =
    process.env.MONGODB_TEST_URI ||
    process.env.MONGO_TEST_URI ||
    process.env.MONGODB_URL ||
    process.env.MONGO_URI

  if (!dbUri || !dbUri.startsWith('mongodb')) {
    throw new Error('Cadena de conexión Mongo inválida. Verifica MONGODB_TEST_URI o MONGO_TEST_URI')
  }

  await mongoose.connect(dbUri)
}

export const disconnectTestDB = async () => {
  if (mongoose.connection.readyState === 0) return

  await mongoose.connection.dropDatabase()
  await mongoose.connection.close()
}
