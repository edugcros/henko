// 📁 src/middlewares/uploadImage.js

import multer from 'multer'
import sharp from 'sharp'

const MAX_SIZE_MB = Number(process.env.MAX_IMAGE_MB || 5)
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

const sanitizeName = name => {
  const base = String(name || 'image').toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_.-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 64) || 'image'
  return base
}

const storage = multer.memoryStorage()

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('Formato no permitido (jpg, png, webp, avif)'))
  }
  cb(null, true)
}

export const uploadPhoto = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_SIZE_BYTES,
    files: 20,
  },
})

export const productImgResize = async (req, res, next) => {
  
  try {
    // Soportar tanto req.files (array) como req.file (single)
    const files = req.files
      ? Object.values(req.files).flat()
      : req.file
        ? [req.file]
        : []    
    if (req.file && !req.files) {
      req.files = [req.file]
    }

    if (!files || files.length === 0) {
      return next()
    }

    await Promise.all(
      files.map(async file => {
        const safeBase = sanitizeName(
          file.originalname?.split('.').slice(0, -1).join('.') || 'image',
        )
        
        // Procesar con sharp
        const processed = await sharp(file.buffer)
          .rotate()
          .resize({ 
            width: 1200, 
            height: 1200, 
            fit: 'inside', 
            withoutEnlargement: true, 
          })
          .webp({ quality: 80 })
          .toBuffer()

        // 🔴 CORREGIDO: Agregar processedBuffer en lugar de reemplazar buffer
        file.processedBuffer = processed
        file.originalBuffer = file.buffer // Mantener original por si acaso
        file.buffer = processed // Compatibilidad backward
        file.safeName = `${Date.now()}-${safeBase}.webp`
        file.mimetype = 'image/webp' // Actualizar MIME type
        
        console.log(`✅ Procesado: ${file.originalname} -> ${processed.length} bytes`)
      }),
    )

    // Si era single, sincronizar req.file
    if (req.file && files.length === 1) {
      req.file = files[0]
    }

    next()
  } catch (err) {
    console.error('❌ Error en productImgResize:', err)
    next(err)
  }
}