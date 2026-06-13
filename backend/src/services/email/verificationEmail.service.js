// 📁 src/services/email/verificationEmail.service.js
import { sendEmail } from '../../utils/sendEmail.js'
import { buildFrontendUrl } from '../../utils/frontendUrl.js'

// =====================================================
// Helpers
// =====================================================

const escapeHtml = value => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// =====================================================
// Verification email
// =====================================================

export const sendVerificationEmail = async (user, tenantOrName, rawToken) => {
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

  const verifyUrl = buildFrontendUrl(
    `/verify-email?token=${encodeURIComponent(rawToken)}`,
    null,
    tenant,
  )

  return sendEmail({
    to: user.email,
    subject: `Bienvenido a ${tenantName} - Verificá tu cuenta`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
        <h2>¡Hola ${safeUserName}!</h2>

        <p>Gracias por crear tu cuenta en <strong>${safeTenantName}</strong>.</p>

        <p>Para completar tu registro y activar tu cuenta, hacé click en el botón de abajo:</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}"
             style="background-color: #000; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
            VERIFICAR MI CUENTA
          </a>
        </div>

        <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>

        <p style="word-break: break-all; font-size: 0.9rem;">
          ${verifyUrl}
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

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; line-height: 1.5;">
      <h2>Restablecer contraseña</h2>

      <p>Hola ${safeUserName},</p>

      <p>Recibimos una solicitud para restablecer tu contraseña.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}"
          style="background: #000; color: #fff; padding: 12px 25px;
          text-decoration: none; border-radius: 6px; font-weight: bold;">
          RESTABLECER CONTRASEÑA
        </a>
      </div>

      <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>

      <p style="word-break: break-all; font-size: 0.9rem;">
        ${resetUrl}
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
