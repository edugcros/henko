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

  // Los assets y el CSS ya están mapeados arriba; el resto pasa por babel-jest,
  // que toma babel.config.cjs.
  transform: {
    '^.+\\.(js|jsx)$': ['babel-jest', { rootMode: 'upward-optional' }],
  },

  clearMocks: true,
}
