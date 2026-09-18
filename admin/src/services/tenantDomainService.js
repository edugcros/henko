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

export const getDomains = async () => {
  const response = await api.get('/tenants/me/domains')
  return unwrap(response)
}

export const addDomain = async hostname => {
  const response = await api.post('/tenants/me/domains', { hostname })
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
