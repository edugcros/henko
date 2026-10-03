// backend/src/utils/cookieHelper.js
import { env } from '../../config/env.js'
import { esHostDePanelDePlataforma } from './domainUtils.js'

// Único lugar que decide el scope de dominio de las cookies de sesión
// (token/refreshToken/_csrf) — antes había una segunda implementación
// duplicada en csrfMiddleware.js que divergía de esta para dominios
// custom de tenant (una caía a .parentdomain, la otra a host-only).
//
// Siempre host-only (sin Domain) a propósito: si se scopea al dominio
// raíz compartido (.henkoapp.com), admin.tenant.henkoapp.com y
// shop.tenant.henkoapp.com terminan compartiendo la MISMA cookie en el
// mismo navegador — la sesión más reciente pisa a la anterior. Admin y
// storefront son dos flujos de login independientes (potencialmente
// personas distintas en el mismo dispositivo) y no tienen que compartir
// cookie jar entre sí. El aislamiento entre tenants no depende de esto
// de todos modos: lo hace el claim tenantId del JWT, validado en cada
// request server-side.
export const getCookieDomain = () => undefined

/**
 * ¿Esta cookie viaja con `Partitioned` (CHIPS)?
 *
 * VIVÍA EN userCtrl Y csrfMiddleware NO LA USABA — MISMO FALLO QUE EL DE ARRIBA
 *
 * El comentario de este archivo cuenta que el scope de dominio tenía dos
 * implementaciones que divergían, una en cada archivo. La regla de partición
 * repitió el patrón: `sendAuthCookies` en userCtrl marcaba `partitioned` en
 * token y refreshToken, y `setSignedSecretCookie` en csrfMiddleware no lo
 * hacía en `_csrf`.
 *
 * Comprobado en producción con AUTH_COOKIE_PARTITIONED=true ya desplegado:
 *
 *   Set-Cookie: _csrf=…; HttpOnly; Secure; SameSite=None      ← sin Partitioned
 *
 * QUÉ ROMPE
 *
 * En un comercio con dominio propio —la tienda en su dominio pidiéndole a
 * api.henkart.com.ar— Chrome bloquea las cookies de terceros que no estén
 * particionadas. Con esta asimetría, la sesión SOBREVIVE y el secreto de CSRF
 * NO: el comprador queda logueado y ningún POST le pasa. Un carrito que no
 * puede comprar, sin ningún error que lo explique.
 *
 * Solo tiene sentido con SameSite=None: una cookie same-site no necesita
 * partición. Y se apaga con AUTH_COOKIE_PARTITIONED='false' exacto — el
 * default es encendido, para que olvidarse no deje sesiones rotas.
 */
export const usePartitionedCookies = sameSite =>
  process.env.AUTH_COOKIE_PARTITIONED !== 'false' && String(sameSite).toLowerCase() === 'none'

/**
 * El nombre de las cookies de sesión, que depende de QUÉ APP las usa.
 *
 * POR QUÉ HOST-ONLY NO ALCANZABA
 *
 * El comentario de arriba tiene razón en el objetivo —panel y tienda son dos
 * logins independientes y no tienen que compartir cookie jar— pero host-only
 * no lo consigue en esta arquitectura, y eso costó un error reportado: al
 * entrar a la tienda con un cliente, el panel empezaba a devolver 403.
 *
 * Host-only scopea la cookie al host que la EMITE, y quien la emite es la API.
 * Las dos apps le pegan a la misma API, así que las dos reciben y mandan la
 * misma cookie. Comprobado contra producción:
 *
 *   Set-Cookie: _csrf=…; Path=/; HttpOnly; Secure; Partitioned; SameSite=None
 *
 * Sin atributo Domain —host-only, api.henkart.com.ar— y con Partitioned. Y
 * Partitioned tampoco las separa: CHIPS indexa por SITIO de nivel superior, o
 * sea el dominio registrable, y tanto admin.henkart.com.ar como
 * henkart.com.ar registran bajo henkart.com.ar. Misma partición, mismo host
 * emisor, mismo nombre: un solo casillero. El último login pisa al anterior.
 *
 * Separar por NOMBRE sí funciona, porque es lo único de los tres que podemos
 * elegir por request.
 *
 * POR QUÉ LA TIENDA CONSERVA LOS NOMBRES VIEJOS
 *
 * Cambiar un nombre invalida las sesiones que lo usaban. Los compradores son
 * muchos más que los administradores, así que el nombre nuevo va del lado del
 * panel: el costo es que cada admin vuelva a entrar una vez, en lugar de
 * desloguear a todos los clientes de todas las tiendas.
 *
 * CÓMO SE DECIDE LA SUPERFICIE
 *
 * Primero lo que ya resolvió `tenantMiddleware`, que es lo más preciso y cubre
 * los dominios de panel propios de cada comercio. Pero ese middleware se monta
 * por ruta y hay rutas autenticadas que no lo tienen, así que hace falta un
 * respaldo que esté siempre: el Origin, que lo pone el navegador y el
 * JavaScript de la página no puede falsear.
 *
 * Un dominio con contexto 'both' —una sola URL que sirve tienda y panel—
 * queda deliberadamente del lado de la tienda: ahí es un único origen con un
 * único cookie jar y no hay nada que separar. Es el comportamiento que ya
 * tenía, así que no cambia para nadie.
 *
 * Elegir el nombre no otorga permisos: la identidad la da el JWT y el rol lo
 * sigue verificando quien corresponda.
 */
export const SESSION_COOKIE_NAMES = {
  storefront: { access: 'token', refresh: 'refreshToken' },
  admin: { access: 'admin_token', refresh: 'admin_refreshToken' },
}

const hostDelOrigen = req => {
  const crudo = req?.headers?.origin || req?.headers?.referer || ''

  if (!crudo) return ''

  try {
    return new URL(crudo).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export const getSessionCookieNames = req => {
  if (req?.isAdminContext === true && req?.isShopContext !== true) {
    return SESSION_COOKIE_NAMES.admin
  }

  const esPanel = esHostDePanelDePlataforma(
    hostDelOrigen(req),
    env.tenantAdminBaseDomain || env.adminBaseDomain,
  )

  return esPanel ? SESSION_COOKIE_NAMES.admin : SESSION_COOKIE_NAMES.storefront
}
