// 📁 jest.env.js
//
// Variables mínimas para que las pruebas puedan arrancar en un checkout limpio.
//
// POR QUE EXISTE ESTE ARCHIVO
//
// `config/env.js` valida al importarse: si falta PORT, JWT_SECRET,
// REFRESH_TOKEN_SECRET o MONGODB_URL, tira una excepción en el momento del
// import. Cualquier suite que importe `app.js` muere ahí antes de correr una
// sola prueba — eran 45 de 68 suites y 168 pruebas, todas por este motivo.
//
// Y esas variables salían de `.env.development`, que está en `.gitignore`. O
// sea: la suite solo corría en una máquina que ya tuviera ese archivo. En CI,
// o en un clon recién hecho, no había forma. `src/test/testSetup.js` lo dice
// sin querer en un comentario: ".env.development trae cargada la key de prueba
// de Cloudflare".
//
// Jest carga este archivo (setupFiles en package.json) antes del grafo de
// módulos de cada suite, que es la única ventana posible: después del import de
// env.js ya es tarde.
//
// POR QUE `??=` Y NO ASIGNACION DIRECTA
//
// Para no cambiarle el entorno a quien ya tiene `.env.development`. Si la
// variable viene de afuera, gana la de afuera; estos valores solo rellenan lo
// que falta. `dotenv` tampoco sobreescribe lo que ya está en process.env, así
// que el orden queda consistente en los dos sentidos.
//
// NO SON SECRETOS: son valores de juguete, deliberadamente evidentes. Los
// tokens que firman y verifican las pruebas viven y mueren dentro de la misma
// corrida.

process.env.NODE_ENV ??= 'test'
process.env.PORT ??= '5000'

process.env.JWT_SECRET ??= 'test-jwt-secret-no-usar-fuera-de-pruebas'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-no-usar-fuera-de-pruebas'

// Ninguna prueba se conecta a esta URI: las que necesitan base levantan su
// propio `MongoMemoryServer` en un beforeAll y conectan mongoose a mano. Esto
// está solo para que la validación de `env.js` no tire al importarse.
process.env.MONGODB_URL ??= 'mongodb://127.0.0.1:27017/henko-test'
