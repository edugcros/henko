// 📁 src/routes/subscriptionRoutes.js
// Rutas para flujo de suscripción

import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

import {
  getSubscriptionConfig,
  processSubscriptionPayment,
  getCurrentSubscription,
  changeSubscriptionPlan,
  cancelSubscription,
  getSubscriptionInvoices,
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
 *
 * Devuelve el plan y el estado de suscripción del comercio, así que exige
 * sesión: son datos del tenant, no información pública de pricing (esa vive
 * en la pantalla de planes, que no llama a este endpoint).
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
// Exige sesión: el handler escribe plan, subscriptionStatus y los datos de
// facturación del tenant. Sin authMiddleware cualquiera que resuelva el
// dominio podía mutar la suscripción del comercio, y el rate limit de acá
// arriba degradaba a IP por no tener req.user.
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

/**
 * POST /api/subscriptions/change-plan
 * Cambiar plan de suscripción actual
 *
 * Body:
 * {
 *   newPlan: 'starter' | 'pro'
 * }
 *
 * Response:
 * {
 *   success: true,
 *   message: 'Plan actualizado exitosamente',
 *   data: {
 *     plan: 'pro',
 *     status: 'active'
 *   }
 * }
 */
router.post(
  '/change-plan',
  resolveTenantByDomain,
  requireTenant,
  authMiddleware,
  changeSubscriptionPlan,
)

/**
 * POST /api/subscriptions/cancel
 * Cancelar suscripción actual (vuelve el tenant a plan 'free')
 *
 * Response:
 * {
 *   success: true,
 *   message: 'Suscripción cancelada exitosamente',
 *   data: {
 *     status: 'cancelled',
 *     plan: 'free'
 *   }
 * }
 */
router.post(
  '/cancel',
  resolveTenantByDomain,
  requireTenant,
  authMiddleware,
  cancelSubscription,
)

/**
 * GET /api/subscriptions/invoices
 * Obtener historial de pagos/facturas de la suscripción
 *
 * Response:
 * {
 *   success: true,
 *   message: 'Facturas obtenidas',
 *   data: {
 *     invoices: [
 *       {
 *         id: '12345',
 *         status: 'approved',
 *         amount: 99.00,
 *         currency: 'USD',
 *         date: '2026-09-04T00:00:00Z',
 *         paidDate: '2026-09-04T12:30:00Z',
 *         reason: 'Suscripción Henko Plan pro'
 *       }
 *     ],
 *     subscriptionId: '<mp_subscription_id>'
 *   }
 * }
 */
router.get(
  '/invoices',
  resolveTenantByDomain,
  requireTenant,
  authMiddleware,
  getSubscriptionInvoices,
)

export default router
