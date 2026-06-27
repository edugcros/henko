// 📁 src/services/aiAgent/whatsappService.js
import crypto from 'node:crypto'

const clean = value => String(value ?? '').trim()

const normalizeGraphApiVersion = value => {
  const version = clean(value || 'v20.0')
  return /^v\d{1,2}\.\d{1,2}$/.test(version) ? version : 'v20.0'
}

const GRAPH_API_VERSION = normalizeGraphApiVersion(
  process.env.WHATSAPP_GRAPH_VERSION,
)

const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

const toNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const normalizePhone = value => clean(value).replace(/[^\d]/g, '')

const normalizeLanguageCode = value => {
  const code = clean(value || 'es_AR')
  return /^[a-z]{2}(?:_[A-Z]{2})?$/.test(code) ? code : 'es_AR'
}

const sanitizeTemplateName = value => clean(value).slice(0, 512)

const sanitizeTemplateParameter = value => {
  if (value == null) return ''

  if (typeof value === 'string') return clean(value).slice(0, 1024)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, 1024)
  }

  return clean(JSON.stringify(value)).slice(0, 1024)
}

const buildWhatsappError = ({ message, code, statusCode, details }) => {
  const error = new Error(message)
  error.code = code
  if (statusCode) error.statusCode = statusCode
  if (details) error.details = details
  return error
}

const getRetryAfterMs = response => {
  const retryAfter = response?.headers?.get?.('retry-after')
  const seconds = Number(retryAfter)

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 10000)
  }

  return null
}

export const verifyWhatsappSignature = ({
  rawBody,
  signatureHeader,
  appSecret,
}) => {
  const cleanSecret = clean(appSecret)

  if (!cleanSecret) {
    return process.env.NODE_ENV !== 'production'
  }

  const received = clean(signatureHeader)
  if (!received.startsWith('sha256=')) return false

  const expected = `sha256=${crypto
    .createHmac('sha256', cleanSecret)
    .update(rawBody || '')
    .digest('hex')}`

  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  )
}

const callWhatsappApi = async ({ phoneNumberId, accessToken, payload }) => {
  const timeoutMs = Math.min(
    Math.max(toNumber(process.env.WHATSAPP_API_TIMEOUT_MS, 15000), 1000),
    60000,
  )
  const maxAttempts = Math.min(
    Math.max(toNumber(process.env.WHATSAPP_API_MAX_ATTEMPTS, 3), 1),
    5,
  )
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
    clean(phoneNumberId),
  )}/messages`

  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let retryDelayMs = null

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clean(accessToken)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      const data = await response.json().catch(() => null)

      if (response.ok) return data

      const error = buildWhatsappError({
        message: data?.error?.message || `Error WhatsApp API ${response.status}`,
        statusCode: response.status,
        code: data?.error?.code || 'WHATSAPP_API_ERROR',
        details: {
          providerTraceId: data?.error?.fbtrace_id || null,
          providerError: data?.error || data || null,
          attempt,
        },
      })

      const retryable = response.status === 429 || response.status >= 500
      retryDelayMs = getRetryAfterMs(response)

      if (!retryable || attempt === maxAttempts) throw error
      lastError = error
    } catch (error) {
      const normalizedError =
        error?.name === 'AbortError'
          ? buildWhatsappError({
            message: 'WhatsApp API timeout',
            code: 'WHATSAPP_API_TIMEOUT',
          })
          : error

      const retryable =
        normalizedError?.code === 'WHATSAPP_API_TIMEOUT' ||
        normalizedError instanceof TypeError ||
        normalizedError?.statusCode === 429 ||
        normalizedError?.statusCode >= 500

      if (!retryable || attempt === maxAttempts) throw normalizedError
      lastError = normalizedError
    } finally {
      clearTimeout(timeout)
    }

    await sleep(retryDelayMs ?? Math.min(250 * 2 ** (attempt - 1), 2000))
  }

  throw lastError ||
    buildWhatsappError({
      message: 'WhatsApp API unavailable',
      code: 'WHATSAPP_API_UNAVAILABLE',
    })
}

export const sendWhatsappTextMessage = async ({
  phoneNumberId,
  accessToken,
  to,
  text,
}) => {
  const cleanPhoneNumberId = clean(phoneNumberId)
  const cleanAccessToken = clean(accessToken)
  const destination = normalizePhone(to)
  const body = clean(text)

  if (!cleanPhoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID faltante')
  if (!cleanAccessToken) throw new Error('WHATSAPP_ACCESS_TOKEN faltante')
  if (!destination) throw new Error('Destinatario WhatsApp faltante')
  if (!body) throw new Error('Mensaje WhatsApp vacío')

  return callWhatsappApi({
    phoneNumberId: cleanPhoneNumberId,
    accessToken: cleanAccessToken,
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: destination,
      type: 'text',
      text: {
        preview_url: false,
        body: body.slice(0, 4000),
      },
    },
  })
}

export const sendWhatsappTemplateMessage = async ({
  phoneNumberId,
  accessToken,
  to,
  templateName,
  languageCode = 'es_AR',
  bodyParameters = [],
}) => {
  const cleanPhoneNumberId = clean(phoneNumberId)
  const cleanAccessToken = clean(accessToken)
  const destination = normalizePhone(to)
  const cleanTemplateName = sanitizeTemplateName(templateName)

  if (!cleanTemplateName) throw new Error('Nombre de template WhatsApp faltante')
  if (!cleanPhoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID faltante')
  if (!cleanAccessToken) throw new Error('WHATSAPP_ACCESS_TOKEN faltante')
  if (!destination) throw new Error('Destinatario WhatsApp faltante')

  const parameters = Array.isArray(bodyParameters)
    ? bodyParameters.map(text => ({
      type: 'text',
      text: sanitizeTemplateParameter(text),
    }))
    : []

  return callWhatsappApi({
    phoneNumberId: cleanPhoneNumberId,
    accessToken: cleanAccessToken,
    payload: {
      messaging_product: 'whatsapp',
      to: destination,
      type: 'template',
      template: {
        name: cleanTemplateName,
        language: { code: normalizeLanguageCode(languageCode) },
        components: parameters.length
          ? [
            {
              type: 'body',
              parameters,
            },
          ]
          : [],
      },
    },
  })
}

const extractMessageText = message => {
  if (message?.type === 'text') return clean(message?.text?.body)
  if (message?.type === 'button') return clean(message?.button?.text)
  if (message?.type === 'interactive') {
    return clean(
      message?.interactive?.button_reply?.title ||
        message?.interactive?.list_reply?.title ||
        message?.interactive?.button_reply?.id ||
        message?.interactive?.list_reply?.id,
    )
  }

  return ''
}

export const extractWhatsappMessages = body => {
  const messages = []

  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {}
      const metadata = value?.metadata || {}
      const contacts = Array.isArray(value?.contacts) ? value.contacts : []
      const statuses = Array.isArray(value?.statuses) ? value.statuses : []

      for (const status of statuses) {
        messages.push({
          messageId: clean(status?.id),
          from: normalizePhone(status?.recipient_id),
          customerName: '',
          phoneNumberId: clean(metadata?.phone_number_id),
          type: 'status',
          text: '',
          unsupported: true,
          status: clean(status?.status),
          timestamp: status?.timestamp || null,
          raw: status,
        })
      }

      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        const contact = contacts.find(item => item?.wa_id === message?.from)
        const type = clean(message?.type) || 'unknown'
        const text = extractMessageText(message)

        messages.push({
          messageId: clean(message?.id),
          from: normalizePhone(message?.from),
          customerName: clean(contact?.profile?.name),
          phoneNumberId: clean(metadata?.phone_number_id),
          type,
          text,
          unsupported: !['text', 'button', 'interactive'].includes(type),
          timestamp: message?.timestamp || null,
          raw: message,
        })
      }
    }
  }

  return messages.filter(message => message.messageId || message.from)
}
