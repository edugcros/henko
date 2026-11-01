// Cierre de los bloqueantes de cobro: lo que le pasa a una orden cuando algo se
// corta a mitad de un pago.
//
// Cuatro garantías, todas sobre el mismo hueco —el proceso muere, o Mercado Pago
// notifica algo que la tienda no sabe ubicar— y todas con plata de por medio:
//
//  1. La firma del webhook la valida el secreto de la aplicación de Mercado Pago
//     DEL COMERCIO (cada tienda cobra con la suya), no solo uno global.
//  2. Un pago cobrado cuyo id no llegó a guardarse se puede vincular a su orden,
//     pero solo si Mercado Pago lo reconoce (external_reference y monto).
//  3. La reserva de stock se marca en la orden junto con el descuento, y una
//     liberación fallida NO se da por hecha.
//  4. La auditoría ve los cobros sin vincular.
//
// Las pruebas de transacción real (que descuento y marca se confirmen o se
// reviertan juntos) necesitan una réplica de Mongo; acá se prueba el contrato
// del código con las dependencias simuladas.

import crypto from 'node:crypto'

import { jest } from '@jest/globals'

process.env.PUBLIC_BACKEND_URL = 'https://api.henko.example'
process.env.API_PREFIX = '/api'
process.env.MP_WEBHOOK_SECRET = 'secreto-global-de-plataforma'

const TENANT = '64b7f0000000000000000001'
const ORDER = '64b7f0000000000000000002'

const mockOrderUpdateOne = jest.fn()
const mockOrderFindOne = jest.fn()
const mockOrderFind = jest.fn()
const mockDecrement = jest.fn()
const mockIncrement = jest.fn()

// Por defecto la "transacción" ejecuta el callback con una sesión de juguete;
// una prueba la cambia para simular que aborta.
let mockTransactionImpl = cb => cb({ id: 'sesion' })

jest.unstable_mockModule('../models/orderModel.js', () => ({
  default: {
    updateOne: mockOrderUpdateOne,
    find: mockOrderFind,
    collection: { findOne: mockOrderFindOne },
  },
  PAYMENT_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded',
  },
  REFUND_STATUS: { NONE: 'none', REQUESTED: 'requested', PARTIAL: 'partial', REFUNDED: 'refunded' },
}))

jest.unstable_mockModule('../models/cartModel.js', () => ({ default: {} }))

jest.unstable_mockModule('../services/orderInventoryService.js', () => ({
  decrementLineStock: mockDecrement,
  incrementLineStock: mockIncrement,
  restoreStockForLines: jest.fn(),
}))

jest.unstable_mockModule('../utils/withOptionalTransaction.js', () => ({
  withOptionalTransaction: cb => mockTransactionImpl(cb),
}))

jest.unstable_mockModule('../../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const { verifyMercadoPagoWebhookSignature, getWebhookHints, resolveWebhookOrderIdentity } =
  await import('../services/paymentWebhookService.js')
const { buildMercadoPagoPaymentData } = await import('../services/paymentMercadoPagoService.js')
const { reserveStockAtomic, releaseReservedStock, persistProviderPaymentId } =
  await import('../services/paymentOrderOpsService.js')
const { checkUnlinkedProviderPayments, auditOrderFinancials } =
  await import('../services/paymentOrderService.js')

// El updateOne de Mongoose devuelve una Query; lo que se usa es `.setOptions()`
// encadenado y el resultado al esperarla.
const query = result => ({
  setOptions() {
    return this
  },
  then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockTransactionImpl = cb => cb({ id: 'sesion' })
  mockDecrement.mockResolvedValue({})
  mockIncrement.mockResolvedValue({})
  mockOrderUpdateOne.mockImplementation(() => query({ matchedCount: 1, modifiedCount: 1 }))
})

// ─── 1. FIRMA DEL WEBHOOK ───────────────────────────────────────────────────

const firmar = ({ secreto, dataId = '123456', requestId = 'req-1', ts = '1700000000' }) => {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  const v1 = crypto.createHmac('sha256', secreto).update(manifest).digest('hex')

  return {
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    query: { 'data.id': dataId },
    body: {},
  }
}

describe('webhook · firma por comercio', () => {
  test('acepta la firma hecha con el secreto global', () => {
    expect(
      verifyMercadoPagoWebhookSignature(firmar({ secreto: 'secreto-global-de-plataforma' })),
    ).toBe(true)
  })

  test('rechaza la firma de la aplicación de un comercio si no se conoce su secreto', () => {
    // El caso que hoy se descartaba: cada comercio firma con su propia clave.
    const req = firmar({ secreto: 'clave-de-la-app-del-comercio' })

    expect(verifyMercadoPagoWebhookSignature(req)).toBe(false)
  })

  test('acepta esa misma firma cuando se aporta el secreto del comercio', () => {
    const req = firmar({ secreto: 'clave-de-la-app-del-comercio' })

    expect(
      verifyMercadoPagoWebhookSignature(req, { tenantSecret: 'clave-de-la-app-del-comercio' }),
    ).toBe(true)
  })

  test('el secreto de OTRO comercio no valida la firma', () => {
    const req = firmar({ secreto: 'clave-de-la-app-del-comercio' })

    expect(verifyMercadoPagoWebhookSignature(req, { tenantSecret: 'clave-de-otro-comercio' })).toBe(
      false,
    )
  })

  test('una firma adulterada no pasa con ninguno de los dos secretos', () => {
    const req = firmar({ secreto: 'clave-de-la-app-del-comercio' })
    req.query['data.id'] = '999999'

    expect(
      verifyMercadoPagoWebhookSignature(req, { tenantSecret: 'clave-de-la-app-del-comercio' }),
    ).toBe(false)
  })

  test('el secreto global también se acepta con su otro nombre, MERCADOPAGO_WEBHOOK_SECRET', () => {
    // config/env.js acepta los dos nombres; la verificación leía solo uno y un
    // entorno con el otro descartaba como falsas todas las notificaciones.
    const original = process.env.MP_WEBHOOK_SECRET
    delete process.env.MP_WEBHOOK_SECRET
    process.env.MERCADOPAGO_WEBHOOK_SECRET = 'secreto-con-el-otro-nombre'
    try {
      expect(
        verifyMercadoPagoWebhookSignature(firmar({ secreto: 'secreto-con-el-otro-nombre' })),
      ).toBe(true)
      // La contraprueba: sin secretos la verificación se OMITE fuera de
      // producción y daría true igual. Que rechace una firma ajena prueba que
      // de verdad se está usando el secreto con el otro nombre.
      expect(verifyMercadoPagoWebhookSignature(firmar({ secreto: 'un-secreto-ajeno' }))).toBe(false)
    } finally {
      process.env.MP_WEBHOOK_SECRET = original
      delete process.env.MERCADOPAGO_WEBHOOK_SECRET
    }
  })

  test('sin cabeceras de firma se rechaza', () => {
    expect(
      verifyMercadoPagoWebhookSignature({ headers: {}, query: { 'data.id': '1' }, body: {} }),
    ).toBe(false)
  })
})

// ─── 2. VINCULAR UN COBRO HUÉRFANO ──────────────────────────────────────────

describe('webhook · pistas de orden y comercio', () => {
  test('la notification_url lleva la orden y el comercio', () => {
    const { paymentData } = buildMercadoPagoPaymentData({
      order: { _id: ORDER, paymentIntent: { amountCents: 150000 } },
      userId: 'u1',
      tenantId: TENANT,
      token: 'tok_1234567890',
      paymentMethodId: 'visa',
      installments: 1,
      payer: { email: 'a@b.com' },
    })

    const url = new URL(paymentData.notification_url)

    expect(url.searchParams.get('order_id')).toBe(ORDER)
    expect(url.searchParams.get('tenant_id')).toBe(TENANT)
    expect(url.searchParams.get('source_news')).toBe('webhooks')
    // La referencia que Mercado Pago devuelve sigue siendo la orden.
    expect(paymentData.external_reference).toBe(ORDER)
  })

  test('getWebhookHints descarta lo que no es un ObjectId', () => {
    expect(getWebhookHints({ query: { order_id: ORDER, tenant_id: TENANT } })).toEqual({
      orderId: ORDER,
      tenantId: TENANT,
    })
    expect(getWebhookHints({ query: { order_id: 'x', tenant_id: { $ne: null } } })).toEqual({
      orderId: null,
      tenantId: null,
    })
    expect(getWebhookHints({ query: {} })).toEqual({ orderId: null, tenantId: null })
  })

  test('encuentra primero por id de pago y no consulta por pista si ya la halló', async () => {
    mockOrderFindOne.mockResolvedValueOnce({ _id: 'o', tenantId: 't' })

    const found = await resolveWebhookOrderIdentity('777', { orderId: ORDER, tenantId: TENANT })

    expect(found).toEqual({ _id: 'o', tenantId: 't' })
    expect(mockOrderFindOne).toHaveBeenCalledTimes(1)
  })

  test('sin id de pago guardado, busca la orden por la pista acotada al comercio', async () => {
    mockOrderFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'o', tenantId: 't' })

    const found = await resolveWebhookOrderIdentity('777', { orderId: ORDER, tenantId: TENANT })

    expect(found).toEqual({ _id: 'o', tenantId: 't' })

    const [filtro] = mockOrderFindOne.mock.calls[1]
    expect(String(filtro._id)).toBe(ORDER)
    expect(String(filtro.tenantId)).toBe(TENANT)
    expect(filtro['paymentIntent.provider']).toBe('mercadopago')
    expect(filtro.isDeleted).toBe(false)
  })

  test('sin pistas y sin id de pago no hay segunda búsqueda', async () => {
    mockOrderFindOne.mockResolvedValueOnce(null)

    expect(await resolveWebhookOrderIdentity('777')).toBeNull()
    expect(mockOrderFindOne).toHaveBeenCalledTimes(1)
  })
})

describe('persistProviderPaymentId', () => {
  test('escribe el id solo si la orden todavía no tiene uno', async () => {
    const ok = await persistProviderPaymentId({
      orderId: ORDER,
      tenantId: TENANT,
      providerPaymentId: 987654,
    })

    expect(ok).toBe(true)

    const [filtro, cambio] = mockOrderUpdateOne.mock.calls[0]
    expect(filtro['paymentIntent.providerPaymentId']).toBeNull()
    expect(cambio.$set['paymentIntent.providerPaymentId']).toBe('987654')
  })

  test('un fallo de escritura no lanza: el pago ya se cobró', async () => {
    mockOrderUpdateOne.mockImplementation(() => query(Promise.reject(new Error('mongo caído'))))

    await expect(
      persistProviderPaymentId({ orderId: ORDER, tenantId: TENANT, providerPaymentId: 1 }),
    ).resolves.toBe(false)
  })

  test('sin datos suficientes no escribe', async () => {
    expect(await persistProviderPaymentId({ orderId: ORDER, tenantId: TENANT })).toBe(false)
    expect(mockOrderUpdateOne).not.toHaveBeenCalled()
  })
})

// ─── 3. RESERVA DE STOCK ────────────────────────────────────────────────────

const lineas = [
  { product: 'p1', count: 2 },
  { product: 'p2', count: 1 },
]

describe('reserva de stock · la marca viaja con el descuento', () => {
  test('con orderId, la marca se escribe en la misma sesión que los descuentos', async () => {
    const reservedAt = await reserveStockAtomic(lineas, TENANT, { orderId: ORDER })

    expect(reservedAt).toBeInstanceOf(Date)
    expect(mockDecrement).toHaveBeenCalledTimes(2)

    const [filtro, cambio, opciones] = mockOrderUpdateOne.mock.calls[0]
    expect(String(filtro._id)).toBe(ORDER)
    // Condicionada: reservar dos veces la misma orden no es posible.
    expect(filtro.stockReservedAt).toBeNull()
    expect(cambio.$set.stockReservedAt).toBe(reservedAt)
    expect(opciones.session).toEqual({ id: 'sesion' })
    expect(mockDecrement.mock.calls[0][0].session).toEqual({ id: 'sesion' })
  })

  test('si la orden ya estaba marcada, aborta para revertir los descuentos', async () => {
    mockOrderUpdateOne.mockImplementation(() => query({ matchedCount: 0 }))

    await expect(reserveStockAtomic(lineas, TENANT, { orderId: ORDER })).rejects.toMatchObject({
      code: 'STOCK_ALREADY_RESERVED',
    })
  })

  test('si una línea no tiene stock no se llega a marcar la orden', async () => {
    mockDecrement.mockRejectedValueOnce(new Error('Stock insuficiente'))

    await expect(reserveStockAtomic(lineas, TENANT, { orderId: ORDER })).rejects.toThrow(
      'Stock insuficiente',
    )
    expect(mockOrderUpdateOne).not.toHaveBeenCalled()
  })

  test('sin orderId se comporta como antes (compatibilidad)', async () => {
    await expect(reserveStockAtomic(lineas, TENANT)).resolves.toBe(true)
    expect(mockOrderUpdateOne).not.toHaveBeenCalled()
  })
})

describe('liberar stock · no se da por hecho si falló', () => {
  test('devuelve true y limpia la marca en la misma sesión cuando libera', async () => {
    const ok = await releaseReservedStock(lineas, TENANT, { orderId: ORDER })

    expect(ok).toBe(true)
    expect(mockIncrement).toHaveBeenCalledTimes(2)

    const [, cambio, opciones] = mockOrderUpdateOne.mock.calls[0]
    expect(cambio.$set.stockReservedAt).toBeNull()
    expect(opciones.session).toEqual({ id: 'sesion' })
  })

  test('devuelve false y NO toca la marca si una línea no se pudo devolver', async () => {
    mockIncrement.mockRejectedValueOnce(new Error('mongo caído'))

    const ok = await releaseReservedStock(lineas, TENANT, { orderId: ORDER })

    expect(ok).toBe(false)
    expect(mockOrderUpdateOne).not.toHaveBeenCalled()
  })

  test('un producto que ya no existe no es un fallo', async () => {
    mockIncrement.mockResolvedValueOnce(null)

    await expect(releaseReservedStock(lineas, TENANT, { orderId: ORDER })).resolves.toBe(true)
  })

  test('si la transacción aborta, tampoco se da por liberado', async () => {
    mockTransactionImpl = async () => {
      throw new Error('TransientTransactionError')
    }

    await expect(releaseReservedStock(lineas, TENANT, { orderId: ORDER })).resolves.toBe(false)
  })
})

// ─── 4. AUDITORÍA DE COBROS SIN VINCULAR ────────────────────────────────────

const ordenSinId = (extra = {}) => ({
  _id: ORDER,
  tenantId: TENANT,
  paymentStatus: 'pending',
  products: [{ subtotalCents: 150000, count: 1 }],
  paymentIntent: {
    provider: 'mercadopago',
    amountCents: 150000,
    originalAmountCents: 150000,
    discountAmountCents: 0,
    providerPaymentId: null,
  },
  ...extra,
})

describe('checkUnlinkedProviderPayments', () => {
  test('un pago aprobado que nombra a la orden y no está vinculado es un hallazgo', () => {
    const hallazgos = checkUnlinkedProviderPayments(ordenSinId(), [
      { id: 555, status: 'approved', external_reference: ORDER, transaction_amount: 1500 },
    ])

    expect(hallazgos).toEqual([
      expect.objectContaining({
        kind: 'provider-payment-unlinked',
        proveedorPaymentId: '555',
        montoProveedor: 150000,
        cobrado: 150000,
      }),
    ])
  })

  test('los intentos rechazados no son plata cobrada', () => {
    expect(
      checkUnlinkedProviderPayments(ordenSinId(), [
        { id: 1, status: 'rejected', external_reference: ORDER, transaction_amount: 1500 },
        { id: 2, status: 'cancelled', external_reference: ORDER, transaction_amount: 1500 },
      ]),
    ).toEqual([])
  })

  test('ignora pagos de otras órdenes', () => {
    expect(
      checkUnlinkedProviderPayments(ordenSinId(), [
        { id: 3, status: 'approved', external_reference: 'otra', transaction_amount: 1500 },
      ]),
    ).toEqual([])
  })

  test('una orden que ya tiene id de pago no se revisa', () => {
    const orden = ordenSinId()
    orden.paymentIntent.providerPaymentId = '555'

    expect(
      checkUnlinkedProviderPayments(orden, [
        { id: 555, status: 'approved', external_reference: ORDER, transaction_amount: 1500 },
      ]),
    ).toEqual([])
  })
})

describe('auditOrderFinancials · órdenes sin id de pago', () => {
  const vieja = () => new Date(Date.now() - 60 * 60 * 1000)

  const conOrdenes = ordenes => {
    mockOrderFind.mockReturnValue({
      sort: () => ({
        limit: () => ({ setOptions: () => ({ lean: () => Promise.resolve(ordenes) }) }),
      }),
    })
  }

  const auditar = extra =>
    auditOrderFinancials({
      resolveTenantContext: async () => ({ accessToken: 'APP_USR-x' }),
      fetchProviderPayment: async () => ({}),
      ...extra,
    })

  test('encuentra el cobro que Mercado Pago tiene y la orden no', async () => {
    conOrdenes([ordenSinId({ stockReservedAt: vieja(), createdAt: vieja() })])

    const buscar = jest
      .fn()
      .mockResolvedValue([
        { id: 555, status: 'approved', external_reference: ORDER, transaction_amount: 1500 },
      ])

    const resultado = await auditar({ searchProviderPayments: buscar })

    expect(buscar).toHaveBeenCalledWith({ externalReference: ORDER, tenantId: TENANT })
    expect(resultado.balanced).toBe(false)
    expect(resultado.findings.map(f => f.kind)).toContain('provider-payment-unlinked')
  })

  test('una orden reciente puede estar en medio del pago: no se consulta', async () => {
    conOrdenes([ordenSinId({ stockReservedAt: new Date(), createdAt: new Date() })])

    const buscar = jest.fn()
    const resultado = await auditar({ searchProviderPayments: buscar })

    expect(buscar).not.toHaveBeenCalled()
    expect(resultado.balanced).toBe(true)
  })

  test('una orden sin intento de pago no se consulta', async () => {
    conOrdenes([ordenSinId({ createdAt: vieja() })])

    const buscar = jest.fn()
    await auditar({ searchProviderPayments: buscar })

    expect(buscar).not.toHaveBeenCalled()
  })

  test('si el proveedor no contesta es "no verificable", no un hallazgo', async () => {
    conOrdenes([ordenSinId({ stockReservedAt: vieja(), createdAt: vieja() })])

    const resultado = await auditar({
      searchProviderPayments: jest.fn().mockRejectedValue(new Error('timeout')),
    })

    expect(resultado.findings).toEqual([])
    expect(resultado.unverifiable).toHaveLength(1)
  })
})
