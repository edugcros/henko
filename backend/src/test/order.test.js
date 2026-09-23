import request from 'supertest'

import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Order, { PAYMENT_STATUS } from '../models/orderModel.js'
import Cart from '../models/cartModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
import mongoose from 'mongoose'

import { reserveStockAtomic } from '../services/paymentOrderOpsService.js'
import { restoreCommittedStockOnRefundIfNeeded } from '../services/paymentOrderOpsService.js'
import {
  authHeaders,
  createTestProduct,
  createTestTenant,
  registerAndLoginUser,
} from './testSetup.js'

describe('orders - storefront user', () => {
  let tenantContext
  let session
  let product
  let createdOrderId

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(User, Product, Order, Cart, Tenant)

    tenantContext = await createTestTenant()
    session = await registerAndLoginUser({
      shopDomain: tenantContext.shopDomain,
      email: 'order@test.com',
    })
    product = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Producto Orden',
      price: 500,
      stock: 30,
    })
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('creates a cash-on-delivery order from the cart', async () => {
    const cartRes = await request(app)
      .post('/api/user/cart')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .send({
        productId: product._id,
        quantity: 1,
      })

    expect(cartRes.statusCode).toBe(200)

    const orderRes = await request(app)
      .post('/api/order/create')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .send({
        COD: true,
        shippingAddress: {
          firstName: 'Pedro',
          lastName: 'Ordenado',
          email: 'order@test.com',
          phone: '+541123456789',
          address: 'Calle Test 123',
          city: 'Buenos Aires',
          zipCode: '1000',
          country: 'AR',
        },
      })

    expect(orderRes.statusCode).toBe(201)
    expect(orderRes.body.success).toBe(true)
    expect(orderRes.body.data.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    createdOrderId = orderRes.body.data._id
  })

  test('returns authenticated user orders', async () => {
    const res = await request(app)
      .get('/api/order/my-orders')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(String(res.body.data[0]._id)).toBe(String(createdOrderId))
  })

  test('decrements product stock for cash-on-delivery orders', async () => {
    const updatedProduct = await Product.findOne({
      _id: product._id,
      tenantId: tenantContext.tenant._id,
    }).setOptions({ tenantId: tenantContext.tenant._id })

    expect(updatedProduct.stock).toBeLessThan(30)
  })

  // La atribución solo se puede leer del request que crea la orden: el
  // PURCHASE server-side sale después, desde el webhook, cuando ya no hay
  // visitante. Se afirma sobre el documento guardado y no sobre la respuesta
  // del endpoint, que no devuelve estos campos.
  test('freezes visitor attribution and Meta click ids on the order', async () => {
    await request(app)
      .post('/api/user/cart')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .send({ productId: product._id, quantity: 1 })

    const orderRes = await request(app)
      .post('/api/order/create')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .set('x-metric-session-id', 'sesion-atribucion-1')
      .set(
        'x-metric-attribution',
        JSON.stringify({ utmSource: 'instagram', utmCampaign: 'primavera' }),
      )
      .set('x-fbc', 'fb.1.1700000000.AbCdEf')
      .set('x-fbp', 'fb.1.1700000000.987654321')
      .send({
        COD: true,
        idempotencyKey: 'orden-con-atribucion',
        shippingAddress: {
          firstName: 'Pedro',
          lastName: 'Ordenado',
          email: 'order@test.com',
          phone: '+541123456789',
          address: 'Calle Test 123',
          city: 'Buenos Aires',
          zipCode: '1000',
          country: 'AR',
        },
      })

    expect(orderRes.statusCode).toBe(201)

    const saved = await Order.findOne({
      _id: orderRes.body.data._id,
      tenantId: tenantContext.tenant._id,
    }).setOptions({ tenantId: tenantContext.tenant._id })

    expect(saved.sessionId).toBe('sesion-atribucion-1')
    expect(saved.attribution.utmSource).toBe('instagram')
    expect(saved.attribution.utmCampaign).toBe('primavera')
    // metaCapiService los manda como fbc/fbp; sin esto el evento sale sin
    // matching de campaña.
    expect(saved.metaClickIds.fbc).toBe('fb.1.1700000000.AbCdEf')
    expect(saved.metaClickIds.fbp).toBe('fb.1.1700000000.987654321')
  })

  test('survives a corrupted attribution header without failing checkout', async () => {
    await request(app)
      .post('/api/user/cart')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .send({ productId: product._id, quantity: 1 })

    const orderRes = await request(app)
      .post('/api/order/create')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .set('x-metric-attribution', '{no-es-json')
      .send({
        COD: true,
        idempotencyKey: 'orden-con-header-roto',
        shippingAddress: {
          firstName: 'Pedro',
          lastName: 'Ordenado',
          email: 'order@test.com',
          phone: '+541123456789',
          address: 'Calle Test 123',
          city: 'Buenos Aires',
          zipCode: '1000',
          country: 'AR',
        },
      })

    expect(orderRes.statusCode).toBe(201)

    const saved = await Order.findOne({
      _id: orderRes.body.data._id,
      tenantId: tenantContext.tenant._id,
    }).setOptions({ tenantId: tenantContext.tenant._id })

    expect(saved.attribution.utmSource).toBe('')
  })
})

// reserveStockAtomic promete, en su propio comentario, que "si una línea falla
// por falta de stock, las líneas ya descontadas de ese mismo intento se
// revierten automáticamente". Esa promesa depende enteramente de que
// withOptionalTransaction abra una transacción de verdad — y durante toda la
// vida del helper no la abrió, porque leía `db.topology`, undefined en este
// driver. O sea que un carrito de dos productos donde el segundo no tenía
// stock dejaba el primero descontado para siempre.
describe('reserva de stock - atomicidad entre líneas', () => {
  let tenantContext
  let conStock
  let sinStock

  beforeAll(async () => {
    await connectTestDB()
    tenantContext = await createTestTenant()

    conStock = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Con stock',
      price: 1000,
      stock: 10,
    })

    sinStock = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Sin stock',
      price: 1000,
      stock: 1,
    })
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('una línea sin stock revierte el descuento de la anterior', async () => {
    const lineas = [
      { product: conStock._id, count: 3, titleSnapshot: 'Con stock' },
      { product: sinStock._id, count: 5, titleSnapshot: 'Sin stock' },
    ]

    await expect(
      reserveStockAtomic(lineas, tenantContext.tenant._id),
    ).rejects.toThrow()

    const recargado = await Product.findOne({
      _id: conStock._id,
      tenantId: tenantContext.tenant._id,
    }).setOptions({ tenantId: tenantContext.tenant._id })

    // 10 y no 7: el descuento de la primera línea tiene que haberse deshecho.
    expect(recargado.stock).toBe(10)
  })
})

// Devolución informada por Mercado Pago y reposición de stock.
//
// Cuando la devolución llega del proveedor, applyMercadoPagoStatusToOrder pone
// la orden en 'refunded' y hasta ahora ahí terminaba: las unidades quedaban
// vendidas para siempre. La reposición vivía solo en el camino de admin.
//
// Medido en producción: la única orden reembolsada tiene stockCommittedAt del
// 11/09, stockRestoredAt en null y ninguna entrada 'refunded' en su auditLog
// — o sea que no pasó por admin, pasó por el proveedor.
describe('devolución del proveedor · el stock vuelve, y una sola vez', () => {
  let tenantContext
  let producto
  let orden

  beforeAll(async () => {
    await connectTestDB()
    tenantContext = await createTestTenant()
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  // El estado en el que queda una orden después de que el pago se aprueba: el
  // stock ya se descontó y se confirmó, y la reserva se limpió. Esa es
  // exactamente la razón por la que releaseRejectedPaymentReservationIfNeeded
  // no cubre este caso: mira la reserva, que acá ya no existe.
  const armarVentaAprobada = async () => {
    producto = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Vendido y devuelto',
      price: 1000,
      stock: 7,
    })

    orden = new Order({
      tenantId: tenantContext.tenant._id,
      idempotencyKey: `devolucion-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      orderby: new mongoose.Types.ObjectId(),
      products: [
        {
          product: producto._id,
          count: 3,
          priceCents: 100000,
          originalPriceCents: 100000,
          subtotalCents: 300000,
          originalSubtotalCents: 300000,
          titleSnapshot: 'Vendido y devuelto',
          currency: 'ARS',
        },
      ],
      paymentIntent: {
        id: `pi-${Date.now()}`,
        provider: 'mercadopago',
        providerPaymentId: '123456',
        status: PAYMENT_STATUS.REFUNDED,
        currency: 'ARS',
        amountCents: 300000,
        originalAmountCents: 300000,
        discountAmountCents: 0,
      },
      // Lo que deja applyMercadoPagoStatusToOrder cuando el proveedor informa
      // una devolución: cambia los estados y nada más.
      paymentStatus: PAYMENT_STATUS.REFUNDED,
      refundStatus: 'refunded',
      paidAt: new Date(),
      stockReservedAt: null,
      stockCommittedAt: new Date(),
      stockRestoredAt: null,
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
    })

    await orden.save({ tenantId: tenantContext.tenant._id })
    return orden
  }

  const stockDelProducto = async () => {
    const p = await Product.findOne({
      _id: producto._id,
      tenantId: tenantContext.tenant._id,
    }).setOptions({ tenantId: tenantContext.tenant._id })
    return p.stock
  }

  test('devuelve al catálogo las unidades de la venta', async () => {
    const o = await armarVentaAprobada()

    await restoreCommittedStockOnRefundIfNeeded({
      order: o,
      tenantId: tenantContext.tenant._id,
    })

    expect(await stockDelProducto()).toBe(10)
    expect(o.stockRestoredAt).toBeTruthy()
    expect(o.auditLog.map(e => e.action)).toContain('stock_restored')
  })

  test('un reintento del webhook no devuelve el stock dos veces', async () => {
    const o = await armarVentaAprobada()
    const ctx = { order: o, tenantId: tenantContext.tenant._id }

    await restoreCommittedStockOnRefundIfNeeded(ctx)
    await restoreCommittedStockOnRefundIfNeeded(ctx)

    expect(await stockDelProducto()).toBe(10)
  })

  // Mercado Pago reintenta los webhooks, y el polling de estado puede correr
  // en paralelo con uno. Sin el reclamo atómico de stockRestoredAt, las dos
  // ejecuciones leen null y las dos reponen: el catálogo termina prometiendo
  // unidades que no existen.
  test('dos ejecuciones simultáneas devuelven 3 unidades, no 6', async () => {
    const o = await armarVentaAprobada()

    // Dos copias distintas del documento: es lo que pasa de verdad cuando el
    // webhook y el polling cargan la misma orden cada uno por su lado.
    const copia = await Order.findOne({
      _id: o._id,
      tenantId: tenantContext.tenant._id,
    }).setOptions({ tenantId: tenantContext.tenant._id })

    await Promise.all([
      restoreCommittedStockOnRefundIfNeeded({
        order: o,
        tenantId: tenantContext.tenant._id,
      }),
      restoreCommittedStockOnRefundIfNeeded({
        order: copia,
        tenantId: tenantContext.tenant._id,
      }),
    ])

    // 7 + 3 = 10. Si el stock volviera dos veces darían 13.
    expect(await stockDelProducto()).toBe(10)
  })

  test('una orden que no está devuelta no toca el stock', async () => {
    const o = await armarVentaAprobada()
    o.paymentStatus = PAYMENT_STATUS.APPROVED

    await restoreCommittedStockOnRefundIfNeeded({
      order: o,
      tenantId: tenantContext.tenant._id,
    })

    expect(await stockDelProducto()).toBe(7)
  })
})
