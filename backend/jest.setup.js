import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { connectTestDB } from './src/test/testDB'
let mongo

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  const uri = mongo.getUri()
  await connectTestDB()
})

afterEach(async () => {
  const collections = await mongoose.connection.db.collections()
  for (let collection of collections) {
    await collection.deleteMany({})
  }
})

afterAll(async () => {
  // Cierra la conexión si aún está abierta
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
  }
})