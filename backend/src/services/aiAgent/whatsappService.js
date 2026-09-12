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

  // Sin appSecret configurado no hay forma de validar que el webhook venga
  // realmente de Meta — falla cerrado siempre, sin importar el ambiente. El
  // fallback anterior (aceptar sin firma fuera de NODE_ENV==='production')
  // dejaba cualquier staging o deploy mal configurado abierto a mensajes
  // falsificados que el agente de IA procesa y responde en nombre del
  // comercio. Para probar en dev, configurar un appSecret real del agente
  // de prueba — no relajar esta validación.
  if (!cleanSecret) {
    return false
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

  // Los mensajes nombran de dónde sale el dato de verdad. Decían
  // "WHATSAPP_PHONE_NUMBER_ID faltante" y "WHATSAPP_ACCESS_TOKEN faltante",
  // como si fueran variables de entorno del servidor: no lo son. Las
  // credenciales de WhatsApp son POR COMERCIO y se cargan en el panel, en
  // Configuración del agente. Quien leía ese error terminaba buscando la
  // variable en Render, donde no está ni tiene que estar.
  if (!cleanPhoneNumberId) {
    throw new Error(
      'Falta el Phone Number ID de WhatsApp en la configuración del asistente',
    )
  }
  if (!cleanAccessToken) {
    throw new Error(
      'Falta el Access Token de WhatsApp en la configuración del asistente',
    )
  }
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
  // Los mensajes nombran de dónde sale el dato de verdad. Decían
  // "WHATSAPP_PHONE_NUMBER_ID faltante" y "WHATSAPP_ACCESS_TOKEN faltante",
  // como si fueran variables de entorno del servidor: no lo son. Las
  // credenciales de WhatsApp son POR COMERCIO y se cargan en el panel, en
  // Configuración del agente. Quien leía ese error terminaba buscando la
  // variable en Render, donde no está ni tiene que estar.
  if (!cleanPhoneNumberId) {
    throw new Error(
      'Falta el Phone Number ID de WhatsApp en la configuración del asistente',
    )
  }
  if (!cleanAccessToken) {
    throw new Error(
      'Falta el Access Token de WhatsApp en la configuración del asistente',
    )
  }
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

/**
 * Le pregunta a Meta si esta conexión sirve, y traduce la respuesta.
 *
 * POR QUÉ EXISTE
 *
 * Conectar WhatsApp exige cuatro datos que se sacan de tres pantallas
 * distintas del panel de Meta. Quien los pega no tiene forma de saber si
 * quedaron bien: el asistente simplemente no contesta, o los envíos fallan
 * horas después. Y cada dato falla distinto — un token vencido no se parece
 * en nada a un número mal copiado.
 *
 * Esto hace dos preguntas concretas a la API de Meta con lo que hay guardado y
 * devuelve el diagnóstico campo por campo. No envía ningún mensaje.
 */
export const checkWhatsappConnection = async ({
  phoneNumberId,
  accessToken,
  businessAccountId,
  appSecret,
} = {}) => {
  const cleanPhoneNumberId = clean(phoneNumberId)
  const cleanAccessToken = clean(accessToken)
  const cleanBusinessAccountId = clean(businessAccountId)

  const checks = {
    phoneNumberId: { ok: false, detail: '' },
    accessToken: { ok: false, detail: '' },
    appSecret: { ok: Boolean(clean(appSecret)), detail: '' },
    webhook: { ok: false, detail: '' },
  }

  if (!clean(appSecret)) {
    checks.appSecret.detail =
      'Falta el App Secret. Sin él se descarta todo lo que entra: el asistente no va a contestar ni un mensaje.'
  }

  if (!cleanPhoneNumberId) {
    checks.phoneNumberId.detail = 'Falta el Phone Number ID.'
  }

  if (!cleanAccessToken) {
    checks.accessToken.detail = 'Falta el Access Token.'
  }

  if (!cleanPhoneNumberId || !cleanAccessToken) {
    return { connected: false, checks, number: null }
  }

  const timeoutMs = Math.min(
    Math.max(toNumber(process.env.WHATSAPP_API_TIMEOUT_MS, 15000), 1000),
    60000,
  )

  const ask = async path => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`,
        {
          headers: { Authorization: `Bearer ${cleanAccessToken}` },
          signal: controller.signal,
        },
      )

      return { status: response.status, data: await response.json().catch(() => null) }
    } catch (error) {
      return { status: 0, data: null, networkError: error?.message || 'sin respuesta' }
    } finally {
      clearTimeout(timeout)
    }
  }

  // 1) El número. Si el token no sirve, Meta responde acá y con su propio
  //    código de error, que es más preciso que cualquier suposición nuestra.
  const numberResponse = await ask(
    `${encodeURIComponent(cleanPhoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
  )

  const providerError = numberResponse.data?.error || null
  const providerCode = Number(providerError?.code || 0)

  if (numberResponse.networkError) {
    checks.accessToken.detail = `No se pudo hablar con Meta: ${numberResponse.networkError}`
    return { connected: false, checks, number: null }
  }

  if (numberResponse.status === 200) {
    checks.accessToken.ok = true
    checks.phoneNumberId.ok = true
    checks.accessToken.detail = 'El token funciona.'
    checks.phoneNumberId.detail = clean(numberResponse.data?.display_phone_number)
      ? `Número ${numberResponse.data.display_phone_number} (${clean(numberResponse.data.verified_name) || 'sin nombre verificado'}).`
      : 'El número responde.'
  } else if (providerCode === 190) {
    // 190 es el código de Meta para token inválido o vencido. Es EL error del
    // token temporal, que dura 24 horas y después deja de andar sin avisar.
    checks.accessToken.detail =
      'El token no sirve o venció. Si copiaste el temporal del panel de Meta, dura 24 horas: hace falta uno permanente, de usuario de sistema.'
  } else if (numberResponse.status === 404 || providerCode === 100) {
    checks.accessToken.ok = true
    checks.phoneNumberId.detail =
      'Meta no encuentra ese Phone Number ID con este token. Revisá que sea el ID del número (no el número en sí) y que pertenezca a esta cuenta.'
  } else {
    checks.accessToken.detail =
      clean(providerError?.message) || `Meta respondió ${numberResponse.status}.`
  }

  // 2) El webhook. Meta dice qué apps están suscriptas a esta cuenta de
  //    WhatsApp: si la lista viene vacía, los mensajes entrantes no llegan a
  //    ningún lado por más que el número y el token estén perfectos.
  if (!cleanBusinessAccountId) {
    checks.webhook.detail =
      'Cargá el Business Account ID para poder verificar el webhook desde acá.'
  } else if (checks.accessToken.ok) {
    const subscribed = await ask(
      `${encodeURIComponent(cleanBusinessAccountId)}/subscribed_apps`,
    )

    const apps = Array.isArray(subscribed.data?.data) ? subscribed.data.data : []

    if (subscribed.status === 200 && apps.length > 0) {
      checks.webhook.ok = true
      checks.webhook.detail = 'La app está suscripta: los mensajes entrantes llegan.'
    } else if (subscribed.status === 200) {
      checks.webhook.detail =
        'No hay ninguna app suscripta a esta cuenta de WhatsApp: los mensajes que te escriban no van a llegar. Falta configurar el webhook en Meta.'
    } else {
      checks.webhook.detail =
        clean(subscribed.data?.error?.message) ||
        `No se pudo consultar la suscripción (Meta respondió ${subscribed.status}).`
    }
  }

  const connected =
    checks.phoneNumberId.ok && checks.accessToken.ok && checks.appSecret.ok

  return {
    connected,
    checks,
    number:
      numberResponse.status === 200
        ? {
          displayPhoneNumber: clean(numberResponse.data?.display_phone_number),
          verifiedName: clean(numberResponse.data?.verified_name),
          qualityRating: clean(numberResponse.data?.quality_rating),
        }
        : null,
  }
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
