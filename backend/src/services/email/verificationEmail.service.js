// 📁 src/services/email/verificationEmail.service.js
import { sendEmail } from '../../utils/sendEmail.js'
import { buildAdminUrl, buildFrontendUrl } from '../../utils/frontendUrl.js'
import { escapeHtml, sanitizeString } from './emailShared.js'

// =====================================================
// Verification email
// =====================================================

/**
 * @param target 'storefront' para compradores, 'admin' para el dueño del
 *               comercio. El dueño no tiene cuenta de comprador, así que
 *               mandarlo a la tienda lo dejaba verificando en la aplicación
 *               equivocada y con un botón de "iniciar sesión" que no era el
 *               suyo.
 */
export const sendVerificationEmail = async (
  user,
  tenantOrName,
  rawToken,
  { target = 'storefront' } = {},
) => {
  if (!user?.email) {
    throw new Error('Usuario inválido para envío de email de verificación')
  }

  if (!rawToken) {
    throw new Error('Token de verificación requerido')
  }

  const tenant =
    typeof tenantOrName === 'object' && tenantOrName !== null
      ? tenantOrName
      : null

  const tenantName =
    tenant?.name ||
    (typeof tenantOrName === 'string' ? tenantOrName : null) ||
    process.env.STORE_NAME ||
    'Henko Store'

  const safeTenantName = escapeHtml(tenantName)
  const safeUserName = escapeHtml(user.firstname || user.email)

  const verifyPath = `/verify-email?token=${encodeURIComponent(rawToken)}`

  const verifyUrl =
    target === 'admin'
      ? buildAdminUrl(verifyPath, null, tenant)
      : buildFrontendUrl(verifyPath, null, tenant)
  const safeVerifyUrl = escapeHtml(verifyUrl)

  return sendEmail({
    to: user.email,
    subject: `Bienvenido a ${sanitizeString(tenantName)} - Verificá tu cuenta`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
        <h2>¡Hola ${safeUserName}!</h2>

        <p>Gracias por crear tu cuenta en <strong>${safeTenantName}</strong>.</p>

        <p>Para completar tu registro y activar tu cuenta, hacé click en el botón de abajo:</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${safeVerifyUrl}"
             style="background-color: #000; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            VERIFICAR MI CUENTA
          </a>
        </div>

        <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>

        <p style="word-break: break-all; font-size: 0.9rem;">
          ${safeVerifyUrl}
        </p>

        <p style="font-size: 0.8rem; color: #666;">
          Este enlace expirará en 24 horas. Si no creaste esta cuenta, podés ignorar este correo.
        </p>
      </div>
    `,
    text: `Verificá tu cuenta aquí: ${verifyUrl}`,
  })
}

// =====================================================
// Reset password email
// =====================================================

export const sendResetPasswordEmail = async (user, resetUrl) => {
  if (!user?.email) {
    throw new Error('Usuario inválido para envío de email')
  }

  if (!resetUrl) {
    throw new Error('URL de reseteo requerida')
  }

  const safeUserName = escapeHtml(user.firstname || user.email)
  const safeResetUrl = escapeHtml(resetUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
      <h2>Restablecer contraseña</h2>

      <p>Hola ${safeUserName},</p>

      <p>Recibimos una solicitud para restablecer tu contraseña.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${safeResetUrl}"
          style="background: #000; color: #fff; padding: 12px 25px;
          text-decoration: none; border-radius: 6px; font-weight: bold;">
          RESTABLECER CONTRASEÑA
        </a>
      </div>

      <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>

      <p style="word-break: break-all; font-size: 0.9rem;">
        ${safeResetUrl}
      </p>

      <p style="font-size: 0.8rem; color: #666;">
        Este enlace expirará en 1 hora.
      </p>

      <p style="font-size: 0.8rem; color: #666;">
        Si no solicitaste este cambio podés ignorar este correo.
      </p>
    </div>
  `

  return sendEmail({
    to: user.email,
    subject: 'Restablecer contraseña',
    html,
    text: `Restablecé tu contraseña aquí: ${resetUrl}`,
  })
}

// =====================================================
// Password changed notice
// =====================================================

/**
 * Aviso de que la contraseña cambió.
 *
 * No lleva ningún enlace de acción a propósito: su único trabajo es que el
 * dueño de la casilla se entere. Si el cambio no fue suyo, este correo es la
 * única señal que va a recibir de que alguien más entró a su cuenta, y hasta
 * ahora no se enviaba nada después de un reseteo exitoso.
 *
 * Falla en silencio para el llamador: el cambio de contraseña ya ocurrió y no
 * tiene sentido revertirlo —ni mostrarle un error al usuario— porque el correo
 * de cortesía no salió.
 */
export const sendPasswordChangedEmail = async (user, tenantOrName = null) => {
  if (!user?.email) return { success: false, skipped: true }

  const tenant =
    typeof tenantOrName === 'object' && tenantOrName !== null
      ? tenantOrName
      : null

  const tenantName =
    tenant?.name ||
    (typeof tenantOrName === 'string' ? tenantOrName : null) ||
    process.env.STORE_NAME ||
    'Tu cuenta'

  const safeTenantName = escapeHtml(tenantName)
  const safeUserName = escapeHtml(user.firstname || user.email)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
      <h2>Tu contraseña fue modificada</h2>

      <p>Hola ${safeUserName},</p>

      <p>
        Te confirmamos que la contraseña de tu cuenta en
        <strong>${safeTenantName}</strong> se cambió recientemente.
      </p>

      <p style="background: #fff4f4; border-left: 4px solid #d32f2f; padding: 12px 16px;">
        <strong>Si no fuiste vos</strong>, alguien más tiene acceso a tu cuenta.
        Restablecé la contraseña de inmediato y avisanos.
      </p>

      <p style="font-size: 0.8rem; color: #666;">
        Si fuiste vos, no hace falta que hagas nada.
      </p>
    </div>
  `

  return sendEmail({
    to: user.email,
    subject: `Tu contraseña de ${sanitizeString(tenantName)} fue modificada`,
    html,
    text: `La contraseña de tu cuenta en ${tenantName} se cambió recientemente. Si no fuiste vos, restablecela de inmediato.`,
  })
}

// =====================================================
// Welcome email
// =====================================================

/**
 * Bienvenida, después de verificar.
 *
 * Va separada del correo de verificación a propósito: ese tiene un único
 * trabajo —que hagan clic en el enlace— y meterle contenido de bienvenida le
 * compite la atención. Este sale cuando la cuenta ya quedó activa, que es
 * cuando la persona está más atenta y no hay nada más que pedirle.
 *
 * Nunca bloquea: la cuenta ya está verificada, y que la cortesía no salga no
 * puede convertir eso en un error.
 */
export const sendWelcomeEmail = async (user, tenantOrName = null) => {
  if (!user?.email) return { success: false, skipped: true }

  const tenant =
    typeof tenantOrName === 'object' && tenantOrName !== null
      ? tenantOrName
      : null

  const tenantName =
    tenant?.name ||
    (typeof tenantOrName === 'string' ? tenantOrName : null) ||
    process.env.STORE_NAME ||
    'la tienda'

  const safeTenantName = escapeHtml(tenantName)
  const safeUserName = escapeHtml(user.firstname || user.email)

  const storeUrl = (() => {
    try {
      return buildFrontendUrl('/', null, tenant)
    } catch {
      // Sin dominio ni ENV utilizable el correo sale igual, sin botón: es una
      // bienvenida, no vale la pena perderla por un enlace.
      return ''
    }
  })()

  const safeStoreUrl = escapeHtml(storeUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
      <h2>¡Tu cuenta ya está activa!</h2>

      <p>Hola ${safeUserName},</p>

      <p>
        Gracias por verificar tu correo. Tu cuenta en
        <strong>${safeTenantName}</strong> quedó lista para usar.
      </p>

      ${
  safeStoreUrl
    ? `<div style="text-align: center; margin: 30px 0;">
             <a href="${safeStoreUrl}"
                style="background:#000; color:#fff; padding:12px 25px; text-decoration:none; border-radius:6px; font-weight:bold;">
               IR A LA TIENDA
             </a>
           </div>`
    : ''
}

      <p style="font-size: 0.8rem; color: #666;">
        Si tenés alguna consulta, respondé este correo y te contestamos.
      </p>
    </div>
  `

  return sendEmail({
    to: user.email,
    subject: `Bienvenido a ${sanitizeString(tenantName)}`,
    html,
    text: `Tu cuenta en ${tenantName} ya está activa.${storeUrl ? ` Entrá acá: ${storeUrl}` : ''}`,
    tenantConfig: tenant || {},
  })
}
