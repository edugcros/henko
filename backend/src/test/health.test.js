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

// Antes de importar app.js: `config/env.js` lee process.env al importarse, y
// app.js lo importa. Puesto después, el endpoint de trabajos arrancaría sin
// secreto y contestaría 503 a todo.
process.env.JOBS_TRIGGER_SECRET = 'secreto-de-prueba-para-los-trabajos'

const estadoDeBase = jest.fn()

jest.unstable_mockModule('../../config/connectDB.js', () => ({
  default: jest.fn(),
  closeDB: jest.fn(),
  estadoDeBase,
}))

// Se simula UN trabajo para poder ejercitar el camino entero —registro,
// ejecución, respuesta— sin salir a la base ni a Mercado Pago. Los otros
// siete se importan de verdad pero no se llaman.
const runPriceHistoryAudit = jest.fn()

jest.unstable_mockModule('../services/pricing/priceHistoryAuditService.js', () => ({
  runPriceHistoryAudit,
  startPriceHistoryAudit: jest.fn(),
  stopPriceHistoryAudit: jest.fn(),
  auditPriceHistory: jest.fn(),
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

// =====================================================
// Disparador externo de los trabajos periódicos
// =====================================================
//
// EL PROBLEMA QUE RESUELVE
//
// Los ocho trabajos se programan con `setInterval` dentro del proceso web. En
// un plan que duerme el servicio por inactividad, un temporizador dormido no
// alcanza su intervalo nunca, y cada despertar reinicia la cuenta: un trabajo
// diario podía pasar semanas sin correr una vez entera. Y no había ninguna
// forma de ejecutarlos desde afuera.
//
// Lo que se fija acá es el contrato de esa puerta, que es lo que un cron
// externo va a depender: cómo autentica, qué contesta cuando el trabajo no
// existe, y qué pasa si una pasada se solapa con la anterior.

const SECRETO = 'secreto-de-prueba-para-los-trabajos'
const RUTA = '/api/internal/jobs/historial-de-precios'

describe('disparador de trabajos periódicos', () => {
  beforeEach(() => {
    runPriceHistoryAudit.mockReset()
    runPriceHistoryAudit.mockResolvedValue({ balanced: true, chains: 3 })
  })

  test('sin el secreto no ejecuta nada', async () => {
    const res = await request(app).post(RUTA)

    expect(res.status).toBe(401)
    expect(runPriceHistoryAudit).not.toHaveBeenCalled()
  })

  test('con el secreto equivocado tampoco', async () => {
    const res = await request(app).post(RUTA).set('x-jobs-secret', 'otro')

    expect(res.status).toBe(401)
    expect(runPriceHistoryAudit).not.toHaveBeenCalled()
  })

  test('con el secreto correcto ejecuta y devuelve el resultado', async () => {
    const res = await request(app).post(RUTA).set('x-jobs-secret', SECRETO)

    expect(res.status).toBe(200)
    expect(runPriceHistoryAudit).toHaveBeenCalledTimes(1)
    expect(res.body.trabajo).toBe('historial-de-precios')
    expect(res.body.resultado).toEqual({ balanced: true, chains: 3 })
  })

  test('un trabajo que no existe da 404 y dice cuáles hay', async () => {
    const res = await request(app)
      .post('/api/internal/jobs/no-existe')
      .set('x-jobs-secret', SECRETO)

    expect(res.status).toBe(404)
    expect(res.body.disponibles).toContain('ordenes')
    expect(res.body.disponibles).toHaveLength(8)
  })

  test('si ya está corriendo devuelve 409 y NO lo corre dos veces', async () => {
    // Ninguno de los ocho se protege por dentro, y ahora hay dos disparadores
    // posibles: el intervalo y esta ruta. Dos pasadas simultáneas de órdenes
    // consultarían dos veces al proveedor por lo mismo.
    // El simulacro avisa cuando ENTRÓ, en vez de esperar un tick y suponer
    // que llegó: un `setImmediate` no alcanza para que supertest abra el
    // socket y el manejador tome el lugar, y entonces la segunda petición
    // corría primero y la prueba se colgaba 30 segundos.
    const liberadores = []
    let avisarQueEntro
    const entro = new Promise(resolve => {
      avisarQueEntro = resolve
    })

    runPriceHistoryAudit.mockImplementation(() => {
      avisarQueEntro()
      return new Promise(resolve => liberadores.push(resolve))
    })

    // El `.then()` no es decorativo: el objeto de supertest es perezoso y no
    // manda nada hasta que alguien lo encadena. Sin esto la primera petición
    // nunca salía y la prueba esperaba un aviso que no iba a llegar.
    const primera = request(app)
      .post(RUTA)
      .set('x-jobs-secret', SECRETO)
      .then(r => r)

    try {
      await entro

      const segunda = await request(app).post(RUTA).set('x-jobs-secret', SECRETO)

      expect(segunda.status).toBe(409)
      expect(runPriceHistoryAudit).toHaveBeenCalledTimes(1)
    } finally {
      // Se sueltan TODOS, pase lo que pase: una promesa sin resolver deja el
      // trabajo marcado como en curso y las pruebas siguientes reciben 409.
      liberadores.forEach(resolver => resolver({ balanced: true }))
      await primera
    }
  })

  test('si el trabajo falla, contesta 500 diciendo cuál y por qué', async () => {
    runPriceHistoryAudit.mockRejectedValue(new Error('la base no responde'))

    const res = await request(app).post(RUTA).set('x-jobs-secret', SECRETO)

    expect(res.status).toBe(500)
    expect(res.body.trabajo).toBe('historial-de-precios')
    expect(res.body.message).toBe('la base no responde')
  })

  test('después de fallar, el trabajo queda libre para reintentarse', async () => {
    // El `finally` que suelta el lugar: sin él, un fallo dejaba el trabajo
    // marcado como en curso para siempre y toda pasada posterior daba 409.
    runPriceHistoryAudit.mockRejectedValueOnce(new Error('falló'))
    await request(app).post(RUTA).set('x-jobs-secret', SECRETO)

    runPriceHistoryAudit.mockResolvedValue({ balanced: true })
    const res = await request(app).post(RUTA).set('x-jobs-secret', SECRETO)

    expect(res.status).toBe(200)
  })
})
