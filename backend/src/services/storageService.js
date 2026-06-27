import { bucket } from '../../config/storage.js'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import logger from '../../config/logger.js'

const ALLOWED_IMAGE_MIMES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])

const normalizeTenantId = tenantId => {
  const clean = String(tenantId || '').trim()
  if (!/^[a-f\d]{24}$/i.test(clean)) {
    throw new Error('tenantId inválido para storage')
  }

  return clean
}

const getSafeImageExtension = file => {
  const mimeExtension = ALLOWED_IMAGE_MIMES.get(file?.mimetype)
  if (!mimeExtension) {
    throw new Error('Formato de imagen no permitido')
  }

  const originalExtension = path.extname(file.originalname || '').toLowerCase()
  return [...ALLOWED_IMAGE_MIMES.values()].includes(originalExtension)
    ? originalExtension
    : mimeExtension
}

export const uploadImage = (file, tenantId) => {
  return new Promise((resolve, reject) => {
    let normalizedTenantId
    let extension

    try {
      if (!file || !file.buffer) {
        throw new Error('Archivo inválido o corrupto')
      }

      normalizedTenantId = normalizeTenantId(tenantId)
      extension = getSafeImageExtension(file)
    } catch (error) {
      return reject(error)
    }

    const fileName = `tenants/${normalizedTenantId}/products/${uuidv4()}${extension}`
    
    const fileUpload = bucket.file(fileName)

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        cacheControl: 'public, max-age=31536000', // Cache de 1 año para performance
      },
      resumable: false,
    })

    stream.on('error', err => {
      logger.error('GCS Upload Error', {
        tenantId: normalizedTenantId,
        message: err?.message || 'Error desconocido',
      })
      reject(err)
    })

    stream.on('finish', async () => {
      try {
        // En producción suele ser mejor manejar permisos a nivel de bucket, 
        // pero si necesitas URLs públicas directas:
        await fileUpload.makePublic() 
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`
        resolve(publicUrl)
      } catch (err) {
        reject(err)
      }
    })

    stream.end(file.buffer)
  })
}
