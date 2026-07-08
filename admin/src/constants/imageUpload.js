// 📁 src/constants/imageUpload.js
//
// Única fuente de verdad en el admin para los tipos MIME y el tamaño máximo
// de imágenes subidas para análisis por IA. Debe reflejar lo que acepta
// backend/config/imageUploadPolicy.js.

export const MAX_IMAGE_SIZE_MB = 10

export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]
