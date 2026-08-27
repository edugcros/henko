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
