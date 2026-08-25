// 📁 src/services/email/reactivationEmail.service.js
//
// Email de reactivación de clientes inactivos (Bloque 8.8, alcance
// acotado). Mismo esqueleto que cartRecoveryEmail.service.js, pero sin
// depender de un carrito: no hay checkoutUrl ni cartSnapshot, el link va a
// la tienda en general.

import { sendEmail } from '../../utils/sendEmail.js'
import { escapeHtml, sanitizeString as clean } from './emailShared.js'

/**
 * @param to            Email del cliente.
 * @param tenantConfig  Documento crudo del tenant (trae name/settings.store).
 * @param customerName  Nombre del cliente, para el saludo.
 * @param storeUrl      Link a la tienda del comercio.
 * @param body          Texto que el admin revisó/editó antes de enviar — se
 *                       respeta tal cual, el HTML no le impone su propia
 *                       redacción.
 */
export const sendReactivationEmail = async ({
  to,
  tenantConfig = {},
  customerName = '',
  storeUrl = '',
  body = '',
}) => {
  const destination = clean(to)

  if (!destination) {
    const error = new Error('Falta el correo del cliente')
    error.code = 'MISSING_RECIPIENT'
    throw error
  }

  if (!storeUrl) {
    const error = new Error('Falta el enlace de la tienda')
    error.code = 'MISSING_STORE_URL'
    throw error
  }

  const storeName =
    clean(tenantConfig?.storeName) ||
    clean(tenantConfig?.name) ||
    clean(tenantConfig?.general?.storeName) ||
    'la tienda'

  const safeStoreName = escapeHtml(storeName)
  const safeStoreUrl = escapeHtml(storeUrl)
  const safeBody = escapeHtml(clean(body))
  const greeting = clean(customerName)
    ? `Hola ${escapeHtml(clean(customerName))},`
    : 'Hola,'

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
      <h2>Te extrañamos en ${safeStoreName}</h2>

      <p>${greeting}</p>

      ${safeBody ? `<p>${safeBody}</p>` : `<p>Hace un tiempo que no te vemos por <strong>${safeStoreName}</strong> — date una vuelta, hay novedades.</p>`}

      <div style="text-align: center; margin: 30px 0;">
        <a href="${safeStoreUrl}"
           style="background:#000; color:#fff; padding:12px 25px; text-decoration:none; border-radius:6px; font-weight:bold;">
          VER LA TIENDA
        </a>
      </div>

      <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>

      <p style="word-break: break-all; font-size: 0.9rem;">${safeStoreUrl}</p>

      <p style="font-size: 0.8rem; color: #666;">
        Si no querés recibir más este tipo de mensajes, respondé este correo y te sacamos de la lista.
      </p>
    </div>
  `

  return sendEmail({
    to: destination,
    subject: `${storeName} te extraña`,
    html,
    text: `${clean(body) || `Hace un tiempo que no te vemos por ${storeName}.`}\n\n${storeUrl}`,
    tenantConfig,
  })
}

export default { sendReactivationEmail }
