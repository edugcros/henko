import { randomBytes } from 'crypto'

export const generateCouponCode = (prefix = '', length = 8) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = prefix
  
  const bytes = randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length]
  }
  
  return result
}

export const generateUniqueCode = async (model, prefix = '', length = 8, maxAttempts = 10) => {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateCouponCode(prefix, length)
    const exists = await model.findOne({ code })
    if (!exists) return code
  }
  throw new Error('No se pudo generar un código único después de varios intentos')
}