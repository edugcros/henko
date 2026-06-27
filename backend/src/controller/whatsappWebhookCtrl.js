// 📁 src/controller/whatsappWebhookCtrl.js
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

export const verifyWhatsappWebhook = async (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  const globalVerifyToken = clean(process.env.WHATSAPP_VERIFY_TOKEN)
  if (mode === 'subscribe' && token && token === globalVerifyToken)
    return res.status(200).send(challenge)
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
      }).select(
        '+channels.whatsapp.accessToken +channels.whatsapp.verifyToken +channels.whatsapp.appSecret',
      )

      if (!agent) continue

      if (process.env.NODE_ENV === 'production') {
        const isValidSignature = verifyWhatsappSignature({
          rawBody: req.rawBody,
          signatureHeader: req.headers['x-hub-signature-256'],
          appSecret: agent.channels.whatsapp.appSecret,
        })
        if (!isValidSignature) continue
      }

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
