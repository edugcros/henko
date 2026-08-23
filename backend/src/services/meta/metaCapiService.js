// 📁 src/services/meta/metaCapiService.js
//
// Meta Conversions API — la mitad "servidor" del pixel. El pixel del
// navegador se pierde con cualquier bloqueador de terceros o Safari/ITP; el
// evento server-side llega igual porque sale del propio backend. Se manda
// con el mismo event_id que el pixel del cliente (ver
// website/src/utils/metaPixel.js) para que Meta deduplique un solo evento en
// vez de contar la compra dos veces.
//
// No participa del flujo de pago: si Meta está caído o mal configurado, la
// orden ya se aprobó y confirmó antes de llegar acá (ver
// paymentController.js → queueApprovedPaymentSideEffects). Un fallo acá se
// loguea y no se reintenta desde este mismo request — el próximo intento de
// reconciliación (webhook/poll) lo vuelve a llamar, y el flag
// metaPurchaseEventSent evita reenviarlo si ya salió bien una vez.

import crypto from 'node:crypto'
import { Money } from '../../utils/money.js'
import { resolveTenantMetaCredentials } from './metaCredentialsService.js'
import { normalizeEmail, isValidEmail } from '../email/emailShared.js'
import logger from '../../../config/logger.js'

const GRAPH_API_VERSION = 'v21.0'
const CAPI_TIMEOUT_MS = 8000

const hashForMeta = value => {
  const clean = String(value || '').trim().toLowerCase()
  if (!clean) return null
  return crypto.createHash('sha256').update(clean).digest('hex')
}

const extractBuyerEmail = order => {
  const sources = [
    order?.shippingAddress?.email,
    order?.customerSnapshot?.email,
    order?.paymentIntent?.payerEmail,
    order?.orderby?.email,
  ]

  for (const email of sources) {
    const normalized = normalizeEmail(email)
    if (normalized && isValidEmail(normalized)) return normalized
  }

  return null
}

const getOrderEventId = order => String(order?._id || '')

const buildPurchasePayload = (order, { requestIp, userAgent, sourceUrl } = {}) => {
  const buyerEmail = extractBuyerEmail(order)
  const hashedEmail = hashForMeta(buyerEmail)

  const userData = {
    ...(hashedEmail ? { em: [hashedEmail] } : {}),
    ...(requestIp ? { client_ip_address: requestIp } : {}),
    ...(userAgent ? { client_user_agent: userAgent } : {}),
  }

  const contents = (order.products || []).map(item => ({
    id: String(item.product || ''),
    quantity: Number(item.count || 1),
    item_price: Money.toDecimal(item.priceCents),
  }))

  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: getOrderEventId(order),
        action_source: 'website',
        ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
        user_data: userData,
        custom_data: {
          currency: order.paymentIntent?.currency || 'ARS',
          value: Money.toDecimal(order.paymentIntent?.amountCents || 0),
          contents,
          content_type: 'product',
          order_id: String(order._id),
        },
      },
    ],
  }
}

/**
 * Manda el evento Purchase server-side a Meta CAPI para esta orden, si el
 * tenant tiene Meta Pixel configurado y todavía no se mandó para esta orden.
 * Nunca tira — un fallo acá no debe romper la confirmación del pago.
 */
export const sendMetaPurchaseEvent = async ({ order, tenantId, req }) => {
  if (!order || order.metaPurchaseEventSent) return { sent: false, reason: 'already_sent' }

  try {
    const credentials = await resolveTenantMetaCredentials(tenantId)

    if (!credentials.isEnabled) {
      return { sent: false, reason: 'not_configured' }
    }

    const payload = buildPurchasePayload(order, {
      requestIp: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    })

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${credentials.pixelId}/events?access_token=${encodeURIComponent(credentials.accessToken)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CAPI_TIMEOUT_MS)

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      logger.error('❌ Meta CAPI rechazó el evento Purchase', {
        orderId: order._id?.toString?.(),
        tenantId: String(tenantId),
        status: response.status,
        error: data?.error?.message || null,
      })
      return { sent: false, reason: 'rejected', status: response.status }
    }

    order.metaPurchaseEventSent = true
    order.metaPurchaseEventSentAt = new Date()

    logger.info('✅ Meta CAPI: evento Purchase enviado', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      eventsReceived: data?.events_received ?? null,
    })

    return { sent: true }
  } catch (error) {
    logger.error('❌ Error enviando evento Purchase a Meta CAPI', {
      orderId: order?._id?.toString?.(),
      tenantId: String(tenantId),
      message: error?.message,
    })
    return { sent: false, reason: 'error', error: error?.message }
  }
}

export default { sendMetaPurchaseEvent }
