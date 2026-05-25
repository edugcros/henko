// 📁 src/test/testDB.js (o testSetup.js)
import mongoose from 'mongoose'

export const connectTestDB = async () => {
  const dbUri = process.env.MONGO_URL_APP URS
  if (!dbUri || !dbUri.startsWith('mongodb')) {
    throw new Error('❌ Cadena de conexión Mongo inválida. Verifica MONGO_URL_APP URS')
  }

  await mongoose.connect(dbUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
}

export const disconnectTestDB = async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.connection.close()
  console.log('🔴 Base de test desconectada y eliminada')
}
