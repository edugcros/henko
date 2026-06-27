import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import AiAgent from '../models/aiAgentModel.js'
import { encryptSecret } from '../services/aiAgent/aiCryptoService.js'

const SECRET_PATHS = [
  'channels.whatsapp.accessToken',
  'channels.whatsapp.appSecret',
  'channels.whatsapp.verifyToken',
]

const isEncrypted = value => String(value || '').startsWith('v1.')

const getPath = (source, path) => {
  return path.split('.').reduce((current, key) => current?.[key], source)
}

const run = async () => {
  const applyChanges = process.argv.includes('--apply')
  await connectDB()

  const documents = await AiAgent.collection
    .find(
      {},
      {
        projection: {
          tenantId: 1,
          'channels.whatsapp.accessToken': 1,
          'channels.whatsapp.appSecret': 1,
          'channels.whatsapp.verifyToken': 1,
        },
      },
    )
    .toArray()

  const operations = []
  let plaintextSecrets = 0

  for (const document of documents) {
    const set = {}

    for (const path of SECRET_PATHS) {
      const value = String(getPath(document, path) || '').trim()
      if (!value || isEncrypted(value)) continue

      plaintextSecrets += 1
      set[path] = encryptSecret(value)
    }

    if (Object.keys(set).length > 0) {
      operations.push({
        updateOne: {
          filter: { _id: document._id },
          update: { $set: set },
        },
      })
    }
  }

  if (applyChanges && operations.length > 0) {
    await AiAgent.collection.bulkWrite(operations, { ordered: false })
  }

  logger.info('Migración de secretos del agente IA finalizada', {
    applyChanges,
    agentsScanned: documents.length,
    agentsWithChanges: operations.length,
    plaintextSecrets,
  })

  if (!applyChanges && operations.length > 0) {
    logger.warn(
      'Se encontraron secretos sin cifrar. Ejecute el comando con --apply antes de producción.',
    )
  }
}

run()
  .catch(error => {
    logger.error('Migración de secretos del agente IA falló', {
      error: error.stack || error.message,
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
