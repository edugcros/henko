// 📄 src/utils/normalizeError.js

/**
 * 🔧 normalizeError
 * Convierte cualquier error (Axios, objeto plano, string, etc.)
 * en una instancia segura de Error() con un mensaje legible.
 */
export function normalizeError(err) {
  if (!err) return new Error('Error desconocido')

  if (err instanceof Error) return err

  if (typeof err === 'string') return new Error(err)

  const msg =
    err?.message ||
    err?.response?.data?.message ||
    (typeof err === 'object' ? JSON.stringify(err, null, 2) : 'Error desconocido')

  return new Error(msg)
}
