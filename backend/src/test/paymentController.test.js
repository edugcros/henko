// El controlador de pagos de punta a punta: processPayment y el webhook contra un
// MongoDB real con transacciones, con Mercado Pago simulado.
//
// POR QUÉ EXISTE
//
// Nada ejecutaba este controlador: las demás suites prueban sus servicios por
// separado. Los dos errores que fijan estas pruebas estaban justo en cómo se
// combinan: un reintento tras un rechazo no podía terminar en un pago aprobado, y
// un fallo después de reclamar los efectos dejaba un pago cobrado como pendiente.

import { jest } from '@jest/globals'
import mongoose from 'mongoose'

import { crearReplicaEnMemoria } from './testDB.js'

delete process.env.MP_WEBHOOK_SECRET
delete process.env.MERCADOPAGO_WEBHOOK_SECRET

const mp = {
  create: jest.fn(),
  get: jest.fn(),
  search: jest.fn(),
}

const queuePaymentEmails = jest.fn(async () => ({}))
const consumeOrderCouponIfNeeded = jest.fn(async () => null)
const releaseOrderCouponIfNeeded = jest.fn(async () => null)

jest.unstable_mockModule('../services/paymentTenantConfigService.js', () => ({
  createMercadoPagoPaymentClient: () => mp,
  getTenantConfig: async () => ({}),
  getTenantMercadoPagoContext: async () => ({ accessToken: 'TEST-token', mode: 'test' }),
  getTenantPaymentPublicConfig: async () => ({}),
  getTenantToken: async () => 'TEST-token',
  getTenantWebhookSecret: async () => null,
}))

jest.unstable_mockModule('../services/paymentEmailService.js', () => ({
  processPendingEmails: jest.fn(),
  queuePaymentEmails,
}))

jest.unstable_mockModule('../services/orderCouponService.js', () => ({
  consumeOrderCouponIfNeeded,
  releaseOrderCouponIfNeeded,
}))

jest.unstable_mockModule('../services/meta/metaCapiService.js', () => ({
  sendMetaPurchaseEvent: async () => undefined,
}))

jest.unstable_mockModule('../services/commerceEvents/commerceEventService.js', () => ({
  markOrderAiInfluenced: async () => undefined,
  recordServerPurchaseEvent: async () => undefined,
}))

jest.unstable_mockModule('../services/aiAgent/aiCartRecoveryService.js', () => ({
  markCartRecoveryConverted: async () => undefined,
}))

const {
  default: Order,
  FULFILLMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_STATUS,
} = await import('../models/orderModel.js')
const { default: Product } = await import('../models/productModel.js')
const { default: User } = await import('../models/userModel.js')
const { getPaymentStatus, mpWebhook, processPayment, recoverInterruptedPayments } =
  await import('../controller/paymentController.js')
const { runOrderReconciliation } = await import('../services/paymentOrderService.js')
const { runWithTenantContext } = await import('../utils/tenantRequestContext.js')

const TENANT = new mongoose.Types.ObjectId()
const COMPRADOR = new mongoose.Types.ObjectId()

const unico = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

let mongod
let producto

beforeAll(async () => {
  mongod = await crearReplicaEnMemoria()
  await mongoose.connect(mongod.getUri())
  await Order.init()

  await User.collection.insertOne({
    _id: COMPRADOR,
    tenantId: TENANT,
    email: 'comprador@test.com',
  })
}, 120000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  jest.clearAllMocks()
  // mockReset y no solo clear: una respuesta encolada que un test no consumió se
  // filtraría al siguiente.
  Object.values(mp).forEach(fn => fn.mockReset())
  consumeOrderCouponIfNeeded.mockReset()
  consumeOrderCouponIfNeeded.mockImplementation(async () => null)
  mp.search.mockResolvedValue({ results: [] })

  await Order.deleteMany({}).setOptions({ ignoreTenant: true })
  await Product.deleteMany({}).setOptions({ ignoreTenant: true })

  producto = await Product.create({
    tenantId: TENANT,
    title: 'Zapatilla',
    slug: `zapatilla-${unico()}`,
    description: 'Producto de prueba',
    marca: 'Marca',
    categoria: 'Test',
    subcategoria: 'General',
    price: 1000,
    stock: 10,
    currency: 'ARS',
    sku: `SKU-${unico().slice(-10).toUpperCase()}`,
    status: 'active',
    visibility: 'visible',
  })
})

const crearOrden = (extra = {}, paymentIntent = {}) =>
  new Order({
    tenantId: TENANT,
    idempotencyKey: `orden-${unico()}`,
    orderby: COMPRADOR,
    products: [
      {
        product: producto._id,
        count: 1,
        priceCents: 100000,
        originalPriceCents: 100000,
        subtotalCents: 100000,
        originalSubtotalCents: 100000,
        titleSnapshot: producto.title,
        currency: 'ARS',
      },
    ],
    paymentIntent: {
      id: `pi-${unico()}`,
      provider: 'mercadopago',
      status: PAYMENT_STATUS.PENDING,
      currency: 'ARS',
      amountCents: 100000,
      originalAmountCents: 100000,
      discountAmountCents: 0,
      ...paymentIntent,
    },
    paymentStatus: PAYMENT_STATUS.PENDING,
    customerSnapshot: { userId: COMPRADOR, email: 'comprador@test.com' },
    shippingAddress: {
      firstName: 'Ana',
      lastName: 'Compradora',
      email: 'comprador@test.com',
      phone: '+541123456789',
      address: 'Calle Test 123',
      city: 'Buenos Aires',
      zipCode: '1000',
      country: 'AR',
    },
    ...extra,
  }).save({ tenantId: TENANT })

const respuesta = () => {
  const res = { statusCode: null, body: null, respondido: 0 }
  res.status = code => {
    res.statusCode = code
    return res
  }
  res.json = body => {
    res.body = body
    return res
  }
  res.end = () => {
    res.respondido += 1
    return res
  }
  return res
}

const pagar = async (orden, token = 'token-de-tarjeta-1') => {
  const res = respuesta()

  await runWithTenantContext({ tenantId: TENANT }, async () =>
    processPayment(
      {
        body: {
          orderId: String(orden._id),
          token,
          payment_method_id: 'visa',
          installments: 1,
          payer: { email: 'comprador@test.com', identification: { type: 'DNI', number: '123' } },
        },
        headers: {},
        ip: '127.0.0.1',
        tenantId: TENANT,
        tenant: { _id: TENANT },
        user: { _id: COMPRADOR, tenantId: TENANT, email: 'comprador@test.com' },
      },
      res,
    ),
  )

  return res
}

const consultarEstado = async orden => {
  const res = respuesta()

  await runWithTenantContext({ tenantId: TENANT }, async () =>
    getPaymentStatus(
      {
        params: { orderId: String(orden._id) },
        headers: {},
        ip: '127.0.0.1',
        tenantId: TENANT,
        tenant: { _id: TENANT },
        user: { _id: COMPRADOR, tenantId: TENANT, email: 'comprador@test.com' },
      },
      res,
    ),
  )

  return res
}

// Con `orden`, el aviso trae las pistas que el backend deja en la notification_url
// de cada pago: es la única forma de encontrar una orden que hoy no tiene id.
const avisoDeWebhook = async (paymentId, orden = null) => {
  const res = respuesta()

  await mpWebhook(
    {
      body: { data: { id: paymentId } },
      headers: { 'x-request-id': unico() },
      query: orden ? { order_id: String(orden._id), tenant_id: String(TENANT) } : {},
      ip: '127.0.0.1',
    },
    res,
  )

  return res
}

const pagoEnMp = (id, status, orden, extra = {}) => ({
  id,
  status,
  status_detail: status,
  external_reference: String(orden._id),
  transaction_amount: 1000,
  ...extra,
})

const releer = orden =>
  Order.findOne({ _id: orden._id, tenantId: TENANT }).setOptions({ tenantId: TENANT }).lean()

const stock = async () =>
  (await Product.findOne({ _id: producto._id, tenantId: TENANT }).setOptions({ tenantId: TENANT }))
    .stock

describe('reintento después de un rechazo', () => {
  test('con otra tarjeta, la orden termina aprobada con el pago nuevo', async () => {
    const orden = await crearOrden()

    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'rejected', orden))
    await pagar(orden, 'token-rechazado-1')

    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.REJECTED)
    expect(await stock()).toBe(10)

    mp.create.mockResolvedValueOnce(pagoEnMp('pago-2', 'approved', orden))
    const res = await pagar(orden, 'token-aprobado-2')

    const final = await releer(orden)

    expect(res.body.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(final.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(final.paymentIntent.providerPaymentId).toBe('pago-2')
    expect(final.paymentIntent.rejectedPaymentIds).toEqual(['pago-1'])
    expect(final.paidAt).toBeTruthy()
    expect(await stock()).toBe(9)
  })

  test('cada intento lleva su propia clave de idempotencia', async () => {
    const orden = await crearOrden()

    mp.create.mockResolvedValue(pagoEnMp('pago-1', 'rejected', orden))
    await pagar(orden, 'token-rechazado-1')
    await pagar(orden, 'token-rechazado-2')

    const claves = mp.create.mock.calls.map(([args]) => args.requestOptions.idempotencyKey)

    expect(claves[0]).not.toBe(claves[1])
  })

  test('el mismo token repite la misma clave: un doble clic no cobra dos veces', async () => {
    const orden = await crearOrden()

    mp.create.mockResolvedValue(pagoEnMp('pago-1', 'rejected', orden))
    await pagar(orden, 'token-repetido-1')
    await pagar(orden, 'token-repetido-1')

    const claves = mp.create.mock.calls.map(([args]) => args.requestOptions.idempotencyKey)

    expect(claves[0]).toBe(claves[1])
  })

  test('un aviso atrasado del rechazo no vuelve a rechazar la orden reabierta', async () => {
    const orden = await crearOrden()

    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'rejected', orden))
    await pagar(orden, 'token-rechazado-1')

    // El reintento se corta sin llegar a un pago: la orden queda reabierta.
    mp.create.mockRejectedValueOnce(new Error('sin conexión'))
    await pagar(orden, 'token-cortado-2')

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'rejected', orden))
    await avisoDeWebhook('pago-1', orden)

    expect(mp.get).not.toHaveBeenCalled()
    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.PENDING)
  })
})

describe('no se cobra de más', () => {
  test('con un pago en curso no se crea otro', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-en-curso' })

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-en-curso', 'in_process', orden))
    const res = await pagar(orden)

    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('PAYMENT_PENDING')
    expect(mp.create).not.toHaveBeenCalled()
  })

  test('si Mercado Pago no contesta por el pago guardado, no se crea otro', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-en-curso' })

    mp.get.mockRejectedValueOnce(new Error('sin conexión'))
    const res = await pagar(orden)

    expect(res.body.code).toBe('PAYMENT_PENDING')
    expect(mp.create).not.toHaveBeenCalled()
  })

  // El proceso cayó después de guardar el id y se perdió el aviso del rechazo.
  test('un pago guardado que en realidad se rechazó no traba la orden', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-rechazado' })

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-rechazado', 'rejected', orden))
    mp.create.mockResolvedValueOnce(pagoEnMp('pago-nuevo', 'approved', orden))

    const res = await pagar(orden)
    const final = await releer(orden)

    expect(res.body.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(final.paymentIntent.providerPaymentId).toBe('pago-nuevo')
    expect(final.paymentIntent.rejectedPaymentIds).toEqual(['pago-rechazado'])
  })

  test.each([
    ['cancelada', { paymentStatus: PAYMENT_STATUS.CANCELLED }],
    ['devuelta', { paymentStatus: PAYMENT_STATUS.REFUNDED }],
  ])('una orden %s no se paga', async (_nombre, extra) => {
    const orden = await crearOrden(extra)

    const res = await pagar(orden)

    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('ORDER_NOT_PAYABLE')
    expect(mp.create).not.toHaveBeenCalled()
    expect(await stock()).toBe(10)
  })

  test('el primer intento no le pregunta nada a Mercado Pago', async () => {
    const orden = await crearOrden()

    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await pagar(orden)

    expect(mp.search).not.toHaveBeenCalled()
  })

  test('si un intento anterior cobró sin guardar el id, se vincula y no se cobra de nuevo', async () => {
    const orden = await crearOrden({ lastPaymentAttemptAt: new Date() })

    mp.search.mockResolvedValueOnce({
      results: [
        pagoEnMp('pago-rechazado', 'rejected', orden),
        pagoEnMp('pago-huerfano', 'approved', orden),
      ],
    })

    const res = await pagar(orden)

    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('PAYMENT_PENDING')
    expect(mp.create).not.toHaveBeenCalled()
    expect((await releer(orden)).paymentIntent.providerPaymentId).toBe('pago-huerfano')
  })

  test('si un intento anterior no cobró nada, se puede pagar', async () => {
    const orden = await crearOrden({ lastPaymentAttemptAt: new Date() })

    mp.search.mockResolvedValueOnce({ results: [pagoEnMp('pago-viejo', 'rejected', orden)] })
    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))

    const res = await pagar(orden)

    expect(res.body.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
  })

  // Un rechazo que no llegó a guardarse, con su aviso cayendo durante el cobro
  // del reintento: dejaba la orden rechazada con el pago nuevo aprobado.
  test('un rechazo sin vincular se anota antes de cobrar y su aviso no pisa la orden', async () => {
    const orden = await crearOrden({ lastPaymentAttemptAt: new Date() })

    mp.search.mockResolvedValueOnce({ results: [pagoEnMp('pago-viejo', 'rejected', orden)] })
    mp.get.mockResolvedValueOnce(pagoEnMp('pago-viejo', 'rejected', orden))
    mp.create.mockImplementationOnce(async () => {
      await avisoDeWebhook('pago-viejo', orden)
      return pagoEnMp('pago-nuevo', 'approved', orden)
    })

    await pagar(orden)

    const final = await releer(orden)

    expect(final.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(final.paymentIntent.providerPaymentId).toBe('pago-nuevo')
  })

  test('si no se puede preguntar por el intento anterior, no se cobra', async () => {
    const orden = await crearOrden({ lastPaymentAttemptAt: new Date() })

    mp.search.mockRejectedValueOnce(new Error('sin conexión'))

    const res = await pagar(orden)

    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('PAYMENT_ATTEMPT_UNVERIFIED')
    expect(mp.create).not.toHaveBeenCalled()
  })

  // Si el proceso muere durante la llamada no corre ningún catch: lo único que
  // sobrevive es lo que ya estaba escrito antes de cobrar.
  test('el intento queda escrito antes de llamar a Mercado Pago', async () => {
    const orden = await crearOrden()
    let marcaAlCobrar = null

    mp.create.mockImplementationOnce(async () => {
      marcaAlCobrar = (await releer(orden)).lastPaymentAttemptAt
      return pagoEnMp('pago-1', 'approved', orden)
    })

    await pagar(orden)

    expect(marcaAlCobrar).toBeTruthy()
  })

  test('un corte en la llamada a Mercado Pago devuelve el stock', async () => {
    const orden = await crearOrden()

    mp.create.mockRejectedValueOnce(new Error('se cortó'))
    await pagar(orden)

    expect(await stock()).toBe(10)
  })
})

describe('el aviso de Mercado Pago no se pierde', () => {
  test('si procesar falla se pide el reintento, y el reintento termina el pago', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-1' })

    mp.get.mockRejectedValueOnce(new Error('sin conexión'))
    const fallido = await avisoDeWebhook('pago-1')

    expect(fallido.statusCode).toBe(500)
    expect(fallido.respondido).toBe(1)
    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.PENDING)

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    const reintento = await avisoDeWebhook('pago-1')

    expect(reintento.statusCode).toBe(200)
    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
  })

  test('si falla un efecto del pago aprobado también se pide el reintento', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-1' })

    consumeOrderCouponIfNeeded.mockRejectedValueOnce(new Error('falló el cupón'))
    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))

    expect((await avisoDeWebhook('pago-1')).statusCode).toBe(500)
  })

  test('un aviso que no se puede aplicar no pide reintentos', async () => {
    expect((await avisoDeWebhook('pago-desconocido')).statusCode).toBe(200)
  })

  test('con el pago tomado por otro proceso se pide el reintento', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-1' })
    const { acquirePaymentLock, releasePaymentLock } =
      await import('../services/paymentConcurrencyService.js')
    const recurso = `webhook:${TENANT}:${orden._id}:pago-1`

    await acquirePaymentLock(recurso, TENANT, 30)

    try {
      expect((await avisoDeWebhook('pago-1')).statusCode).toBe(500)
    } finally {
      await releasePaymentLock(recurso)
    }
  })

  // Mercado Pago corta a los 22 segundos y lo cuenta como fallido.
  test('si procesar tarda de más se le contesta igual, una sola vez', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-1' })
    const timeout = jest.spyOn(global, 'setTimeout')
    let seguir

    mp.get.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          seguir = () => resolve(pagoEnMp('pago-1', 'approved', orden))
        }),
    )

    const res = respuesta()
    const aviso = mpWebhook(
      { body: { data: { id: 'pago-1' } }, headers: {}, query: {}, ip: '127.0.0.1' },
      res,
    )

    const plazo = timeout.mock.calls.find(([, ms]) => ms === 15000)
    timeout.mockRestore()

    plazo[0]()

    expect(res.statusCode).toBe(200)

    while (!seguir) await new Promise(resolve => setImmediate(resolve))
    seguir()
    await aviso

    expect(res.respondido).toBe(1)
    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
  })
})

describe('un pago aprobado siempre queda guardado', () => {
  test('si falla un efecto, la orden queda aprobada y el webhook termina lo que falta', async () => {
    const orden = await crearOrden()

    consumeOrderCouponIfNeeded.mockRejectedValueOnce(new Error('falló el cupón'))
    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))

    const res = await pagar(orden)

    // Al comprador se le dice la verdad: pagó.
    expect(res.body.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)

    const aMedias = await releer(orden)

    expect(aMedias.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(aMedias.paidAt).toBeTruthy()
    expect(aMedias.paymentEffectsCommittedAt.getTime()).toBe(0)
    expect(queuePaymentEmails).not.toHaveBeenCalled()

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await avisoDeWebhook('pago-1')

    const final = await releer(orden)

    expect(final.paymentEffectsCommittedAt).toBeTruthy()
    expect(final.stockCommittedAt).toBeTruthy()
    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
    expect(await stock()).toBe(9)
  })

  test('un aviso repetido de un pago ya terminado no repite los efectos', async () => {
    const orden = await crearOrden()

    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await pagar(orden)

    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await avisoDeWebhook('pago-1')

    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
    expect(await stock()).toBe(9)
  })

  test('una orden vieja aprobada, sin marca de efectos, no los repite', async () => {
    const orden = await crearOrden(
      {
        paymentStatus: PAYMENT_STATUS.APPROVED,
        paidAt: new Date(),
        stockCommittedAt: new Date(),
      },
      { providerPaymentId: 'pago-viejo', status: PAYMENT_STATUS.APPROVED },
    )

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-viejo', 'approved', orden))
    await avisoDeWebhook('pago-viejo')

    expect(queuePaymentEmails).not.toHaveBeenCalled()
  })

  // Órdenes tal como las deja un proceso que murió después de reclamar.
  const hace = minutos => new Date(Date.now() - minutos * 60 * 1000)

  const aprobadaAMedias = (reclamo, extra = {}, providerPaymentId = `pago-${unico()}`) =>
    crearOrden(
      {
        paymentStatus: PAYMENT_STATUS.APPROVED,
        paidAt: hace(30),
        paymentEffectsCommittedAt: reclamo,
        ...extra,
      },
      { providerPaymentId, status: PAYMENT_STATUS.APPROVED },
    )

  test('el reclamo de un proceso que murió vence y el webhook termina el pago', async () => {
    const orden = await aprobadaAMedias(hace(11), {}, 'pago-1')

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await avisoDeWebhook('pago-1')

    expect((await releer(orden)).stockCommittedAt).toBeTruthy()
    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
  })

  test('un reclamo reciente no se le pisa al proceso que lo tiene', async () => {
    const orden = await aprobadaAMedias(hace(9), {}, 'pago-1')

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await avisoDeWebhook('pago-1')

    expect((await releer(orden)).stockCommittedAt).toBeNull()
    expect(queuePaymentEmails).not.toHaveBeenCalled()
  })

  test('consultar el estado termina un pago a medias', async () => {
    const orden = await aprobadaAMedias(hace(11), {}, 'pago-1')

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await consultarEstado(orden)

    expect((await releer(orden)).stockCommittedAt).toBeTruthy()
    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
  })

  // El proceso murió después de guardar: el reclamo viejo no es trabajo pendiente.
  test('un reclamo vencido con el stock ya confirmado no se retoma', async () => {
    const orden = await aprobadaAMedias(hace(60), { stockCommittedAt: hace(59) }, 'pago-1')

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await consultarEstado(orden)

    expect(queuePaymentEmails).not.toHaveBeenCalled()
  })

  // El proceso muere entre guardar la aprobación y reclamar los efectos.
  const sinLlegarAReclamar = async accion => {
    const original = Order.findOneAndUpdate
    const reclamo = jest.spyOn(Order, 'findOneAndUpdate').mockImplementation(function (
      filtro,
      ...resto
    ) {
      if (filtro?.$or) throw new Error('se cayó el proceso')
      return original.call(this, filtro, ...resto)
    })

    try {
      await accion()
    } finally {
      reclamo.mockRestore()
    }
  }

  test('una caída antes de reclamar deja la orden a la vista de la recuperación', async () => {
    const orden = await crearOrden()

    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await sinLlegarAReclamar(() => pagar(orden))

    const aMedias = await releer(orden)

    expect(aMedias.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(aMedias.paymentEffectsCommittedAt.getTime()).toBe(0)

    await recoverInterruptedPayments()

    expect((await releer(orden)).stockCommittedAt).toBeTruthy()
    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
  })

  test('aprobar no le pone marca a una orden con el stock ya confirmado', async () => {
    const orden = await aprobadaAMedias(null, { stockCommittedAt: hace(60) }, 'pago-1')

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await sinLlegarAReclamar(() => consultarEstado(orden))

    expect((await releer(orden)).paymentEffectsCommittedAt).toBeNull()
  })

  test('aprobar no pisa el reclamo que ya tiene otro proceso', async () => {
    const reclamo = hace(1)
    const orden = await aprobadaAMedias(reclamo, {}, 'pago-1')

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await consultarEstado(orden)

    expect((await releer(orden)).paymentEffectsCommittedAt).toEqual(reclamo)
  })

  test('un proceso lento no suelta el reclamo que ya retomó otro', async () => {
    const orden = await crearOrden()
    const ajeno = new Date(Date.now() + 1000)

    consumeOrderCouponIfNeeded.mockImplementationOnce(async () => {
      await Order.updateOne(
        { _id: orden._id, tenantId: TENANT },
        { $set: { paymentEffectsCommittedAt: ajeno } },
      ).setOptions({ tenantId: TENANT })

      throw new Error('falló el cupón')
    })
    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))

    await pagar(orden)

    expect((await releer(orden)).paymentEffectsCommittedAt).toEqual(ajeno)
  })

  describe('la pasada de recuperación', () => {
    test('termina una orden con el reclamo vencido', async () => {
      const orden = await aprobadaAMedias(hace(11))

      await expect(recoverInterruptedPayments()).resolves.toEqual({
        revisadas: 1,
        recuperadas: 1,
        fallidas: 0,
      })

      expect((await releer(orden)).stockCommittedAt).toBeTruthy()
      expect(queuePaymentEmails).toHaveBeenCalledTimes(1)

      await recoverInterruptedPayments()

      expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
    })

    test('termina una orden cuyo reclamo se soltó tras un error', async () => {
      const orden = await crearOrden()

      consumeOrderCouponIfNeeded.mockRejectedValueOnce(new Error('falló el cupón'))
      mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
      await pagar(orden)

      await recoverInterruptedPayments()

      expect((await releer(orden)).stockCommittedAt).toBeTruthy()
      expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
    })

    test('no toca lo que no quedó a medias', async () => {
      // Vieja o aprobada a mano: nunca tuvo reclamo.
      await aprobadaAMedias(null)
      // Con un proceso trabajando.
      await aprobadaAMedias(hace(1))
      // Ya terminada.
      await aprobadaAMedias(hace(60), { stockCommittedAt: hace(59) })
      // Cancelada después de aprobarse el reclamo.
      await crearOrden({
        paymentStatus: PAYMENT_STATUS.CANCELLED,
        paymentEffectsCommittedAt: hace(60),
      })

      await expect(recoverInterruptedPayments()).resolves.toMatchObject({ revisadas: 0 })
      expect(queuePaymentEmails).not.toHaveBeenCalled()
    })

    test('no retoma pagos más viejos que la ventana', async () => {
      await aprobadaAMedias(hace(11), { paidAt: hace(31 * 24 * 60) })

      await expect(recoverInterruptedPayments()).resolves.toMatchObject({ revisadas: 0 })
    })

    test('una orden vieja pagada hace poco se retoma', async () => {
      const orden = await aprobadaAMedias(hace(11))

      await Order.collection.updateOne(
        { _id: orden._id },
        { $set: { createdAt: hace(90 * 24 * 60) } },
      )

      await expect(recoverInterruptedPayments()).resolves.toMatchObject({ recuperadas: 1 })
    })

    test('una orden que falla no frena a las demás y se reintenta', async () => {
      const fallida = await aprobadaAMedias(hace(12))
      await aprobadaAMedias(hace(11))

      consumeOrderCouponIfNeeded.mockRejectedValueOnce(new Error('falló el cupón'))

      await expect(recoverInterruptedPayments()).resolves.toEqual({
        revisadas: 2,
        recuperadas: 1,
        fallidas: 1,
      })

      // Pasa al final de la fila: si no, 50 que fallan siempre taparían al resto.
      const marca = (await releer(fallida)).paymentEffectsCommittedAt

      expect(marca.getTime()).toBeGreaterThan(hace(1).getTime())

      await Order.updateOne(
        { _id: fallida._id, tenantId: TENANT },
        { $set: { paymentEffectsCommittedAt: hace(11) } },
      ).setOptions({ tenantId: TENANT })

      await expect(recoverInterruptedPayments()).resolves.toMatchObject({ recuperadas: 1 })
      expect(queuePaymentEmails).toHaveBeenCalledTimes(2)
    })

    test('corre con el trabajo periódico de órdenes', async () => {
      const orden = await aprobadaAMedias(hace(11), {}, 'pago-1')

      mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
      await runOrderReconciliation()

      expect((await releer(orden)).stockCommittedAt).toBeTruthy()
    })
  })

  test('consultar el estado de una orden vieja no repite los correos', async () => {
    const orden = await crearOrden(
      {
        paymentStatus: PAYMENT_STATUS.APPROVED,
        paidAt: new Date(),
        stockCommittedAt: new Date(),
      },
      { providerPaymentId: 'pago-viejo', status: PAYMENT_STATUS.APPROVED },
    )

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-viejo', 'approved', orden))
    await consultarEstado(orden)

    expect(queuePaymentEmails).not.toHaveBeenCalled()
  })

  test('un pago que entra por webhook aprueba la orden', async () => {
    const orden = await crearOrden({ stockReservedAt: new Date() }, { providerPaymentId: 'pago-1' })

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await avisoDeWebhook('pago-1')

    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
  })

  test('aprobar no pisa una orden que el comercio despachó mientras se cobraba', async () => {
    const orden = await crearOrden()

    // Como lo hace el panel: guarda el documento, y eso sube su versión.
    mp.create.mockImplementationOnce(async () => {
      const enElPanel = await Order.findOne({ _id: orden._id, tenantId: TENANT }).setOptions({
        tenantId: TENANT,
      })
      enElPanel.fulfillmentStatus = FULFILLMENT_STATUS.SHIPPED
      await enElPanel.save({ tenantId: TENANT })

      return pagoEnMp('pago-1', 'approved', orden)
    })

    await pagar(orden)

    const final = await releer(orden)

    expect(final.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(final.orderStatus).toBe(ORDER_STATUS.SHIPPED)
  })

  test('una orden abierta pasa a procesando al aprobarse, aunque fallen los efectos', async () => {
    const orden = await crearOrden()

    consumeOrderCouponIfNeeded.mockRejectedValueOnce(new Error('falló el cupón'))
    mp.create.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))

    await pagar(orden)

    expect((await releer(orden)).orderStatus).toBe(ORDER_STATUS.PROCESSING)
  })

  test('no se aprueba encima de una orden cancelada mientras se cobraba', async () => {
    const orden = await crearOrden()

    mp.create.mockImplementationOnce(async () => {
      await Order.updateOne(
        { _id: orden._id, tenantId: TENANT },
        { $set: { paymentStatus: PAYMENT_STATUS.CANCELLED } },
      ).setOptions({ tenantId: TENANT })

      return pagoEnMp('pago-1', 'approved', orden)
    })

    await pagar(orden)

    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.CANCELLED)
    expect(queuePaymentEmails).not.toHaveBeenCalled()
  })
})

// Lo que hace la devolución se prueba contra la base en orderAdminMutation.test.js.
// Acá, que los dos caminos del proveedor la pidan.
describe('una venta que el proveedor revierte devuelve el cupón', () => {
  const aprobada = () =>
    crearOrden(
      { paymentStatus: PAYMENT_STATUS.APPROVED, paidAt: new Date() },
      { providerPaymentId: 'pago-1', status: PAYMENT_STATUS.APPROVED },
    )

  test.each(['refunded', 'charged_back'])('por webhook: %s', async estado => {
    const orden = await aprobada()

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', estado, orden))

    expect((await avisoDeWebhook('pago-1')).statusCode).toBe(200)
    expect(releaseOrderCouponIfNeeded).toHaveBeenCalledTimes(1)
    expect(String(releaseOrderCouponIfNeeded.mock.calls[0][0].order._id)).toBe(String(orden._id))
  })

  test('por la consulta de estado', async () => {
    const orden = await aprobada()

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'refunded', orden))

    await consultarEstado(orden)

    expect(releaseOrderCouponIfNeeded).toHaveBeenCalledTimes(1)
  })

  test('un rechazo no devuelve nada: ese pago nunca consumió el cupón', async () => {
    const orden = await crearOrden({}, { providerPaymentId: 'pago-1' })

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'rejected', orden))

    await avisoDeWebhook('pago-1')

    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.REJECTED)
    expect(releaseOrderCouponIfNeeded).not.toHaveBeenCalled()
  })

  // Una disputa abierta todavía no es un resultado.
  test.each(['approved', 'in_mediation'])('%s no devuelve nada', async estado => {
    const orden = await aprobada()

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', estado, orden))

    await avisoDeWebhook('pago-1')

    expect(releaseOrderCouponIfNeeded).not.toHaveBeenCalled()
  })
})
