// 📁 src/routes/paymentRoutes.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / SHOP DOMAIN / RATE LIMIT / WEBHOOK SAFE

import express from 'express'
import rateLimit from 'express-rate-limit'

import {
  processPayment,
  mpWebhook,
} from '../controller/paymentController.js'

import { authMiddleware } from '../middlewares/authMiddleware.js'
import {
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

// =====================================================
// RATE LIMITERS
// =====================================================

const paymentWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    const tenantId = req.tenantId || req.user?.tenantId || 'no-tenant'
    const actorId = req.user?._id || req.user?.id || req.ip || 'anonymous'

    return `${tenantId}:${actorId}`
  },
  message: {
    success: false,
    message: 'Demasiados intentos de pago. Esperá unos minutos e intentá nuevamente.',
  },
})

const mpWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    const mpSignature = req.headers['x-signature'] || 'no-signature'
    const mpRequestId = req.headers['x-request-id'] || 'no-request-id'

    return `mp-webhook:${mpSignature}:${mpRequestId}:${req.ip}`
  },
  message: {
    success: false,
    message: 'Demasiadas notificaciones recibidas.',
  },
})

// =====================================================
// STOREFRONT / CUSTOMER
// =====================================================

/**
 * Procesar pago desde storefront autenticado.
 *
 * POST /api/payments/process
 *
 * Requiere:
 * - Tenant resuelto por dominio storefront.
 * - No admin domain.
 * - Usuario autenticado.
 * - Rate limit por tenant + usuario/IP.
 *
 * CSRF:
 * Si ya tenés csrfProtectionDynamic global en app.js,
 * no lo repitas acá para evitar doble validación.
 */
router.post(
  '/process',
  resolveTenantByDomain,
  requireTenant,
  requireShopDomain,
  authMiddleware,
  paymentWriteLimiter,
  processPayment,
)

// =====================================================
// WEBHOOKS
// =====================================================

/**
 * Webhook de Mercado Pago.
 *
 * POST /api/payments/webhook/mercadopago
 *
 * No lleva:
 * - authMiddleware
 * - requireShopDomain
 * - csrfProtection
 *
 * Motivo:
 * Mercado Pago llama desde servidores externos y no desde el browser.
 *
 * La autenticidad debe validarse dentro de mpWebhook:
 * - x-signature
 * - x-request-id
 * - data.id / payment id
 * - metadata / external_reference / orderId
 */
router.post(
  '/webhook/mercadopago',
  mpWebhookLimiter,
  mpWebhook,
)

export default router