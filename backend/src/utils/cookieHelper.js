// backend/src/utils/cookieHelper.js

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
  process.env.AUTH_COOKIE_PARTITIONED !== 'false' &&
  String(sameSite).toLowerCase() === 'none'
