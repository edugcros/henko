import request from 'supertest'

import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Order, { FULFILLMENT_STATUS, PAYMENT_STATUS } from '../models/orderModel.js'
import Cart from '../models/cartModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
import {
  authHeaders,
  createTestProduct,
  createTestTenant,
  createTestUser,
  registerAndLoginUser,
} from './testSetup.js'

describe('orders - admin routes', () => {
  let tenantContext
  let buyerSession
  let adminSession
  let product
  let orderId

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(User, Product, Order, Cart, Tenant)

    tenantContext = await createTestTenant()
    buyerSession = await registerAndLoginUser({
      shopDomain: tenantContext.shopDomain,
      email: 'buyer-admin-order@test.com',
    })
    adminSession = await createTestUser({
      tenantId: tenantContext.tenant._id,
      email: 'admin-order@test.com',
      role: 'admin',
    })
    product = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Producto Orden Admin',
      price: 700,
      stock: 20,
    })

    await request(app)
      .post('/api/user/cart')
      .set(authHeaders({
        token: buyerSession.token,
        domain: tenantContext.shopDomain,
        csrfToken: buyerSession.csrfToken,
        csrfCookie: buyerSession.csrfCookie,
      }))
      .send({
        productId: product._id,
        quantity: 1,
      })

    const orderRes = await createTestOrder()

    orderId = orderRes.body.data._id
  })

  // Carga el carrito y confirma la orden, que es como nacen las órdenes reales.
  async function createTestOrder() {
    await request(app)
      .post('/api/user/cart')
      .set(authHeaders({
        token: buyerSession.token,
        domain: tenantContext.shopDomain,
        csrfToken: buyerSession.csrfToken,
        csrfCookie: buyerSession.csrfCookie,
      }))
      .send({
        productId: product._id,
        quantity: 1,
      })

    return request(app)
      .post('/api/order/create')
      .set(authHeaders({
        token: buyerSession.token,
        domain: tenantContext.shopDomain,
        csrfToken: buyerSession.csrfToken,
        csrfCookie: buyerSession.csrfCookie,
      }))
      .send({
        COD: true,
        shippingAddress: {
          firstName: 'Buyer',
          lastName: 'Admin',
          email: 'buyer-admin-order@test.com',
          phone: '+541123456789',
          address: 'Calle Test 456',
          city: 'Buenos Aires',
          zipCode: '1000',
          country: 'AR',
        },
      })
  }

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('lists tenant orders from the admin domain', async () => {
    const res = await request(app)
      .get('/api/order/getAll')
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.length).toBeGreaterThan(0)
  })

  test('el resumen abarca TODO lo filtrado, no la página que se está viendo', async () => {
    // La cabecera del panel mostraba el total de pedidos al lado de un importe
    // sumado solo sobre las órdenes cargadas: "250 pedidos • $12.340 en
    // ventas", donde los $12.340 eran los de esa página. Cambiaban al pasar de
    // página, y los contadores por estado también.
    //
    // Se piden 1 por página teniendo más de una orden: si el resumen se armara
    // con lo devuelto, daría el importe de una sola.
    await createTestOrder()

    const res = await request(app)
      .get('/api/order/getAll?limit=1')
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.pagination.total).toBeGreaterThan(1)

    const sumaDeLaPagina = res.body.data.reduce(
      (sum, order) => sum + Number(order.totals?.total || 0),
      0,
    )

    expect(res.body.summary.count).toBe(res.body.pagination.total)
    expect(res.body.summary.total).toBeGreaterThan(sumaDeLaPagina)

    // Los contadores por estado también salen del total, no de la página.
    const contados = Object.values(res.body.summary.byStatus).reduce(
      (sum, count) => sum + count,
      0,
    )
    expect(contados).toBe(res.body.pagination.total)
  })

  test('updates fulfillment status from the admin domain', async () => {
    const { csrfToken, csrfCookie } = buyerSession

    const res = await request(app)
      .put(`/api/order/${orderId}/fulfillment-status`)
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
        csrfToken,
        csrfCookie,
      }))
      .send({ fulfillmentStatus: FULFILLMENT_STATUS.PREPARING })

    expect(res.statusCode).toBe(200)
    expect(res.body.data.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    expect(res.body.data.fulfillmentStatus).toBe(FULFILLMENT_STATUS.PREPARING)
  })
})
