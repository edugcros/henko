// 📁 src/utils/cloudinary.js
import { v2 as cloudinary } from 'cloudinary'
import dotenv from 'dotenv'
import logger from '../../config/logger.js'

dotenv.config()

const requiredEnvVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
const missingCloudinaryVars = requiredEnvVars.filter(key => !process.env[key])
const isCloudinaryConfigured = missingCloudinaryVars.length === 0

// Configuración de reintentos y timeout
const UPLOAD_TIMEOUT_MS = parseInt(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS || '30000', 10) // 30s default
const MAX_RETRIES = parseInt(process.env.CLOUDINARY_MAX_RETRIES || '3', 10)
const INITIAL_RETRY_DELAY_MS = 1000 // 1s inicial
const MAX_RETRY_DELAY_MS = 10000 // máximo 10s

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  })
} else {
  logger.warn('Cloudinary deshabilitado por configuración incompleta', {
    missing: missingCloudinaryVars,
  })
}

// ==========================================
// FUNCIONES PRIVADAS (HELPERS)
// ==========================================

/**
 * Calcula delay exponencial con jitter para reintentos
 */
const getRetryDelay = (attemptNumber) => {
  const exponentialDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attemptNumber)
  const jitteredDelay = exponentialDelay + Math.random() * 1000 // jitter de hasta 1s
  return Math.min(jitteredDelay, MAX_RETRY_DELAY_MS)
}

/**
 * Determina si un error es reintentatble
 */
const isRetryableError = (error) => {
  if (!error) return false
  
  // Errores de conexión que conviene reintentar
  const retryableErrors = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'ERR_HTTP2_STREAM_CLOSED',
  ]
  
  return retryableErrors.includes(error.code) || 
         retryableErrors.includes(error.syscall) ||
         (error.message && retryableErrors.some(e => error.message.includes(e)))
}

/**
 * Upload genérico a Cloudinary con reintentos y timeout
 */
const uploadToCloudinary = (buffer, folder, options = {}) => {
  if (!isCloudinaryConfigured) {
    throw new Error(`Cloudinary no configurado: faltan ${missingCloudinaryVars.join(', ')}`)
  }

  return new Promise((resolve, reject) => {
    let attemptNumber = 0

    const attemptUpload = () => {
      attemptNumber++
      const uploadOptions = {
        folder,
        resource_type: 'image',
        overwrite: false,
        ...options,
        transformation: [
          { quality: 'auto:good', fetch_format: 'auto' },
          { width: 2000, crop: 'limit' },
          ...(options.transformation || []),
        ],
      }

      let timeoutHandle = null
      let streamEnded = false

      const stream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          clearTimeout(timeoutHandle)
          streamEnded = true

          if (error) {
            logger.warn(`⚠️ Cloudinary upload attempt ${attemptNumber}/${MAX_RETRIES} failed:`, {
              code: error.code,
              message: error.message,
              syscall: error.syscall,
            })

            // Si es reintentatble y no hemos alcanzado el límite, reintentar
            if (isRetryableError(error) && attemptNumber < MAX_RETRIES) {
              const delayMs = getRetryDelay(attemptNumber - 1)
              logger.info(`🔄 Reintentando en ${delayMs}ms (intento ${attemptNumber + 1}/${MAX_RETRIES})`)
              setTimeout(attemptUpload, delayMs)
            } else {
              // Error no reintentatble o agotamos reintentos
              logger.error(
                `❌ Cloudinary upload falló (${attemptNumber} intentos):`,
                error
              )
              reject(error)
            }
            return
          }

          // Success
          logger.info(`✅ Imagen subida exitosamente (intento ${attemptNumber}): ${result.public_id}`)
          resolve(result)
        }
      )

      // Timeout: si no termina en UPLOAD_TIMEOUT_MS, abortar
      timeoutHandle = setTimeout(() => {
        if (!streamEnded) {
          logger.warn(`⏱️ Cloudinary upload timeout (${UPLOAD_TIMEOUT_MS}ms) en intento ${attemptNumber}`)
          stream.destroy()

          // Si no hemos alcanzado el límite de reintentos, reintentar
          if (attemptNumber < MAX_RETRIES) {
            const delayMs = getRetryDelay(attemptNumber - 1)
            logger.info(`🔄 Reintentando en ${delayMs}ms (intento ${attemptNumber + 1}/${MAX_RETRIES})`)
            setTimeout(attemptUpload, delayMs)
          } else {
            reject(
              new Error(
                `Cloudinary upload timeout después de ${MAX_RETRIES} intentos`
              )
            )
          }
        }
      }, UPLOAD_TIMEOUT_MS)

      // Manejo de errores del stream
      stream.on('error', (error) => {
        clearTimeout(timeoutHandle)
        if (!streamEnded) {
          streamEnded = true
          logger.warn(`⚠️ Stream error en intento ${attemptNumber}:`, error.message)

          if (isRetryableError(error) && attemptNumber < MAX_RETRIES) {
            const delayMs = getRetryDelay(attemptNumber - 1)
            logger.info(`🔄 Reintentando en ${delayMs}ms (intento ${attemptNumber + 1}/${MAX_RETRIES})`)
            setTimeout(attemptUpload, delayMs)
          } else {
            reject(error)
          }
        }
      })

      stream.end(buffer)
    }

    // Iniciar primer intento
    attemptUpload()
  })
}

// ==========================================
// FUNCIONES PÚBLICAS - UPLOAD
// ==========================================

/**
 * Subir imagen de producto con reintentos automáticos
 * @param {Buffer} buffer - Buffer de la imagen
 * @param {string} productId - ID del producto
 * @param {string} tenantId - ID del tenant (para organización)
 */
export const cloudinaryUploadImg = async (buffer, productId, tenantId) => {
  try {
    const folder = `product/${tenantId}/${productId}`
    const result = await uploadToCloudinary(buffer, folder)

    return {
      url: result.secure_url,
      asset_id: result.asset_id,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      size: result.bytes,
    }
  } catch (error) {
    logger.error('❌ Error subiendo imagen a Cloudinary después de reintentos:', {
      error: error.message,
      code: error.code,
      productId,
      tenantId,
    })
    throw new Error(
      `Error al subir imagen: ${error.message || 'Cloudinary no disponible'}`
    )
  }
}

/**
 * Subir asset de tema con reintentos automáticos
 */
export const cloudinaryUploadThemeAsset = async (buffer, folder = 'themes') => {
  try {
    const result = await uploadToCloudinary(buffer, folder, {
      transformation: [{ quality: 'auto:eco' }],
    })

    return {
      url: result.secure_url,
      public_id: result.public_id,
    }
  } catch (error) {
    logger.error('❌ Error subiendo theme asset:', {
      error: error.message,
      code: error.code,
      folder,
    })
    throw error
  }
}

// ==========================================
// FUNCIONES PÚBLICAS - DELETE
// ==========================================

/**
 * Eliminar imagen de Cloudinary por public_id
 * @param {string} publicId - public_id de la imagen en Cloudinary
 */
export const cloudinaryDeleteImg = async publicId => {
  try {
    if (!publicId || typeof publicId !== 'string') {
      throw new Error('public_id inválido')
    }

    // Limpiar el public_id si viene con URL completa
    const cleanPublicId = publicId.includes('cloudinary.com')
      ? publicId.split('/').slice(-2).join('/').split('.')[0]
      : publicId

    const result = await cloudinary.uploader.destroy(cleanPublicId, {
      resource_type: 'image',
    })

    if (result.result === 'ok' || result.result === 'not found') {
      logger.info(`🗑️ Imagen eliminada: ${cleanPublicId}`)
      return { success: true, result: result.result }
    } else {
      logger.warn(`⚠️ Resultado inesperado al eliminar: ${result.result}`)
      return { success: false, result: result.result }
    }
  } catch (error) {
    logger.error('❌ Error eliminando imagen de Cloudinary:', {
      error: error.message,
      publicId,
    })
    throw error
  }
}

/**
 * Eliminar múltiples imágenes (batch)
 * @param {string[]} publicIds - Array de public_ids
 */
export const cloudinaryDeleteMultiple = async publicIds => {
  try {
    if (!Array.isArray(publicIds) || publicIds.length === 0) {
      return { success: true, deleted: [] }
    }

    const results = await Promise.allSettled(
      publicIds.map(id => cloudinaryDeleteImg(id))
    )

    const successful = results
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value)

    const failed = results
      .filter(r => r.status === 'rejected' || !r.value.success)
      .map((r, i) => ({ publicId: publicIds[i], error: r.reason || r.value }))

    logger.info(`🗑️ Batch delete: ${successful.length} éxitos, ${failed.length} fallos`)

    return {
      success: failed.length === 0,
      deleted: successful.length,
      failed: failed.length > 0 ? failed : undefined,
    }
  } catch (error) {
    logger.error('❌ Error en batch delete:', error)
    throw error
  }
}

// ==========================================
// FUNCIONES ADICIONALES ÚTILES
// ==========================================

/**
 * Obtener URL transformada de Cloudinary
 */
export const getTransformedUrl = (publicId, options = {}) => {
  const { width, height, crop = 'fill', quality = 'auto' } = options

  return cloudinary.url(publicId, {
    width,
    height,
    crop,
    quality,
    fetch_format: 'auto',
    secure: true,
  })
}

/**
 * Verificar si una imagen existe en Cloudinary
 */
export const checkImageExists = async publicId => {
  try {
    const result = await cloudinary.api.resource(publicId, { resource_type: 'image' })
    return { exists: true, data: result }
  } catch (error) {
    if (error.error?.http_code === 404) {
      return { exists: false }
    }
    throw error
  }
}

// ==========================================
// EXPORT DEFAULT
// ==========================================

export default cloudinary