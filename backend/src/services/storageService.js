import { bucket } from '../../config/storage.js'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'

export const uploadImage = (file, tenantId) => {
  return new Promise((resolve, reject) => {
    if (!file || !file.buffer) {
      return reject(new Error('Archivo inválido o corrupto'))
    }

    // Sanitización del nombre: remover caracteres especiales que rompen URLs
    const extension = path.extname(file.originalname)
    const fileName = `tenants/${tenantId}/products/${uuidv4()}${extension}`
    
    const fileUpload = bucket.file(fileName)

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        cacheControl: 'public, max-age=31536000', // Cache de 1 año para performance
      },
      resumable: false,
    })

    stream.on('error', err => {
      console.error('GCS Upload Error:', err)
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