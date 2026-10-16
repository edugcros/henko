// Lo que paymentRecovery.test.js NO puede probar: el comportamiento contra un
// MongoDB de verdad.
//
// Aquella suite simula la base y comprueba el contrato del código. Acá se
// comprueba lo que solo la base puede decir:
//
//  1. Que el descuento de stock y la marca `stockReservedAt` entran juntos o no
//     entra ninguno (transacción real, replica set).
//  2. Que MongoDB ACEPTA las definiciones corregidas de los índices únicos de
//     `Order` —las anteriores llevaban `$ne: null` y las rechazaba— y que
//     efectivamente impiden lo que prometen.
//  3. Que el aviso de índices faltantes ve la diferencia real entre lo declarado
//     y lo existente.
//
// Replica set de un solo nodo y no un mongod suelto: sin replica set no hay
// transacciones, y entonces la mitad de lo que hay que probar no se puede ni
// ejecutar. Producción es Atlas, o sea replica set. Mismo criterio que
// productPriceHistory.test.js.

import mongoose from 'mongoose'

import Order, { PAYMENT_STATUS } from '../models/orderModel.js'
import Product from '../models/productModel.js'
import {
  persistProviderPaymentId,
  releaseReservedStock,
  reserveStockAtomic,
} from '../services/paymentOrderOpsService.js'
import { auditOrderFinancials } from '../services/paymentOrderService.js'
import { findMissingIndexes } from '../services/indexHealthService.js'
import { crearReplicaEnMemoria } from './testDB.js'

const TENANT = new mongoose.Types.ObjectId()
const OTRO_TENANT = new mongoose.Types.ObjectId()

let mongod

beforeAll(async () => {
  mongod = await crearReplicaEnMemoria()
  await mongoose.connect(mongod.getUri())

  // Los índices se construyen en segundo plano al conectar. Se esperan y se
  // piden explícitamente: si MongoDB rechazara alguna definición, esto lanza y
  // la suite entera falla con el motivo a la vista, en vez de que el índice
  // simplemente no exista (que es lo que pasaba con `$ne: null`).
  await Order.init()
  await Order.createIndexes()
}, 120000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  await Product.deleteMany({}).setOptions({ ignoreTenant: true })
  await Order.deleteMany({}).setOptions({ ignoreTenant: true })
})

// ─── Armado de datos ────────────────────────────────────────────────────────

const unico = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

const crearProducto = ({ stock = 10, tenantId = TENANT, title = 'Zapatilla' } = {}) =>
  Product.create({
    tenantId,
    title,
    slug: `${title.toLowerCase()}-${unico()}`,
    description: 'Producto de prueba para suite automatizada',
    marca: 'Marca Test',
    categoria: 'Test',
    subcategoria: 'General',
    price: 1000,
    stock,
    currency: 'ARS',
    sku: `SKU-${unico().slice(-10).toUpperCase()}`,
    status: 'active',
    visibility: 'visible',
  })

const stockDe = async (producto, tenantId = TENANT) => {
  const p = await Product.findOne({ _id: producto._id, tenantId }).setOptions({ tenantId })
  return p.stock
}

const ordenDe = (id, tenantId = TENANT) =>
  Order.findOne({ _id: id, tenantId }).setOptions({ tenantId }).lean()

const armarOrden = async ({ items = [], tenantId = TENANT, paymentIntent = {}, ...extra } = {}) => {
  // Una orden sin líneas no es un caso válido. Las pruebas de índices no miran
  // el contenido, así que se les da una línea cualquiera.
  const lineas = items.length
    ? items
    : [{ producto: { _id: new mongoose.Types.ObjectId(), title: 'Genérico' }, count: 1 }]

  const products = lineas.map(({ producto, count }) => ({
    product: producto._id,
    count,
    priceCents: 100000,
    originalPriceCents: 100000,
    subtotalCents: 100000 * count,
    originalSubtotalCents: 100000 * count,
    titleSnapshot: producto.title,
    currency: 'ARS',
  }))

  const total = products.reduce((suma, linea) => suma + linea.subtotalCents, 0) || 100000

  const orden = new Order({
    tenantId,
    idempotencyKey: `orden-${unico()}`,
    orderby: new mongoose.Types.ObjectId(),
    products,
    paymentIntent: {
      id: `pi-${unico()}`,
      provider: 'mercadopago',
      status: PAYMENT_STATUS.PENDING,
      currency: 'ARS',
      amountCents: total,
      originalAmountCents: total,
      discountAmountCents: 0,
      ...paymentIntent,
    },
    paymentStatus: PAYMENT_STATUS.PENDING,
    customerSnapshot: {
      userId: new mongoose.Types.ObjectId(),
      email: 'comprador@test.com',
    },
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
  })

  await orden.save({ tenantId })
  return orden
}

// ─── 1. RESERVA DE STOCK ────────────────────────────────────────────────────

describe('reserva de stock · MongoDB real', () => {
  test('descuenta el stock y marca la orden en la misma operación', async () => {
    const producto = await crearProducto({ stock: 10 })
    const orden = await armarOrden({ items: [{ producto, count: 3 }] })

    const reservedAt = await reserveStockAtomic(orden.products, TENANT, { orderId: orden._id })

    expect(reservedAt).toBeInstanceOf(Date)
    expect(await stockDe(producto)).toBe(7)

    const guardada = await ordenDe(orden._id)
    expect(new Date(guardada.stockReservedAt).getTime()).toBe(reservedAt.getTime())
  })

  test('si la orden ya estaba marcada, aborta y el descuento SE REVIERTE', async () => {
    // Es la garantía central: descuento y marca viajan en la misma transacción.
    // La marca ya puesta hace fallar el segundo paso DESPUÉS de haber
    // descontado; si no hubiera transacción real, el stock quedaría en 7.
    const producto = await crearProducto({ stock: 10 })
    const orden = await armarOrden({
      items: [{ producto, count: 3 }],
      stockReservedAt: new Date(),
    })

    await expect(
      reserveStockAtomic(orden.products, TENANT, { orderId: orden._id }),
    ).rejects.toMatchObject({ code: 'STOCK_ALREADY_RESERVED' })

    expect(await stockDe(producto)).toBe(10)
  })

  test('reservar dos veces la misma orden no descuenta dos veces', async () => {
    const producto = await crearProducto({ stock: 10 })
    const orden = await armarOrden({ items: [{ producto, count: 3 }] })

    await reserveStockAtomic(orden.products, TENANT, { orderId: orden._id })

    await expect(
      reserveStockAtomic(orden.products, TENANT, { orderId: orden._id }),
    ).rejects.toMatchObject({ code: 'STOCK_ALREADY_RESERVED' })

    expect(await stockDe(producto)).toBe(7)
  })

  test('dos reservas simultáneas de la misma orden: solo una descuenta', async () => {
    const producto = await crearProducto({ stock: 10 })
    const orden = await armarOrden({ items: [{ producto, count: 3 }] })

    const resultados = await Promise.allSettled([
      reserveStockAtomic(orden.products, TENANT, { orderId: orden._id }),
      reserveStockAtomic(orden.products, TENANT, { orderId: orden._id }),
    ])

    expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await stockDe(producto)).toBe(7)
  })

  test('una línea sin stock aborta antes de marcar la orden y no deja nada descontado', async () => {
    const conStock = await crearProducto({ stock: 10, title: 'ConStock' })
    const sinStock = await crearProducto({ stock: 1, title: 'SinStock' })
    const orden = await armarOrden({
      items: [
        { producto: conStock, count: 3 },
        { producto: sinStock, count: 5 },
      ],
    })

    await expect(
      reserveStockAtomic(orden.products, TENANT, { orderId: orden._id }),
    ).rejects.toThrow()

    expect(await stockDe(conStock)).toBe(10)
    expect(await stockDe(sinStock)).toBe(1)
    expect((await ordenDe(orden._id)).stockReservedAt).toBeNull()
  })
})

// ─── 2. LIBERAR LA RESERVA ──────────────────────────────────────────────────

describe('liberar la reserva · MongoDB real', () => {
  test('devuelve el stock y limpia la marca juntos', async () => {
    const producto = await crearProducto({ stock: 10 })
    const orden = await armarOrden({ items: [{ producto, count: 3 }] })

    await reserveStockAtomic(orden.products, TENANT, { orderId: orden._id })
    expect(await stockDe(producto)).toBe(7)

    const liberado = await releaseReservedStock(orden.products, TENANT, { orderId: orden._id })

    expect(liberado).toBe(true)
    expect(await stockDe(producto)).toBe(10)
    expect((await ordenDe(orden._id)).stockReservedAt).toBeNull()
  })

  test('si una línea falla, NO devuelve nada y conserva la marca', async () => {
    // Antes la liberación tragaba el error y el llamador limpiaba la marca
    // igual: las unidades quedaban fuera del catálogo y la orden convencida de
    // haberlas devuelto. Una línea con un id imposible hace fallar la segunda
    // devolución; la primera ya había sumado y tiene que deshacerse.
    const producto = await crearProducto({ stock: 10 })
    const orden = await armarOrden({ items: [{ producto, count: 3 }] })

    await reserveStockAtomic(orden.products, TENANT, { orderId: orden._id })

    const lineas = [
      { product: producto._id, count: 3, titleSnapshot: 'Zapatilla' },
      { product: 'no-es-un-id', count: 1, titleSnapshot: 'Roto' },
    ]

    const liberado = await releaseReservedStock(lineas, TENANT, { orderId: orden._id })

    expect(liberado).toBe(false)
    expect(await stockDe(producto)).toBe(7)
    expect((await ordenDe(orden._id)).stockReservedAt).not.toBeNull()
  })
})

// ─── 3. ÍNDICES ÚNICOS DE ORDER ─────────────────────────────────────────────

const indiceCon = async campo => {
  const indices = await Order.collection.indexes()
  return indices.find(i => Object.keys(i.key).includes(campo) && Object.keys(i.key).length > 1)
}

describe('índices únicos de Order · MongoDB real', () => {
  test('MongoDB acepta y crea las definiciones corregidas', async () => {
    const porPago = await indiceCon('paymentIntent.providerPaymentId')
    const porClave = await indiceCon('idempotencyKey')

    expect(porPago).toMatchObject({
      key: { tenantId: 1, 'paymentIntent.providerPaymentId': 1 },
      unique: true,
      partialFilterExpression: {
        isDeleted: false,
        'paymentIntent.providerPaymentId': { $type: 'string' },
      },
    })

    expect(porClave).toMatchObject({
      key: { tenantId: 1, idempotencyKey: 1 },
      unique: true,
      partialFilterExpression: { isDeleted: false, idempotencyKey: { $type: 'string' } },
    })
  })

  test('existe el índice para buscar por id de pago sin comercio (webhook)', async () => {
    const indices = await Order.collection.indexes()
    const soloPago = indices.find(
      i => Object.keys(i.key).length === 1 && i.key['paymentIntent.providerPaymentId'] === 1,
    )

    expect(soloPago).toBeTruthy()
    expect(soloPago.unique).toBeFalsy()
  })

  test('la misma clave de idempotencia en el mismo comercio se rechaza', async () => {
    await armarOrden({ idempotencyKey: 'clave-repetida' })

    await expect(armarOrden({ idempotencyKey: 'clave-repetida' })).rejects.toMatchObject({
      code: 11000,
    })
  })

  test('la misma clave en OTRO comercio sí se permite', async () => {
    await armarOrden({ idempotencyKey: 'clave-compartida' })

    await expect(
      armarOrden({ idempotencyKey: 'clave-compartida', tenantId: OTRO_TENANT }),
    ).resolves.toBeTruthy()
  })

  test('una orden borrada no bloquea la clave', async () => {
    await armarOrden({ idempotencyKey: 'clave-reusada' })

    await expect(
      armarOrden({ idempotencyKey: 'clave-reusada', isDeleted: true }),
    ).resolves.toBeTruthy()
  })

  test('el mismo id de pago en el mismo comercio se rechaza', async () => {
    await armarOrden({ paymentIntent: { providerPaymentId: '555' } })

    await expect(armarOrden({ paymentIntent: { providerPaymentId: '555' } })).rejects.toMatchObject(
      { code: 11000 },
    )
  })

  test('muchas órdenes sin id de pago conviven (null no cuenta como valor)', async () => {
    // Es lo que rompía con una definición mal hecha: todas las órdenes recién
    // creadas, todavía sin pago, tienen el campo vacío.
    await armarOrden()
    await armarOrden()
    await expect(armarOrden()).resolves.toBeTruthy()
  })
})

describe('persistProviderPaymentId · MongoDB real', () => {
  test('escribe el id una sola vez y no pisa un vínculo existente', async () => {
    const orden = await armarOrden()

    expect(
      await persistProviderPaymentId({
        orderId: orden._id,
        tenantId: TENANT,
        providerPaymentId: 777,
      }),
    ).toBe(true)

    expect(
      await persistProviderPaymentId({
        orderId: orden._id,
        tenantId: TENANT,
        providerPaymentId: 888,
      }),
    ).toBe(false)

    expect((await ordenDe(orden._id)).paymentIntent.providerPaymentId).toBe('777')
  })

  test('un id de pago ya usado por otra orden del comercio no se escribe, y no lanza', async () => {
    await armarOrden({ paymentIntent: { providerPaymentId: '999' } })
    const otra = await armarOrden()

    // El índice único hace fallar la escritura; el pago ya se cobró, así que el
    // fallo se informa con false en vez de lanzar.
    await expect(
      persistProviderPaymentId({
        orderId: otra._id,
        tenantId: TENANT,
        providerPaymentId: 999,
      }),
    ).resolves.toBe(false)

    expect((await ordenDe(otra._id)).paymentIntent.providerPaymentId ?? null).toBeNull()
  })
})

// ─── 4. AUDITORÍA DE COBROS SIN VINCULAR ────────────────────────────────────

describe('auditoría de cobros sin vincular · MongoDB real', () => {
  const hace = minutos => new Date(Date.now() - minutos * 60 * 1000)

  // createdAt lo fija Mongoose; para envejecer una orden se escribe directo.
  const envejecer = (orden, minutos) =>
    Order.collection.updateOne({ _id: orden._id }, { $set: { createdAt: hace(minutos) } })

  const auditar = buscar =>
    auditOrderFinancials({
      since: hace(24 * 60),
      resolveTenantContext: async () => ({ accessToken: 'APP_USR-x' }),
      fetchProviderPayment: async () => ({}),
      searchProviderPayments: buscar,
    })

  test('encuentra el cobro que Mercado Pago tiene y la orden no', async () => {
    const producto = await crearProducto()
    const orden = await armarOrden({
      items: [{ producto, count: 1 }],
      stockReservedAt: hace(40),
    })
    await envejecer(orden, 40)

    const buscar = crearEspia([
      {
        id: 4242,
        status: 'approved',
        external_reference: String(orden._id),
        transaction_amount: 1000,
      },
    ])

    const resultado = await auditar(buscar)

    expect(buscar.calls).toEqual([
      { externalReference: String(orden._id), tenantId: String(TENANT) },
    ])
    expect(resultado.balanced).toBe(false)
    expect(resultado.findings).toEqual([
      expect.objectContaining({
        kind: 'provider-payment-unlinked',
        orderId: String(orden._id),
        proveedorPaymentId: '4242',
      }),
    ])
  })

  test('una orden reciente o ya vinculada no se consulta', async () => {
    const producto = await crearProducto()

    const reciente = await armarOrden({
      items: [{ producto, count: 1 }],
      stockReservedAt: new Date(),
    })

    const vinculada = await armarOrden({
      items: [{ producto, count: 1 }],
      stockReservedAt: hace(40),
      paymentIntent: { providerPaymentId: '1' },
    })
    await envejecer(vinculada, 40)

    const buscar = crearEspia([])
    await auditar(buscar)

    expect(buscar.calls.map(c => c.externalReference)).not.toContain(String(reciente._id))
    expect(buscar.calls.map(c => c.externalReference)).not.toContain(String(vinculada._id))
  })
})

// Un espía mínimo: en un archivo ESM `jest` no es global, y acá solo hace falta
// registrar con qué se lo llamó.
function crearEspia(resultado) {
  const fn = async argumentos => {
    fn.calls.push({ ...argumentos, tenantId: String(argumentos.tenantId) })
    return resultado
  }
  fn.calls = []
  return fn
}

// ─── 5. AVISO DE ÍNDICES FALTANTES ──────────────────────────────────────────
//
// Va al final: borra los índices de Order para comprobar que la diferencia se
// ve, y los vuelve a crear.

describe('salud de índices · MongoDB real', () => {
  afterAll(async () => {
    await Order.createIndexes()
  })

  test('ve los índices que faltan y deja de verlos cuando se crean', async () => {
    await Order.collection.dropIndexes()

    const antes = await findMissingIndexes()
    const faltanEnOrder = antes.missing.find(m => m.model === 'Order')

    expect(faltanEnOrder).toBeTruthy()

    const claves = faltanEnOrder.indexes.map(i => JSON.stringify(i.keys))
    expect(claves.some(k => k.includes('paymentIntent.providerPaymentId'))).toBe(true)
    expect(claves.some(k => k.includes('idempotencyKey'))).toBe(true)

    await Order.createIndexes()

    const despues = await findMissingIndexes()
    expect(despues.missing.find(m => m.model === 'Order')).toBeUndefined()
  })
})
