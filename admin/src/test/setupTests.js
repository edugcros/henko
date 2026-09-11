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
