// Todas las pantallas tienen que poder cargarse.
//
// POR QUÉ EXISTE
//
// Una edición dejó JSX desbalanceado en CheckoutPage. El build de Vercel falló
// con un SyntaxError de Babel; la suite del panel pasó igual, verde, 34 de 34.
// Ninguna prueba importaba esa pantalla, así que nada la miraba.
//
// El comentario de jest.config.js dice que este archivo de configuración nació
// porque "webpack no ejecuta componentes, así que un build verde no dice nada
// sobre si la página abre". Esto es el reverso: los tests tampoco dicen nada
// sobre una página que ninguno importa.
//
// Este test no verifica que una pantalla funcione — para eso están los tests de
// cada una. Verifica lo mínimo: que el archivo parsee y que sus imports existan.
// Es barato, cubre todas a la vez, y cubre las que se agreguen mañana sin que
// nadie se acuerde de sumarlas acá.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Varias pantallas leen la configuración al importarse y abortan sin esto.
process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'
process.env.REACT_APP_NODE_ENV = 'test'

const directorio = path.dirname(fileURLToPath(import.meta.url))

const pantallas = fs
  .readdirSync(directorio)
  .filter(archivo => /\.(js|jsx)$/.test(archivo))
  .filter(archivo => !/\.test\.(js|jsx)$/.test(archivo))
  .filter(archivo => archivo !== 'index.js')
  .sort()

describe('pantallas del panel', () => {
  test('hay pantallas que revisar', () => {
    // Si un cambio de estructura vacía la lista, este test dejaría de proteger
    // nada mientras sigue en verde.
    expect(pantallas.length).toBeGreaterThan(10)
  })

  test.each(pantallas)('%s se puede importar', async archivo => {
    const modulo = await import(`./${archivo}`)

    // Una pantalla sin export default no la puede montar el router.
    expect(modulo.default).toBeDefined()
  })
})
