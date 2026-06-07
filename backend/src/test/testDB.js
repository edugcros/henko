// 📁 src/test/testDB.js (o testSetup.js)
import mongoose from 'mongoose'

export const connectTestDB = async () => {
  const dbUri =
    process.env.MONGODB_TEST_URI ||
    process.env.MONGO_TEST_URI ||
    process.env.MONGODB_URL ||
    process.env.MONGO_URI

  if (!dbUri || !dbUri.startsWith('mongodb')) {
    throw new Error('Cadena de conexión Mongo inválida. Verifica MONGODB_TEST_URI o MONGO_TEST_URI')
  }

  await mongoose.connect(dbUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
}

export const disconnectTestDB = async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.connection.close()
  console.log('Base de test desconectada y eliminada')
}
