// Configuración de tests del panel.
//
// El panel tenía las herramientas instaladas y cero tests. Este archivo existe
// porque esa ausencia dejó pasar a producción una pantalla que compilaba y
// rompía al renderizar: webpack no ejecuta componentes, así que un build verde
// no dice nada sobre si la página abre.
//
// Los aliases (@utils, @features, …) los resuelve babel con module-resolver,
// que ya los tiene bien escritos en babel.config.cjs — no hace falta
// repetirlos acá.

export default {
  testEnvironment: 'jsdom',

  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|webp|svg|ico)$': '<rootDir>/src/test/fileMock.cjs',
  },

  testMatch: ['<rootDir>/src/**/*.test.js', '<rootDir>/src/**/*.test.jsx'],

  // package.json declara "type": "module", lo que vuelve ESM a los .js — pero
  // ese campo no dice nada de los .jsx, así que Jest los trataba como CommonJS
  // y el default de una página .jsx llegaba envuelto dos veces
  // ({ default: { default: Componente } }). El síntoma es opaco: React tira
  // "Element type is invalid... but got: object" señalando al render, no al
  // import. Vale para todas las páginas .jsx, no solo la que lo destapó.
  extensionsToTreatAsEsm: ['.jsx'],

  // @testing-library/jest-dom ya estaba instalado y sin enganchar, así que el
  // primer test tuvo que afirmar con toBeDefined(): getByText ya lanza si no
  // encuentra, con lo cual esa aserción no agrega nada y el mensaje de error
  // que queda es peor. Con esto vuelven a estar disponibles toBeInTheDocument y
  // el resto de los matchers de DOM.
  setupFilesAfterEnv: ['@testing-library/jest-dom'],

  // Los assets y el CSS ya están mapeados arriba; el resto pasa por babel-jest,
  // que toma babel.config.cjs.
  transform: {
    '^.+\\.(js|jsx)$': ['babel-jest', { rootMode: 'upward-optional' }],
  },

  clearMocks: true,
}
