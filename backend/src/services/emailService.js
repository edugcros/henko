// 📁 src/services/emailService.js
// VERSIÓN PRODUCCIÓN - SMTP / ORDEN CLIENTE / ORDEN ADMIN / MULTI-TENANT / SIN HARDCODE

import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import { validateEmail, escapeHtml, sanitizeString } from './email/emailShared.js'

// =====================================================
// CONSTANTES
// =====================================================

const isProd = process.env.NODE_ENV === 'production'

// =====================================================
// HELPERS BÁSICOS
// =====================================================

const getEnvBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

const formatMoney = (value, currency = 'ARS') => {
  const num = Number(value || 0)

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(num) ? num : 0)
}

const normalizeObject = value => {
  if (!value) return {}

  if (typeof value.toObject === 'function') {
    return value.toObject()
  }

  if (typeof value === 'object') {
    return value
  }

  return {}
}

const mapToObject = value => {
  if (!value) return {}

  if (value instanceof Map) {
    return Object.fromEntries(value)
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  return {}
}

// =====================================================
// TENANT / CONFIG HELPERS
// =====================================================

const getStoreName = tenantConfig => {
  return (
    sanitizeString(tenantConfig?.storeName) ||
    sanitizeString(tenantConfig?.name) ||
    sanitizeString(tenantConfig?.general?.storeName) ||
    sanitizeString(process.env.STORE_NAME) ||
    sanitizeString(process.env.APP_NAME) ||
    'Tienda'
  )
}

const getPrimaryColor = tenantConfig => {
  return (
    sanitizeString(tenantConfig?.primaryColor) ||
    sanitizeString(tenantConfig?.colors?.primary) ||
    sanitizeString(process.env.EMAIL_PRIMARY_COLOR) ||
    '#111827'
  )
}

const getLogoUrl = tenantConfig => {
  return (
    sanitizeString(tenantConfig?.storeLogo) ||
    sanitizeString(tenantConfig?.logoUrl) ||
    sanitizeString(tenantConfig?.settings?.branding?.logoUrl) ||
    sanitizeString(tenantConfig?.general?.logo) ||
    sanitizeString(process.env.EMAIL_LOGO_URL) ||
    ''
  )
}

const getStoreUrl = tenantConfig => {
  return (
    sanitizeString(tenantConfig?.storeUrl) ||
    sanitizeString(tenantConfig?.url) ||
    sanitizeString(tenantConfig?.domain) ||
    sanitizeString(env.clientUrl) ||
    sanitizeString(env.shopFrontendUrl) ||
    sanitizeString(env.app?.url) ||
    ''
  )
}

const getSupportEmail = tenantConfig => {
  return (
    validateEmail(tenantConfig?.supportEmail) ||
    validateEmail(tenantConfig?.contactEmail) ||
    validateEmail(tenantConfig?.settings?.store?.contactEmail) ||
    validateEmail(tenantConfig?.footer?.email) ||
    validateEmail(process.env.SUPPORT_EMAIL) ||
    validateEmail(process.env.EMAIL_FROM) ||
    validateEmail(process.env.EMAIL_USER)
  )
}

const getAdminEmail = (recipientAdminEmail = null, tenantConfig = {}) => {
  return (
    validateEmail(recipientAdminEmail) ||
    validateEmail(tenantConfig?.adminEmail) ||
    validateEmail(tenantConfig?.email) ||
    validateEmail(tenantConfig?.settings?.store?.contactEmail) ||
    validateEmail(tenantConfig?.footer?.email) ||
    (!isProd ? validateEmail(process.env.ADMIN_EMAIL) : null)
  )
}

const getBuyerEmail = ({
  recipientEmail = null,
  order = null,
  payer = null,
  user = null,
} = {}) => {
  const safeOrder = normalizeObject(order)

  return (
    validateEmail(recipientEmail) ||
    validateEmail(safeOrder?.shippingAddress?.email) ||
    validateEmail(safeOrder?.customerSnapshot?.email) ||
    validateEmail(safeOrder?.paymentIntent?.payerEmail) ||
    validateEmail(safeOrder?.orderby?.email) ||
    validateEmail(payer?.email) ||
    validateEmail(user?.email) ||
    null
  )
}

// El aviso del remitente sandbox se emite una sola vez por proceso: si no,
// cada mail enviado repetiría la misma línea y dejaría de leerse.
let sandboxSenderWarned = false

/**
 * Desde qué dirección sale este correo. Única definición de la regla.
 *
 * Orden: dominio propio del comercio si está VERIFICADO, después el de la
 * plataforma, y como último recurso el sandbox del proveedor.
 *
 * El estado 'verified' no es un detalle administrativo: un dominio que aún no
 * publica SPF/DKIM no autoriza a nadie a enviar en su nombre, así que usarlo
 * como remitente no es "casi funcionar" — es garantizar el rebote o la
 * carpeta de spam. Por eso pending y failed salen por la plataforma.
 */
export const resolveSenderAddress = (tenantConfig = {}) => {
  const tenantSender =
    tenantConfig?.email?.status === 'verified'
      ? validateEmail(tenantConfig?.email?.fromAddress)
      : null

  if (tenantSender) return tenantSender

  // Sin dominio propio verificado, el default depende del transporte activo.
  // Antes esta rama vivía en getFromAddress como un return anticipado ANTES
  // de mirar tenantConfig: bajo SMTP, un comercio con su dominio ya
  // verificado (por tenantEmailDomainService, vía SendGrid) seguía saliendo
  // por la casilla de la plataforma, porque nunca se llegaba a chequear
  // tenantSender arriba.
  const activeTransport = getEmailTransportName()

  if (activeTransport === SMTP_TRANSPORT || activeTransport === SENDGRID_API_TRANSPORT) {
    return (
      validateEmail(process.env.EMAIL_FROM) ||
      validateEmail(process.env.EMAIL_USER) ||
      ''
    )
  }

  return validateEmail(process.env.RESEND_FROM_EMAIL) || 'onboarding@resend.dev'
}

const getFromAddress = tenantConfig => {
  const storeName = getStoreName(tenantConfig)
  const fromEmail = resolveSenderAddress(tenantConfig)

  // Sin este aviso la falla es invisible y desconcertante: la API de Resend
  // acepta el envío y devuelve un id, los logs dicen "enviado", y el mail no
  // le llega a nadie salvo al dueño de la cuenta de Resend — que es la única
  // casilla a la que el remitente sandbox puede entregar. Alguien pasa una
  // tarde entera revisando el código de registro por una variable vacía.
  if (fromEmail === 'onboarding@resend.dev' && !sandboxSenderWarned) {
    sandboxSenderWarned = true

    logger.warn(
      '[EMAIL] RESEND_FROM_EMAIL no está configurada: se usa el remitente sandbox de Resend, que SOLO entrega a la casilla dueña de la cuenta. El resto de los destinatarios no va a recibir nada, aunque el envío figure como exitoso.',
    )
  }

  return `${escapeHtml(storeName)} <${fromEmail}>`
}

const getReplyTo = tenantConfig => {
  return getSupportEmail(tenantConfig) || undefined
}

// =====================================================
// ORDER NORMALIZERS
// =====================================================

const normalizeOrderId = order => {
  const safeOrder = normalizeObject(order)

  const rawId =
    safeOrder?.orderNumber ||
    safeOrder?.idempotencyKey ||
    safeOrder?._id ||
    safeOrder?.id ||
    null

  if (!rawId) return 'SIN-ID'

  return String(rawId).slice(-8).toUpperCase()
}

const getImageFallback = () => {
  return sanitizeString(process.env.DEFAULT_PRODUCT_IMAGE_URL)
}

const extractImageUrl = imageData => {
  try {
    const fallback = getImageFallback()

    if (!imageData) return fallback

    if (typeof imageData === 'string') {
      return imageData || fallback
    }

    if (Array.isArray(imageData) && imageData.length > 0) {
      const first = imageData[0]

      if (typeof first === 'string') return first

      if (first && typeof first === 'object') {
        return (
          sanitizeString(first.secure_url) ||
          sanitizeString(first.url) ||
          sanitizeString(first.imageUrl) ||
          fallback
        )
      }
    }

    if (typeof imageData === 'object') {
      return (
        sanitizeString(imageData.secure_url) ||
        sanitizeString(imageData.url) ||
        sanitizeString(imageData.imageUrl) ||
        fallback
      )
    }

    return fallback
  } catch (error) {
    logger.error('❌ Error extrayendo imagen para email', {
      message: error.message,
    })

    return getImageFallback()
  }
}

const normalizeOrderItems = order => {
  const safeOrder = normalizeObject(order)
  const items = safeOrder?.items || safeOrder?.products || []

  if (!Array.isArray(items)) return []

  return items.map(item => {
    const safeItem = normalizeObject(item)

    const quantity = Number(
      safeItem.quantity ||
        safeItem.count ||
        safeItem.qty ||
        1,
    )

    const price = Number(
      safeItem.price ??
        safeItem.unitPrice ??
        safeItem.priceDecimal ??
        (safeItem.priceCents !== undefined
          ? safeItem.priceCents / 100
          : undefined) ??
        0,
    )

    const subtotal = Number(
      safeItem.subtotal ??
        safeItem.subtotalDecimal ??
        (safeItem.subtotalCents !== undefined
          ? safeItem.subtotalCents / 100
          : undefined) ??
        price * quantity,
    )

    const originalPrice = Number(
      safeItem.originalPrice ??
        safeItem.regularPrice ??
        safeItem.compareAtPrice ??
        (safeItem.originalPriceCents !== undefined
          ? safeItem.originalPriceCents / 100
          : undefined) ??
        price,
    )

    const title =
      sanitizeString(safeItem.title) ||
      sanitizeString(safeItem.titleSnapshot) ||
      sanitizeString(safeItem.name) ||
      sanitizeString(safeItem.product?.title) ||
      'Producto'

    return {
      title,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      price: Number.isFinite(price) ? price : 0,
      originalPrice: Number.isFinite(originalPrice) ? originalPrice : price,
      subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      image:
        safeItem.image ||
        safeItem.imageSnapshot ||
        safeItem.images ||
        safeItem.product?.images ||
        null,
      variantSku:
        sanitizeString(safeItem.variantSku) ||
        sanitizeString(safeItem.variantSKU) ||
        sanitizeString(safeItem.skuSnapshot) ||
        sanitizeString(safeItem.sku) ||
        null,
      selectedAttributes: mapToObject(safeItem.selectedAttributes),
    }
  })
}

const normalizeOrderTotals = order => {
  const safeOrder = normalizeObject(order)

  const currency =
    sanitizeString(safeOrder?.currency) ||
    sanitizeString(safeOrder?.paymentIntent?.currency) ||
    sanitizeString(safeOrder?.totals?.currency) ||
    'ARS'

  const subtotal = Number(
    safeOrder?.subtotal ??
      safeOrder?.totals?.subtotal ??
      safeOrder?.paymentIntent?.originalAmount ??
      (safeOrder?.paymentIntent?.originalAmountCents !== undefined
        ? safeOrder.paymentIntent.originalAmountCents / 100
        : undefined) ??
      0,
  )

  const discount = Number(
    safeOrder?.discount ??
      safeOrder?.totals?.discount ??
      safeOrder?.paymentIntent?.discountAmount ??
      (safeOrder?.paymentIntent?.discountAmountCents !== undefined
        ? safeOrder.paymentIntent.discountAmountCents / 100
        : undefined) ??
      0,
  )

  const total = Number(
    safeOrder?.total ??
      safeOrder?.totals?.total ??
      safeOrder?.paymentIntent?.amount ??
      (safeOrder?.paymentIntent?.amountCents !== undefined
        ? safeOrder.paymentIntent.amountCents / 100
        : undefined) ??
      Math.max(0, subtotal - discount),
  )

  return {
    currency: currency.toUpperCase(),
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    discount: Number.isFinite(discount) ? discount : 0,
    total: Number.isFinite(total) ? total : 0,
  }
}

const normalizeShippingAddress = order => {
  const safeOrder = normalizeObject(order)
  const shipping = safeOrder?.shippingAddress || {}

  return {
    firstName:
      sanitizeString(shipping.firstName) ||
      sanitizeString(shipping.firstname) ||
      sanitizeString(safeOrder?.customerSnapshot?.firstname) ||
      sanitizeString(safeOrder?.customerSnapshot?.firstName) ||
      'Cliente',

    lastName:
      sanitizeString(shipping.lastName) ||
      sanitizeString(shipping.lastname) ||
      sanitizeString(safeOrder?.customerSnapshot?.lastname) ||
      sanitizeString(safeOrder?.customerSnapshot?.lastName) ||
      '',

    email:
      validateEmail(shipping.email) ||
      validateEmail(safeOrder?.customerSnapshot?.email) ||
      validateEmail(safeOrder?.paymentIntent?.payerEmail) ||
      null,

    phone:
      sanitizeString(shipping.phone) ||
      sanitizeString(safeOrder?.customerSnapshot?.mobile) ||
      sanitizeString(safeOrder?.customerSnapshot?.phone) ||
      '',

    address: sanitizeString(shipping.address),
    city: sanitizeString(shipping.city),
    zipCode: sanitizeString(shipping.zipCode),
    province: sanitizeString(shipping.province),
    country: sanitizeString(shipping.country, 'AR'),
  }
}

const buildPlainTextSummary = ({
  orderNumber,
  items,
  totals,
  shippingAddress,
  storeName,
}) => {
  const lines = items.map(item => {
    return `- ${item.title} x${item.quantity}: ${formatMoney(
      item.subtotal,
      totals.currency,
    )}`
  })

  return [
    `${storeName}`,
    `Orden #${orderNumber}`,
    '',
    'Productos:',
    ...lines,
    '',
    `Subtotal: ${formatMoney(totals.subtotal, totals.currency)}`,
    totals.discount > 0
      ? `Descuento: -${formatMoney(totals.discount, totals.currency)}`
      : null,
    `Total: ${formatMoney(totals.total, totals.currency)}`,
    '',
    `Cliente: ${shippingAddress.firstName} ${shippingAddress.lastName}`.trim(),
    shippingAddress.email ? `Email: ${shippingAddress.email}` : null,
    shippingAddress.phone ? `Teléfono: ${shippingAddress.phone}` : null,
    shippingAddress.address ? `Dirección: ${shippingAddress.address}` : null,
    shippingAddress.city ? `Ciudad: ${shippingAddress.city}` : null,
    shippingAddress.province ? `Provincia: ${shippingAddress.province}` : null,
    shippingAddress.zipCode ? `CP: ${shippingAddress.zipCode}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

// =====================================================
// TRANSPORTES
// =====================================================
//
// Hay tres:
//
//   resend        HTTPS (443) contra la API de Resend.
//   smtp          nodemailer contra un relay real por socket — hoy, SendGrid.
//   sendgrid_api  HTTPS (443) contra la Web API de SendGrid (mismo remitente
//                 y misma API key que smtp, pero sin abrir un socket SMTP).
//
// henko-api corre en el plan FREE de Render (verificado contra la propia
// API de Render, no asumido), y ese plan bloquea los puertos SMTP salientes
// (25, 465, 587) desde septiembre 2025 — un intento real contra
// smtp.sendgrid.net:587 se quedó colgado sin error ni éxito, consistente con
// un bloqueo silencioso de puerto, no con credenciales inválidas. `smtp`
// sigue existiendo para quien corra este backend en un plan pago o fuera de
// Render, pero en este proyecto el default en producción es `sendgrid_api`.
// Fuente: https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports
//
// De ahí el selector:
//
//   EMAIL_TRANSPORT=smtp          nodemailer por socket
//   EMAIL_TRANSPORT=sendgrid_api  Web API de SendGrid (HTTPS)
//   EMAIL_TRANSPORT=resend        Resend
//   sin definir                   Resend

const SMTP_TRANSPORT = 'smtp'
const RESEND_TRANSPORT = 'resend'
const SENDGRID_API_TRANSPORT = 'sendgrid_api'
const SENDGRID_MAIL_SEND_URL = 'https://api.sendgrid.com/v3/mail/send'
const EMAIL_SEND_TIMEOUT_MS = 15000

const hasSmtpCredentials = () => {
  return Boolean(
    sanitizeString(process.env.EMAIL_HOST) &&
      sanitizeString(process.env.EMAIL_USER) &&
      sanitizeString(process.env.EMAIL_PASS),
  )
}

export const getEmailTransportName = () => {
  const forced = sanitizeString(process.env.EMAIL_TRANSPORT).toLowerCase()

  if (forced === SMTP_TRANSPORT) return SMTP_TRANSPORT
  if (forced === SENDGRID_API_TRANSPORT) return SENDGRID_API_TRANSPORT
  return RESEND_TRANSPORT
}

const getSendGridApiKeyForSend = () =>
  sanitizeString(process.env.SENDGRID_API_KEY) || sanitizeString(process.env.EMAIL_PASS)

// El from ya llega armado como 'Nombre <email>' (o solo 'email') porque lo
// arma getFromAddress para los otros dos transportes, que aceptan ese string
// tal cual. La Web API de SendGrid en cambio pide from como {email, name}.
const parseFromHeader = raw => {
  const str = sanitizeString(raw)
  const match = /^(.*)<([^>]+)>\s*$/.exec(str)

  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '')
    return { email: match[2].trim(), name: name || undefined }
  }

  return { email: str }
}

let resendClientInstance = null
let smtpTransporterInstance = null
let transportAnnounced = false

const announceTransportOnce = transport => {
  if (transportAnnounced) return
  transportAnnounced = true

  logger.info(`[EMAIL] Transporte activo: ${transport}`)
}

const getSmtpTransporter = () => {
  if (smtpTransporterInstance) return smtpTransporterInstance

  if (!hasSmtpCredentials()) {
    const error = new Error(
      'SMTP incompleto: faltan EMAIL_HOST, EMAIL_USER o EMAIL_PASS',
    )
    error.code = 'SMTP_NOT_CONFIGURED'
    throw error
  }

  const port = Number(process.env.EMAIL_PORT || 465)

  smtpTransporterInstance = nodemailer.createTransport({
    host: sanitizeString(process.env.EMAIL_HOST),
    port,
    // 465 es SMTPS (TLS desde el saludo). 587 arranca en claro y sube a TLS
    // con STARTTLS, que nodemailer maneja solo con secure:false.
    secure: port === 465,
    auth: {
      user: sanitizeString(process.env.EMAIL_USER),
      pass: process.env.EMAIL_PASS,
    },
    // Sin esto una conexión bloqueada (puerto filtrado, servidor caído) se
    // cuelga indefinidamente en vez de fallar y dejar que sendWithRetry
    // reintente — es justo lo que pasó al probar SMTP contra el plan Free
    // de Render antes de migrar a sendgrid_api (ver docs/EMAIL_PRODUCTION.md).
    connectionTimeout: EMAIL_SEND_TIMEOUT_MS,
    greetingTimeout: EMAIL_SEND_TIMEOUT_MS,
    socketTimeout: EMAIL_SEND_TIMEOUT_MS,
  })

  return smtpTransporterInstance
}

const getResendClient = () => {
  const apiKey = sanitizeString(process.env.RESEND_API_KEY)

  if (!apiKey) {
    const error = new Error('RESEND_API_KEY no está configurada')
    error.code = 'RESEND_NOT_CONFIGURED'
    throw error
  }

  if (!resendClientInstance) {
    resendClientInstance = new Resend(apiKey)
  }

  return resendClientInstance
}

// Se mantiene exportada por compatibilidad: código existente puede llamarla
// tras un error para forzar reconstrucción del cliente en el próximo envío.
export const resetEmailTransporter = () => {
  resendClientInstance = null
  smtpTransporterInstance = null
}

// =====================================================
// SEND CORE
// =====================================================

const sendWithRetry = async (mailOptions, maxRetries = 3) => {
  let lastError = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      logger.info('📤 Enviando email', {
        attempt,
        maxRetries,
        to: mailOptions.to,
        subject: mailOptions.subject,
      })

      const transport = getEmailTransportName()
      announceTransportOnce(transport)

      if (transport === SMTP_TRANSPORT) {
        const info = await getSmtpTransporter().sendMail({
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject,
          html: mailOptions.html || undefined,
          text: mailOptions.text || undefined,
          replyTo: mailOptions.replyTo || undefined,
          attachments: mailOptions.attachments?.length
            ? mailOptions.attachments
            : undefined,
        })

        logger.info('✅ Email enviado correctamente', {
          messageId: info?.messageId,
          transport: SMTP_TRANSPORT,
        })

        return {
          success: true,
          messageId: info?.messageId || null,
          // A diferencia de Resend, SMTP informa qué destinatarios aceptó y
          // cuáles rechazó el servidor. Se pasan tal cual.
          accepted: info?.accepted?.length ? info.accepted : [mailOptions.to],
          rejected: info?.rejected || [],
          response: info?.response || 'smtp-accepted',
          attempt,
        }
      }

      if (transport === SENDGRID_API_TRANSPORT) {
        const apiKey = getSendGridApiKeyForSend()

        if (!apiKey) {
          const error = new Error(
            'SendGrid API: falta EMAIL_PASS o SENDGRID_API_KEY',
          )
          error.code = 'SENDGRID_API_NOT_CONFIGURED'
          throw error
        }

        const { email: fromEmail, name: fromName } = parseFromHeader(mailOptions.from)
        const content = [
          mailOptions.text ? { type: 'text/plain', value: mailOptions.text } : null,
          mailOptions.html ? { type: 'text/html', value: mailOptions.html } : null,
        ].filter(Boolean)

        // Sin timeout, una respuesta que nunca llega deja la promesa colgada
        // indefinidamente en vez de fallar y dejar reintentar (mismo
        // problema que motivó el timeout del transporter SMTP arriba).
        const abortController = new AbortController()
        const timeoutId = setTimeout(
          () => abortController.abort(),
          EMAIL_SEND_TIMEOUT_MS,
        )

        let response
        try {
          response = await fetch(SENDGRID_MAIL_SEND_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: mailOptions.to }] }],
              from: { email: fromEmail, ...(fromName ? { name: fromName } : {}) },
              ...(mailOptions.replyTo ? { reply_to: { email: mailOptions.replyTo } } : {}),
              subject: mailOptions.subject,
              content,
            }),
            signal: abortController.signal,
          })
        } catch (fetchError) {
          if (fetchError.name === 'AbortError') {
            const timeoutError = new Error(
              `SendGrid API no respondió en ${EMAIL_SEND_TIMEOUT_MS}ms`,
            )
            timeoutError.code = 'SENDGRID_TIMEOUT'
            throw timeoutError
          }
          throw fetchError
        } finally {
          clearTimeout(timeoutId)
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          const error = new Error(
            `SendGrid API rechazó el envío (${response.status}): ${body.slice(0, 500)}`,
          )
          error.code = response.status === 401 || response.status === 403
            ? 'SENDGRID_AUTH_FAILED'
            : 'SENDGRID_REQUEST_INVALID'
          throw error
        }

        const messageId = response.headers.get('x-message-id')

        logger.info('✅ Email enviado correctamente', {
          messageId,
          transport: SENDGRID_API_TRANSPORT,
        })

        return {
          success: true,
          messageId: messageId || null,
          accepted: [mailOptions.to],
          rejected: [],
          response: 'sendgrid-api-accepted',
          attempt,
        }
      }

      const client = getResendClient()
      const { data, error } = await client.emails.send({
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        html: mailOptions.html || undefined,
        text: mailOptions.text || undefined,
        replyTo: mailOptions.replyTo || undefined,
        attachments: mailOptions.attachments?.length
          ? mailOptions.attachments
          : undefined,
      })

      if (error) {
        const resendError = new Error(error.message || 'Error de Resend')
        resendError.code = error.name
        throw resendError
      }

      logger.info('✅ Email enviado correctamente', {
        messageId: data?.id,
        transport: RESEND_TRANSPORT,
      })

      return {
        success: true,
        messageId: data?.id || null,
        accepted: [mailOptions.to],
        rejected: [],
        response: 'resend-accepted',
        attempt,
      }
    } catch (error) {
      lastError = error

      logger.error('❌ Intento de email fallido', {
        attempt,
        maxRetries,
        to: mailOptions.to,
        subject: mailOptions.subject,
        message: error.message,
        code: error.code,
      })

      // API key ausente/inválida: config rota, reintentar no cambia nada.
      const authFailed =
        error.code === 'RESEND_NOT_CONFIGURED' ||
        String(error.message || '').toLowerCase().includes('api key')

      if (authFailed) {
        logger.error('🔒 Error de configuración de Resend', {
          suggestion: 'Verificá RESEND_API_KEY en las variables de entorno.',
        })

        return {
          success: false,
          error: 'RESEND_AUTHENTICATION_FAILED',
          details: error.message,
          code: error.code,
          suggestion: 'Verificá que RESEND_API_KEY esté configurada y sea válida.',
        }
      }

      // validation_error de Resend: pedido inválido (destinatario fuera del
      // sandbox, dominio del remitente no verificado, email mal formado,
      // etc.). No es un problema de credenciales — reintentar tampoco
      // ayuda, así que se corta acá, pero con el mensaje real de Resend en
      // vez de sugerir revisar la API key.
      const requestInvalid = error.code === 'validation_error'

      if (requestInvalid) {
        logger.error('⚠️ Resend rechazó el envío (solicitud inválida)', {
          details: error.message,
        })

        return {
          success: false,
          error: 'RESEND_REQUEST_INVALID',
          details: error.message,
          code: error.code,
        }
      }

      // Igual que con Resend: config rota o pedido inválido no se arregla
      // reintentando.
      if (error.code === 'SENDGRID_API_NOT_CONFIGURED' || error.code === 'SENDGRID_AUTH_FAILED') {
        logger.error('🔒 Error de configuración de SendGrid API', {
          suggestion: 'Verificá EMAIL_PASS (o SENDGRID_API_KEY) en las variables de entorno.',
        })

        return {
          success: false,
          error: 'SENDGRID_AUTHENTICATION_FAILED',
          details: error.message,
          code: error.code,
        }
      }

      if (error.code === 'SENDGRID_REQUEST_INVALID') {
        logger.error('⚠️ SendGrid API rechazó el envío (solicitud inválida)', {
          details: error.message,
        })

        return {
          success: false,
          error: 'SENDGRID_REQUEST_INVALID',
          details: error.message,
          code: error.code,
        }
      }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 10000)

        logger.info('⏳ Reintentando envío de email', {
          delay,
          nextAttempt: attempt + 1,
        })

        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || 'UNKNOWN_EMAIL_ERROR',
    code: lastError?.code || null,
    attempts: maxRetries,
  }
}

export const sendEmail = async ({
  to,
  subject,
  html,
  text = '',
  tenantConfig = {},
  from = null,
  replyTo = null,
  attachments = [],
  maxRetries = 3,
}) => {
  const validTo = validateEmail(to)

  if (!validTo) {
    return {
      success: false,
      error: 'INVALID_RECIPIENT_EMAIL',
      details: `Email inválido: ${to}`,
    }
  }

  const mailOptions = {
    from: from || getFromAddress(tenantConfig),
    to: validTo,
    subject,
    html,
    text,
    replyTo: replyTo || getReplyTo(tenantConfig),
    attachments: Array.isArray(attachments) ? attachments : [],
  }

  Object.keys(mailOptions).forEach(key => {
    if (mailOptions[key] === undefined || mailOptions[key] === null || mailOptions[key] === '') {
      delete mailOptions[key]
    }
  })

  return sendWithRetry(mailOptions, maxRetries)
}

// =====================================================
// HTML BUILDERS
// =====================================================

const buildHeaderHtml = ({ storeName, logoUrl, primaryColor, subtitle }) => {
  return `
    <tr>
      <td style="background: ${primaryColor}; padding: 34px 30px; text-align: center;">
        ${
  logoUrl
    ? `
              <img src="${escapeHtml(logoUrl)}"
                   alt="${escapeHtml(storeName)}"
                   style="max-width: 160px; max-height: 70px; margin-bottom: 18px;"
              />
            `
    : ''
}

        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
          ${escapeHtml(storeName)}
        </h1>

        ${
  subtitle
    ? `
              <p style="color: rgba(255,255,255,0.92); margin: 10px 0 0 0; font-size: 16px;">
                ${escapeHtml(subtitle)}
              </p>
            `
    : ''
}
      </td>
    </tr>
  `
}

const buildItemsHtml = ({ items, totals }) => {
  if (!items.length) {
    return `
      <tr>
        <td style="padding: 15px; color: #666;">
          No hay productos disponibles para mostrar.
        </td>
      </tr>
    `
  }

  return items
    .map(item => {
      const imageUrl = extractImageUrl(item.image)
      const safeTitle = escapeHtml(item.title)

      const attributesObject = mapToObject(item.selectedAttributes)

      const attributes = Object.entries(attributesObject)
        .map(([key, value]) => {
          return `${escapeHtml(key)}: ${escapeHtml(value)}`
        })
        .join(' · ')

      const imageHtml = imageUrl
        ? `
          <img src="${escapeHtml(imageUrl)}"
               alt="${safeTitle}"
               style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #e0e0e0;"
          />
        `
        : `
          <div style="width: 80px; height: 80px; border-radius: 8px; border: 1px solid #e0e0e0; background: #f3f4f6; display: table-cell; vertical-align: middle; text-align: center; color: #999; font-size: 12px;">
            Sin imagen
          </div>
        `

      const hasDiscount =
        Number(item.originalPrice || 0) > Number(item.price || 0)

      return `
        <tr>
          <td style="padding: 15px; border-bottom: 1px solid #e0e0e0; width: 80px;">
            ${imageHtml}
          </td>

          <td style="padding: 15px; border-bottom: 1px solid #e0e0e0;">
            <div style="font-weight: 600; color: #333; font-size: 16px;">
              ${safeTitle}
            </div>

            ${
  item.variantSku
    ? `<div style="color: #777; font-size: 13px; margin-top: 4px;">SKU: ${escapeHtml(item.variantSku)}</div>`
    : ''
}

            ${
  attributes
    ? `<div style="color: #777; font-size: 13px; margin-top: 4px;">${attributes}</div>`
    : ''
}

            <div style="color: #666; font-size: 14px; margin-top: 4px;">
              Cantidad: ${item.quantity} × ${
  hasDiscount
    ? `
                    <span style="text-decoration: line-through; color: #999;">
                      ${formatMoney(item.originalPrice, totals.currency)}
                    </span>
                    <strong>${formatMoney(item.price, totals.currency)}</strong>
                  `
    : formatMoney(item.price, totals.currency)
}
            </div>
          </td>

          <td style="padding: 15px; border-bottom: 1px solid #e0e0e0; text-align: right; font-weight: 600; color: #333;">
            ${formatMoney(item.subtotal, totals.currency)}
          </td>
        </tr>
      `
    })
    .join('')
}

const buildTotalsHtml = ({ totals, primaryColor }) => {
  const hasDiscount = totals.discount > 0

  return `
    <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
      <table width="100%" style="font-size: 16px; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Subtotal</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 500;">
            ${formatMoney(totals.subtotal, totals.currency)}
          </td>
        </tr>

        ${
  hasDiscount
    ? `
              <tr>
                <td style="padding: 8px 0; color: #16a34a;">Descuento</td>
                <td style="padding: 8px 0; text-align: right; color: #16a34a; font-weight: 600;">
                  -${formatMoney(totals.discount, totals.currency)}
                </td>
              </tr>
            `
    : ''
}

        <tr>
          <td colspan="2" style="border-top: 2px solid ${primaryColor}; height: 10px;"></td>
        </tr>

        <tr>
          <td style="padding: 15px 0; font-weight: 700; font-size: 18px; color: #333;">Total</td>
          <td style="padding: 15px 0; text-align: right; font-weight: 700; font-size: 20px; color: ${primaryColor};">
            ${formatMoney(totals.total, totals.currency)}
          </td>
        </tr>
      </table>
    </div>
  `
}

const buildShippingHtml = shippingAddress => {
  return `
    <div style="background-color: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
      <h3 style="margin: 0 0 12px 0; color: #333; font-size: 16px;">
        Datos de entrega
      </h3>

      <p style="margin: 4px 0; color: #555;">
        <strong>Cliente:</strong> ${escapeHtml(
    `${shippingAddress.firstName} ${shippingAddress.lastName}`.trim(),
  )}
      </p>

      ${
  shippingAddress.email
    ? `<p style="margin: 4px 0; color: #555;"><strong>Email:</strong> ${escapeHtml(shippingAddress.email)}</p>`
    : ''
}

      ${
  shippingAddress.phone
    ? `<p style="margin: 4px 0; color: #555;"><strong>Teléfono:</strong> ${escapeHtml(shippingAddress.phone)}</p>`
    : ''
}

      ${
  shippingAddress.address
    ? `<p style="margin: 4px 0; color: #555;"><strong>Dirección:</strong> ${escapeHtml(shippingAddress.address)}</p>`
    : ''
}

      ${
  shippingAddress.city
    ? `<p style="margin: 4px 0; color: #555;"><strong>Ciudad:</strong> ${escapeHtml(shippingAddress.city)}</p>`
    : ''
}

      ${
  shippingAddress.zipCode
    ? `<p style="margin: 4px 0; color: #555;"><strong>CP:</strong> ${escapeHtml(shippingAddress.zipCode)}</p>`
    : ''
}

      ${
  shippingAddress.province
    ? `<p style="margin: 4px 0; color: #555;"><strong>Provincia:</strong> ${escapeHtml(shippingAddress.province)}</p>`
    : ''
}

      ${
  shippingAddress.country
    ? `<p style="margin: 4px 0; color: #555;"><strong>País:</strong> ${escapeHtml(shippingAddress.country)}</p>`
    : ''
}
    </div>
  `
}

const buildFooterHtml = ({ storeName, supportEmail, storeUrl }) => {
  return `
    <p style="color: #999; font-size: 14px; text-align: center; margin-top: 40px; line-height: 1.6;">
      ${
  supportEmail
    ? `Si tenés preguntas, escribinos a <a href="mailto:${escapeHtml(supportEmail)}" style="color: #666;">${escapeHtml(supportEmail)}</a>.<br />`
    : ''
}

      ${
  storeUrl
    ? `<a href="${escapeHtml(storeUrl)}" style="color: #666; text-decoration: none;">${escapeHtml(storeUrl)}</a><br />`
    : ''
}

      <strong>${escapeHtml(storeName)}</strong> © ${new Date().getFullYear()}
    </p>
  `
}

// =====================================================
// EMAIL AL COMPRADOR
// =====================================================

export const sendOrderConfirmationEmail = async (
  order,
  recipientEmail = null,
  tenantConfig = {},
  context = {},
) => {
  const safeOrder = normalizeObject(order)

  const to = getBuyerEmail({
    recipientEmail,
    order: safeOrder,
    payer: context?.payer,
    user: context?.user,
  })

  logger.info('🚀 Preparando email de confirmación al cliente', {
    orderId: safeOrder?._id?.toString?.() || safeOrder?.id || null,
    recipientEmail,
    resolvedEmail: to,
    hasPayerEmail: Boolean(context?.payer?.email),
    hasUserEmail: Boolean(context?.user?.email),
  })

  if (!to) {
    logger.error('❌ Email cliente inválido o ausente', {
      recipientEmail,
      shippingEmail: safeOrder?.shippingAddress?.email,
      customerEmail: safeOrder?.customerSnapshot?.email,
      payerEmail: safeOrder?.paymentIntent?.payerEmail,
      contextPayerEmail: context?.payer?.email,
      contextUserEmail: context?.user?.email,
    })

    return {
      success: false,
      error: 'INVALID_CLIENT_EMAIL',
    }
  }

  const storeName = getStoreName(tenantConfig)
  const primaryColor = getPrimaryColor(tenantConfig)
  const logoUrl = getLogoUrl(tenantConfig)
  const storeUrl = getStoreUrl(tenantConfig)
  const supportEmail = getSupportEmail(tenantConfig)

  const orderNumber = normalizeOrderId(safeOrder)
  const items = normalizeOrderItems(safeOrder)
  const totals = normalizeOrderTotals(safeOrder)
  const shippingAddress = normalizeShippingAddress(safeOrder)

  const itemsHtml = buildItemsHtml({ items, totals })
  const totalsHtml = buildTotalsHtml({ totals, primaryColor })
  const shippingHtml = buildShippingHtml(shippingAddress)
  const footerHtml = buildFooterHtml({ storeName, supportEmail, storeUrl })

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Confirmación de compra - ${escapeHtml(storeName)}</title>
      </head>

      <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                ${buildHeaderHtml({
    storeName,
    logoUrl,
    primaryColor,
    subtitle: `Orden #${orderNumber}`,
  })}

                <tr>
                  <td style="padding: 40px 30px;">
                    <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                      Hola <strong>${escapeHtml(shippingAddress.firstName || 'Cliente')}</strong>,<br />
                      Tu compra fue confirmada correctamente. Ya estamos procesando tu orden.
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px; border-collapse: collapse;">
                      ${itemsHtml}
                    </table>

                    ${totalsHtml}
                    ${shippingHtml}
                    ${footerHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `

  const text = buildPlainTextSummary({
    orderNumber,
    items,
    totals,
    shippingAddress,
    storeName,
  })

  return sendEmail({
    to,
    subject: `Confirmación de compra #${orderNumber} | ${storeName}`,
    html,
    text,
    tenantConfig,
    maxRetries: 3,
  })
}

// =====================================================
// EMAIL AL ADMIN
// =====================================================

export const sendAdminNotificationEmail = async (
  order,
  recipientAdminEmail = null,
  tenantConfig = {},
) => {
  const safeOrder = normalizeObject(order)

  const to = getAdminEmail(recipientAdminEmail, tenantConfig)

  logger.info('🚀 Preparando email de nueva venta al admin', {
    orderId: safeOrder?._id?.toString?.() || safeOrder?.id || null,
    recipientAdminEmail,
    tenantAdminEmail: tenantConfig?.adminEmail,
    developmentFallbackConfigured:
      !isProd && Boolean(validateEmail(process.env.ADMIN_EMAIL)),
    resolvedEmail: to,
  })

  if (!to) {
    logger.warn('⚠️ No hay email de admin configurado', {
      recipientAdminEmail,
      tenantAdminEmail: tenantConfig?.adminEmail,
      developmentFallbackConfigured:
        !isProd && Boolean(validateEmail(process.env.ADMIN_EMAIL)),
    })

    return {
      success: false,
      error: 'ADMIN_EMAIL_NOT_CONFIGURED',
    }
  }

  const storeName = getStoreName(tenantConfig)
  const primaryColor = getPrimaryColor(tenantConfig)
  const logoUrl = getLogoUrl(tenantConfig)
  const storeUrl = getStoreUrl(tenantConfig)
  const supportEmail = getSupportEmail(tenantConfig)

  const orderNumber = normalizeOrderId(safeOrder)
  const items = normalizeOrderItems(safeOrder)
  const totals = normalizeOrderTotals(safeOrder)
  const shippingAddress = normalizeShippingAddress(safeOrder)

  const itemsSummary = items.length
    ? items
      .map(item => {
        return `${escapeHtml(item.title)} x${item.quantity} = ${formatMoney(
          item.subtotal,
          totals.currency,
        )}`
      })
      .join('<br />')
    : 'Sin productos disponibles para mostrar'

  const shippingHtml = buildShippingHtml(shippingAddress)
  const footerHtml = buildFooterHtml({ storeName, supportEmail, storeUrl })

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Nueva venta - ${escapeHtml(storeName)}</title>
      </head>

      <body style="background-color: #f4f4f4; margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center">
              <table width="650" cellpadding="0" cellspacing="0" style="background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.08);">
                ${buildHeaderHtml({
    storeName,
    logoUrl,
    primaryColor,
    subtitle: `Nueva venta #${orderNumber}`,
  })}

                <tr>
                  <td style="padding: 30px;">
                    <h2 style="color: ${primaryColor}; border-bottom: 2px solid ${primaryColor}; padding-bottom: 10px; margin-top: 0;">
                      Nueva orden de venta
                    </h2>

                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                      <table width="100%" style="font-size: 15px; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 8px 0;"><strong>Orden:</strong></td>
                          <td style="padding: 8px 0; text-align: right;">#${escapeHtml(orderNumber)}</td>
                        </tr>

                        <tr>
                          <td style="padding: 8px 0;"><strong>Total:</strong></td>
                          <td style="padding: 8px 0; text-align: right; font-size: 20px; color: ${primaryColor}; font-weight: bold;">
                            ${formatMoney(totals.total, totals.currency)}
                          </td>
                        </tr>

                        ${
  totals.discount > 0
    ? `
                              <tr>
                                <td style="padding: 8px 0;"><strong>Descuento:</strong></td>
                                <td style="padding: 8px 0; text-align: right; color: #16a34a; font-weight: bold;">
                                  -${formatMoney(totals.discount, totals.currency)}
                                </td>
                              </tr>
                            `
    : ''
}

                        <tr>
                          <td style="padding: 8px 0;"><strong>Cliente:</strong></td>
                          <td style="padding: 8px 0; text-align: right;">
                            ${escapeHtml(`${shippingAddress.firstName} ${shippingAddress.lastName}`.trim())}
                          </td>
                        </tr>

                        ${
  shippingAddress.email
    ? `
                              <tr>
                                <td style="padding: 8px 0;"><strong>Email cliente:</strong></td>
                                <td style="padding: 8px 0; text-align: right;">
                                  <a href="mailto:${escapeHtml(shippingAddress.email)}" style="color: ${primaryColor};">
                                    ${escapeHtml(shippingAddress.email)}
                                  </a>
                                </td>
                              </tr>
                            `
    : ''
}

                        ${
  shippingAddress.phone
    ? `
                              <tr>
                                <td style="padding: 8px 0;"><strong>Teléfono:</strong></td>
                                <td style="padding: 8px 0; text-align: right;">
                                  ${escapeHtml(shippingAddress.phone)}
                                </td>
                              </tr>
                            `
    : ''
}
                      </table>
                    </div>

                    <div style="margin: 20px 0;">
                      <h3 style="color: #333; margin-bottom: 15px;">Items vendidos:</h3>
                      <p style="color: #666; line-height: 1.6; background: #fff; padding: 15px; border-radius: 4px; border: 1px solid #e0e0e0;">
                        ${itemsSummary}
                      </p>
                    </div>

                    ${shippingHtml}
                    ${footerHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `

  const text = buildPlainTextSummary({
    orderNumber,
    items,
    totals,
    shippingAddress,
    storeName,
  })

  return sendEmail({
    to,
    subject: `Nueva venta #${orderNumber} - ${formatMoney(
      totals.total,
      totals.currency,
    )} | ${storeName}`,
    html,
    text,
    tenantConfig,
    maxRetries: 2,
  })
}

// =====================================================
// EMAILS DE CICLO DE VIDA DE ORDEN
// =====================================================

const buildOrderStatusEmailHtml = ({
  storeName,
  logoUrl,
  primaryColor,
  storeUrl,
  supportEmail,
  orderNumber,
  firstName,
  headline,
  bodyHtml,
}) => {
  const footerHtml = buildFooterHtml({ storeName, supportEmail, storeUrl })

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(headline)} - ${escapeHtml(storeName)}</title>
      </head>

      <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                ${buildHeaderHtml({
    storeName,
    logoUrl,
    primaryColor,
    subtitle: `Orden #${orderNumber}`,
  })}

                <tr>
                  <td style="padding: 40px 30px;">
                    <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                      Hola <strong>${escapeHtml(firstName)}</strong>,
                    </p>

                    ${bodyHtml}

                    ${footerHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

const resolveOrderStatusEmailRecipient = ({
  order,
  recipientEmail,
  context,
}) => {
  return getBuyerEmail({
    recipientEmail,
    order: normalizeObject(order),
    payer: context?.payer,
    user: context?.user,
  })
}

export const sendOrderShippedEmail = async (
  order,
  recipientEmail = null,
  tenantConfig = {},
  context = {},
) => {
  const safeOrder = normalizeObject(order)

  const to = resolveOrderStatusEmailRecipient({
    order: safeOrder,
    recipientEmail,
    context,
  })

  if (!to) {
    return { success: false, error: 'INVALID_CLIENT_EMAIL' }
  }

  const storeName = getStoreName(tenantConfig)
  const primaryColor = getPrimaryColor(tenantConfig)
  const logoUrl = getLogoUrl(tenantConfig)
  const storeUrl = getStoreUrl(tenantConfig)
  const supportEmail = getSupportEmail(tenantConfig)
  const orderNumber = normalizeOrderId(safeOrder)
  const shippingAddress = normalizeShippingAddress(safeOrder)

  const trackingNumber = sanitizeString(
    safeOrder?.shipment?.trackingNumber ||
    safeOrder?.trackingNumber,
  )
  const carrier = sanitizeString(
    safeOrder?.shipment?.carrier ||
    safeOrder?.carrier,
  )

  const trackingHtml = trackingNumber
    ? `
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 12px 0; color: #166534; font-size: 16px;">
          Datos de envío
        </h3>
        ${carrier ? `<p style="margin: 4px 0; color: #555;"><strong>Transporte:</strong> ${escapeHtml(carrier)}</p>` : ''}
        <p style="margin: 4px 0; color: #555;"><strong>Código de seguimiento:</strong> ${escapeHtml(trackingNumber)}</p>
      </div>
    `
    : ''

  const bodyHtml = `
    <p style="color: #333; font-size: 16px; line-height: 1.6;">
      Tu orden <strong>#${escapeHtml(orderNumber)}</strong> fue despachada y está en camino.
    </p>
    ${trackingHtml}
    <p style="color: #666; font-size: 14px; line-height: 1.6; margin-top: 20px;">
      Te avisaremos cuando tu pedido haya sido entregado.
    </p>
  `

  const html = buildOrderStatusEmailHtml({
    storeName,
    logoUrl,
    primaryColor,
    storeUrl,
    supportEmail,
    orderNumber,
    firstName: shippingAddress.firstName,
    headline: 'Tu pedido está en camino',
    bodyHtml,
  })

  const textLines = [
    storeName,
    `Orden #${orderNumber}`,
    '',
    `Hola ${shippingAddress.firstName},`,
    'Tu orden fue despachada y está en camino.',
  ]

  if (carrier) textLines.push(`Transporte: ${carrier}`)
  if (trackingNumber) textLines.push(`Código de seguimiento: ${trackingNumber}`)

  return sendEmail({
    to,
    subject: `Tu pedido #${orderNumber} está en camino | ${storeName}`,
    html,
    text: textLines.join('\n'),
    tenantConfig,
    maxRetries: 2,
  })
}

export const sendOrderDeliveredEmail = async (
  order,
  recipientEmail = null,
  tenantConfig = {},
  context = {},
) => {
  const safeOrder = normalizeObject(order)

  const to = resolveOrderStatusEmailRecipient({
    order: safeOrder,
    recipientEmail,
    context,
  })

  if (!to) {
    return { success: false, error: 'INVALID_CLIENT_EMAIL' }
  }

  const storeName = getStoreName(tenantConfig)
  const primaryColor = getPrimaryColor(tenantConfig)
  const logoUrl = getLogoUrl(tenantConfig)
  const storeUrl = getStoreUrl(tenantConfig)
  const supportEmail = getSupportEmail(tenantConfig)
  const orderNumber = normalizeOrderId(safeOrder)
  const shippingAddress = normalizeShippingAddress(safeOrder)

  const bodyHtml = `
    <p style="color: #333; font-size: 16px; line-height: 1.6;">
      Tu orden <strong>#${escapeHtml(orderNumber)}</strong> fue entregada exitosamente.
    </p>
    <p style="color: #666; font-size: 14px; line-height: 1.6; margin-top: 20px;">
      Esperamos que disfrutes tu compra. Si tenés algún inconveniente, no dudes en contactarnos.
    </p>
    ${
  storeUrl
    ? `
        <div style="text-align: center; margin-top: 30px;">
          <a href="${escapeHtml(storeUrl)}"
             style="display: inline-block; background: ${primaryColor}; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
            Volver a la tienda
          </a>
        </div>
      `
    : ''
}
  `

  const html = buildOrderStatusEmailHtml({
    storeName,
    logoUrl,
    primaryColor,
    storeUrl,
    supportEmail,
    orderNumber,
    firstName: shippingAddress.firstName,
    headline: 'Tu pedido fue entregado',
    bodyHtml,
  })

  const text = [
    storeName,
    `Orden #${orderNumber}`,
    '',
    `Hola ${shippingAddress.firstName},`,
    'Tu orden fue entregada exitosamente.',
    'Esperamos que disfrutes tu compra.',
  ].join('\n')

  return sendEmail({
    to,
    subject: `Tu pedido #${orderNumber} fue entregado | ${storeName}`,
    html,
    text,
    tenantConfig,
    maxRetries: 2,
  })
}

export const sendOrderCancelledEmail = async (
  order,
  recipientEmail = null,
  tenantConfig = {},
  context = {},
) => {
  const safeOrder = normalizeObject(order)

  const to = resolveOrderStatusEmailRecipient({
    order: safeOrder,
    recipientEmail,
    context,
  })

  if (!to) {
    return { success: false, error: 'INVALID_CLIENT_EMAIL' }
  }

  const storeName = getStoreName(tenantConfig)
  const primaryColor = getPrimaryColor(tenantConfig)
  const logoUrl = getLogoUrl(tenantConfig)
  const storeUrl = getStoreUrl(tenantConfig)
  const supportEmail = getSupportEmail(tenantConfig)
  const orderNumber = normalizeOrderId(safeOrder)
  const shippingAddress = normalizeShippingAddress(safeOrder)
  const totals = normalizeOrderTotals(safeOrder)

  const reason = sanitizeString(context?.reason)

  const bodyHtml = `
    <p style="color: #333; font-size: 16px; line-height: 1.6;">
      Tu orden <strong>#${escapeHtml(orderNumber)}</strong> por un total de
      <strong>${formatMoney(totals.total, totals.currency)}</strong> fue cancelada.
    </p>
    ${
  reason
    ? `
        <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0; color: #991b1b; font-size: 14px;">
            <strong>Motivo:</strong> ${escapeHtml(reason)}
          </p>
        </div>
      `
    : ''
}
    <p style="color: #666; font-size: 14px; line-height: 1.6; margin-top: 20px;">
      Si tenés preguntas sobre esta cancelación, no dudes en contactarnos.
    </p>
  `

  const html = buildOrderStatusEmailHtml({
    storeName,
    logoUrl,
    primaryColor,
    storeUrl,
    supportEmail,
    orderNumber,
    firstName: shippingAddress.firstName,
    headline: 'Tu orden fue cancelada',
    bodyHtml,
  })

  const textLines = [
    storeName,
    `Orden #${orderNumber}`,
    '',
    `Hola ${shippingAddress.firstName},`,
    `Tu orden #${orderNumber} por ${formatMoney(totals.total, totals.currency)} fue cancelada.`,
  ]

  if (reason) textLines.push(`Motivo: ${reason}`)

  return sendEmail({
    to,
    subject: `Tu orden #${orderNumber} fue cancelada | ${storeName}`,
    html,
    text: textLines.join('\n'),
    tenantConfig,
    maxRetries: 2,
  })
}

export const sendOrderRefundedEmail = async (
  order,
  recipientEmail = null,
  tenantConfig = {},
  context = {},
) => {
  const safeOrder = normalizeObject(order)

  const to = resolveOrderStatusEmailRecipient({
    order: safeOrder,
    recipientEmail,
    context,
  })

  if (!to) {
    return { success: false, error: 'INVALID_CLIENT_EMAIL' }
  }

  const storeName = getStoreName(tenantConfig)
  const primaryColor = getPrimaryColor(tenantConfig)
  const logoUrl = getLogoUrl(tenantConfig)
  const storeUrl = getStoreUrl(tenantConfig)
  const supportEmail = getSupportEmail(tenantConfig)
  const orderNumber = normalizeOrderId(safeOrder)
  const shippingAddress = normalizeShippingAddress(safeOrder)
  const totals = normalizeOrderTotals(safeOrder)

  const reason = sanitizeString(context?.reason)

  const bodyHtml = `
    <p style="color: #333; font-size: 16px; line-height: 1.6;">
      Tu orden <strong>#${escapeHtml(orderNumber)}</strong> fue reembolsada.
      El monto de <strong>${formatMoney(totals.total, totals.currency)}</strong> será acreditado
      a tu medio de pago original.
    </p>
    ${
  reason
    ? `
        <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0; color: #1e40af; font-size: 14px;">
            <strong>Motivo:</strong> ${escapeHtml(reason)}
          </p>
        </div>
      `
    : ''
}
    <p style="color: #666; font-size: 14px; line-height: 1.6; margin-top: 20px;">
      El plazo de acreditación depende de tu medio de pago y puede demorar algunos días hábiles.
      Si tenés preguntas, no dudes en contactarnos.
    </p>
  `

  const html = buildOrderStatusEmailHtml({
    storeName,
    logoUrl,
    primaryColor,
    storeUrl,
    supportEmail,
    orderNumber,
    firstName: shippingAddress.firstName,
    headline: 'Tu orden fue reembolsada',
    bodyHtml,
  })

  const textLines = [
    storeName,
    `Orden #${orderNumber}`,
    '',
    `Hola ${shippingAddress.firstName},`,
    `Tu orden #${orderNumber} fue reembolsada.`,
    `El monto de ${formatMoney(totals.total, totals.currency)} será acreditado a tu medio de pago original.`,
  ]

  if (reason) textLines.push(`Motivo: ${reason}`)

  return sendEmail({
    to,
    subject: `Tu orden #${orderNumber} fue reembolsada | ${storeName}`,
    html,
    text: textLines.join('\n'),
    tenantConfig,
    maxRetries: 2,
  })
}

// =====================================================
// APP URS SMTP
// =====================================================

export const testEmailConnection = async () => {
  try {
    const client = getResendClient()
    const { error } = await client.apiKeys.list()

    if (error) {
      throw new Error(error.message || 'Error de Resend')
    }

    return {
      success: true,
      message: 'Resend verificado correctamente',
    }
  } catch (error) {
    logger.error('❌ testEmailConnection falló', {
      message: error.message,
      code: error.code,
    })

    return {
      success: false,
      message: error.message,
      code: error.code || null,
    }
  }
}

// =====================================================
// DEFAULT EXPORT
// =====================================================

export default {
  sendEmail,
  sendOrderConfirmationEmail,
  sendAdminNotificationEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
  sendOrderRefundedEmail,
  testEmailConnection,
  resetEmailTransporter,
}
