// backend/src/utils/cookieHelper.js

export const getCookieDomain = req => {
  // 1. Obtenemos el host actual (dinámico)
  const host = req.hostname || req.get('host')?.split(':')[0]

  // 2. Si es localhost, devolvemos undefined (obligatorio para navegadores)
  if (!host || host === 'localhost' || host === '127.0.0.1') return undefined

  // 3. CASO ESPECIAL: Si el host es tu dominio principal (SaaS)
  // Usamos la variable de entorno para asegurar que sea .henkoapp.com
  if (process.env.PRODUCTION_DOMAIN && host.includes(process.env.PRODUCTION_DOMAIN)) {
    return `.${process.env.PRODUCTION_DOMAIN.replace(/^\./, '')}`
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