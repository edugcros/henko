// 📁 src/services/email/cartRecoveryEmail.service.js
//
// Recuperación de carrito abandonado por correo.
//
// El detector de carritos y toda la infraestructura de correo ya existían,
// pero el worker solo sabía mandar WhatsApp: un comprador que abandonaba el
// carrito sin haber dejado su teléfono no recibía nada, aunque hubiera dejado
// su email en el checkout. Las dos mitades estaban construidas y sin unir.

import { sendEmail } from '../../utils/sendEmail.js'

const escapeHtml = value => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const clean = value => String(value ?? '').trim()

/**
 * @param values  Las mismas variables que arma el worker para la plantilla de
 *                WhatsApp (customerName, productName, cartTotal, checkoutUrl),
 *                para que los dos canales digan lo mismo.
 * @param body    Texto de la regla de campaña, ya con las variables
 *                reemplazadas. Es lo que el comercio escribió; el correo lo
 *                respeta en vez de imponer su propia redacción.
 */
export const sendCartRecoveryEmail = async ({
  to,
  tenantConfig = {},
  values = {},
  body = '',
}) => {
  const destination = clean(to)

  if (!destination) {
    const error = new Error('Falta el correo del comprador')
    error.code = 'MISSING_RECIPIENT'
    throw error
  }

  // Mismo orden de resolución que getStoreName en emailService: el worker
  // pasa el documento crudo del tenant, que trae `name` y no `storeName`.
  // Leer solo `storeName` dejaba todos estos correos como "la tienda".
  const storeName =
    clean(tenantConfig?.storeName) ||
    clean(tenantConfig?.name) ||
    clean(tenantConfig?.general?.storeName) ||
    'la tienda'
  const customerName = clean(values.customerName)
  const checkoutUrl = clean(values.checkoutUrl)

  if (!checkoutUrl) {
    const error = new Error('Falta el enlace de checkout')
    error.code = 'MISSING_CHECKOUT_URL'
    throw error
  }

  const safeStoreName = escapeHtml(storeName)
  const safeCheckoutUrl = escapeHtml(checkoutUrl)
  const safeBody = escapeHtml(clean(body))
  const safeProductName = escapeHtml(clean(values.productName))
  const safeCartTotal = escapeHtml(clean(values.cartTotal))

  const greeting = customerName
    ? `Hola ${escapeHtml(customerName)},`
    : 'Hola,'

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
      <h2>Te quedó algo en el carrito</h2>

      <p>${greeting}</p>

      ${safeBody ? `<p>${safeBody}</p>` : `<p>Guardamos tu carrito en <strong>${safeStoreName}</strong> para que puedas terminar la compra cuando quieras.</p>`}

      ${
  safeProductName
    ? `<p style="background:#f7f7f7; padding:12px 16px; border-radius:6px;">
             <strong>${safeProductName}</strong>${safeCartTotal ? `<br/>Total: ${safeCartTotal}` : ''}
           </p>`
    : ''
}

      <div style="text-align: center; margin: 30px 0;">
        <a href="${safeCheckoutUrl}"
           style="background:#000; color:#fff; padding:12px 25px; text-decoration:none; border-radius:6px; font-weight:bold;">
          RETOMAR MI COMPRA
        </a>
      </div>

      <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>

      <p style="word-break: break-all; font-size: 0.9rem;">${safeCheckoutUrl}</p>

      <p style="font-size: 0.8rem; color: #666;">
        Si ya completaste la compra o no te interesa, podés ignorar este correo.
      </p>
    </div>
  `

  return sendEmail({
    to: destination,
    subject: `Te quedó algo en el carrito de ${storeName}`,
    html,
    text: `${clean(body) || 'Guardamos tu carrito para que termines la compra cuando quieras.'}\n\nRetomá tu compra: ${checkoutUrl}`,
    tenantConfig,
  })
}

export default { sendCartRecoveryEmail }
