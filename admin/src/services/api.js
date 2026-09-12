// 📁 src/services/api.js
//
// Las métricas del tablero. Nada más.
//
// QUÉ HABÍA ACÁ
//
// Cinco "APIs" agrupadas por tema —userAPI, tenantAPI, productAPI, orderAPI y
// analyticsAPI— más un objeto por defecto con alias "para compatibilidad con
// código viejo". De todo eso, el panel importaba exactamente una función:
// analyticsAPI.getDashboard, desde Dashboard.js. El resto no lo llamaba nadie:
// el login vive en el slice de usuario, los productos en productSlice, las
// órdenes en orderSlice.
//
// No era código muerto inofensivo. Tres de esas rutas NO EXISTEN en el backend
// —GET /user/profile, GET /tenants/current y GET /order/:id— así que cualquiera
// que hubiera "reusado" el helper se habría comido un 404 con un nombre de
// función que prometía lo contrario. Y el setApiStore de este archivo duplicaba
// en nombre al de utils/axiosConfig, que es el que el arranque usa de verdad.

import api from '@utils/axiosConfig'

export const analyticsAPI = {
  getDashboard: params =>
    api.get('/dash/stats', {
      params,
    }),
}

export default { analytics: analyticsAPI }
