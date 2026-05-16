import asyncHandler from 'express-async-handler'
import { sendEmail } from '../utils/sendEmail.js'
import logger from '../../config/logger.js'
import validator from 'validator'

export const sendEmailController = asyncHandler(async (req, res) => {
  const { to, subject, text, html } = req.body

  // 1. Validaciones estrictas
  if (!to || !validator.isEmail(to)) {
    return res.status(400).json({ success: false, message: 'Destinatario inválido' })
  }

  if (!subject || subject.trim().length < 3) {
    return res.status(400).json({ success: false, message: 'El asunto debe tener al menos 3 caracteres' })
  }

  if (!text && !html) {
    return res.status(400).json({ success: false, message: 'El cuerpo del correo (texto o HTML) es requerido' })
  }

  try {
    logger.info(`📧 Intentando enviar correo a: ${to} | Asunto: ${subject}`)

    // 2. Ejecución del envío
    const result = await sendEmail({ to, subject, text, html })

    // 3. Respuesta exitosa
    res.status(200).json({ 
      success: true, 
      message: 'Correo enviado correctamente', 
      messageId: result.messageId, // Útil para seguimiento en servicios como Mailgun o Gmail
    })

  } catch (error) {
    logger.error(`❌ Error en sendEmailController: ${error.message}`)
    res.status(500).json({ 
      success: false, 
      message: 'Error interno al procesar el envío de correo', 
    })
  }
})