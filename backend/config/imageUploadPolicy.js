// 📁 config/imageUploadPolicy.js
//
// Única fuente de verdad para los tipos MIME y el tamaño máximo aceptados
// en cualquier endpoint que reciba imágenes destinadas al análisis por IA
// (subida manual desde el admin, importación vía agente, etc.).

export const ALLOWED_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
])

// Formatos que reporta sharp() al leer el contenido real del archivo
// (usados para validar por firma binaria, no solo por Content-Type declarado).
export const ALLOWED_IMAGE_SHARP_FORMATS = Object.freeze([
  'jpeg',
  'png',
  'webp',
  'avif',
  'heif',
])

export const MAX_IMAGE_UPLOAD_MB = Number(process.env.MAX_IMAGE_MB || 10)
export const MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024
