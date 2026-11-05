// El estado de la suscripción viene del proveedor, y se puede guardar.
//
// DOS FALLAS ENCADENADAS, contra una base real porque ninguna se ve con mocks.
//
// 1. `integrations.subscriptionMercadoPago` no estaba declarado en el schema, y
//    el schema es estricto: cada escritura se descartaba en silencio. El
//    `subscriptionId` nunca llegó a guardarse.
//
// 2. Peor: Mongoose 6 trae `strictQuery` en true, que borra del FILTRO las
//    rutas no declaradas. La búsqueda del webhook
//    —findOne({'integrations.subscriptionMercadoPago.subscriptionId': x})—
//    se convertía en findOne({}) y devolvía el PRIMER tenant de la colección.
//    Buscar por un identificador y recibir a otro: un evento de cancelación de
//    una suscripción inexistente cancelaba al comercio equivocado.
//
// Declarar el campo arregla las dos, porque una ruta declarada ya no se
// descarta ni al escribir ni al filtrar. El test lo comprueba con strictQuery
// en true, que es el peor caso.

import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { crearMongoEnMemoria } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')

const mp = { create: jest.fn(), get: jest.fn(), update: jest.fn() }

jest.unstable_mockModule('mercadopago', () => ({
  MercadoPagoConfig: class {},
  Payment: class {},
  Invoice: class {},
  PreApproval: class {
    create = mp.create
    get = mp.get
    update = mp.update
  },
}))

let mongod
let Tenant
let readProviderBillingDates
let getSubscriptionSummary
let auditSubscriptions
let activateAuthorizedSubscription
let handleSubscriptionWebhook
let processSubscriptionPayment

const crearTenant = (nombre, extra = {}) =>
  Tenant.create({ name: nombre, slug: `${nombre.toLowerCase()}-${Date.now()}`, ...extra })

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())

  Tenant = (await import('../models/tenantModel.js')).default
  ;({ readProviderBillingDates, auditSubscriptions } =
    await import('../services/subscriptionPaymentService.js'))
  ;({ getSubscriptionSummary } = await import('../services/subscriptionMetricsService.js'))
  ;({ activateAuthorizedSubscription, handleSubscriptionWebhook } =
    await import('../controller/subscriptionWebhookCtrl.js'))
  ;({ processSubscriptionPayment } = await import('../controller/subscriptionCtrl.js'))

  // Después de los imports: cargar la configuración los vuelve a poner.
  delete process.env.MP_WEBHOOK_SECRET
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET
}, 60_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

afterEach(async () => {
  await Tenant.collection.deleteMany({})
})

describe('suscripción · el id del proveedor se guarda de verdad', () => {
  test('los campos de Mercado Pago persisten', async () => {
    const tenant = await crearTenant('Comercio')

    await Tenant.findByIdAndUpdate(tenant._id, {
      'integrations.subscriptionMercadoPago': {
        subscriptionId: 'mp-sub-1',
        status: 'authorized',
        payerEmail: 'duenio@comercio.com',
        planSelected: 'pro',
      },
    })

    const leido = await Tenant.findById(tenant._id).lean()
    const mp = leido.integrations?.subscriptionMercadoPago

    // Antes esto era null: el schema descartaba el objeto entero.
    expect(mp).toBeTruthy()
    expect(mp.subscriptionId).toBe('mp-sub-1')
    expect(mp.status).toBe('authorized')
    expect(mp.payerEmail).toBe('duenio@comercio.com')
  })

  test('el webhook encuentra al comercio correcto entre varios', async () => {
    const a = await crearTenant('ComercioA')
    await crearTenant('ComercioB')

    await Tenant.findByIdAndUpdate(a._id, {
      'integrations.subscriptionMercadoPago.subscriptionId': 'mp-de-A',
    })

    const hallado = await Tenant.findOne({
      'integrations.subscriptionMercadoPago.subscriptionId': 'mp-de-A',
    })

    expect(String(hallado._id)).toBe(String(a._id))
  })

  test('un id inexistente devuelve null, NO un comercio cualquiera', async () => {
    // El corazón del bug. Con el campo sin declarar y strictQuery en true, esta
    // misma consulta devolvía "ComercioA" — el primero de la colección.
    const previo = mongoose.get('strictQuery')
    mongoose.set('strictQuery', true)

    await crearTenant('ComercioA')
    await crearTenant('ComercioB')

    const hallado = await Tenant.findOne({
      'integrations.subscriptionMercadoPago.subscriptionId': 'ID-QUE-NO-EXISTE',
    })

    mongoose.set('strictQuery', previo)

    expect(hallado).toBeNull()
  })

  test('una cancelación distingue pedida de efectiva', async () => {
    // Se puede pedir hoy una baja que recién corre al final del período pago.
    // Guardar las dos en el mismo campo perdía esa diferencia.
    const tenant = await crearTenant('Comercio')
    const pedida = new Date('2026-09-10T00:00:00.000Z')
    const efectiva = new Date('2026-10-01T00:00:00.000Z')

    await Tenant.findByIdAndUpdate(tenant._id, {
      'integrations.subscriptionMercadoPago.cancelAt': efectiva,
      'integrations.subscriptionMercadoPago.cancelledAt': pedida,
    })

    const mp = (await Tenant.findById(tenant._id).lean()).integrations.subscriptionMercadoPago

    expect(mp.cancelAt.toISOString()).toBe(efectiva.toISOString())
    expect(mp.cancelledAt.toISOString()).toBe(pedida.toISOString())
  })
})

describe('suscripción · las fechas salen del proveedor', () => {
  test('sin datos del proveedor no se inventa ninguna fecha', async () => {
    // Este es el punto entero. Antes acá salía hoy+30, indistinguible de una
    // fecha real para quien la lee.
    const ciclo = readProviderBillingDates({})

    expect(ciclo.nextBillingAt).toBeNull()
    expect(ciclo.currentPeriodEnd).toBeNull()
    expect(ciclo.currentPeriodStart).toBeNull()
  })

  test('se usa next_payment_date cuando Mercado Pago lo informa', async () => {
    const ciclo = readProviderBillingDates({
      next_payment_date: '2026-10-15T10:00:00.000Z',
      auto_recurring: { start_date: '2026-09-15T10:00:00.000Z' },
    })

    expect(ciclo.nextBillingAt.toISOString()).toBe('2026-10-15T10:00:00.000Z')
    expect(ciclo.currentPeriodStart.toISOString()).toBe('2026-09-15T10:00:00.000Z')
    // El período vigente termina cuando llega el próximo cobro. Es una
    // definición derivada del dato del proveedor, no un calendario nuestro.
    expect(ciclo.currentPeriodEnd.toISOString()).toBe(ciclo.nextBillingAt.toISOString())
  })

  test('el último cobro manda sobre la fecha de alta', async () => {
    // En una renovación, el período vigente arranca en el último cobro, no en
    // el día que el comercio se suscribió hace seis meses.
    const ciclo = readProviderBillingDates({
      auto_recurring: { start_date: '2026-03-01T00:00:00.000Z' },
      summarized: { last_charged_date: '2026-09-01T00:00:00.000Z' },
    })

    expect(ciclo.currentPeriodStart.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  test('una fecha ilegible del proveedor se descarta, no se propaga', async () => {
    const ciclo = readProviderBillingDates({ next_payment_date: 'no es una fecha' })

    expect(ciclo.nextBillingAt).toBeNull()
  })
})

// ─── Lo que el panel muestra de la suscripción ───────────
//
// Las tres tarjetas de "Estado de suscripción" del dashboard salen de acá, y
// dos mentían: el ingreso recurrente venía de una tabla de precios en DÓLARES
// escrita en el servicio (26,14 y 99) que el panel formateaba con signo pesos,
// y "Próximo pago" mostraba la fecha del ÚLTIMO cobro.

describe('resumen de suscripción · lo que ve el panel', () => {
  const originales = {}

  const setEnv = (name, value) => {
    if (!(name in originales)) originales[name] = process.env[name]
    process.env[name] = value
  }

  afterEach(() => {
    for (const [name, value] of Object.entries(originales)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
      delete originales[name]
    }
  })

  test('el ingreso recurrente es el precio vigente del plan, en pesos', async () => {
    setEnv('PLAN_PRICE_ARS_STARTER', '40000')

    const tenant = await crearTenant('ComercioPago', {
      plan: 'starter',
      subscriptionStatus: 'active',
    })

    const resumen = await getSubscriptionSummary(tenant._id)

    // 26.14 era el valor viejo: el precio en dólares de una lista que ya no
    // existe. Si alguien vuelve a escribir un número en el servicio, este test
    // lo agarra.
    expect(resumen.mrr).toBe(40000)
    expect(resumen.currency).toBe('ARS')
  })

  test('sin cobro activo no hay ingreso recurrente', async () => {
    setEnv('PLAN_PRICE_ARS_STARTER', '40000')

    const tenant = await crearTenant('ComercioBaja', {
      plan: 'starter',
      subscriptionStatus: 'cancelled',
    })

    const resumen = await getSubscriptionSummary(tenant._id)

    expect(resumen.mrr).toBe(0)
    // El plan se conserva al dar de baja: lo que cambia es el estado.
    expect(resumen.currentPlan).toBe('starter')
  })

  test('un plan sin precio configurado no inventa un ingreso', async () => {
    const tenant = await crearTenant('ComercioSinPrecio', {
      plan: 'pro',
      subscriptionStatus: 'active',
    })

    const resumen = await getSubscriptionSummary(tenant._id)

    expect(resumen.mrr).toBe(0)
  })

  test('el próximo cobro es el del proveedor, no el último pago', async () => {
    const tenant = await crearTenant('ComercioFechas', {
      plan: 'starter',
      subscriptionStatus: 'active',
    })

    await Tenant.findByIdAndUpdate(tenant._id, {
      'integrations.subscriptionMercadoPago.lastPaymentAt': new Date('2026-09-01T00:00:00.000Z'),
      'integrations.subscriptionMercadoPago.nextBillingAt': new Date('2026-10-01T00:00:00.000Z'),
    })

    const resumen = await getSubscriptionSummary(tenant._id)

    expect(new Date(resumen.nextBillingAt).toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(new Date(resumen.lastPaymentAt).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  test('un comercio inexistente devuelve la misma forma, no otra', async () => {
    // Los caminos de error devolvían `nextBillingDate`, una clave que ninguna
    // otra salida producía: el panel leía undefined justo cuando algo falló.
    const resumen = await getSubscriptionSummary(new mongoose.Types.ObjectId())

    expect(Object.keys(resumen).sort()).toEqual([
      'currency',
      'currentPlan',
      'isActive',
      'lastPaymentAt',
      'mrr',
      'nextBillingAt',
      'pastDueAt',
      'status',
    ])
  })
})

// AUDITORÍA CONTRA EL PROVEEDOR
//
// El estado de suscripción se mantiene por eventos: el alta la escribe el
// panel, y renovaciones, rechazos y cancelaciones llegan SOLO por webhook. Un
// evento perdido deja deriva permanente, y ese estado decide si el comercio
// puede usar la plataforma.
//
// Medido en producción el 19/09/2026, sobre el único comercio con suscripción
// real: Mercado Pago decía `cancelled` y HENKO `active`. La cancelación llegó
// mientras el webhook devolvía 403 y nunca se aplicó. Arreglar el webhook
// evita la deriva futura; nada encontraba la que ya existía.

const clienteQueDevuelve = estado => ({
  get: async () => ({ status: estado, reason: 'Suscripción Henko Plan starter' }),
})

const conSuscripcion = (tenant, subscriptionId = 'sub-1') =>
  Tenant.findByIdAndUpdate(tenant._id, {
    'integrations.subscriptionMercadoPago': { subscriptionId, status: 'authorized' },
  })

describe('auditoría de suscripciones · detectar, no corregir', () => {
  test('encuentra el caso de producción: activa acá, cancelada allá', async () => {
    // ESTA ES LA PROPIEDAD. Sin esto la deriva es invisible para siempre.
    const tenant = await crearTenant('Deriva', { subscriptionStatus: 'active', plan: 'pro' })
    await conSuscripcion(tenant)

    const auditoria = await auditSubscriptions({
      Tenant,
      client: clienteQueDevuelve('cancelled'),
    })

    expect(auditoria.balanced).toBe(false)
    expect(auditoria.findings).toHaveLength(1)
    expect(auditoria.findings[0]).toMatchObject({
      slug: tenant.slug,
      stored: { subscriptionStatus: 'active', plan: 'pro' },
      provider: { status: 'cancelled', mapped: 'cancelled' },
    })
  })

  test('cuando coinciden no hay hallazgo', async () => {
    // 'authorized' del proveedor mapea a 'active'. Reportarlo entrenaría a
    // ignorar el aviso que importa.
    const tenant = await crearTenant('Sana', { subscriptionStatus: 'active' })
    await conSuscripcion(tenant)

    const auditoria = await auditSubscriptions({
      Tenant,
      client: clienteQueDevuelve('authorized'),
    })

    expect(auditoria.balanced).toBe(true)
    expect(auditoria.checked).toBe(1)
  })

  test('si el proveedor no contesta, NO es un hallazgo', async () => {
    // La propiedad de seguridad. Un timeout de Mercado Pago no puede leerse
    // como una cancelación: con esto al revés, una caída del proveedor daría
    // de baja a todos los comercios que están pagando.
    const tenant = await crearTenant('SinRespuesta', { subscriptionStatus: 'active' })
    await conSuscripcion(tenant)

    const auditoria = await auditSubscriptions({
      Tenant,
      client: {
        get: async () => {
          throw new Error('ETIMEDOUT')
        },
      },
    })

    expect(auditoria.findings).toHaveLength(0)
    expect(auditoria.balanced).toBe(true)
    expect(auditoria.checked).toBe(0)
    expect(auditoria.unverifiable).toHaveLength(1)
    expect(auditoria.unverifiable[0].slug).toBe(tenant.slug)
  })

  test('NO corrige nada', async () => {
    // Mismo criterio que la auditoría contable: corregir sin que una persona
    // mire la evidencia convierte un fallo de lectura en pérdida de datos.
    const tenant = await crearTenant('Intacta', { subscriptionStatus: 'active', plan: 'pro' })
    await conSuscripcion(tenant)

    await auditSubscriptions({ Tenant, client: clienteQueDevuelve('cancelled') })

    const despues = await Tenant.findById(tenant._id).lean()
    expect(despues.subscriptionStatus).toBe('active')
    expect(despues.plan).toBe('pro')
  })

  test('ignora a los comercios sin suscripción en el proveedor', async () => {
    // Un comercio en prueba no tiene subscriptionId. Preguntarle al proveedor
    // por una suscripción que no existe daría un error por comercio y llenaría
    // el informe de ruido.
    await crearTenant('EnPrueba', { subscriptionStatus: 'trialing' })

    const auditoria = await auditSubscriptions({
      Tenant,
      client: {
        get: async () => {
          throw new Error('no debería llamarse')
        },
      },
    })

    expect(auditoria.checked).toBe(0)
    expect(auditoria.findings).toHaveLength(0)
    expect(auditoria.unverifiable).toHaveLength(0)
  })
})

// EL CICLO QUE LA CORRE
//
// Una auditoría que nadie ejecuta no vale nada. Y hay una lección ya escrita
// en startAccountingAudit que aplica igual acá: medido en los logs de
// producción, esa auditoría arrancó 25 veces en una noche y su tick de
// sesenta minutos no se disparó NI UNA. Un timer largo en un servicio que se
// reinicia seguido es un timer que no corre. Por eso hay una pasada de
// arranque además del intervalo.

describe('auditoría de suscripciones · el ciclo', () => {
  let runSubscriptionAudit
  let startSubscriptionAudit
  let stopSubscriptionAudit

  beforeAll(async () => {
    ;({ runSubscriptionAudit, startSubscriptionAudit, stopSubscriptionAudit } =
      await import('../services/subscriptionPaymentService.js'))
  })

  afterEach(() => {
    stopSubscriptionAudit()
    delete process.env.SUBSCRIPTION_AUDIT_ENABLED
  })

  test('una pasada sobre una base sin suscripciones no rompe ni avisa', async () => {
    const r = await runSubscriptionAudit({ Tenant })

    expect(r).not.toBeNull()
    expect(r.balanced).toBe(true)
    expect(r.checked).toBe(0)
  })

  test('se puede apagar sin un revert', async () => {
    // Si la auditoría resulta ser el problema —consulta al proveedor por cada
    // comercio— se apaga con una variable en vez de esperar un deploy.
    process.env.SUBSCRIPTION_AUDIT_ENABLED = 'false'
    const log = { info: jest.fn(), error: jest.fn() }

    startSubscriptionAudit({ logger: log })

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('deshabilitada'))
  })

  test('la pasada de arranque CORRE de verdad, no solo se anuncia', async () => {
    // Sin la de arranque, un servicio que se reinicia cada media hora nunca
    // llega al tick de una hora. Ya pasó con la auditoría contable: 25
    // arranques en una noche y cero pasadas.
    //
    // Se espía Tenant.find, que es lo PRIMERO que toca la auditoría. Dos
    // versiones anteriores de esta prueba miraban el log de "iniciada" y el
    // logger inyectado: las dos pasaban con el setTimeout quitado, porque ese
    // log se arma igual y la pasada usa el logger del módulo. Medir el
    // anuncio en vez del efecto es exactamente el error que este repo ya tiene
    // escrito en otros lados.
    process.env.SUBSCRIPTION_AUDIT_ON_START_MS = '40'

    const espia = jest.spyOn(Tenant, 'find')
    const log = { info: jest.fn(), error: jest.fn() }

    startSubscriptionAudit({ logger: log })

    expect(espia).not.toHaveBeenCalled() // todavía no: va con retraso

    await new Promise(resolve => setTimeout(resolve, 300))

    delete process.env.SUBSCRIPTION_AUDIT_ON_START_MS

    expect(espia).toHaveBeenCalled()
    espia.mockRestore()
  })

  test('arrancarla dos veces no deja dos ciclos', async () => {
    const log = { info: jest.fn(), error: jest.fn() }

    startSubscriptionAudit({ logger: log })
    startSubscriptionAudit({ logger: log })

    const iniciadas = log.info.mock.calls.filter(([msg]) => String(msg).includes('iniciada'))
    expect(iniciadas).toHaveLength(1)
  })
})

// EL PUNTO CIEGO: ACTIVO SIN SUSCRIPCION EN EL PROVEEDOR
//
// La auditoria solo alcanza a quien TIENE subscriptionId. Un comercio activo
// sin esa referencia no se compara contra nada: es invisible, y puede estar
// usando la plataforma sin que nadie verifique que pago.
//
// Aparecio al ir a limpiar la referencia obsoleta del comercio del dueño:
// borrarla lo habria sacado del control en vez de resolver nada.

describe('auditoría de suscripciones · los activos sin proveedor se ven', () => {
  test('un comercio activo sin subscriptionId se informa', async () => {
    // ESTA ES LA PROPIEDAD. Antes desaparecia del informe.
    const tenant = await crearTenant('SinProveedor', {
      subscriptionStatus: 'active',
      plan: 'pro',
    })

    const auditoria = await auditSubscriptions({
      Tenant,
      client: {
        get: async () => {
          throw new Error('no debería llamarse')
        },
      },
    })

    expect(auditoria.withoutProvider).toHaveLength(1)
    expect(auditoria.withoutProvider[0]).toMatchObject({
      slug: tenant.slug,
      plan: 'pro',
      subscriptionStatus: 'active',
    })
  })

  test('pero NO cuenta como descuadre', async () => {
    // El comercio del dueño esta legitimamente asi: no puede suscribirse,
    // pagador y receptor serian la misma cuenta. Convertirlo en hallazgo
    // haria sonar el aviso cada hora para siempre.
    await crearTenant('DelDuenio', { subscriptionStatus: 'active', plan: 'pro' })

    const auditoria = await auditSubscriptions({ Tenant, client: null })

    expect(auditoria.balanced).toBe(true)
    expect(auditoria.findings).toHaveLength(0)
  })

  test('un comercio en prueba no cuenta: todavía no tiene por qué pagar', async () => {
    await crearTenant('EnPruebaAun', { subscriptionStatus: 'trialing', plan: 'starter' })

    const auditoria = await auditSubscriptions({ Tenant, client: null })

    expect(auditoria.withoutProvider).toHaveLength(0)
  })
})

describe('la suscripción sigue a Mercado Pago', () => {
  const USUARIO = new mongoose.Types.ObjectId()

  beforeAll(() => {
    process.env.PLAN_PRICE_ARS_STARTER = '20000'
    process.env.PLAN_PRICE_ARS_PRO = '40000'
  })

  afterAll(() => {
    delete process.env.PLAN_PRICE_ARS_STARTER
    delete process.env.PLAN_PRICE_ARS_PRO
  })

  const respuesta = () => {
    const res = { statusCode: null, body: null }
    res.status = code => {
      res.statusCode = code
      return res
    }
    res.json = body => {
      res.body = body
      return res
    }
    return res
  }

  const pagar = async (tenant, plan = 'pro') => {
    const res = respuesta()

    await processSubscriptionPayment(
      {
        user: { _id: USUARIO, tenantId: tenant._id },
        tenantId: tenant._id,
        tenant: { _id: tenant._id },
        headers: {},
        body: { plan, token: 'token-tarjeta', payer: { email: 'duenio@comercio.com' } },
      },
      res,
    )

    return res
  }

  const aviso = async (id, type = 'subscription_preapproval') => {
    const res = respuesta()

    await handleSubscriptionWebhook(
      { headers: {}, originalUrl: '/webhook', query: {}, body: { type, data: { id } } },
      res,
    )

    return res
  }

  const conSuscripcion = (subscriptionStatus, datos = {}) =>
    crearTenant(`Comercio${Math.random().toString(16).slice(2, 8)}`, {
      subscriptionStatus,
      integrations: {
        subscriptionMercadoPago: { subscriptionId: 'pre-1', status: 'pending', ...datos },
      },
    })

  const estado = async tenant => Tenant.findById(tenant._id).lean()

  beforeEach(() => {
    Object.values(mp).forEach(fn => fn.mockReset())
  })

  afterEach(async () => {
    await mongoose.connection.collection('subscriptionwebhookevents').deleteMany({})
  })

  test('autorizar desde Mercado Pago aplica el plan y el email elegidos', async () => {
    const tenant = await crearTenant('Rodeo', { plan: 'starter', trialEndsAt: new Date() })

    mp.create
      .mockRejectedValueOnce(Object.assign(new Error('CC_VAL_433'), { status: 400 }))
      .mockResolvedValueOnce({ id: 'pre-1', status: 'pending', init_point: 'https://mp/pre-1' })

    const pago = await pagar(tenant)

    expect(pago.body.data.initPoint).toBe('https://mp/pre-1')
    expect((await estado(tenant)).plan).toBe('starter')

    mp.get.mockResolvedValueOnce({
      id: 'pre-1',
      status: 'authorized',
      next_payment_date: '2026-12-05T00:00:00.000Z',
    })
    await aviso('pre-1')

    const final = await estado(tenant)
    const guardada = final.integrations.subscriptionMercadoPago

    expect(final.plan).toBe('pro')
    expect(final.subscriptionStatus).toBe('active')
    expect(final.trialEndsAt).toBeNull()
    expect(guardada.status).toBe('authorized')
    expect(guardada.payerEmail).toBe('duenio@comercio.com')
    expect(guardada.nextBillingAt).toEqual(new Date('2026-12-05T00:00:00.000Z'))
  })

  // Es el segundo aviso con la misma clave: antes se descartaba como repetido.
  test('la baja de una suscripción ya autorizada se aplica', async () => {
    const tenant = await conSuscripcion('trialing', { planSelected: 'pro' })

    mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'authorized' })
    await aviso('pre-1')
    expect((await estado(tenant)).subscriptionStatus).toBe('active')

    mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'cancelled' })
    await aviso('pre-1')
    expect((await estado(tenant)).subscriptionStatus).toBe('cancelled')
  })

  test('una suscripción autorizada no le borra el pago pendiente al comercio', async () => {
    const pendienteDesde = new Date('2026-11-01T00:00:00.000Z')
    const tenant = await conSuscripcion('past_due', { status: 'authorized' })

    await Tenant.findByIdAndUpdate(tenant._id, { subscriptionPastDueAt: pendienteDesde })

    mp.get.mockResolvedValueOnce({
      id: 'pre-1',
      status: 'authorized',
      next_payment_date: '2026-12-05T00:00:00.000Z',
    })
    await aviso('pre-1')

    const final = await estado(tenant)

    expect(final.subscriptionStatus).toBe('past_due')
    expect(final.subscriptionPastDueAt).toEqual(pendienteDesde)
    expect(final.integrations.subscriptionMercadoPago.nextBillingAt).toEqual(
      new Date('2026-12-05T00:00:00.000Z'),
    )
  })

  test('cancelar un enlace que nunca se autorizó no le corta la prueba', async () => {
    const tenant = await conSuscripcion('trialing')

    mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'cancelled' })
    await aviso('pre-1')

    const final = await estado(tenant)

    expect(final.subscriptionStatus).toBe('trialing')
    expect(final.integrations.subscriptionMercadoPago.status).toBe('cancelled')
  })

  test('sin poder consultar la suscripción se pide el reintento', async () => {
    const tenant = await conSuscripcion('trialing', { planSelected: 'pro' })

    mp.get.mockRejectedValueOnce(new Error('sin conexión'))
    expect((await aviso('pre-1')).statusCode).toBe(500)

    mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'authorized' })
    expect((await aviso('pre-1')).statusCode).toBe(200)
    expect((await estado(tenant)).subscriptionStatus).toBe('active')
  })

  test('el aviso de otra suscripción no activa al comercio', async () => {
    const tenant = await conSuscripcion('trialing')

    mp.get.mockResolvedValueOnce({ id: 'pre-vieja', status: 'authorized' })
    await aviso('pre-vieja')

    expect((await estado(tenant)).subscriptionStatus).toBe('trialing')
  })

  test('de dos retomas de un evento abandonado solo una lo aplica', async () => {
    const tenant = await conSuscripcion('trialing', { planSelected: 'pro' })
    const eventos = mongoose.connection.collection('subscriptionwebhookevents')

    await eventos.insertOne({
      provider: 'mercadopago',
      eventId: 'subscription_preapproval:pre-1',
      eventType: 'subscription_preapproval',
      subscriptionId: 'pre-1',
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - 11 * 60 * 1000),
    })

    mp.get.mockResolvedValue({ id: 'pre-1', status: 'authorized' })

    await Promise.all([aviso('pre-1'), aviso('pre-1')])

    expect(mp.get).toHaveBeenCalledTimes(1)
    expect((await estado(tenant)).subscriptionStatus).toBe('active')
  })

  // Entre leer al comercio y activarlo, otro proceso pudo haberlo cambiado.
  test('no se activa con una suscripción que dejó de ser la del comercio', async () => {
    const leido = await conSuscripcion('trialing', { planSelected: 'pro' })

    await Tenant.findByIdAndUpdate(leido._id, {
      'integrations.subscriptionMercadoPago.subscriptionId': 'pre-2',
    })

    await activateAuthorizedSubscription(leido, { id: 'pre-1', status: 'authorized' })

    expect((await estado(leido)).subscriptionStatus).toBe('trialing')
  })

  test('activar a un comercio que ya se activó no le cambia nada', async () => {
    const leido = await conSuscripcion('trialing', { planSelected: 'pro' })

    await Tenant.findByIdAndUpdate(leido._id, { subscriptionStatus: 'past_due' })

    await activateAuthorizedSubscription(leido, { id: 'pre-1', status: 'authorized' })

    expect((await estado(leido)).subscriptionStatus).toBe('past_due')
  })

  describe('el alta', () => {
    test.each(['active', 'past_due'])(
      'con una suscripción %s no se crea otra en Mercado Pago',
      async estadoActual => {
        const tenant = await conSuscripcion(estadoActual, { status: 'authorized' })

        const res = await pagar(tenant)

        expect(res.statusCode).toBe(409)
        expect(res.body.data.code).toBe('ALREADY_SUBSCRIBED')
        expect(mp.create).not.toHaveBeenCalled()
      },
    )

    test('un doble clic crea una sola suscripción', async () => {
      const tenant = await crearTenant('DobleClic')

      mp.create.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return { id: 'pre-nueva', status: 'authorized' }
      })

      const respuestas = await Promise.all([pagar(tenant), pagar(tenant)])

      expect(respuestas.map(r => r.statusCode).sort()).toEqual([200, 409])
      expect(mp.create).toHaveBeenCalledTimes(1)
    })

    test('se puede volver a intentar después de un alta terminada', async () => {
      const tenant = await crearTenant('Reintento')

      mp.create.mockResolvedValueOnce({ id: 'pre-1', status: 'cancelled' })
      await pagar(tenant)

      mp.create.mockResolvedValueOnce({ id: 'pre-2', status: 'authorized' })
      expect((await pagar(tenant)).statusCode).toBe(200)
    })

    test('una baja permite volver a suscribirse', async () => {
      const tenant = await conSuscripcion('cancelled', { status: 'cancelled' })

      mp.create.mockResolvedValueOnce({ id: 'pre-2', status: 'authorized' })

      expect((await pagar(tenant)).statusCode).toBe(200)
      expect(mp.get).not.toHaveBeenCalled()
      expect(mp.update).not.toHaveBeenCalled()
    })

    test('el enlace pendiente anterior se da de baja al pagar', async () => {
      const tenant = await conSuscripcion('trialing')

      mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'pending' })
      mp.create.mockResolvedValueOnce({ id: 'pre-2', status: 'authorized' })

      await pagar(tenant)

      expect(mp.update).toHaveBeenCalledWith({ id: 'pre-1', body: { status: 'cancelled' } })
      expect((await estado(tenant)).integrations.subscriptionMercadoPago.subscriptionId).toBe(
        'pre-2',
      )
    })

    test('otro rechazo reemplaza el enlace pendiente en vez de acumularlo', async () => {
      const tenant = await conSuscripcion('trialing')

      mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'pending' })
      mp.create
        .mockRejectedValueOnce(Object.assign(new Error('CC_VAL_433'), { status: 400 }))
        .mockResolvedValueOnce({ id: 'pre-2', status: 'pending', init_point: 'https://mp/pre-2' })

      await pagar(tenant)

      expect(mp.update).toHaveBeenCalledWith({ id: 'pre-1', body: { status: 'cancelled' } })
    })

    test('si no se puede dar de baja el enlace anterior, el alta igual sale bien', async () => {
      const tenant = await conSuscripcion('trialing')

      mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'pending' })
      mp.create.mockResolvedValueOnce({ id: 'pre-2', status: 'authorized' })
      mp.update.mockRejectedValueOnce(new Error('sin conexión'))

      expect((await pagar(tenant)).statusCode).toBe(200)
    })

    // Autorizó el enlace, el aviso todavía no llegó y volvió a pagar con tarjeta.
    test('un enlace ya autorizado activa al comercio y no cobra de nuevo', async () => {
      const tenant = await conSuscripcion('trialing', { planSelected: 'pro' })

      mp.get.mockResolvedValueOnce({ id: 'pre-1', status: 'authorized' })

      const res = await pagar(tenant)

      expect(res.statusCode).toBe(409)
      expect(mp.create).not.toHaveBeenCalled()
      expect((await estado(tenant)).subscriptionStatus).toBe('active')
    })

    test('sin saber cómo quedó el enlace anterior no se cobra', async () => {
      const tenant = await conSuscripcion('trialing')

      mp.get.mockRejectedValueOnce(new Error('sin conexión'))

      expect((await pagar(tenant)).statusCode).toBe(503)
      expect(mp.create).not.toHaveBeenCalled()
    })
  })
})
