// 📁 src/utils/cloudinary.js
import { v2 as cloudinary } from 'cloudinary'
import dotenv from 'dotenv'
import logger from '../../config/logger.js'

dotenv.config()

const requiredEnvVars = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']
const missingCloudinaryVars = requiredEnvVars.filter(key => !process.env[key])
const isCloudinaryConfigured = missingCloudinaryVars.length === 0

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
 * Upload genérico a Cloudinary con transformaciones optimizadas
 */
const uploadToCloudinary = (buffer, folder, options = {}) => {
  if (!isCloudinaryConfigured) {
    throw new Error(`Cloudinary no configurado: faltan ${missingCloudinaryVars.join(', ')}`)
  }

  return new Promise((resolve, reject) => {
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

    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload error:', error)
          return reject(error)
        }
        resolve(result)
      },
    )
    
    stream.end(buffer)
  })
}

// ==========================================
// FUNCIONES PÚBLICAS - UPLOAD
// ==========================================

/**
 * Subir imagen de producto
 * @param {Buffer} buffer - Buffer de la imagen
 * @param {string} productId - ID del producto
 * @param {string} tenantId - ID del tenant (para organización)
 */
export const cloudinaryUploadImg = async (buffer, productId, tenantId) => {
  try {
    const folder = `product/${tenantId}/${productId}`
    const result = await uploadToCloudinary(buffer, folder)
    
    logger.info(`✅ Imagen subida: ${result.public_id}`)
    
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
    logger.error('❌ Error subiendo imagen a Cloudinary:', error)
    throw new Error('Error al subir imagen')
  }
}

/**
 * Subir asset de tema
 */
export const cloudinaryUploadThemeAsset = async (buffer, folder = 'themes') => {
  try {
    const result = await uploadToCloudinary(buffer, folder, {
      transformation: [{ quality: 'auto:eco' }],
    })
    
    logger.info(`✅ Theme asset subido: ${result.public_id}`)
    
    return {
      url: result.secure_url,
      public_id: result.public_id,
    }
  } catch (error) {
    logger.error('❌ Error subiendo theme asset:', error)
    throw error
  }
}

// ==========================================
// FUNCIONES PÚBLICAS - DELETE (NUEVO)
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
    logger.error('❌ Error eliminando imagen de Cloudinary:', error)
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
      publicIds.map(id => cloudinaryDeleteImg(id)),
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
