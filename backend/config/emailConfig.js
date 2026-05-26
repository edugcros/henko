import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import logger from './logger.js'

dotenv.config()

const requiredVars = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS']
const missingEmailVars = requiredVars.filter(key => !process.env[key])
const isEmailConfigured = missingEmailVars.length === 0

if (!isEmailConfigured) {
  logger.warn('SMTP deshabilitado por configuración incompleta', {
    missing: missingEmailVars,
  })
}

const isSecure = Number(process.env.EMAIL_PORT) === 465

const createDisabledTransporter = () => ({
  sendMail: async () => {
    throw new Error(`SMTP no configurado: faltan ${missingEmailVars.join(', ')}`)
  },
  verify: callback => {
    const error = new Error(`SMTP no configurado: faltan ${missingEmailVars.join(', ')}`)
    if (typeof callback === 'function') callback(error)
    return Promise.reject(error)
  },
})

const transporter = isEmailConfigured
  ? nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: isSecure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    pool: true,
    maxConnections: 5,
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
    connectionTimeout: 10000,
  })
  : createDisabledTransporter()

if (isEmailConfigured) {
  transporter.verify((error, success) => {
    if (error) {
      logger.error('❌ Error de configuración SMTP:', {
        message: error.message,
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
      })
    } else {
      logger.info('✅ Servidor de correo vinculado exitosamente', success)
    }
  })
}

export default transporter
