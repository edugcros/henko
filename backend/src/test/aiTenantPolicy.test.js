// 📁 src/test/aiTenantPolicy.test.js
//
// El límite POR COMERCIO y el interruptor, que es lo que las palancas globales
// no podían hacer.
//
// QUÉ SE PRUEBA Y POR QUÉ IMPORTA
//
// Hasta acá había tres palancas y las tres eran globales: techo en tokens,
// techo en dólares y el reparto. Si UN comercio se desbocaba, la única maniobra
// era bajarle el reparto A TODOS. Y el autolímite del panel del comercio lo
// pone el comercio: puede volver a subirlo cuando quiera.
//
// Las dos propiedades que se verifican acá son las que hacen que eso deje de
// ser cierto:
//
//   1. la fracción de un comercio le cambia SU tope y no el de los demás;
//   2. el interruptor corta, corta también con key propia, y corta ANTES de
//      gastar un lugar de la ventana de velocidad.
//
// Contra base real: la política es un documento con índice único y el upsert lo
// resuelve Mongo. Con un mock se probaría el mock.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')
// El techo global del que sale la fracción. Fijo acá para que las cuentas del
// test sean verificables a mano y no dependan del entorno.
process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000000'
process.env.AI_PLATFORM_PER_TENANT_SHARE = '0.5'
// El tope por comercio solo existe donde el plan dice ILIMITADO (0) sobre la
// key compartida: con un tope finito manda el del plan y no hay fracción que
// calcular. Poner el plan en ilimitado es ponerse en el único escenario donde
// esta palanca decide algo — y es el escenario real, porque es exactamente la
// combinación que hizo falta acotar.
process.env.AI_LIMIT_STARTER_AGENT_TOKENS = '0'
process.env.AI_LIMIT_PRO_AGENT_TOKENS = '0'

const { default: AiTenantPolicy } = await import('../models/aiTenantPolicyModel.js')
const { default: AiRateWindow, RATE_WINDOW } = await import(
  '../models/aiRateWindowModel.js'
)
const { getTenantAiPolicy, setTenantAiPolicy } = await import(
  '../services/ai/platformAiSettingService.js'
)
const { reserveAiBudget, DENY_REASONS, AI_METRICS, getAiBudgetSnapshot, buildBudgetDenialMessage } =
  await import('../services/ai/aiBudgetService.js')
const { getSharedKeyTenantCap } = await import('../services/ai/aiPlanPolicy.js')

const ACOTADO = '64b7f00000000000000000a1'
const NORMAL = '64b7f00000000000000000a2'
const APAGADO = '64b7f00000000000000000a3'

const perfil = (tenantId, extra = {}) => ({
  tenantId,
  plan: 'pro',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  keySource: 'platform',
  apiKey: 'AIzaTEST',
  ...extra,
})

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await AiTenantPolicy.init()
  await AiRateWindow.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await AiTenantPolicy.collection.deleteMany({})
  await AiRateWindow.collection.deleteMany({})
})

const reservar = (tenantId, extraPerfil = {}) =>
  reserveAiBudget({
    tenantId,
    metric: AI_METRICS.AGENT_TOKENS,
    profile: perfil(tenantId, extraPerfil),
    period: '2035-02',
  })

describe('la fracción por comercio', () => {
  test('sin política cargada, usa la global', () => {
    // 1.000.000 × 0,5. Es el comportamiento que ya existía y que no se puede
    // haber roto al agregar el override.
    expect(getSharedKeyTenantCap(AI_METRICS.AGENT_TOKENS)).toBe(500000)
  })

  test('con fracción propia, el tope es el suyo', () => {
    expect(getSharedKeyTenantCap(AI_METRICS.AGENT_TOKENS, { share: 0.1 })).toBe(100000)
  })

  test('una fracción fuera de rango se acota en vez de aplicarse', () => {
    // Llega desde afuera —un endpoint, un script— y el rango tiene que valer
    // venga de donde venga. Arriba de 1 permitiría que un solo comercio se
    // lleve más que el techo entero.
    expect(getSharedKeyTenantCap(AI_METRICS.AGENT_TOKENS, { share: 5 })).toBe(1000000)
    expect(getSharedKeyTenantCap(AI_METRICS.AGENT_TOKENS, { share: 0 })).toBe(10000)
  })

  test('acotar a UNO no toca el tope de los demás', async () => {
    // ESTA ES LA PROPIEDAD. Es exactamente lo que la palanca global no podía
    // hacer: bajarle el reparto a uno le bajaba el tope a todos.
    await setTenantAiPolicy({
      tenantId: ACOTADO,
      share: 0.1,
      changedByEmail: 'duenio@henko.com',
      reason: 'se comió el 60% del presupuesto en tres días',
    })

    const acotado = await getAiBudgetSnapshot(ACOTADO)
    const normal = await getAiBudgetSnapshot(NORMAL)

    expect(acotado.metrics[AI_METRICS.AGENT_TOKENS].limit).toBe(100000)
    expect(normal.metrics[AI_METRICS.AGENT_TOKENS].limit).toBe(500000)
  })

  test('volver la fracción a null devuelve el mando a la global', async () => {
    await setTenantAiPolicy({
      tenantId: ACOTADO,
      share: 0.1,
      changedByEmail: 'duenio@henko.com',
      reason: 'acotado',
    })

    // null EXPLÍCITO es distinto de no mandar el campo. Sin esta diferencia,
    // acotar a un comercio sería irreversible desde la pantalla.
    await setTenantAiPolicy({
      tenantId: ACOTADO,
      share: null,
      changedByEmail: 'duenio@henko.com',
      reason: 'ya se normalizó',
    })

    expect((await getTenantAiPolicy(ACOTADO)).share).toBe(null)
    expect((await getAiBudgetSnapshot(ACOTADO)).metrics[AI_METRICS.AGENT_TOKENS].limit).toBe(
      500000,
    )
  })

  test('no mandar el campo deja la fracción como estaba', async () => {
    await setTenantAiPolicy({
      tenantId: ACOTADO,
      share: 0.1,
      changedByEmail: 'duenio@henko.com',
      reason: 'acotado',
    })

    // Apagar y prender el interruptor no puede borrarle el tope de paso.
    await setTenantAiPolicy({
      tenantId: ACOTADO,
      suspended: true,
      suspendedReason: 'dejó de pagar',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    expect((await getTenantAiPolicy(ACOTADO)).share).toBe(0.1)
  })

  test('una fracción disparatada se rechaza en el servicio, no solo en la ruta', async () => {
    // El servicio también lo puede llamar un script de mantenimiento: el mismo
    // valor tiene que rebotar por los dos caminos.
    await expect(
      setTenantAiPolicy({
        tenantId: ACOTADO,
        share: 3,
        changedByEmail: 'duenio@henko.com',
        reason: 'dedo pesado',
      }),
    ).rejects.toThrow(/entre 0,01 y 1/)
  })
})

describe('el interruptor', () => {
  test('un comercio suspendido no consume', async () => {
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'factura impaga desde agosto',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    const r = await reservar(APAGADO)

    expect(r.allowed).toBe(false)
    expect(r.reason).toBe(DENY_REASONS.TENANT_SUSPENDED)
  })

  test('el motivo llega al mensaje que ve el comercio', async () => {
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'factura impaga desde agosto',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    const r = await reservar(APAGADO)

    // Un servicio que se apaga sin decir por qué genera un ticket por cada
    // comercio afectado.
    expect(buildBudgetDenialMessage(r)).toContain('factura impaga desde agosto')
  })

  test('corta TAMBIÉN con key propia del comercio', async () => {
    // Apagarlo es una decisión de HENKO sobre el uso de SUS funciones, y no
    // cambia porque el comercio ponga la key: si dejó de pagar, dejó de pagar.
    // El bloque de BYOK devuelve allowed antes de mirar cupos, así que si el
    // interruptor quedara después, no lo alcanzaría.
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'mora',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    const r = await reservar(APAGADO, { keySource: 'tenant' })

    expect(r.allowed).toBe(false)
    expect(r.reason).toBe(DENY_REASONS.TENANT_SUSPENDED)
  })

  test('no gasta un lugar de la ventana de velocidad', async () => {
    // No va a hacer la operación: cobrarle el lugar adelantaría su freno de
    // velocidad cuando vuelva a estar activo.
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'mora',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    await reservar(APAGADO)

    const ventana = await AiRateWindow.findOne({
      tenantId: APAGADO,
      window: RATE_WINDOW.MINUTE,
    })
      .setOptions({ tenantId: APAGADO })
      .lean()

    expect(ventana).toBe(null)
  })

  test('levantarlo lo devuelve a trabajar y limpia el motivo', async () => {
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'mora',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: false,
      changedByEmail: 'duenio@henko.com',
      reason: 'pagó',
    })

    const politica = await getTenantAiPolicy(APAGADO)

    expect(politica.suspended).toBe(false)
    // Un motivo viejo colgado de un comercio activo confunde a quien lo lea.
    expect(politica.suspendedReason).toBe(null)
    expect((await reservar(APAGADO)).allowed).toBe(true)
  })

  test('apagar a uno no apaga a los demás', async () => {
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'mora',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    expect((await reservar(NORMAL)).allowed).toBe(true)
  })

  test('el panel del comercio muestra que está apagado', async () => {
    // Sin esto el panel mostraría cupo disponible y el asistente no
    // respondería: un ticket de soporte por algo que ya estaba decidido y
    // escrito.
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'factura impaga desde agosto',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    const snapshot = await getAiBudgetSnapshot(APAGADO)

    expect(snapshot.suspended).toBe(true)
    expect(snapshot.suspendedReason).toBe('factura impaga desde agosto')
  })
})

describe('la lectura de la política', () => {
  test('un comercio sin política cargada devuelve el defecto permisivo', async () => {
    const politica = await getTenantAiPolicy(NORMAL)

    expect(politica).toEqual({ share: null, suspended: false, suspendedReason: null })
  })

  test('dos cambios sobre el mismo comercio no crean dos documentos', async () => {
    // El upsert se apoya en el índice único. Sin él, cada cambio dejaría una
    // fila nueva y la lectura devolvería cualquiera de las dos.
    await setTenantAiPolicy({
      tenantId: ACOTADO,
      share: 0.2,
      changedByEmail: 'duenio@henko.com',
      reason: 'uno',
    })
    await setTenantAiPolicy({
      tenantId: ACOTADO,
      share: 0.3,
      changedByEmail: 'duenio@henko.com',
      reason: 'dos',
    })

    const filas = await AiTenantPolicy.collection
      .find({ tenantId: new mongoose.Types.ObjectId(ACOTADO) })
      .toArray()

    expect(filas).toHaveLength(1)
    expect(filas[0].share).toBe(0.3)
  })

  test('queda registrado quién lo cambió y por qué', async () => {
    // Apagarle la IA a un comercio es una decisión que alguien va a tener que
    // explicar, y dentro de tres meses el estado solo no explica nada.
    await setTenantAiPolicy({
      tenantId: APAGADO,
      suspended: true,
      suspendedReason: 'mora',
      changedByEmail: 'duenio@henko.com',
      reason: 'factura de agosto vencida hace 40 días',
    })

    const [fila] = await AiTenantPolicy.collection
      .find({ tenantId: new mongoose.Types.ObjectId(APAGADO) })
      .toArray()

    expect(fila.changedByEmail).toBe('duenio@henko.com')
    expect(fila.reason).toBe('factura de agosto vencida hace 40 días')
  })
})
