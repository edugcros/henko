// 📁 src/test/aiDualBudget.test.js
//
// Dos controles de gasto, no uno con dos nombres.
//
//   tokens → VOLUMEN. No depende de ningún precio, así que es la red cuando el
//            catálogo de tarifas está viejo o el modelo no figura en él.
//   usd    → PLATA. Es lo que HENKO paga, y el único que sube cuando la cadena
//            de respaldo entrega un modelo cinco veces más caro sin que se
//            mueva un solo token de más.
//
// El caso que motiva todo esto: entre gemini-3.6-flash (0,75/3,75 por millón) y
// gemini-3.1-flash-lite (0,25/1,50) hay 5x. El mismo tope de tokens puede
// costar veinte dólares o cien según qué modelo esté respondiendo, y eso lo
// decide la cadena de respaldo cuando el pedido está saturado, no una
// configuración.
//
// Contra base real: lo que se prueba es el disyuntor que corta la IA de TODOS
// los comercios, y con mocks se probaría el mock.

import mongoose from 'mongoose'
import { crearMongoEnMemoria, esperarA } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')

const { default: AiOperation } = await import('../models/aiOperationModel.js')
const { default: AiProviderCall } = await import('../models/aiProviderCallModel.js')
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')
const { default: AiUsage } = await import('../models/aiUsageModel.js')
const { reserveAiBudget, refundAiBudget, recordTokenSpend, AI_METRICS, DENY_REASONS } =
  await import('../services/ai/aiBudgetService.js')
const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')
const { cacheDel } = await import('../utils/cache.js')

const TENANT = '64b7f0000000000000000001'

const PERFIL = {
  tenantId: TENANT,
  plan: 'starter',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  keySource: 'platform',
  apiKey: 'AIzaTEST',
}

let mongod
let contador = 0

/**
 * El disyuntor se pregunta por AHORA, no por el período que pide la reserva:
 * usa getCurrentPeriod() para leer el consumo y para su caché. Escribir el
 * consumo en un período inventado no lo afecta — el primer intento de estos
 * tests lo hacía y todos pasaban por el lado equivocado.
 */
const PERIODO_REAL = getCurrentPeriod()

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())
  await AiOperation.init()
  await AiProviderCall.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET
  delete process.env.AI_PLATFORM_MONTHLY_USD_BUDGET
  // La fracción por comercio decide su techo en plata, así que un test que la
  // mueve se la dejaría puesta al siguiente.
  delete process.env.AI_PLATFORM_PER_TENANT_SHARE

  // La decisión se cachea 30 segundos por período. Sin borrarla, el segundo
  // test leería la del primero.
  await cacheDel(`ai:platform:breaker:${PERIODO_REAL}`)
  await AiPlatformUsage.deleteMany({ period: PERIODO_REAL })

  // También el contador del comercio: todos los casos comparten período y
  // tenant, así que sin esto el cupo llega acumulado del caso anterior y una
  // reserva se deniega por cuota cuando el test creía estar midiendo el techo
  // de plataforma.
  await AiUsage.deleteMany({ period: PERIODO_REAL }).setOptions({ ignoreTenant: true })
})

/** Una clave de operación distinta por caso; el período es siempre el real. */
const nuevaClave = () => `caso-${contador++}`

const conConsumo = async ({ tokens = 0, costUsd = 0 }) => {
  await AiPlatformUsage.updateOne(
    { period: PERIODO_REAL },
    {
      $set: { tokens, estimatedCostUsd: costUsd },
      $setOnInsert: { period: PERIODO_REAL },
    },
    { upsert: true },
  )
}

const reservar = operationId =>
  reserveAiBudget({
    tenantId: TENANT,
    metric: AI_METRICS.AGENT_MESSAGES,
    profile: PERFIL,
    period: PERIODO_REAL,
    operationId,
  })

describe('lo que hay hoy en producción no cambia', () => {
  test('sin el techo en dólares, manda el de tokens igual que siempre', async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000'

    await conConsumo({ tokens: 1000, costUsd: 999999 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.reason).toBe(DENY_REASONS.PLATFORM_BUDGET)
    // El costo enorme no participa: sin AI_PLATFORM_MONTHLY_USD_BUDGET, el
    // techo en dólares es ilimitado.
    expect(resultado.detail).toBe('tokens')
  })

  test('sin ninguno de los dos, no hay disyuntor', async () => {
    await conConsumo({ tokens: 99999999, costUsd: 99999 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(true)
  })
})

describe('el techo en dólares corta por su cuenta', () => {
  test('el gasto se pasa y los tokens no: corta igual', async () => {
    // ESTE es el caso que el tope de tokens no puede ver. La cadena de
    // respaldo entregó un modelo cinco veces más caro: el volumen va por el
    // 10% y la plata ya se pasó.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    await conConsumo({ tokens: 100000, costUsd: 100.5 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.detail).toBe('usd')
  })

  test('los tokens se pasan y el gasto no: también corta', async () => {
    // El techo de tokens no queda decorativo. Es la red cuando el número en
    // dólares está mal: sale de multiplicar tokens por un catálogo de precios,
    // y un modelo que no figura se cobra con la tarifa de respaldo.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    await conConsumo({ tokens: 1500, costUsd: 3 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.detail).toBe('tokens')
  })

  test('con los dos pasados, se informa el de la plata', async () => {
    // Entre dos techos superados, el que hay que contarle al dueño de la
    // plataforma es el que le cuesta dinero.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    await conConsumo({ tokens: 5000, costUsd: 50 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.detail).toBe('usd')
  })

  test('debajo de los dos techos, pasa', async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    await conConsumo({ tokens: 500, costUsd: 4.2 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(true)
  })

  test('el techo en dólares admite decimales', async () => {
    // A diferencia del de tokens, no se redondea a entero: un techo de 99,50
    // es perfectamente razonable y redondearlo a 99 cortaría medio dólar antes.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '99.50'

    await conConsumo({ tokens: 10, costUsd: 99.4 })
    expect((await reservar(nuevaClave())).allowed).toBe(true)

    await cacheDel(`ai:platform:breaker:${PERIODO_REAL}`)
    await conConsumo({ tokens: 10, costUsd: 99.6 })
    expect((await reservar(nuevaClave())).allowed).toBe(false)
  })
})

// ─── BLOQUE 10 · cien al mismo tiempo ───────────────────────────────────────
//
// El costo real se conoce DESPUÉS de la respuesta. Entre comprobar el techo y
// ese momento hay una ventana, y con cien requests simultáneos los cien pasan
// la comprobación y los cien gastan. Un techo que se comprueba y no se reserva
// no es un techo: es una sugerencia.

describe('concurrencia · el techo se reserva, no se consulta', () => {
  const PLATA = 0.01 // lo que se compromete por operación de agentMessages

  test('cien reservas simultáneas contra un techo de USD 1', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '1'

    // Fracción completa para este comercio, porque lo que esta prueba verifica
    // es el techo GLOBAL. Con la fracción por defecto (0,5) el tope en plata
    // del comercio queda en USD 0,50 y muerde a la operación 50, así que la
    // denegación llegaría por tenant_usd_budget_exhausted y la prueba dejaría
    // de mirar lo que vino a mirar. El techo por comercio tiene su propia
    // prueba más abajo.
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '1'

    const resultados = await Promise.all(
      Array.from({ length: 100 }, (_, i) => reservar(`concurrente-${i}`)),
    )

    const permitidas = resultados.filter(r => r.allowed).length
    const denegadas = resultados.filter(r => !r.allowed)

    // USD 1 / USD 0,01 = 100 exactas. Ni una más.
    expect(permitidas).toBeLessThanOrEqual(1 / PLATA)

    const doc = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()

    // Lo comprometido no puede pasarse del techo. Sin la reserva atómica esto
    // daba 100 permitidas sin importar el techo.
    expect(doc.reservedCostUsd).toBeLessThanOrEqual(1)
    expect(doc.reservedCostUsd).toBeCloseTo(permitidas * PLATA, 6)

    if (denegadas.length > 0) {
      expect(denegadas[0].reason).toBe(DENY_REASONS.PLATFORM_BUDGET)
      expect(denegadas[0].detail).toBe('usd')
    }
  }, 60000)

  test('con techo holgado, las cien entran', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '1000'

    const resultados = await Promise.all(
      Array.from({ length: 100 }, (_, i) => reservar(`holgadas-${i}`)),
    )

    expect(resultados.filter(r => r.allowed)).toHaveLength(100)
  }, 60000)
})

describe('liquidación · se devuelve la diferencia', () => {
  test('reservado 0,01 · real 0,0034 · queda retenido 0', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    const operationId = nuevaClave()
    const reserva = await reservar(operationId)
    expect(reserva.allowed).toBe(true)

    const conReserva = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    expect(conReserva.reservedCostUsd).toBeCloseTo(0.01, 6)
    // Todavía no se gastó nada: la auditoría contable compara este número
    // contra el libro y no puede incluir plata comprometida.
    expect(conReserva.estimatedCostUsd || 0).toBe(0)

    await recordTokenSpend({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_TOKENS,
      model: 'gemini-3.1-flash-lite',
      inputTokens: 2000,
      outputTokens: 500,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId,
    })
    // Se sondea la liquidación en vez de dormir 300 ms a ojo: termina apenas
    // ocurre, y si la máquina está lenta aguanta en lugar de fallar sin que
    // nada esté roto.
    const liquidado = await esperarA(
      () => AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean(),
      doc => doc?.reservedCostUsd === 0,
    )

    // La retención vuelve a cero y queda SOLO el gasto real.
    expect(liquidado.reservedCostUsd).toBe(0)
    expect(liquidado.estimatedCostUsd).toBeGreaterThan(0)
    expect(liquidado.estimatedCostUsd).toBeLessThan(0.01)
  })

  test('una reserva denegada por cuota del comercio no retiene plata', async () => {
    // Sin esto, un comercio sin cupo le comería el techo a la plataforma con
    // cada intento fallido.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      limitOverride: 1,
    })
    const denegada = await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      limitOverride: 1,
    })

    expect(denegada.allowed).toBe(false)

    const doc = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    // Solo la que sí reservó retiene.
    expect(doc.reservedCostUsd).toBeCloseTo(0.01, 6)
  })

  test('devolver la operación suelta lo comprometido', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    const operationId = nuevaClave()
    await reservar(operationId)

    await refundAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      period: PERIODO_REAL,
      operationId,
    })
    const doc = await esperarA(
      () => AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean(),
      d => d?.reservedCostUsd === 0,
    )
    expect(doc.reservedCostUsd).toBe(0)
  })

  test('sin techo en dólares no se reserva nada, y no cuesta nada', async () => {
    // El comportamiento de hoy: sin AI_PLATFORM_MONTHLY_USD_BUDGET no hay
    // reserva financiera, así que tampoco hay escritura de más por operación.
    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(true)

    const doc = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    expect(doc?.reservedCostUsd || 0).toBe(0)
  })
})

// EL TECHO EN PLATA DE UN COMERCIO.
//
// POR QUE NO ALCANZABA EL DE TOKENS
//
// Lo dice el catalogo de precios: entre un modelo y otro de la cadena hay 5x de
// diferencia de tarifa, asi que el mismo tope de tokens puede costar veinte
// dolares o cien segun quien conteste — y eso lo decide la cadena de respaldo,
// no una politica. El techo en plata existia SOLO a nivel plataforma, o sea que
// cuando UN comercio se desbocaba el disyuntor cortaba para TODOS: el control
// existia, pero en la unidad equivocada y repartiendo el dano entre comercios
// que no habian hecho nada.
describe('techo en plata por comercio', () => {
  const PLATA = 0.01 // lo que se compromete por operacion de agentMessages

  test('corta a este comercio y no a la plataforma entera', async () => {
    // Techo global holgado, fraccion chica: lo que tiene que morder es el tope
    // del comercio, no el global.
    // getPerTenantShare acota con piso de 0,01, asi que una fraccion mas chica
    // que eso no existe: USD 2 x 0,05 = USD 0,10 para este comercio.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '2'
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '0.05'

    const resultados = await Promise.all(
      Array.from({ length: 30 }, (_, i) => reservar(`plata-tenant-${i}`)),
    )

    const permitidas = resultados.filter(r => r.allowed).length
    const denegadas = resultados.filter(r => !r.allowed)

    // USD 0,10 / USD 0,01 = 10 exactas.
    expect(permitidas).toBeLessThanOrEqual(10)
    expect(denegadas.length).toBeGreaterThan(0)

    // El motivo distingue quien se quedo sin plata. Si dijera
    // platform_budget_exhausted, quien mire el log concluiria que hay que subir
    // el techo global cuando el problema es un solo comercio.
    expect(denegadas[0].reason).toBe(DENY_REASONS.TENANT_USD_BUDGET)

    // Y la plataforma sigue con plata: el daño no se reparte.
    const plataforma = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    expect(plataforma.reservedCostUsd).toBeLessThan(2)
  }, 60000)

  test('lo comprometido del comercio no se pasa de su techo', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '2'
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '0.05'

    await Promise.all(Array.from({ length: 30 }, (_, i) => reservar(`plata-tope-${i}`)))

    const usage = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Sin la reserva atomica esto daba 30 permitidas sin importar el techo: el
    // costo real recien se conoce despues de la respuesta, asi que
    // comprobar-y-despues-gastar deja pasar las treinta.
    expect(usage.reservedCostUsd).toBeLessThanOrEqual(0.1 + 1e-9)
  }, 60000)

  test('con la fraccion por defecto el comercio entra igual que antes', async () => {
    // La regresion que importa: el tope nuevo no puede apretar a quien ya
    // funcionaba. Con 0,5 de 100 son USD 50 y diez operaciones son USD 0,10.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reservar(`plata-holgado-${i}`)),
    )

    expect(resultados.every(r => r.allowed)).toBe(true)
  }, 60000)

  test('una denegacion no se come la plata del comercio', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '2'
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '0.05'

    // Se llena el techo del comercio y despues se insiste.
    await Promise.all(Array.from({ length: 10 }, (_, i) => reservar(`plata-llena-${i}`)))

    const antes = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    await Promise.all(Array.from({ length: 5 }, (_, i) => reservar(`plata-insiste-${i}`)))

    const despues = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Los intentos denegados no comprometen nada: si sumaran, un comercio
    // trabado se quedaria trabado hasta fin de mes a fuerza de reintentos.
    expect(despues.reservedCostUsd).toBeCloseTo(antes.reservedCostUsd, 6)
  }, 60000)
})

// El tope en dolares puesto a mano sobre UN comercio.
//
// La fraccion reparte proporcionalmente y tiene piso de 1%, asi que no sirve
// para decir "este comercio no me puede costar mas de veinte dolares este mes".
// Para eso esta el usdCap, y gana sobre la fraccion.
describe('tope en dolares puesto a mano', () => {
  test('el usdCap le gana a la fraccion', async () => {
    const { setTenantAiPolicy } = await import('../services/ai/platformAiSettingService.js')

    // Fraccion holgada: si mandara la fraccion, las 30 entrarian.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '1'

    await setTenantAiPolicy({
      tenantId: TENANT,
      usdCap: 0.05,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })

    const resultados = await Promise.all(
      Array.from({ length: 30 }, (_, i) => reservar(`usdcap-${i}`)),
    )

    const permitidas = resultados.filter(r => r.allowed).length

    // USD 0,05 / USD 0,01 = 5 exactas, aunque la fraccion diera 100.
    expect(permitidas).toBeLessThanOrEqual(5)
    expect(resultados.some(r => r.reason === DENY_REASONS.TENANT_USD_BUDGET)).toBe(true)
  }, 60000)
})

// Sin techo global, la plata del comercio igual se libera.
//
// EL DEFECTO
//
// Los dos techos son independientes. getPlatformMonthlyUsdBudget devuelve
// UNLIMITED cuando no hay override ni variable de entorno —el estado POR
// DEFECTO—, asi que la reserva de plataforma es cero. Pero un comercio con
// usdCap puesto a mano SI compromete plata: la guarda del override corre antes
// de mirar el techo global.
//
// liquidarReserva liberaba la del comercio por el monto de la de plataforma, o
// sea cero. Cada operacion dejaba su estimado comprometido para siempre: el
// contador del comercio crecia hasta tocar su techo y despues se le denegaba
// todo por el resto del mes habiendo gastado casi nada. Justo a los comercios
// que alguien decidio acotar, en silencio, y al principio pareciendo que el
// techo funcionaba.
describe('liberacion sin techo global', () => {
  test('la plata comprometida del comercio vuelve al liquidar', async () => {
    const { setTenantAiPolicy } = await import('../services/ai/platformAiSettingService.js')
    const { recordAiConsumption } = await import('../services/ai/aiBudgetService.js')

    // El estado por defecto: SIN techo global en dolares.
    delete process.env.AI_PLATFORM_MONTHLY_USD_BUDGET

    await setTenantAiPolicy({
      tenantId: TENANT,
      usdCap: 1,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })

    const permiso = await reservar('liberacion-sin-global')
    expect(permiso.allowed).toBe(true)

    const durante = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Mientras corre, hay plata comprometida.
    expect(durante.reservedCostUsd).toBeGreaterThan(0)

    await recordAiConsumption({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      amount: 1,
      profile: PERFIL,
      operationId: 'liberacion-sin-global',
      period: PERIODO_REAL,
      costUsd: 0.001,
    }).catch(() => null)

    const despues = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Y al liquidar vuelve. Sin esto el comercio se bloqueaba solo.
    expect(despues.reservedCostUsd).toBe(0)
  }, 60000)
})
