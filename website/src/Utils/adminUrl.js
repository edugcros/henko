// 📁 src/Utils/adminUrl.js
//
// El panel admin vive en otro dominio que la tienda (admin.tienda.com vs
// tienda.com), así que no se llega con react-router: hay que construir una
// URL absoluta y navegar de verdad. Esto estaba embebido en SubscriptionCTA
// y el enlace del footer terminó apuntando a una ruta interna que no existe
// en el router del sitio, cayendo en NotFound.

import { env } from '../config/env'

const cleanValue = value => String(value || '').trim()

const removeTrailingSlash = value => cleanValue(value).replace(/\/+$/, '')

const removeProtocol = value =>
  cleanValue(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')

const hasProtocol = value => /^https?:\/\//i.test(cleanValue(value))

const isLocalHostname = hostname => {
  const cleanHostname = cleanValue(hostname).toLowerCase()

  return (
    cleanHostname === 'localhost' ||
    cleanHostname === '127.0.0.1' ||
    cleanHostname.endsWith('.local')
  )
}

export const buildAdminBaseUrl = () => {
  if (typeof window === 'undefined') return ''

  const { hostname, protocol, host } = window.location

  if (isLocalHostname(hostname)) {
    const adminBase =
      removeProtocol(env?.adminBaseDomain) || `admin.${hostname}`
    return `${protocol}//${adminBase}:3001`
  }

  const adminBaseDomain = removeTrailingSlash(env?.adminBaseDomain)
  const publicBaseDomain = removeTrailingSlash(env?.publicBaseDomain)

  if (adminBaseDomain) {
    return hasProtocol(adminBaseDomain)
      ? adminBaseDomain
      : `https://${removeProtocol(adminBaseDomain)}`
  }

  if (publicBaseDomain) {
    return `https://admin.${removeProtocol(publicBaseDomain)}`
  }

  return `${protocol}//${host}`
}

/**
 * URL absoluta a una ruta del panel admin.
 * Devuelve '' si no se pudo resolver la base (SSR), para que quien la use
 * pueda decidir no renderizar el enlace.
 */
export const buildAdminUrl = (path = '/') => {
  const base = buildAdminBaseUrl()
  if (!base) return ''

  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

// Pantalla de planes del panel: es pública, así que sirve como destino
// comercial desde el sitio para alguien que todavía no tiene cuenta.
export const SUBSCRIPTION_PATH = '/subscripcion'
