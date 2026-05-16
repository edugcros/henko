import transporter from '../../config/emailConfig.js'
import dotenv from 'dotenv'
import logger from '../../config/logger.js'

// Cargar variables de entorno
dotenv.config()

/**
 * Utilidad para enviar correos electrónicos
 * @param {Object} params - Objeto con to, subject, text, html, attachments, replyTo
 */
export const sendEmail = async ({ to, subject, text, html, attachments = [], replyTo }) => {
  
  // 1. ✅ Validación Rigurosa
  // Verificamos que existan los campos básicos y que el contenido no sea solo espacios en blanco
  const hasContent = (text && text.trim().length > 0) || (html && html.trim().length > 0)

  if (!to || !subject || !hasContent) {
    logger.error('❌ Validación de email fallida: Faltan parámetros o contenido vacío', { to, subject })
    throw new Error('Faltan parámetros obligatorios o el contenido del email está vacío')
  }

  // 2. 📝 Configuración de las opciones del correo
  const mailOptions = {
    // Usamos EMAIL_USER de las variables de entorno para el remitente
    from: `"E-commerce Soporte" <${process.env.EMAIL_USER}>`,
    to,
    subject: subject.trim(),
    text: text ? text.trim() : '',
    html: html ? html.trim() : '',
    attachments,
    // Si existe replyTo (para que el cliente responda a otro mail), se agrega dinámicamente
    ...(replyTo ? { replyTo } : {}),
  }

  // 3. 🚀 Intento de envío
  try {
    // Verificamos conexión antes de enviar (opcional, pero ayuda al debug)
    // await transporter.verify(); 

    const info = await transporter.sendMail(mailOptions)
    
    logger.info('📧 Correo enviado con éxito', { 
      messageId: info.messageId, 
      to: to,
      subject: subject, 
    })

    return { 
      success: true, 
      message: 'Correo enviado correctamente', 
      messageId: info.messageId, 
    }

  } catch (error) {
    // 4. ❌ Manejo de errores detallado
    logger.error('🔥 Error crítico en Nodemailer al enviar correo', { 
      errorMessage: error.message, 
      stack: error.stack,
      to, 
    })

    // Lanzamos un error específico que el controlador pueda capturar
    // Si el error es "Invalid login", el problema está en EMAIL_USER/EMAIL_PASS
    throw new Error(`No se pudo enviar el correo: ${error.message}`)
  }
}