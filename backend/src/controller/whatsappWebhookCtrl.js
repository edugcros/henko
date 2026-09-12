// 📁 src/controller/whatsappWebhookCtrl.js
import crypto from 'node:crypto'

import AiAgent from '../models/aiAgentModel.js'
import Tenant from '../models/tenantModel.js'
import { processAgentMessage } from '../services/aiAgent/aiAgentBrainService.js'
import {
  extractWhatsappMessages,
  sendWhatsappTextMessage,
  verifyWhatsappSignature,
} from '../services/aiAgent/whatsappService.js'
import { registerCustomerInboundMessage } from '../services/aiAgent/aiContactPolicyService.js'
import logger from '../../config/logger.js'

const clean = value => String(value || '').trim()

/**
 * El token de verificación de ESTE comercio.
 *
 * Meta pide un "verify token" al dar de alta el webhook: lo manda una sola vez
 * y espera que le devolvamos el challenge. Antes había uno solo para toda la
 * plataforma, así que todos los comercios tenían que pegar el mismo secreto —
 * y el campo que la pantalla les pedía completar no lo leía nadie.
 *
 * Ahora cada comercio tiene el suyo, derivado de su id con HMAC. No se guarda
 * en ningún lado: se recalcula y se compara. Así se le puede mostrar en el
 * panel sin compartir un secreto entre comercios, y sin una tabla más.
 */
export const buildWebhookVerifyToken = tenantId => {
  const secret = clean(process.env.WHATSAPP_VERIFY_TOKEN)
  const id = clean(tenantId)

  if (!secret || !id) return ''

  const signature = crypto
    .createHmac('sha256', secret)
    .update(id)
    .digest('hex')
    .slice(0, 32)

  return `${id}.${signature}`
}

const isValidTenantVerifyToken = token => {
  const [tenantId] = clean(token).split('.')
  const expected = buildWebhookVerifyToken(tenantId)

  if (!expected || expected.length !== clean(token).length) return false

  return crypto.timingSafeEqual(Buffer.from(clean(token)), Buffer.from(expected))
}

export const verifyWhatsappWebhook = async (req, res) => {
  const mode = req.query['hub.mode']
  const token = clean(req.query['hub.verify_token'])
  const challenge = req.query['hub.challenge']
  const globalVerifyToken = clean(process.env.WHATSAPP_VERIFY_TOKEN)

  // Se aceptan los dos: el token por comercio (el que muestra el panel) y el
  // global de siempre, para no romper una integración ya dada de alta con él.
  const accepted =
    mode === 'subscribe' &&
    token &&
    ((globalVerifyToken && token === globalVerifyToken) ||
      isValidTenantVerifyToken(token))

  if (accepted) return res.status(200).send(challenge)

  return res
    .status(403)
    .json({ success: false, message: 'Webhook verification failed' })
}

export const receiveWhatsappWebhook = async (req, res) => {
  res.status(200).json({ success: true })
  const messages = extractWhatsappMessages(req.body)
  if (!messages.length) return

  for (const message of messages) {
    try {
      const agent = await AiAgent.findOne({
        'channels.whatsapp.phoneNumberId': message.phoneNumberId,
        enabled: true,
        'channels.whatsapp.enabled': true,
      })
        .select(
          '+channels.whatsapp.accessToken +channels.whatsapp.appSecret',
        )
        .setOptions({ ignoreTenant: true })

      if (!agent) continue

      // Siempre se valida la firma, y verifyWhatsappSignature falla cerrado
      // si el agente no tiene appSecret configurado (sin importar el
      // ambiente) — antes esto quedaba condicionado a NODE_ENV==='production'
      // en un punto o en otro, así que cualquier entorno mal configurado
      // (staging, typo en el deploy) aceptaba webhooks sin comprobar que
      // vinieran de Meta.
      const isValidSignature = verifyWhatsappSignature({
        rawBody: req.rawBody,
        signatureHeader: req.headers['x-hub-signature-256'],
        appSecret: agent.channels.whatsapp.appSecret,
      })
      if (!isValidSignature) continue

      const tenant = await Tenant.findById(agent.tenantId).lean()
      if (!tenant) continue

      if (message.unsupported) {
        await sendWhatsappTextMessage({
          phoneNumberId: agent.channels.whatsapp.phoneNumberId,
          accessToken: agent.channels.whatsapp.accessToken,
          to: message.from,
          text: 'Por ahora puedo responder mensajes de texto. Enviame tu consulta escrita y te ayudo.',
        })
        continue
      }

      await registerCustomerInboundMessage({
        tenantId: agent.tenantId,
        channel: 'whatsapp',
        destination: message.from,
      })

      const result = await processAgentMessage({
        tenantId: agent.tenantId,
        tenant,
        channel: 'whatsapp',
        externalUserId: message.from,
        customerName: message.customerName,
        customerPhone: message.from,
        text: message.text,
        externalMessageId: message.messageId,
      })
      if (result.duplicate) continue
      await sendWhatsappTextMessage({
        phoneNumberId: agent.channels.whatsapp.phoneNumberId,
        accessToken: agent.channels.whatsapp.accessToken,
        to: message.from,
        text: result.reply,
      })
    } catch (error) {
      logger.error('[WhatsApp Agent] Error procesando mensaje', {
        message: error.message,
        code: error.code || null,
      })
    }
  }
}
