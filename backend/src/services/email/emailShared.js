// 📁 src/services/email/emailShared.js
//
// Helpers de validación/sanitización usados por todo el subsistema de email
// (emailService, verificationEmail, cartRecoveryEmail, orderEmailService,
// paymentEmailService, tenantEmailDomainService, tenantSettingsCtrl). Antes
// cada archivo tenía su propia copia de EMAIL_REGEX/escapeHtml/sanitizado —
// centralizados acá para que una corrección (ej. el saneo anti-header-
// injection) se aplique en un solo lugar.

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeEmail = value => String(value || '').trim().toLowerCase()

export const isValidEmail = value => EMAIL_REGEX.test(normalizeEmail(value))

// Devuelve el email normalizado o null — para usar en cadenas de fallback
// (validateEmail(a) || validateEmail(b) || ...).
export const validateEmail = value => {
  const normalized = normalizeEmail(value)
  return isValidEmail(normalized) ? normalized : null
}

export const escapeHtml = value => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Para campos de una sola línea que pueden terminar en un header de email
// (subject, From) además del cuerpo HTML — nombres de tienda, IDs de
// proveedor, valores de registros DNS. Corta CR/LF para que un dato con
// saltos de línea no pueda inyectar headers adicionales. No usar en campos
// de texto libre legítimamente multilínea (ej. dirección o descripción de
// tienda en tenantSettingsCtrl).
export const sanitizeString = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback

  const clean = String(value).replace(/[\r\n]+/g, ' ').trim()
  return clean || fallback
}
