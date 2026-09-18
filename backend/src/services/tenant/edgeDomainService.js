// 📁 src/services/tenant/edgeDomainService.js
//
// Dar de alta el dominio de un comercio en el borde que sirve la tienda.
//
// POR QUÉ HACE FALTA UN PASO MÁS DESPUÉS DE VERIFICAR
//
// Verificar prueba que el dominio es del comercio. No alcanza: mientras el
// borde no lo conozca, una petición a ese hostname llega sin que nadie sepa qué
// servir, y no hay certificado que presentar. Son dos cosas distintas —quién es
// el dueño y quién lo atiende— y hasta ahora solo se hacía la primera.
//
// EL DESTINO DEL CNAME ESTABA MAL
//
// Las instrucciones mandaban al comercio a apuntar su dominio a env.apiDomain,
// que es el BACKEND. Un dominio apuntado ahí recibe la API, no la tienda. Se
// informa desde PLATFORM_EDGE_CNAME, que es el borde real del storefront.

import logger from '../../../config/logger.js'

const API = 'https://api.vercel.com'

const limpio = valor => String(valor || '').trim()

/**
 * ¿Está configurado el alta automática en el borde?
 *
 * Sin credenciales no se rompe nada: el dominio queda verificado y el comercio
 * ve que falta un paso. Acoplar la verificación a un token del dashboard haría
 * que un secreto sin cargar bloqueara el alta entera.
 */
export const isEdgeProvisioningEnabled = () =>
  Boolean(limpio(process.env.VERCEL_TOKEN) && limpio(process.env.VERCEL_PROJECT_ID))

const construirUrl = ruta => {
  const equipo = limpio(process.env.VERCEL_TEAM_ID)

  return equipo ? `${API}${ruta}?teamId=${encodeURIComponent(equipo)}` : `${API}${ruta}`
}

const pedir = async (ruta, opciones = {}) => {
  const respuesta = await fetch(construirUrl(ruta), {
    ...opciones,
    headers: {
      Authorization: `Bearer ${limpio(process.env.VERCEL_TOKEN)}`,
      'Content-Type': 'application/json',
      ...(opciones.headers || {}),
    },
  })

  const cuerpo = await respuesta.json().catch(() => ({}))

  return { ok: respuesta.ok, status: respuesta.status, cuerpo }
}

/**
 * Registra el dominio en el proyecto de la tienda.
 *
 * Devuelve siempre un objeto con `ok`; no lanza. El alta del dominio ya pasó su
 * parte importante —la verificación de propiedad— y un fallo del proveedor no
 * debe deshacerla ni dejar al comercio con un error que no puede resolver.
 */
export const registrarDominioEnBorde = async hostname => {
  if (!isEdgeProvisioningEnabled()) {
    return { ok: false, motivo: 'sin_credenciales' }
  }

  const proyecto = encodeURIComponent(limpio(process.env.VERCEL_PROJECT_ID))

  const { ok, status, cuerpo } = await pedir(`/v10/projects/${proyecto}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: hostname }),
  })

  if (ok) {
    logger.info('[BORDE] Dominio registrado', { hostname })
    return { ok: true, yaExistia: false }
  }

  // Que ya esté dado de alta es el resultado deseado, no un error: pasa al
  // reintentar una verificación, y tratarlo como fallo dejaría al comercio
  // viendo un error sobre algo que ya está bien.
  if (cuerpo?.error?.code === 'domain_already_in_use' || status === 409) {
    logger.info('[BORDE] El dominio ya estaba registrado', { hostname })
    return { ok: true, yaExistia: true }
  }

  logger.error('[BORDE] No se pudo registrar el dominio', {
    hostname,
    status,
    code: cuerpo?.error?.code || null,
    message: cuerpo?.error?.message || null,
  })

  return {
    ok: false,
    motivo: cuerpo?.error?.code || `http_${status}`,
    mensaje: cuerpo?.error?.message || null,
  }
}

/** Baja del dominio en el borde, para cuando el comercio lo quita. */
export const quitarDominioDelBorde = async hostname => {
  if (!isEdgeProvisioningEnabled()) {
    return { ok: false, motivo: 'sin_credenciales' }
  }

  const proyecto = encodeURIComponent(limpio(process.env.VERCEL_PROJECT_ID))

  const { ok, status, cuerpo } = await pedir(
    `/v9/projects/${proyecto}/domains/${encodeURIComponent(hostname)}`,
    { method: 'DELETE' },
  )

  // 404 es éxito: el objetivo era que no estuviera.
  if (ok || status === 404) return { ok: true }

  logger.warn('[BORDE] No se pudo quitar el dominio', {
    hostname,
    status,
    code: cuerpo?.error?.code || null,
  })

  return { ok: false, motivo: cuerpo?.error?.code || `http_${status}` }
}

/**
 * A dónde tiene que apuntar el comercio su CNAME.
 *
 * Sale de PLATFORM_EDGE_CNAME y NO de apiDomain: apuntar al backend fue el bug
 * que esto corrige. Sin la variable devuelve null, y el panel muestra el paso
 * como pendiente en vez de dar una instrucción equivocada — que es peor que no
 * dar ninguna.
 */
export const obtenerDestinoDelBorde = () =>
  limpio(process.env.PLATFORM_EDGE_CNAME) || null

export default {
  registrarDominioEnBorde,
  quitarDominioDelBorde,
  obtenerDestinoDelBorde,
  isEdgeProvisioningEnabled,
}
