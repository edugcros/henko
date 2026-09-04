// 📁 src/routes/subscriptionRoutes.js
// Rutas para flujo de suscripción

import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

import {
  getSubscriptionConfig,
  processSubscriptionPayment,
  getCurrentSubscription,
} from '../controller/subscriptionCtrl.js'

import { authMiddleware } from '../middlewares/authMiddleware.js'
import {
  resolveTenantByDomain,
  requireTenant,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

// =====================================================
// RATE LIMITERS
// =====================================================

const subscriptionPaymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hora
  max: 10,                    // 10 intentos por hora
  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: req => {
    const tenantId = req.tenantId || req.user?.tenantId || 'no-tenant'
    const userId = req.user?._id || req.user?.id || req.ip || 'anonymous'
    return `${tenantId}:${userId}`
  },

  message: {
    success: false,
    message: 'Demasiados intentos de pago. Esperá una hora e intentá nuevamente.',
  },
})

// =====================================================
// RUTAS
// =====================================================

/**
 * GET /api/subscriptions/config
 * Obtener configuración de pago (public key MP, plan actual, etc)
 * Acceso: Autenticado + Tenant resuelto
 */
router.get(
  '/config',
  resolveTenantByDomain,
  requireTenant,
  authMiddleware,
  getSubscriptionConfig,
)

/**
 * POST /api/subscriptions/process-payment
 * Procesar pago de suscripción recurrente en Mercado Pago
 *
 * Body:
 * {
 *   plan: 'starter' | 'pro',
 *   token: '<card_token_mp>',
 *   paymentMethodId: 'credit_card',
 *   issuerId?: '123',
 *   payer: {
 *     name: 'Juan Perez',
 *     email: 'juan@example.com',
 *     identification?: { type: 'DNI', number: '12345678' }
 *   }
 * }
 *
 * Response:
 * {
 *   success: true,
 *   message: 'Suscripción activada exitosamente',
 *   data: {
 *     subscriptionId: '<mp_subscription_id>',
 *     plan: 'starter',
 *     status: 'active' | 'pending'
 *   }
 * }
 */
router.post(
  '/process-payment',
  resolveTenantByDomain,
  requireTenant,
  authMiddleware,
  subscriptionPaymentLimiter,
  processSubscriptionPayment,
)

/**
 * GET /api/subscriptions/current
 * Obtener información actual de suscripción del tenant
 * Acceso: Autenticado + Tenant resuelto
 */
router.get(
  '/current',
  resolveTenantByDomain,
  requireTenant,
  authMiddleware,
  getCurrentSubscription,
)

export default router
