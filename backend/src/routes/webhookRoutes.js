// 📁 src/routes/webhookRoutes.js
// Rutas para webhooks de terceros (Mercado Pago, etc)

import express from 'express'
import { handleSubscriptionWebhook } from '../controller/subscriptionWebhookCtrl.js'
import { SUBSCRIPTION_WEBHOOK_ROUTE } from '../config/subscriptionConfig.js'

const router = express.Router()

/**
 * POST /api/webhooks/mercadopago/subscription
 * Webhook público para eventos de suscripción de Mercado Pago
 *
 * Mercado Pago envía notificaciones de:
 * - subscription_update: cambios en la suscripción
 * - subscription_authorized: pago aprobado
 * - subscription_failed: pago rechazado
 * - subscription_canceled: cancelación
 *
 * Body:
 * {
 *   "type": "subscription_authorized",
 *   "data": {
 *     "id": "123456789",
 *     "status": "authorized",
 *     "reason": null
 *   }
 * }
 */
// La ruta viene de subscriptionConfig, que es la misma fuente que usa la URL
// declarada a Mercado Pago. Escribirla literal acá es lo que permitió que las
// dos divergieran sin que nada avisara.
router.post(SUBSCRIPTION_WEBHOOK_ROUTE, handleSubscriptionWebhook)

export default router
