// 📁 src/services/email/emailShared.js
//
// Helpers de validación/sanitización usados por todo el subsistema de email
// (emailService, verificationEmail, cartRecoveryEmail, orderEmailService,
// paymentEmailService, tenantEmailDomainService, tenantSettingsCtrl). Antes
// cada archivo tenía su propia copia de EMAIL_REGEX/escapeHtml/sanitizado —
// centralizados acá para que una corrección (ej. el saneo anti-header-
// injection) se aplique en un solo lugar.

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * El número de cuenta de AWS: doce dígitos, ni uno más ni uno menos.
 *
 * POR QUÉ VIVE ACÁ Y NO AL LADO DE QUIEN LO USA
 *
 * Lo necesitan dos lugares que NO se pueden importar entre sí:
 *
 *   arnDeSes (emailProviders)   lo exige para armar el ARN del inquilino
 *   checkEnv (script)           lo comprueba ANTES de desplegar
 *
 * El script no puede importar emailProviders porque eso arrastra el logger y
 * con él config/env.js, que en producción LANZA ante la primera variable que
 * falta — justo lo que el script existe para informar sin morirse. Y este
 * módulo no tiene dependencias, así que es el único punto común.
 *
 * Que estuvieran separados ya costó: el preflight daba por buena cualquier
 * cadena no vacía mientras el runtime exigía el formato, así que un alias de
 * cuenta pasaba el chequeo, fallaba al armar el ARN, y el envío degradaba a
 * reputación compartida EN SILENCIO. El chequeo declaraba sana una migración
 * que no aislaba nada.
 */
export const AWS_ACCOUNT_ID_REGEX = /^\d{12}$/

export const isValidAwsAccountId = value => AWS_ACCOUNT_ID_REGEX.test(String(value ?? '').trim())

export const normalizeEmail = value =>
  String(value || '')
    .trim()
    .toLowerCase()

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

  const clean = String(value)
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return clean || fallback
}
