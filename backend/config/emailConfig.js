import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import logger from './logger.js'

dotenv.config()

// 1. Validar variables necesarias antes de arrancar
const requiredVars = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS']
requiredVars.forEach(key => {
  if (!process.env[key]) {
    logger.error(`❌ Falta la variable de entorno obligatoria: ${key}`)
    // No matamos el proceso inmediatamente para permitir que otros servicios inicien, 
    // pero el transporte fallará al usarse.
  }
})

const isSecure = Number(process.env.EMAIL_PORT) === 465

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: isSecure, // true para 465, false para otros (587)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  pool: true,
  maxConnections: 5,
  tls: {
    // ⚠️ Si usas Gmail o correos corporativos en desarrollo, a veces fallan los certificados.
    // En producción, asegúrate de que sea true.
    rejectUnauthorized: process.env.NODE_ENV === 'production', 
  },
  connectionTimeout: 10000, // 10 segundos de espera
})

// 2. CORRECCIÓN DE SINTAXIS: Verificar conexión
// Tenías "transporter.verify ,error", le faltaban los paréntesis ()
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

export default transporter