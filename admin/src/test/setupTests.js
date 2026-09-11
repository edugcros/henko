// Lo que jsdom no trae y las pantallas del panel sí necesitan.
//
// antd resuelve su grilla con `window.matchMedia`, y jsdom no lo implementa: al
// renderizar cualquier página que use Row/Col, el efecto de useBreakpoint tira
// "window.matchMedia is not a function" y el test falla por el entorno, no por
// el componente. El síntoma engaña bastante — aparece como un error dentro de
// react-dom, lejos del código propio.
//
// Va acá y no en cada archivo de test porque le pasa a toda pantalla de antd,
// que en este panel son casi todas.

import { TextDecoder, TextEncoder } from 'node:util'

// react-router v7 usa TextEncoder al cargarse y jsdom no lo expone, aunque Node
// lo tenga desde hace años en node:util. Sin esto, importar cualquier pantalla
// que use el router falla con "TextEncoder is not defined" desde dentro de
// react-router, que no da ninguna pista de que el problema es el entorno.
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = query => ({
    matches: false,
    media: query,
    onchange: null,
    // Las dos APIs: antd usa addListener en algunas versiones y addEventListener
    // en otras, y una sola dejaría el error para el día que actualicen.
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
