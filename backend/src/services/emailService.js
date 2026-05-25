// 📁 src/services/emailService.js
// VERSIÓN PRODUCCIÓN - SMTP / ORDEN CLIENTE / ORDEN ADMIN / MULTI-TENANT / SIN HARDCODE

import nodemailer from 'nodemailer'
import logger from '../../config/logger.js'

// =====================================================
// CONSTANTES
// =====================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// =====================================================
// HELPERS BÁSICOS
// =====================================================

const sanitizeString = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback

  const clean = String(value).trim()
  return clean || fallback
}

const validateEmail = email => {
  if (!email || typeof email !== 'string') return null

  const trimmed = email.trim().toLowerCase()
  return EMAIL_REGEX.test(trimmed) ? trimmed : null
}

const escapeHtml = value => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

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

const normalizeEmail = value => {
  return validateEmail(value)
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
    sanitizeString(process.env.CLIENT_URL) ||
    sanitizeString(process.env.SHOP_FRONTEND_URL) ||
    sanitizeString(process.env.APP_URL) ||
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
    validateEmail(process.env.ADMIN_EMAIL)
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

const getFromAddress = tenantConfig => {
  const storeName = getStoreName(tenantConfig)

  const emailFrom =
    validateEmail(process.env.EMAIL_FROM) ||
    validateEmail(process.env.EMAIL_USER)

  if (!emailFrom) {
    throw new Error('EMAIL_FROM o EMAIL_USER no configurado para envío SMTP')
  }

  return `"${escapeHtml(storeName)}" <${emailFrom}>`
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
    shippingAddress.zipCode ? `CP: ${shippingAddress.zipCode}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

// =====================================================
// SMTP TRANSPORTER
// =====================================================

const createTransporter = async () => {
  const host = sanitizeString(process.env.EMAIL_HOST, 'smtp.gmail.com')
  const port = Number(process.env.EMAIL_PORT || 465)
  const secure = getEnvBoolean(process.env.EMAIL_SECURE, port === 465)
  const user = validateEmail(process.env.EMAIL_USER)
  const pass = sanitizeString(process.env.EMAIL_PASS)

  if (!user) {
    throw new Error('EMAIL_USER no configurado o inválido')
  }

  if (!pass) {
    throw new Error('EMAIL_PASS no configurado')
  }

  const config = {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: getEnvBoolean(
        process.env.EMAIL_TLS_REJECT_UNAUTHORIZED,
        process.env.NODE_ENV === 'production',
      ),
    },
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development',
  }

  logger.info('📧 Configurando SMTP', {
    host: config.host,
    port: config.port,
    user: config.auth.user,
    secure: config.secure,
    tlsRejectUnauthorized: config.tls.rejectUnauthorized,
  })

  const transporter = nodemailer.createTransport(config)

  try {
    await transporter.verify()

    logger.info('✅ SMTP verificado correctamente', {
      host,
      port,
      user,
    })

    return transporter
  } catch (error) {
    logger.error('❌ Error verificando SMTP', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
    })

    throw error
  }
}

let transporterInstance = null

const getTransporter = async () => {
  if (!transporterInstance) {
    transporterInstance = await createTransporter()
  }

  return transporterInstance
}

export const resetEmailTransporter = () => {
  transporterInstance = null
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

      const transporter = await getTransporter()
      const info = await transporter.sendMail(mailOptions)

      logger.info('✅ Email enviado correctamente', {
        messageId: info.messageId,
        to: mailOptions.to,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      })

      return {
        success: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
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
        command: error.command,
        response: error.response,
      })

      const authFailed =
        String(error.message || '').toLowerCase().includes('authentication') ||
        String(error.message || '').includes('5.7.0') ||
        String(error.code || '').includes('EAUTH')

      if (authFailed) {
        logger.error('🔒 Error de autenticación SMTP', {
          suggestion:
            'Verificá EMAIL_USER y EMAIL_PASS. En Gmail usá App Password, no contraseña normal.',
        })

        return {
          success: false,
          error: 'SMTP_AUTHENTICATION_FAILED',
          details: error.message,
          code: error.code,
          suggestion:
            'Verificá que uses App Password de Gmail de 16 caracteres.',
        }
      }

      resetEmailTransporter()

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
    response: lastError?.response || null,
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
  context = {},
) => {
  const safeOrder = normalizeObject(order)

  const to = getAdminEmail(recipientAdminEmail, tenantConfig)

  logger.info('🚀 Preparando email de nueva venta al admin', {
    orderId: safeOrder?._id?.toString?.() || safeOrder?.id || null,
    recipientAdminEmail,
    tenantAdminEmail: tenantConfig?.adminEmail,
    envAdminEmail: process.env.ADMIN_EMAIL,
    resolvedEmail: to,
  })

  if (!to) {
    logger.warn('⚠️ No hay email de admin configurado', {
      recipientAdminEmail,
      tenantAdminEmail: tenantConfig?.adminEmail,
      envAdminEmail: process.env.ADMIN_EMAIL,
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
// APP URS SMTP
// =====================================================

export const testEmailConnection = async () => {
  try {
    const transporter = await getTransporter()
    await transporter.verify()

    return {
      success: true,
      message: 'SMTP verificado correctamente',
    }
  } catch (error) {
    logger.error('❌ testEmailConnection falló', {
      message: error.message,
      code: error.code,
      response: error.response,
    })

    return {
      success: false,
      message: error.message,
      code: error.code || null,
      response: error.response || null,
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
  testEmailConnection,
  resetEmailTransporter,
}