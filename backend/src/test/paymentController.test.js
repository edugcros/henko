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

const { default: Order, PAYMENT_STATUS } = await import('../models/orderModel.js')
const { default: Product } = await import('../models/productModel.js')
const { default: User } = await import('../models/userModel.js')
const { mpWebhook, processPayment } = await import('../controller/paymentController.js')
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
  const res = { statusCode: null, body: null }
  res.status = code => {
    res.statusCode = code
    return res
  }
  res.json = body => {
    res.body = body
    return res
  }
  res.end = () => res
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

// Con `orden`, el aviso trae las pistas que el backend deja en la notification_url
// de cada pago: es la única forma de encontrar una orden que hoy no tiene id.
const avisoDeWebhook = (paymentId, orden = null) =>
  mpWebhook(
    {
      body: { data: { id: paymentId } },
      headers: { 'x-request-id': unico() },
      query: orden ? { order_id: String(orden._id), tenant_id: String(TENANT) } : {},
      ip: '127.0.0.1',
    },
    respuesta(),
  )

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

    const res = await pagar(orden)

    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('PAYMENT_PENDING')
    expect(mp.create).not.toHaveBeenCalled()
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
    expect(aMedias.paymentEffectsCommittedAt).toBeNull()
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

  test('un pago que entra por webhook aprueba la orden', async () => {
    const orden = await crearOrden({ stockReservedAt: new Date() }, { providerPaymentId: 'pago-1' })

    mp.get.mockResolvedValueOnce(pagoEnMp('pago-1', 'approved', orden))
    await avisoDeWebhook('pago-1')

    expect((await releer(orden)).paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(queuePaymentEmails).toHaveBeenCalledTimes(1)
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
