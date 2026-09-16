// 📁 src/test/aiRateLimit.test.js
//
// El freno de VELOCIDAD, que es lo que el cupo mensual no puede hacer.
//
// POR QUÉ EXISTE
//
// Todo el control de gasto de este paquete mide ACUMULADO: cuánto lleva el
// comercio este mes, cuánto lleva la plataforma. Eso no protege contra un bug.
// Un loop en el agente puede quemar el presupuesto entero en una hora, y el
// disyuntor recién se entera cuando ya pasó — porque compara contra un total,
// no contra un ritmo.
//
// Medido: el agente es el 72% del consumo (595.620 de 826.148 tokens del mes)
// y sus rutas no tenían ningún limitador. La de visión sí, en la ruta HTTP,
// pero el agente entra por WhatsApp: el freno tiene que estar donde pasa TODO
// consumo, que es reserveAiBudget.
//
// Contra base real porque el candado ES un índice único de Mongo: el límite
// viaja dentro del filtro del findOneAndUpdate, y con un mock se probaría el
// mock.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')

const { default: AiRateWindow, RATE_WINDOW, windowStartFor } = await import(
  '../models/aiRateWindowModel.js'
)
const { reserveAiBudget, DENY_REASONS, AI_METRICS } = await import(
  '../services/ai/aiBudgetService.js'
)

const TENANT = '64b7f0000000000000000091'
const OTRO = '64b7f0000000000000000092'

const PERFIL = {
  tenantId: TENANT,
  plan: 'pro',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  keySource: 'platform',
  apiKey: 'AIzaTEST',
}

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  // El índice único ES el mecanismo: sin construirlo, el primer test correría
  // sin candado y pasaría por casualidad.
  await AiRateWindow.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await AiRateWindow.collection.deleteMany({})
  delete process.env.AI_RATE_LIMIT_PER_MINUTE
  delete process.env.AI_RATE_LIMIT_PER_HOUR
})

const reservar = (tenantId = TENANT) =>
  reserveAiBudget({
    tenantId,
    metric: AI_METRICS.AGENT_MESSAGES,
    profile: { ...PERFIL, tenantId },
    period: '2035-01',
  })

describe('el freno de velocidad', () => {
  test('deja pasar el uso normal', async () => {
    // El comercio activo hizo 145 operaciones en TODO el mes, unas 5 por día.
    // El tope por minuto es cien veces eso: ningún uso legítimo lo toca.
    process.env.AI_RATE_LIMIT_PER_MINUTE = '5'

    for (let i = 0; i < 5; i += 1) {
      const r = await reservar()
      expect(r.allowed).toBe(true)
    }
  })

  test('corta la sexta cuando el tope son cinco', async () => {
    process.env.AI_RATE_LIMIT_PER_MINUTE = '5'

    for (let i = 0; i < 5; i += 1) await reservar()

    const frenada = await reservar()

    expect(frenada.allowed).toBe(false)
    expect(frenada.reason).toBe(DENY_REASONS.RATE_LIMIT)
    // Cuál ventana cortó: la acción es distinta. El minuto se destraba solo
    // enseguida; la hora, no.
    expect(frenada.detail).toBe('minute:5')
  })

  test('el freno es POR COMERCIO, no global', async () => {
    // Si fuera global, un comercio desbocado dejaría sin IA a todos los demás
    // — que es exactamente el problema que vino a resolver, al revés.
    process.env.AI_RATE_LIMIT_PER_MINUTE = '2'

    await reservar(TENANT)
    await reservar(TENANT)
    expect((await reservar(TENANT)).allowed).toBe(false)

    // El otro sigue entero.
    expect((await reservar(OTRO)).allowed).toBe(true)
  })

  test('la ventana de la HORA agarra lo que el minuto deja pasar', async () => {
    // 19 por minuto sostenidas durante una hora son 1.140 operaciones y
    // ninguna dispara el freno del minuto. Sin la segunda ventana, el abuso
    // sostenido pasa entero.
    process.env.AI_RATE_LIMIT_PER_MINUTE = '100'
    process.env.AI_RATE_LIMIT_PER_HOUR = '3'

    for (let i = 0; i < 3; i += 1) {
      expect((await reservar()).allowed).toBe(true)
    }

    const frenada = await reservar()
    expect(frenada.allowed).toBe(false)
    expect(frenada.detail).toBe('hour:3')
  })

  test('el minuto que corta NO consume lugar de la hora', async () => {
    // Cobrarle al comercio un lugar de la hora por una operación que no va a
    // hacer adelantaría el freno largo sin motivo.
    process.env.AI_RATE_LIMIT_PER_MINUTE = '1'
    process.env.AI_RATE_LIMIT_PER_HOUR = '100'

    await reservar()
    await reservar() // frenada por minuto
    await reservar() // frenada por minuto

    const hora = await AiRateWindow.findOne({
      tenantId: TENANT,
      window: RATE_WINDOW.HOUR,
    })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Solo la primera, que sí pasó, gastó lugar de la hora.
    expect(hora.count).toBe(1)
  })

  test('la ventana nueva arranca limpia', async () => {
    // El freno acota el ritmo, no el total: pasado el minuto se puede seguir.
    // Si no se liberara, seria un cupo mensual mal hecho.
    process.env.AI_RATE_LIMIT_PER_MINUTE = '2'

    await reservar()
    await reservar()
    expect((await reservar()).allowed).toBe(false)

    // Se envejece la ventana en curso: es lo mismo que pasar al minuto
    // siguiente, sin esperarlo.
    await AiRateWindow.collection.updateMany(
      { window: RATE_WINDOW.MINUTE },
      { $set: { windowStart: windowStartFor(RATE_WINDOW.MINUTE, new Date(Date.now() - 120000)) } },
    )

    expect((await reservar()).allowed).toBe(true)
  })

  test('las operaciones se cuentan ANTES de llamar al proveedor', async () => {
    // Los tokens se conocen DESPUES de la llamada, y para entonces ya se
    // gastaron: un freno que necesita el resultado para decidir no frena nada.
    process.env.AI_RATE_LIMIT_PER_MINUTE = '10'

    await reservar()

    const minuto = await AiRateWindow.findOne({
      tenantId: TENANT,
      window: RATE_WINDOW.MINUTE,
    })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(minuto.count).toBe(1)
    expect(minuto.windowStart).toBeInstanceOf(Date)
  })

  test('carreras simultáneas no superan el tope', async () => {
    // ESTA ES LA PROPIEDAD. Leer el contador y despues decidir dejaria pasar a
    // las dos requests que leen 4 con el tope en 5. El limite viaja DENTRO del
    // filtro del findOneAndUpdate, asi que lo resuelve la base.
    process.env.AI_RATE_LIMIT_PER_MINUTE = '5'

    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => reservar()),
    )

    const pasaron = resultados.filter(r => r.allowed).length
    expect(pasaron).toBe(5)

    const minuto = await AiRateWindow.findOne({
      tenantId: TENANT,
      window: RATE_WINDOW.MINUTE,
    })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(minuto.count).toBe(5)
  })
})
