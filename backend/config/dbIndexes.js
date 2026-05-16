// 📁 src/config/dbIndexes.js
// Ejecutar al iniciar la app

import mongoose from 'mongoose'

export const createIndexes = async () => {
  // PaymentAttempt - TTL automático (5 minutos)
  await mongoose.connection.collection('paymentattempts').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 300 },
  )
  
  // WebhookLog - TTL automático (24 horas)
  await mongoose.connection.collection('webhooklogs').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 86400 },
  )
  
  // DistributedLock - TTL automático (2 minutos)
  await mongoose.connection.collection('distributedlocks').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 120 },
  )
  
  // EmailJob
  await mongoose.connection.collection('emailjobs').createIndex(
    { status: 1, createdAt: 1 },
  )
  
  console.log('✅ Índices MongoDB creados')
}