// 📁 src/utils/metaPixel.js
//
// Envoltorio del Meta Pixel del navegador. website/public/index.html es un
// build único compartido por todos los tenants (ver TenantContext.js), así
// que el pixel no puede ir hardcodeado ahí — se inyecta acá recién cuando se
// conoce el pixelId del tenant activo (TenantContext.js llama a
// initMetaPixel una sola vez por carga).
//
// Todo lo demás son no-ops seguros si el pixel nunca se inicializó (tenant
// sin Meta Pixel configurado): así los call-sites (ProductCard, Cart,
// CheckoutPage) no necesitan un `if` propio en cada evento.

let initializedPixelId = null

const isBrowser = typeof window !== 'undefined'

export const initMetaPixel = pixelId => {
  if (!isBrowser || !pixelId) return
  if (initializedPixelId === pixelId) return

  if (typeof window.fbq !== 'function') {
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js')
    /* eslint-enable */
  }

  window.fbq('init', pixelId)
  initializedPixelId = pixelId

  // El primer PageView lo dispara App.js (mismo efecto que ya escucha cada
  // cambio de ruta) para que haya una sola fuente de verdad — si initMetaPixel
  // lo mandara también acá, la carga inicial contaría el PageView dos veces.
}

export const isMetaPixelReady = () =>
  isBrowser && Boolean(initializedPixelId) && typeof window.fbq === 'function'

/**
 * @param {string} eventName  Nombre estándar de Meta (PageView, ViewContent,
 *   AddToCart, InitiateCheckout, Purchase, ...).
 * @param {object} [params]  custom_data del evento.
 * @param {string} [eventId]  Compartido con el evento server-side
 *   equivalente (Conversions API) para que Meta deduplique en vez de contar
 *   la misma acción dos veces. Ver backend/src/services/meta/metaCapiService.js.
 */
export const trackMetaEvent = (eventName, params = {}, eventId = null) => {
  if (!isMetaPixelReady()) return

  try {
    if (eventId) {
      window.fbq('track', eventName, params, { eventID: eventId })
    } else {
      window.fbq('track', eventName, params)
    }
  } catch {
    // El pixel no debe romper la UX de compra.
  }
}

export default { initMetaPixel, isMetaPixelReady, trackMetaEvent }
