// 📁 src/controller/sendgridWebhookCtrl.js
//
// Qué pasó DESPUÉS de que SendGrid aceptó el correo.
//
// POR QUÉ HACE FALTA
//
// El envío registra "aceptado por SendGrid" cuando la API devuelve 202, y eso
// solo significa "lo recibí, después veré qué hago". El rebote, el descarte y
// el bloqueo ocurren más tarde y por otro canal.
//
// Pasó en producción el 18/09/2026: un correo quedó en `Dropped` porque la
// dirección estaba en la lista de supresión de SendGrid, y en los logs figuraba
// como enviado correctamente. Sin esto, un cliente que no recibe su correo de
// verificación es indistinguible de uno que sí lo recibió.

import crypto from 'node:crypto'

import logger from '../../config/logger.js'
import { sendResponse } from '../utils/response.js'

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature'
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp'

/**
 * Eventos que significan que el correo NO llegó.
 *
 * `deferred` queda afuera a propósito: es un reintento en curso, no un fallo, y
 * tratarlo como error llenaría los logs de alarmas que se resuelven solas.
 */
const EVENTOS_DE_FALLO = new Set([
  'bounce',
  'dropped',
  'blocked',
  'spamreport',
])

/**
 * Cuánto se tolera de desfasaje entre el reloj de SendGrid y el nuestro.
 *
 * Sin ventana, una firma robada se puede reenviar para siempre. Diez minutos
 * cubren cualquier desfasaje razonable de relojes sin dejar la puerta abierta.
 */
const VENTANA_TOLERADA_MS = 10 * 60 * 1000

/**
 * ¿La firma es de SendGrid?
 *
 * SendGrid firma con ECDSA sobre (timestamp + cuerpo crudo). Por eso se usa
 * req.rawBody y no req.body: JSON.stringify del objeto ya parseado no
 * reproduce byte a byte lo que se firmó, y la verificación fallaría siempre.
 */
export const verifySendgridSignature = req => {
  const clavePublica = String(process.env.SENDGRID_WEBHOOK_PUBLIC_KEY || '').trim()

  if (!clavePublica) {
    // Mismo criterio que el webhook de Mercado Pago: en producción sin clave
    // no se procesa nada, porque un endpoint público sin verificar deja que
    // cualquiera invente rebotes.
    if (process.env.NODE_ENV === 'production') {
      logger.error('❌ SENDGRID_WEBHOOK_PUBLIC_KEY no configurada en producción')
      return false
    }

    logger.warn('⚠️ SENDGRID_WEBHOOK_PUBLIC_KEY sin configurar; no se verifica en desarrollo')
    return true
  }

  const firma = req.headers[SIGNATURE_HEADER]
  const timestamp = req.headers[TIMESTAMP_HEADER]

  if (!firma || !timestamp) return false

  const edad = Math.abs(Date.now() - Number(timestamp) * 1000)

  if (!Number.isFinite(edad) || edad > VENTANA_TOLERADA_MS) {
    logger.warn('[SENDGRID] Evento con timestamp fuera de ventana', { timestamp })
    return false
  }

  const cuerpo = req.rawBody

  if (!cuerpo) {
    logger.error('[SENDGRID] Falta req.rawBody: no se puede verificar la firma')
    return false
  }

  try {
    const verificador = crypto.createVerify('sha256')
    verificador.update(timestamp)
    verificador.update(cuerpo)
    verificador.end()

    return verificador.verify(
      {
        key: `-----BEGIN PUBLIC KEY-----\n${clavePublica}\n-----END PUBLIC KEY-----`,
        format: 'pem',
      },
      firma,
      'base64',
    )
  } catch (error) {
    logger.warn('[SENDGRID] No se pudo verificar la firma', { message: error.message })
    return false
  }
}

/**
 * POST /api/webhooks/sendgrid/events
 *
 * SendGrid manda los eventos en lotes. Se responde 204 siempre que la firma sea
 * válida: un error nuestro procesando un evento no debe hacer que SendGrid
 * reintente el lote entero en bucle.
 */
export const handleSendgridEvents = async (req, res) => {
  if (!verifySendgridSignature(req)) {
    logger.error('🔴 Webhook de SendGrid con firma inválida', {
      hasSignature: Boolean(req.headers[SIGNATURE_HEADER]),
    })

    return sendResponse(res, 401, false, 'Firma inválida')
  }

  const eventos = Array.isArray(req.body) ? req.body : []

  for (const evento of eventos) {
    const tipo = String(evento?.event || '').toLowerCase()

    const datos = {
      evento: tipo,
      to: evento?.email || null,
      // sg_message_id trae un sufijo de enrutamiento después del punto; la
      // parte anterior es el messageId que ya se registra al enviar, y es lo
      // que permite cruzar este evento con aquella línea del log.
      messageId: String(evento?.sg_message_id || '').split('.')[0] || null,
      motivo: evento?.reason || evento?.response || null,
      tipoRebote: evento?.type || null,
    }

    if (EVENTOS_DE_FALLO.has(tipo)) {
      logger.error('📭 Correo NO entregado', datos)
      continue
    }

    logger.info('📬 Evento de correo', datos)
  }

  return res.status(204).end()
}

export default { handleSendgridEvents, verifySendgridSignature }
