// Qué contesta el health check, que es lo que decide si un deploy sale vivo.
//
// Antes devolvía 200 fijo. Eso convierte al health check de Render en un sello
// de goma: un proceso que arrancó pero nunca pudo llegar a Mongo pasaba como
// sano y se quedaba sirviendo 500 con el aval del panel.
//
// Lo que se mide acá es la regla, que no es obvia y por eso vale fijarla:
// `listo` es "se conectó alguna vez", NO "está conectado ahora". Si siguiera el
// estado actual, un parpadeo de Mongo haría que Render reinicie la instancia, y
// reiniciar no acerca la base — solo suma arranques en frío arriba de la caída.

import { jest } from '@jest/globals'

const estadoDeBase = jest.fn()

jest.unstable_mockModule('../../config/connectDB.js', () => ({
  default: jest.fn(),
  closeDB: jest.fn(),
  estadoDeBase,
}))

const { default: request } = await import('supertest')
const { default: app } = await import('../../app.js')

describe('health check', () => {
  test('503 mientras nunca se haya podido conectar a la base', async () => {
    estadoDeBase.mockReturnValue({
      listo: false,
      conexion: 'conectando',
      readyState: 2,
    })

    const res = await request(app).get('/health')

    expect(res.status).toBe(503)
    expect(res.body.success).toBe(false)
    expect(res.body.db.conexion).toBe('conectando')
  })

  test('200 una vez que se conectó', async () => {
    estadoDeBase.mockReturnValue({
      listo: true,
      conexion: 'conectado',
      readyState: 1,
    })

    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('sigue vivo si pierde la base después de haber conectado — reiniciar no la traería de vuelta', async () => {
    estadoDeBase.mockReturnValue({
      listo: true,
      conexion: 'desconectado',
      readyState: 0,
    })

    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    // Pero lo dice, para quien esté mirando desde afuera.
    expect(res.body.db.conexion).toBe('desconectado')
  })

  test('las dos rutas contestan lo mismo — son el mismo manejador', async () => {
    estadoDeBase.mockReturnValue({
      listo: true,
      conexion: 'conectado',
      readyState: 1,
    })

    const directa = await request(app).get('/health')
    const conPrefijo = await request(app).get('/api/health')

    expect(conPrefijo.status).toBe(directa.status)
    expect(conPrefijo.body.db).toEqual(directa.body.db)
  })
})
