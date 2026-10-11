// Qué puede afirmar un navegador sobre las métricas de un comercio.
//
// El endpoint /api/metrics/events es público a propósito: la tienda tiene que
// poder reportar visitas desde el navegador. Lo que no puede es que un cliente
// se declare a sí mismo como el backend.
//
// EL AGUJERO
//
// Los números económicos no filtran por tipo de evento sino por
// `source: 'system'`. aiAgentRevenueInsightsService suma `$value` de los PURCHASE
// con esa fuente para calcular la facturación atribuida a la IA, y
// aiInsightDetectionService hace lo mismo para sus señales de venta. El
// controlador tomaba `source` del cuerpo y aceptaba 'system'.
//
// O sea que un POST público con
//   { eventType: 'purchase', source: 'system', value: 999999,
//     metadata: { aiInfluenced: true } }
// entraba directo al tablero económico.
//
// LO OTRO
//
// `productId` y `orderId` también los elige el cliente, y nadie comprobaba que
// fueran del comercio que manda el evento.
//
// Va contra una base real: lo que se prueba es una consulta con filtro por
// tenant, que con mocks solo probaría que la escribí como la escribí.

import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { crearMongoEnMemoria } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')

const TENANT = new mongoose.Types.ObjectId()
const OTRO_TENANT = new mongoose.Types.ObjectId()
const PRODUCTO_PROPIO = new mongoose.Types.ObjectId()
const PRODUCTO_AJENO = new mongoose.Types.ObjectId()
const ORDEN_AJENA = new mongoose.Types.ObjectId()

let mongod
let trackUserMetricEvent
let reportClientCrash
let logger
let UserMetricEvent

const respuesta = () => ({
  statusCode: 0,
  body: null,
  status(code) {
    this.statusCode = code
    return this
  },
  json(payload) {
    this.body = payload
    return this
  },
  end() {
    return this
  },
})

const enviar = async evento => {
  const req = {
    tenantId: TENANT,
    headers: { host: 'tienda.test', 'user-agent': 'jest' },
    body: Array.isArray(evento) ? { events: evento } : evento,
    originalUrl: '/api/metrics/events',
    socket: { remoteAddress: '1.2.3.4' },
  }
  const res = respuesta()

  await trackUserMetricEvent(req, res, err => {
    if (err) throw err
  })

  return res
}

const evento = (extra = {}) => ({
  eventType: 'product_view',
  sessionId: 'sesion-1',
  ...extra,
})

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())

  ;({ trackUserMetricEvent, reportClientCrash } = await import('../controller/userMetricsCtrl.js'))
  logger = (await import('../../config/logger.js')).default
  UserMetricEvent = (await import('../models/userMetricEventModel.js')).default

  const db = mongoose.connection.db

  await db.collection('products').insertMany([
    { _id: PRODUCTO_PROPIO, tenantId: TENANT, title: 'Propio' },
    { _id: PRODUCTO_AJENO, tenantId: OTRO_TENANT, title: 'Ajeno' },
  ])
  await db.collection('orders').insertOne({ _id: ORDEN_AJENA, tenantId: OTRO_TENANT })
}, 60_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

afterEach(async () => {
  await UserMetricEvent.collection.deleteMany({})
})

const guardado = () => UserMetricEvent.collection.findOne({})

describe('métricas · fuentes reservadas', () => {
  test("un cliente NO puede declararse 'system'", async () => {
    // El evento que inflaba el tablero económico.
    const res = await enviar(
      evento({
        eventType: 'purchase',
        source: 'system',
        value: 999999,
        metadata: { aiInfluenced: true },
      }),
    )

    expect(res.statusCode).toBe(400)
    expect(await guardado()).toBeNull()
  })

  test("tampoco 'admin', ni escrita de otra forma", async () => {
    for (const source of ['admin', 'SYSTEM', ' System ']) {
      const res = await enviar(evento({ source }))
      expect({ source, status: res.statusCode }).toEqual({ source, status: 400 })
    }
  })

  test("'agent' NO está reservada: la manda el navegador", async () => {
    // AiCartActionBridge marca con ella el agregado al carrito que originó el
    // chat, y markOrderAiInfluenced lo usa para atribuirle la compra a la IA.
    // Reservarla rompería esa atribución entera — es el caso donde la
    // clasificación obvia habría roto una función que anda.
    const res = await enviar(
      evento({
        eventType: 'add_to_cart',
        source: 'agent',
        productId: String(PRODUCTO_PROPIO),
      }),
    )

    expect(res.statusCode).toBe(201)
    expect((await guardado()).source).toBe('agent')
  })

  test('un lote entero se rechaza si UNO de sus eventos la reclama', async () => {
    // Quedarse con el resto sería aceptar un envío que ya se sabe manipulado.
    const res = await enviar([
      evento(),
      evento({ eventType: 'purchase', source: 'system', value: 500000 }),
    ])

    expect(res.statusCode).toBe(400)
    expect(await guardado()).toBeNull()
  })

  test('las fuentes de cliente siguen funcionando', async () => {
    const res = await enviar(evento({ source: 'storefront' }))

    expect(res.statusCode).toBe(201)
    expect((await guardado()).source).toBe('storefront')
  })

  test("una fuente desconocida se guarda como 'unknown', no se rechaza", async () => {
    // No es un intento de suplantación: es un cliente viejo o un typo.
    const res = await enviar(evento({ source: 'algo-raro' }))

    expect(res.statusCode).toBe(201)
    expect((await guardado()).source).toBe('unknown')
  })

  test('la tienda puede seguir reportando su propia compra', async () => {
    // El checkout manda purchase y payment_approved desde el navegador. Eso no
    // se bloquea: queda con fuente 'storefront', que es analítica de cliente y
    // los agregados económicos no la miran.
    const res = await enviar(evento({ eventType: 'purchase', source: 'storefront', value: 1500 }))

    expect(res.statusCode).toBe(201)
    expect((await guardado()).source).toBe('storefront')
  })
})

describe('métricas · referencias de otro comercio', () => {
  test('un producto ajeno no queda vinculado, ni como id ni como texto', async () => {
    const res = await enviar(evento({ productId: String(PRODUCTO_AJENO) }))

    expect(res.statusCode).toBe(201)

    const fila = await guardado()

    // El evento se conserva —la visita ocurrió— pero sin la referencia.
    expect(fila.productId).toBeNull()
    // `productRef` es la copia en texto del mismo id. Dejarla es dejar el id
    // del producto de otro comercio guardado igual.
    expect(fila.productRef).toBeFalsy()
  })

  test('una orden ajena tampoco', async () => {
    const res = await enviar(evento({ eventType: 'purchase', orderId: String(ORDEN_AJENA) }))

    expect(res.statusCode).toBe(201)

    const fila = await guardado()

    expect(fila.orderObjectId).toBeNull()
    // Y el string: el modelo tiene un hook que reconstruye orderObjectId desde
    // orderId cuando el primero viene vacío, así que anular solo el ObjectId lo
    // devuelve intacto antes de guardar.
    expect(fila.orderId).toBeFalsy()
  })

  test('un producto propio sí se vincula', async () => {
    const res = await enviar(evento({ productId: String(PRODUCTO_PROPIO) }))

    expect(res.statusCode).toBe(201)
    expect(String((await guardado()).productId)).toBe(String(PRODUCTO_PROPIO))
  })

  test('un id que no existe se trata como ajeno', async () => {
    const inexistente = new mongoose.Types.ObjectId()

    await enviar(evento({ productId: String(inexistente) }))

    expect((await guardado()).productId).toBeNull()
  })

  test('un lote mezclado conserva lo propio y anula lo ajeno', async () => {
    await enviar([
      evento({ sessionId: 's1', productId: String(PRODUCTO_PROPIO) }),
      evento({ sessionId: 's2', productId: String(PRODUCTO_AJENO) }),
    ])

    const filas = await UserMetricEvent.collection.find({}).toArray()
    const porSesion = Object.fromEntries(
      filas.map(f => [f.sessionId, f.productId ? String(f.productId) : null]),
    )

    expect(porSesion).toEqual({
      s1: String(PRODUCTO_PROPIO),
      s2: null,
    })
  })
})

// ─── Lo que el tablero cuenta como actividad de la tienda ────────────────────
//
// Dos números del dashboard salían mal de acá, y ninguno se ve leyendo el
// código de a una función: hay que mirar qué hay guardado.
//
//  1. El panel de administración también escribe UserMetricEvent —cada login
//     del dueño es uno—, y el bloque de comportamiento no filtraba por fuente.
//     En producción eran 39 de 46 "logins", más la sesión del dueño contada
//     como sesión de la tienda: el divisor de la conversión.
//
//  2. Una venta deja DOS eventos purchase, el del navegador y el del backend.
//     El embudo mostraba 6 compras sobre 3 órdenes pagadas.

describe('métricas · actividad de la tienda vs. del panel', () => {
  const TENANT_STATS = new mongoose.Types.ObjectId()

  let getDashboardStats

  const guardarEventos = async eventos => {
    const ahora = new Date()

    await UserMetricEvent.collection.insertMany(
      eventos.map((e, i) => ({
        tenantId: TENANT_STATS,
        eventType: e.eventType,
        source: e.source,
        sessionId: e.sessionId,
        occurredAt: ahora,
        createdAt: ahora,
        // En PESOS, como lo escribe commerceEventService al registrar una
        // compra: hace Money.toDecimal(amountCents) antes de guardar.
        value: e.value || 0,
        attribution: e.attribution || {},
        metadata: e.metadata || {},
        path: '/',
        eventIndex: i,
      })),
    )
  }

  beforeAll(async () => {
    ;({ getDashboardStats } = await import('../services/statsService.js'))
  })

  afterEach(async () => {
    await UserMetricEvent.collection.deleteMany({ tenantId: TENANT_STATS })
  })

  test('los eventos del panel no cuentan como actividad de la tienda', async () => {
    await guardarEventos([
      { eventType: 'login', source: 'admin', sessionId: 'sesion-del-duenio' },
      { eventType: 'login', source: 'admin', sessionId: 'sesion-del-duenio' },
      { eventType: 'login', source: 'storefront', sessionId: 'sesion-de-un-cliente' },
      { eventType: 'page_view', source: 'storefront', sessionId: 'sesion-de-un-cliente' },
    ])

    const { summary } = await getDashboardStats(String(TENANT_STATS), '30d')

    // Antes: 3 logins y 2 sesiones. El dueño entrando a su propio panel movía
    // la conversión de su tienda.
    expect(summary.logins).toBe(1)
    expect(summary.sessions).toBe(1)
  })

  test('una venta es una compra, aunque deje dos eventos', async () => {
    await guardarEventos([
      {
        eventType: 'purchase',
        source: 'storefront',
        sessionId: 'sesion-de-un-cliente',
        value: 1000,
      },
      { eventType: 'purchase', source: 'system', sessionId: 'sesion-de-un-cliente', value: 1000 },
    ])

    const { summary } = await getDashboardStats(String(TENANT_STATS), '30d')

    // El evento server-side es el único con una emisión por venta.
    expect(summary.purchaseEvents).toBe(1)
  })
})

// ─── Unidades: pesos y centavos no son lo mismo ──────────────────────────────
//
// El valor de UserMetricEvent se guarda en PESOS. statsService le aplicaba
// Money.toDecimal —que convierte de centavos— a dos de las cifras del bloque
// "Valor generado por HENKO", así que las dividía por cien.

describe('métricas · el valor generado se informa en pesos', () => {
  const TENANT_PESOS = new mongoose.Types.ObjectId()

  let getDashboardStats

  beforeAll(async () => {
    ;({ getDashboardStats } = await import('../services/statsService.js'))
  })

  afterEach(async () => {
    await UserMetricEvent.collection.deleteMany({ tenantId: TENANT_PESOS })
  })

  test('una venta de $150.000 influenciada por IA no se muestra como $1.500', async () => {
    const ahora = new Date()

    await UserMetricEvent.collection.insertMany([
      {
        tenantId: TENANT_PESOS,
        eventType: 'purchase',
        source: 'system',
        sessionId: 'sesion-de-la-venta',
        occurredAt: ahora,
        createdAt: ahora,
        value: 150000,
        attribution: { utmCampaign: 'primavera' },
        metadata: { aiInfluenced: true },
        path: '/',
      },
    ])

    const { summary } = await getDashboardStats(String(TENANT_PESOS), '30d')

    expect(summary.aiInfluencedRevenue).toBe(150000)
    // Misma venta, contada una sola vez: es la tarjeta grande del panel.
    expect(summary.totalGeneratedValue).toBe(150000)
  })
})

// Qué queda registrado cuando el frontend se rompe en el navegador del cliente.
//
// Un login desde un celular devolvía 200, el backend escribía "Login exitoso" y
// el usuario veía "Ocurrió un error inesperado": un crash de render que el
// ErrorBoundary tapaba. Desde el servidor era invisible —la app alcanza a pedir
// tenant y tema antes de romperse, así que los access logs se ven sanos— y el
// stack moría en la consola de un teléfono que no tenemos. Con una tienda por
// comercio, pedirle la consola a cada cliente no escala.
describe('métricas · reporte de crash del frontend', () => {
  const reportar = async (cuerpo, extra = {}) => {
    const req = {
      tenantId: TENANT,
      headers: { host: 'tienda.test', 'user-agent': 'jest', ...(extra.headers || {}) },
      body: cuerpo,
      originalUrl: '/api/metrics/client-error',
      socket: { remoteAddress: '1.2.3.4' },
      ...extra,
    }
    const res = respuesta()

    await reportClientCrash(req, res, err => {
      if (err) throw err
    })

    return res
  }

  let espia

  beforeEach(() => {
    espia = jest.spyOn(logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    espia.mockRestore()
  })

  const loQueSeLogueo = () => espia.mock.calls[0][1]

  test('deja el stack, la ruta y el tenant en el log', async () => {
    const res = await reportar({
      message: "Cannot read properties of undefined (reading 'nombre')",
      stack: 'TypeError: Cannot read properties of undefined\n    at Home (Home.js:120:15)',
      componentStack: '\n    at Home\n    at PublicLayout',
      route: '/?desde=login',
      authenticated: true,
    })

    // 204: el cliente ya está roto, no tiene nada que hacer con una respuesta.
    expect(res.statusCode).toBe(204)
    expect(espia).toHaveBeenCalledTimes(1)

    const log = loQueSeLogueo()

    expect(log.mensaje).toContain('Cannot read properties of undefined')
    expect(log.stack).toContain('at Home (Home.js:120:15)')
    expect(log.componentStack).toContain('at PublicLayout')
    expect(log.ruta).toBe('/?desde=login')
    expect(log.autenticado).toBe(true)
    expect(log.tenantId).toBe(String(TENANT))
    expect(log.tenantDominio).toBe('tienda.test')
  })

  test('sin mensaje no ensucia el log', async () => {
    // Bots y clientes mal programados pegan en todo lo que sea público; sin
    // mensaje no hay incidente que leer.
    const res = await reportar({ stack: 'algo', route: '/' })

    expect(res.statusCode).toBe(400)
    expect(espia).not.toHaveBeenCalled()
  })

  test('el handler tolera que no haya tenant y loguea igual', async () => {
    const res = await reportar(
      { message: 'Tenant no resuelto', route: '/' },
      { tenantId: undefined, headers: { host: 'desconocida.test', 'user-agent': 'jest' } },
    )

    expect(res.statusCode).toBe(204)
    expect(loQueSeLogueo().tenantId).toBe('')
    // El dominio alcanza para saber de qué tienda vino el crash.
    expect(loQueSeLogueo().tenantDominio).toBe('desconocida.test')
  })

  test('la ruta NO pasa por resolveTenantByDomain, que cortaría con 404', async () => {
    // Esta prueba existe por un error concreto: la ruta se montó con
    // resolveTenantByDomain creyendo que sólo adjuntaba el comercio. Ante un
    // dominio desconocido o inactivo ese middleware contesta 404 y no llama a
    // next(), así que en el único escenario que este endpoint existe para
    // diagnosticar —el dominio que no resuelve— el reporte se perdía. Que el
    // handler tolere la falta de tenant (prueba de arriba) no sirve de nada si
    // la request nunca llega.
    const router = (await import('../routes/userMetricsRoutes.js')).default

    const capa = router.stack.find(c => c.route?.path === '/client-error')

    expect(capa).toBeDefined()

    const manejadores = capa.route.stack.map(s => s.name)

    expect(manejadores).not.toContain('resolveTenantByDomain')
    expect(manejadores).not.toContain('requireTenant')
  })

  test('recorta un stack gigante en lugar de volcarlo entero al log', async () => {
    const res = await reportar({
      message: 'x'.repeat(5000),
      stack: 'y'.repeat(50000),
    })

    expect(res.statusCode).toBe(204)

    const log = loQueSeLogueo()

    expect(log.mensaje).toHaveLength(500)
    expect(log.stack).toHaveLength(4000)
  })

  test('distingue el dispositivo, que es lo que separaba celular de escritorio', async () => {
    await reportar(
      { message: 'boom' },
      {
        headers: {
          host: 'tienda.test',
          'user-agent':
            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/154.0.0.0 Mobile Safari/537.36',
        },
      },
    )

    expect(loQueSeLogueo().dispositivo).toBe('mobile')
  })

  test('la ruta está exenta de CSRF', async () => {
    // Tiene que serlo: el crash puede ocurrir antes de que la app consiga su
    // token —o justamente por no haberlo conseguido—, y un 403 nos taparía el
    // único reporte de la falla. No escribe nada, sólo emite una línea de log.
    const { csrfExemptRoutes } = await import('../middlewares/csrfMiddleware.js')

    const exenta = csrfExemptRoutes.some(
      ruta => ruta.method === 'POST' && ruta.path.endsWith('/metrics/client-error'),
    )

    expect(exenta).toBe(true)
  })
})

// Si un cliente puede elegir su propia clave de rate limit, no hay rate limit.
//
// EL AGUJERO
//
// El limiter de /api/metrics/events tomaba la IP del primer valor crudo de
// x-forwarded-for, que lo manda quien llama. Con un header distinto en cada
// request, cada intento caía en un cubo nuevo y el techo de 180/min no frenaba
// nada. El endpoint es público y cada evento aceptado es una escritura en
// userMetricEvent —la colección que más crece y la única de las ocho sin TTL—,
// así que el límite que protege la base de un flood era decorativo.
//
// req.ip sale de `trust proxy: 1`: lo resuelve el proxy contando saltos de
// confianza y el cliente no lo decide.
describe('métricas · la clave del rate limit no la elige el cliente', () => {
  // Se usa la función exportada y no el middleware ya construido:
  // express-rate-limit no expone su keyGenerator, así que la primera versión de
  // esta prueba leía undefined y comparaba undefined contra undefined — pasaba
  // sin verificar nada.
  const claveDe = async req => {
    const { claveDeRateLimit } = await import('../routes/userMetricsRoutes.js')

    return claveDeRateLimit(req)
  }

  const pedido = xff => ({
    ip: '203.0.113.7',
    tenantId: TENANT,
    headers: { host: 'tienda.test', ...(xff ? { 'x-forwarded-for': xff } : {}) },
    socket: { remoteAddress: '203.0.113.7' },
  })

  test('cambiar x-forwarded-for no mueve la clave', async () => {
    const a = await claveDe(pedido('1.1.1.1'))
    const b = await claveDe(pedido('2.2.2.2, 3.3.3.3'))
    const c = await claveDe(pedido(null))

    // Si alguna de estas tres difiere, el techo se evade cambiando un header.
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a).toContain(String(TENANT))
  })

  test('IPs reales distintas sí caen en cubos distintos', async () => {
    // El límite tiene que seguir separando clientes de verdad.
    const uno = await claveDe({ ...pedido(null), ip: '203.0.113.7' })
    const otro = await claveDe({ ...pedido(null), ip: '198.51.100.9' })

    expect(uno).not.toBe(otro)
  })
})
