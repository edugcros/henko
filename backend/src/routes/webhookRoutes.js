// 📁 src/routes/webhookRoutes.js
// Rutas para webhooks de terceros (Mercado Pago, etc)

import express from 'express'
import { handleSubscriptionWebhook } from '../controller/subscriptionWebhookCtrl.js'

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
router.post('/mercadopago/subscription', handleSubscriptionWebhook)

export default router
