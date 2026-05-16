// 📁 src/jobs/emailProcessor.js
// Ejecutar cada 30 segundos con node-cron

import cron from 'node-cron'
import { processPendingEmails } from '../controllers/paymentController.js'
import logger from '../config/logger.js'

// Procesar emails cada 30 segundos
cron.schedule('*/30 * * * * *', async () => {
  try {
    await processPendingEmails()
  } catch (error) {
    logger.error(`❌ Error en cron de emails: ${error.message}`)
  }
})

logger.info('📧 Email processor cron iniciado')