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
export const isEdgeProvisioningEnabled = (surface = SUPERFICIE.TIENDA) =>
  Boolean(limpio(process.env.VERCEL_TOKEN) && proyectoDe(surface))

/**
 * En qué proyecto del borde vive cada superficie.
 *
 * LA TIENDA Y EL PANEL SON DOS PROYECTOS DISTINTOS
 *
 * Un hostname sirve UNA aplicación. Dar de alta `admin.sutienda.com` en el
 * proyecto del storefront lo dejaría sirviendo la tienda: el comercio apunta
 * su DNS, ve que "funciona", y lo que carga es su propia tienda otra vez. Un
 * fallo así no se lee como un error de configuración — se lee como que HENKO
 * no anda.
 *
 * Sin VERCEL_ADMIN_PROJECT_ID el alta de un dominio de panel queda sin hacer y
 * se informa como pendiente, igual que cuando falta el token. No cae al
 * proyecto de la tienda: es preferible un paso manual a un alta silenciosa en
 * el lugar equivocado.
 */
export const SUPERFICIE = Object.freeze({
  TIENDA: 'storefront',
  PANEL: 'admin',
})

const proyectoDe = surface =>
  surface === SUPERFICIE.PANEL
    ? limpio(process.env.VERCEL_ADMIN_PROJECT_ID)
    : limpio(process.env.VERCEL_PROJECT_ID)

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
 * Los registros que el BORDE pide, además de los nuestros.
 *
 * POR QUÉ HAY UNA SEGUNDA VERIFICACIÓN
 *
 * Nuestro TXT prueba que el dominio es del comercio. Eso no le dice nada al
 * borde: si ese hostname ya está dado de alta en OTRA cuenta del proveedor —una
 * landing vieja, un sitio anterior del mismo comercio— exige su propia prueba
 * antes de servirlo. Es razonable: dos cuentas distintas reclamando el mismo
 * nombre.
 *
 * Descartarlo es el peor de los casos: el comercio ve "verificado" en HENKO y
 * su tienda no funciona, porque el borde sigue esperando un registro que nadie
 * le pidió. El dato ya viene en la respuesta del alta; lo único que faltaba era
 * no tirarlo.
 */
const extraerVerificacionPendiente = cuerpo => {
  const lista = Array.isArray(cuerpo?.verification) ? cuerpo.verification : []

  return lista
    .filter(item => item?.type && item?.domain)
    .map(item => ({
      type: String(item.type).toUpperCase(),
      name: item.domain,
      value: item.value ?? null,
      motivo: item.reason || null,
    }))
}

/**
 * Registra el dominio en el proyecto de la tienda.
 *
 * Devuelve siempre un objeto con `ok`; no lanza. El alta del dominio ya pasó su
 * parte importante —la verificación de propiedad— y un fallo del proveedor no
 * debe deshacerla ni dejar al comercio con un error que no puede resolver.
 */
export const registrarDominioEnBorde = async (
  hostname,
  { surface = SUPERFICIE.TIENDA } = {},
) => {
  if (!isEdgeProvisioningEnabled(surface)) {
    return {
      ok: false,
      motivo:
        surface === SUPERFICIE.PANEL && limpio(process.env.VERCEL_TOKEN)
          ? 'sin_proyecto_de_panel'
          : 'sin_credenciales',
    }
  }

  const proyecto = encodeURIComponent(proyectoDe(surface))

  const { ok, status, cuerpo } = await pedir(`/v10/projects/${proyecto}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: hostname }),
  })

  if (ok) {
    const pendiente = extraerVerificacionPendiente(cuerpo)

    if (pendiente.length) {
      logger.warn('[BORDE] El dominio quedó registrado pero el borde pide su propia verificación', {
        hostname,
        registros: pendiente.map(r => r.name),
      })
    } else {
      logger.info('[BORDE] Dominio registrado', { hostname })
    }

    return { ok: true, yaExistia: false, verificacionPendiente: pendiente }
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
export const quitarDominioDelBorde = async (
  hostname,
  { surface = SUPERFICIE.TIENDA } = {},
) => {
  if (!isEdgeProvisioningEnabled(surface)) {
    return { ok: false, motivo: 'sin_credenciales' }
  }

  const proyecto = encodeURIComponent(proyectoDe(surface))

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
  SUPERFICIE,
  registrarDominioEnBorde,
  quitarDominioDelBorde,
  obtenerDestinoDelBorde,
  isEdgeProvisioningEnabled,
}
