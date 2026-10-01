// 📁 jest.env.js
//
// Variables mínimas para que las pruebas puedan arrancar en un checkout limpio.
//
// POR QUE EXISTE ESTE ARCHIVO
//
// `config/env.js` valida al importarse: si falta PORT, JWT_SECRET,
// REFRESH_TOKEN_SECRET o MONGODB_URL, tira una excepción en el momento del
// import. Cualquier suite que importe `app.js` moría ahí antes de correr una
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
// POR QUE CARGA DOTENV ACA, SI YA LO HACE env.js
//
// Por el orden. `dotenv` no sobreescribe lo que ya está en `process.env`, y este
// archivo corre ANTES que env.js. Si acá se asignara a secas, el valor de
// juguete le ganaría al `.env.development` del desarrollador en vez de rellenar
// lo que falta — y en el caso de Mongo eso no es cosmético: `resolveTestDbUri`
// cae a MONGODB_URL cuando no hay MONGODB_TEST_URI, así que un valor inventado
// acá le mandaría las pruebas a un servidor que no es el suyo.
//
// Cargando primero el mismo archivo que cargará env.js, el `??=` de abajo
// vuelve a significar lo que dice: rellenar huecos y nada más.

import { existsSync } from 'node:fs'
import path from 'node:path'

import dotenv from 'dotenv'

// El mismo archivo que elige `config/env.js` para todo lo que no es producción.
// En CI no existe y `existsSync` lo saltea sin ruido.
const envFile = path.resolve(process.cwd(), '.env.development')

if (existsSync(envFile)) {
  dotenv.config({ path: envFile })
}

process.env.NODE_ENV ??= 'test'
process.env.PORT ??= '5000'

// NO SON SECRETOS: valores de juguete, deliberadamente evidentes. Los tokens que
// firman y verifican las pruebas viven y mueren dentro de la misma corrida.
process.env.JWT_SECRET ??= 'test-jwt-secret-no-usar-fuera-de-pruebas'
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-no-usar-fuera-de-pruebas'

// Para la validación de `env.js`, que exige una de las dos. Las 26 suites que
// necesitan base levantan su propio `MongoMemoryServer` y no usan esta URI.
process.env.MONGODB_URL ??= 'mongodb://127.0.0.1:27017/henko'

// `createSubscriptionClient` rechaza la credencial de plataforma si no tiene
// forma de token de Mercado Pago —tiene que empezar en `TEST-` o `APP_USR-`— y
// tira MP_ACCESS_TOKEN_INVALID antes de intentar cualquier llamada. Sin esto,
// `subscriptionClient.test.js` falla en el chequeo de formato y nunca llega a
// probar lo que quiere probar, que es qué métodos expone el cliente.
//
// NO ES UNA CREDENCIAL: es un literal con forma válida y valor evidentemente
// falso. Ninguna prueba sale a la red con esto.
process.env.MP_ACCESS_TOKEN ??= 'TEST-0000000000000000-000000-0000000000000000000000000000000-000000000'

// Las 7 suites que pasan por `src/test/testDB.js` sí conectan a un mongod real
// (no a uno en memoria), y de ahí derivan el nombre de base agregándole `-test`.
// En CI lo provee el service container del workflow; en una máquina sin Mongo
// local esas 7 fallan, y es lo esperable: piden una base de verdad.
process.env.MONGODB_TEST_URI ??= process.env.MONGODB_URL
