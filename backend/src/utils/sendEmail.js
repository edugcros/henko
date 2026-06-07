import logger from '../../config/logger.js'
import { sendEmail as sendEmailThroughService } from '../services/emailService.js'

/**
 * Adaptador legacy.
 * Mantiene el contrato histórico basado en throw para no romper controladores viejos,
 * mientras delega todo el envío real al servicio consolidado.
 */
export const sendEmail = async ({
  to,
  subject,
  text,
  html,
  attachments = [],
  replyTo,
  tenantConfig = {},
  from,
}) => {
  const hasContent = (text && text.trim().length > 0) || (html && html.trim().length > 0)

  if (!to || !subject || !hasContent) {
    logger.error('❌ Validación de email fallida: Faltan parámetros o contenido vacío', {
      to,
      subject,
    })
    throw new Error('Faltan parámetros obligatorios o el contenido del email está vacío')
  }

  const result = await sendEmailThroughService({
    to,
    subject: subject.trim(),
    text: text ? text.trim() : '',
    html: html ? html.trim() : '',
    attachments,
    replyTo,
    tenantConfig,
    from,
  })

  if (!result?.success) {
    logger.error('🔥 Error crítico al enviar correo', {
      to,
      subject,
      error: result?.error,
      details: result?.details,
      code: result?.code,
    })

    throw new Error(result?.details || result?.error || 'No se pudo enviar el correo')
  }

  return {
    success: true,
    message: 'Correo enviado correctamente',
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
    response: result.response,
  }
}
