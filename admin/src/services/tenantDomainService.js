// 📁 admin/src/services/tenantDomainService.js
//
// Dominio propio del comercio: la dirección desde la que se entra a su tienda
// y a su panel.
//
// Backend: backend/src/services/tenant/tenantDomainService.js
//
// Distinto del dominio de ENVÍO (emailDomainService), que es por dónde salen
// los correos. Un comercio puede tener uno, el otro, o los dos.
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

/**
 * Los dominios del comercio, y qué puede hacer la plataforma con ellos.
 *
 * `capabilities` viaja al lado de la lista y no adentro: la lista es del
 * comercio, la capacidad es de la plataforma. Dar de alta un dominio para el
 * panel solo termina bien si el backend puede registrarlo en el proyecto del
 * panel en el borde, y eso depende de una variable de entorno que el panel no
 * puede ver. Por eso pregunta en vez de suponer.
 */
export const getDomains = async () => {
  const response = await api.get('/tenants/me/domains')

  return {
    domains: unwrap(response) || [],
    // Falso mientras el backend no lo diga: ante la duda no se ofrece un alta
    // que quizás no se pueda completar.
    capabilities: response?.data?.capabilities || { adminDomain: false },
  }
}

/**
 * @param {string} hostname
 * @param {'storefront'|'admin'} [surface] para qué sirve ese hostname. Sin
 *   esto el backend asume tienda, que es lo que pide casi toda alta.
 */
export const addDomain = async (hostname, surface) => {
  const response = await api.post('/tenants/me/domains', {
    hostname,
    ...(surface ? { surface } : {}),
  })
  return unwrap(response)
}

/**
 * El hostname va en el cuerpo y no en la ruta: un dominio con puntos en un
 * parámetro de path obliga a encodear y se rompe con facilidad.
 */
export const verifyDomain = async hostname => {
  const response = await api.post('/tenants/me/domains/verify', { hostname })
  return unwrap(response)
}

export const deleteDomain = async hostname => {
  const response = await api.delete('/tenants/me/domains', {
    data: { hostname },
  })
  return unwrap(response)
}

export default {
  getDomains,
  addDomain,
  verifyDomain,
  deleteDomain,
}
