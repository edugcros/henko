// 📁 config/logger.js
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 📂 Directorio de logs
const logDirectory = path.join(__dirname, '../logs')
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true })
}

// 📌 Formatos
/*const logFormat = winston.format.printf(({ level, message, timestamp, stack }) => {
  return stack
    ? `${timestamp} [${level}]: ${message}\n${stack}`
    : `${timestamp} [${level}]: ${message}`
})*/

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    // 📄 Log en consola con colores para desarrollo
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.combine(winston.format.timestamp(), winston.format.json())
        : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),

    // 📄 Archivos rotativos para producción
    new DailyRotateFile({
      filename: path.join(logDirectory, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: path.join(logDirectory, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
  exitOnError: false,
})

// 📌 Captura errores no controlados
process.on('uncaughtException', err => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack })
  process.exit(1)
})

process.on('unhandledRejection', reason => {
  logger.error(`Unhandled Rejection: ${reason}`)
})

export default logger
