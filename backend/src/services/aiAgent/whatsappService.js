// 📁 src/services/aiAgent/whatsappService.js
import crypto from 'node:crypto'

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0'
const clean = value => String(value || '').trim()

export const verifyWhatsappSignature = ({ rawBody, signatureHeader, appSecret }) => {
  const cleanSecret = clean(appSecret)
  if (!cleanSecret) return true // Permite entornos dev, bloquear en prod desde controller.
  if (!signatureHeader || !String(signatureHeader).startsWith('sha256=')) return false

  const expected = `sha256=${crypto.createHmac('sha256', cleanSecret).update(rawBody || '').digest('hex')}`
  const receivedBuffer = Buffer.from(String(signatureHeader))
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
}

const callWhatsappApi = async ({ phoneNumberId, accessToken, payload }) => {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Error WhatsApp API ${response.status}`)
    error.statusCode = response.status
    error.details = data
    throw error
  }
  return data
}

export const sendWhatsappTextMessage = async ({ phoneNumberId, accessToken, to, text }) => {
  if (!clean(phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID faltante')
  if (!clean(accessToken)) throw new Error('WHATSAPP_ACCESS_TOKEN faltante')
  if (!clean(to)) throw new Error('Destinatario WhatsApp faltante')
  if (!clean(text)) throw new Error('Mensaje WhatsApp vacío')

  return callWhatsappApi({
    phoneNumberId: clean(phoneNumberId),
    accessToken: clean(accessToken),
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: clean(to),
      type: 'text',
      text: { preview_url: false, body: clean(text).slice(0, 4000) },
    },
  })
}

export const sendWhatsappTemplateMessage = async ({ phoneNumberId, accessToken, to, templateName, languageCode = 'es_AR', bodyParameters = [] }) => {
  if (!clean(templateName)) throw new Error('Nombre de template WhatsApp faltante')

  return callWhatsappApi({
    phoneNumberId: clean(phoneNumberId),
    accessToken: clean(accessToken),
    payload: {
      messaging_product: 'whatsapp',
      to: clean(to),
      type: 'template',
      template: {
        name: clean(templateName),
        language: { code: clean(languageCode) || 'es_AR' },
        components: bodyParameters.length
          ? [{ type: 'body', parameters: bodyParameters.map(text => ({ type: 'text', text: String(text).slice(0, 1024) })) }]
          : [],
      },
    },
  })
}

export const extractWhatsappMessages = body => {
  const messages = []
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {}
      const metadata = value?.metadata || {}
      const contacts = Array.isArray(value?.contacts) ? value.contacts : []
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        const contact = contacts.find(item => item?.wa_id === message?.from)
        messages.push({
          messageId: message?.id,
          from: message?.from,
          customerName: contact?.profile?.name || '',
          phoneNumberId: metadata?.phone_number_id || '',
          type: message?.type,
          text: message?.type === 'text' ? message?.text?.body || '' : '',
          unsupported: message?.type !== 'text',
          raw: message,
        })
      }
    }
  }
  return messages
}
