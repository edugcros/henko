// 📁 jest.env.js
//
// Entorno de las pruebas, cargado antes del grafo de módulos de cada suite.
//
// POR QUE EXISTE ESTE ARCHIVO
//
// `jest.config.js` lo venía declarando en `setupFiles` desde siempre, pero el
// archivo no estaba en el repo. Jest no lo trata como opcional: valida los
// setupFiles antes de correr nada y aborta la corrida entera con
//
//   Validation Error: Module <rootDir>/jest.env.js in the setupFiles option
//   was not found.
//
// O sea que `npm test` en la tienda nunca llegó a ejecutar una prueba. Sumado a
// que el script traía `--watchAll` —que no termina— la suite no corría ni a
// mano ni en CI.

import { TextDecoder, TextEncoder } from 'node:util'

// jsdom no trae TextEncoder/TextDecoder, y react-router 7 los usa al importarse
// (react-router/dist/development/index.js). Sin esto la suite muere en el
// `import` de react-router-dom con "ReferenceError: TextEncoder is not
// defined", antes de cualquier assert. Node los tiene desde la 11; el hueco es
// de jsdom, así que se los pasamos.
//
// Va en setupFiles y no en setupFilesAfterEach porque tiene que estar antes de
// que se evalúen los módulos de la suite, no antes de cada prueba.
global.TextEncoder ??= TextEncoder
global.TextDecoder ??= TextDecoder

process.env.NODE_ENV ??= 'test'

// `src/Utils/axiosConfig.js` llama a `assertApiBaseUrl()` al importarse y tira
// si no hay REACT_APP_API_BASE_URL. Como media app termina importando axios por
// la cadena de slices, sin esto cualquier suite que toque un componente con
// rutas muere en el import. El valor no se usa para pedir nada: las pruebas no
// salen a la red.
//
// Es la única REACT_APP_* obligatoria fuera de producción. Las demás que lee
// `src/config/env.js` son opcionales, o solo se validan si están presentes
// (REACT_APP_MP_PUBLIC_KEY valida formato, no presencia), así que no se fijan
// acá: una prueba que dependa de alguna la declara ella misma, para que se lea
// en la prueba de qué depende.
process.env.REACT_APP_API_BASE_URL ??= 'http://localhost:5000/api'
