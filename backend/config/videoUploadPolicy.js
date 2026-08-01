// 📁 config/videoUploadPolicy.js
//
// Única fuente de verdad para los tipos MIME, tamaño y duración máxima
// aceptados en el endpoint de video de producto.

export const ALLOWED_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

export const MAX_VIDEO_UPLOAD_MB = Number(process.env.MAX_VIDEO_MB || 60)
export const MAX_VIDEO_UPLOAD_BYTES = MAX_VIDEO_UPLOAD_MB * 1024 * 1024

export const MAX_VIDEO_DURATION_SECONDS = Number(
  process.env.MAX_VIDEO_DURATION_SECONDS || 60,
)
