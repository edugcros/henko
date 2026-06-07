// backend/src/utils/cookieHelper.js
import { env } from '../../config/env.js'

export const getCookieDomain = req => {
  // 1. Obtenemos el host actual (dinámico)
  const host = req.hostname || req.get('host')?.split(':')[0]

  // 2. Si es localhost, devolvemos undefined (obligatorio para navegadores)
  if (!host || host === 'localhost' || host === '127.0.0.1') return undefined

  // 3. CASO ESPECIAL: Si el host es tu dominio principal (SaaS)
  // Usamos la variable de entorno para asegurar que sea .henkoapp.com
  const rootDomain = String(env.rootDomain || env.publicBaseDomain || '')
    .replace(/^\./, '')
    .trim()
    .toLowerCase()

  if (rootDomain && host.includes(rootDomain)) {
    return `.${rootDomain}`
  }

  // 4. CASO TENANT: Si es un dominio de cliente diferente (tienda-pepe.com)
  const parts = host.split('.')
  if (parts.length >= 2) {
    // Si el dominio termina en algo simple como .com, .local, .net
    // El slice(-2) funciona perfecto.
    return `.${parts.slice(-2).join('.')}`
  }

  return undefined
}
