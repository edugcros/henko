import { jest } from '@jest/globals'
import mongoose from 'mongoose'

import Order, { ORDER_STATUS, PAYMENT_STATUS, FULFILLMENT_STATUS } from '../models/orderModel.js'
import { ensureAdminOrManager } from '../services/orderExecutionService.js'
import {
  cancelOrderWithInventoryRestore,
  orderRequiresForceDeletion,
  refundOrderWithInventoryRestore,
} from '../services/orderAdminMutationService.js'
import { LEGACY_ORDER_STATUS, updateOrderPaymentStatus } from '../controller/orderCtrl.js'
import { getCouponsByProduct, validateCoupon } from '../controller/couponCtrl.js'
import Cart from '../models/cartModel.js'
import Coupon from '../models/couponModel.js'
import CouponUsage from '../models/CouponUsageModel.js'
import CouponUserUsageCounter from '../models/couponUserUsageCounterModel.js'
import Product from '../models/productModel.js'
import {
  consumeCouponForUserAtomic,
  consumeOrderCouponIfNeeded,
  ensureCouponUsageAllowedForUser,
  releaseOrderCouponIfNeeded,
} from '../services/orderCouponService.js'
import { reserveStockAtomic } from '../services/paymentOrderOpsService.js'
import { crearReplicaEnMemoria } from './testDB.js'

describe('order admin mutation guards', () => {
  test.each(['admin', 'moderator', 'manager', 'owner', 'superadmin'])(
    'allows %s to mutate orders',
    role => {
      expect(() => ensureAdminOrManager({ user: { role } })).not.toThrow()
    },
  )

  test.each(['user', 'guest', undefined, null])('rejects %s from mutating orders', role => {
    expect(() => ensureAdminOrManager({ user: { role } })).toThrow(
      expect.objectContaining({
        statusCode: 403,
      }),
    )
  })

  test('requires force when deleting paid or delivered orders', () => {
    expect(
      orderRequiresForceDeletion({
        order: {
          paymentStatus: PAYMENT_STATUS.APPROVED,
          orderStatus: ORDER_STATUS.OPEN,
          fulfillmentStatus: FULFILLMENT_STATUS.UNFULFILLED,
        },
        legacyOrderStatus: LEGACY_ORDER_STATUS,
      }).protectedOrder,
    ).toBe(true)

    expect(
      orderRequiresForceDeletion({
        order: {
          paymentStatus: PAYMENT_STATUS.PENDING,
          orderStatus: ORDER_STATUS.DELIVERED,
          fulfillmentStatus: FULFILLMENT_STATUS.DELIVERED,
        },
        legacyOrderStatus: LEGACY_ORDER_STATUS,
      }).protectedOrder,
    ).toBe(true)
  })
})

// El cupón de una venta que se deshace.
//
// Contra base real: lo que evita devolver dos veces es la escritura sobre el
// CouponUsage, y lo que importa al final son los contadores que quedan.
describe('el cupón de una orden reembolsada vuelve', () => {
  const TENANT = new mongoose.Types.ObjectId()
  const COMPRADOR = new mongoose.Types.ObjectId()
  const OTRO = new mongoose.Types.ObjectId()
  let mongod
  let cupon

  beforeAll(async () => {
    mongod = await crearReplicaEnMemoria()
    await mongoose.connect(mongod.getUri())
    await Promise.all([Coupon.init(), CouponUsage.init(), CouponUserUsageCounter.init()])
  }, 120000)

  afterAll(async () => {
    await mongoose.disconnect()
    await mongod?.stop()
  })

  const opciones = { tenantId: TENANT }
  const leerCupon = () => Coupon.findById(cupon._id).setOptions(opciones).lean()
  const usosDe = user =>
    CouponUserUsageCounter.findOne({ tenantId: TENANT, coupon: cupon._id, user })
      .setOptions(opciones)
      .lean()
  const usoDe = orden =>
    CouponUsage.findOne({ tenantId: TENANT, order: orden._id }).setOptions(opciones).lean()

  const orden = () => ({
    _id: new mongoose.Types.ObjectId(),
    coupon: { couponId: cupon._id },
    couponConsumedAt: null,
    products: [],
    paymentIntent: {
      originalAmountCents: 100000,
      discountAmountCents: 10000,
      amountCents: 90000,
      currency: 'ARS',
    },
  })

  // Como en un pago aprobado: es el único momento en que se consume.
  const ordenPagada = async (userId = COMPRADOR) => {
    const o = orden()

    await consumeOrderCouponIfNeeded({ order: o, tenantId: TENANT, userId })

    return o
  }

  const devolver = (o, session = null) =>
    releaseOrderCouponIfNeeded({ order: o, tenantId: TENANT, session })

  beforeEach(async () => {
    await Coupon.deleteMany({}).setOptions({ ignoreTenant: true })
    await CouponUsage.deleteMany({}).setOptions({ ignoreTenant: true })
    await CouponUserUsageCounter.deleteMany({}).setOptions({ ignoreTenant: true })

    cupon = await Coupon.create({
      tenantId: TENANT,
      code: 'VUELVE10',
      description: 'Cupón de prueba',
      discountType: 'percentage',
      discountValue: 10,
      usageLimit: 1,
      usageLimitPerUser: 1,
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      createdBy: COMPRADOR,
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('los dos contadores bajan y el uso queda como historial', async () => {
    // ESTA ES LA PROPIEDAD. Antes el comprador perdía el cupón y no lo recuperaba.
    const o = await ordenPagada()

    expect((await leerCupon()).usageCount).toBe(1)

    await devolver(o)

    expect((await leerCupon()).usageCount).toBe(0)
    expect((await usosDe(COMPRADOR)).count).toBe(0)
    expect((await usoDe(o)).releasedAt).toBeInstanceOf(Date)
  })

  test('el comprador puede volver a usarlo', async () => {
    const o = await ordenPagada()
    const puedeUsarlo = () =>
      ensureCouponUsageAllowedForUser({ coupon: cupon, userId: COMPRADOR, tenantId: TENANT })

    await expect(puedeUsarlo()).rejects.toThrow('límite de uso')

    await devolver(o)

    await expect(puedeUsarlo()).resolves.toBeUndefined()
    await expect(
      consumeCouponForUserAtomic({ coupon: cupon, userId: COMPRADOR, tenantId: TENANT }),
    ).resolves.toBeUndefined()
  })

  test('el panel de la tienda también se lo ofrece de nuevo', async () => {
    const producto = new mongoose.Types.ObjectId()
    const ofrecido = async () => {
      const res = { status: () => res, json: body => Object.assign(res, { body }) }

      jest.spyOn(Product, 'findOne').mockReturnValue({
        setOptions: () => ({
          lean: async () => ({ _id: producto, categoria: 'Test' }),
        }),
      })

      await getCouponsByProduct(
        {
          params: { productId: String(producto) },
          query: {},
          headers: {},
          tenantId: TENANT,
          tenant: { _id: TENANT },
          user: { _id: COMPRADOR, tenantId: TENANT },
        },
        res,
      )

      return res.body?.data?.[0]?.userCanUse
    }

    const o = await ordenPagada()

    await Coupon.updateOne({ _id: cupon._id }, { usageLimit: 5 }).setOptions(opciones)
    expect(await ofrecido()).toBe(false)

    await devolver(o)
    expect(await ofrecido()).toBe(true)
  })

  test('validar el cupón en el carrito deja de decir que ya se usó', async () => {
    const validar = async () => {
      const res = { status: () => res, json: body => Object.assign(res, { body }) }

      jest.spyOn(Cart, 'findOne').mockReturnValue({
        populate: () => ({
          lean: async () => ({ products: [{ productId: new mongoose.Types.ObjectId() }] }),
        }),
      })

      await validateCoupon(
        {
          body: { code: cupon.code },
          params: {},
          query: {},
          headers: {},
          tenantId: TENANT,
          tenant: { _id: TENANT },
          user: { _id: COMPRADOR, tenantId: TENANT },
        },
        res,
      )

      return res.body.code
    }

    const o = await ordenPagada()

    await Coupon.updateOne({ _id: cupon._id }, { usageLimit: 5 }).setOptions(opciones)
    expect(await validar()).toBe('USER_LIMIT_REACHED')

    await devolver(o)
    expect(await validar()).not.toBe('USER_LIMIT_REACHED')
  })

  test('dos caminos a la vez lo devuelven una sola vez', async () => {
    await Coupon.updateOne({ _id: cupon._id }, { usageLimit: 5 }).setOptions(opciones)

    const o = await ordenPagada()
    await ordenPagada(OTRO)

    await Promise.all([devolver(o), devolver(o), devolver(o)])

    expect((await leerCupon()).usageCount).toBe(1)
    expect((await usosDe(COMPRADOR)).count).toBe(0)
    expect((await usosDe(OTRO)).count).toBe(1)
  })

  test('un cupón vencido o borrado recupera el uso igual', async () => {
    const o = await ordenPagada()

    await Coupon.updateOne(
      { _id: cupon._id },
      { isDeleted: true, isActive: false, endDate: new Date(Date.now() - 1000) },
    ).setOptions(opciones)

    await devolver(o)

    expect((await leerCupon()).usageCount).toBe(0)
  })

  test('sin uso registrado no hay nada que devolver', async () => {
    await Coupon.updateOne({ _id: cupon._id }, { usageCount: 1 }).setOptions(opciones)

    expect(await devolver(orden())).toBeNull()
    expect(await devolver({ _id: new mongoose.Types.ObjectId() })).toBeNull()
    expect((await leerCupon()).usageCount).toBe(1)
  })

  // El consumo escribe los contadores antes que la marca de la orden: si el guardado
  // se cayó en el medio, la marca no está y el uso sí.
  test('lo devuelve aunque la orden no haya llegado a marcarlo', async () => {
    const o = await ordenPagada()

    o.couponConsumedAt = null
    await devolver(o)

    expect((await leerCupon()).usageCount).toBe(0)
  })

  test('una orden devuelta no vuelve a consumir el cupón', async () => {
    const o = await ordenPagada()

    await devolver(o)
    o.couponConsumedAt = null
    await consumeOrderCouponIfNeeded({ order: o, tenantId: TENANT, userId: COMPRADOR })

    expect((await leerCupon()).usageCount).toBe(0)
  })

  test('los contadores no bajan de cero', async () => {
    const o = await ordenPagada()

    await Coupon.updateOne({ _id: cupon._id }, { usageCount: 0 }).setOptions(opciones)
    await CouponUserUsageCounter.updateOne({ coupon: cupon._id }, { count: 0 }).setOptions(opciones)

    await devolver(o)

    expect((await leerCupon()).usageCount).toBe(0)
    expect((await usosDe(COMPRADOR)).count).toBe(0)
  })

  test('si no se pudo descontar, el próximo aviso lo reintenta', async () => {
    const o = await ordenPagada()
    const falla = jest.spyOn(Coupon, 'updateOne').mockImplementationOnce(() => ({
      setOptions: () => Promise.reject(new Error('sin conexión')),
    }))

    await expect(devolver(o)).resolves.toBeNull()
    expect((await usoDe(o)).releasedAt).toBeNull()

    falla.mockRestore()
    await devolver(o)

    expect((await leerCupon()).usageCount).toBe(0)
  })

  test('si falla el contador del comprador no se repite el descuento del total', async () => {
    await Coupon.updateOne({ _id: cupon._id }, { usageLimit: 5 }).setOptions(opciones)

    const o = await ordenPagada()
    await ordenPagada(OTRO)

    jest.spyOn(CouponUserUsageCounter, 'updateOne').mockImplementationOnce(() => ({
      setOptions: () => Promise.reject(new Error('sin conexión')),
    }))

    await devolver(o)
    await devolver(o)

    expect((await leerCupon()).usageCount).toBe(1)
  })

  test.each([
    ['del total', () => Coupon],
    ['del comprador', () => CouponUserUsageCounter],
  ])('dentro de una transacción, un error %s la aborta', async (_nombre, modelo) => {
    const o = await ordenPagada()
    const session = await mongoose.startSession()

    jest.spyOn(modelo(), 'updateOne').mockImplementationOnce(() => ({
      setOptions: () => Promise.reject(new Error('sin conexión')),
    }))

    await expect(session.withTransaction(() => devolver(o, session))).rejects.toThrow(
      'sin conexión',
    )
    await session.endSession()

    expect((await usoDe(o)).releasedAt).toBeNull()
    expect((await leerCupon()).usageCount).toBe(1)
  })

  describe('desde el panel', () => {
    const orderModel = order => ({
      findOne: () => ({ setOptions: () => ({ session: async () => order }) }),
    })

    const argumentos = order => ({
      orderModel: orderModel(order),
      orderId: String(order._id),
      tenantObjectId: TENANT,
      tenantId: TENANT,
      req: {},
      normalizeObjectId: id => id,
      isValidId: () => true,
    })

    test('un reembolso fallido deja el cupón como estaba', async () => {
      const o = await ordenPagada()
      const session = await mongoose.startSession()

      Object.assign(o, {
        paymentStatus: PAYMENT_STATUS.APPROVED,
        stockRestoredAt: new Date(),
        markRefunded: async () => {
          throw new Error('no se pudo guardar')
        },
      })

      await expect(
        session.withTransaction(() =>
          refundOrderWithInventoryRestore({ ...argumentos(o), session }),
        ),
      ).rejects.toThrow('no se pudo guardar')
      await session.endSession()

      expect((await leerCupon()).usageCount).toBe(1)
      expect((await usosDe(COMPRADOR)).count).toBe(1)
      expect((await usoDe(o)).releasedAt).toBeNull()
    })

    test('un reembolso lo devuelve', async () => {
      const o = await ordenPagada()
      const session = await mongoose.startSession()

      Object.assign(o, {
        paymentStatus: PAYMENT_STATUS.APPROVED,
        stockRestoredAt: new Date(),
        markRefunded: jest.fn(async () => undefined),
      })

      await session.withTransaction(() =>
        refundOrderWithInventoryRestore({ ...argumentos(o), session }),
      )
      await session.endSession()

      expect(o.markRefunded).toHaveBeenCalled()
      expect((await leerCupon()).usageCount).toBe(0)
    })

    test('cancelar una orden sin pagar no toca el cupón de nadie', async () => {
      await Coupon.updateOne({ _id: cupon._id }, { usageCount: 1 }).setOptions(opciones)

      const o = Object.assign(orden(), {
        paymentStatus: PAYMENT_STATUS.PENDING,
        orderStatus: ORDER_STATUS.OPEN,
        stockRestoredAt: new Date(),
        markCancelled: jest.fn(async () => undefined),
      })
      const session = await mongoose.startSession()

      await session.withTransaction(() =>
        cancelOrderWithInventoryRestore({ ...argumentos(o), session }),
      )
      await session.endSession()

      expect((await leerCupon()).usageCount).toBe(1)
    })
  })

  describe('aprobar el pago a mano', () => {
    const ADMIN = new mongoose.Types.ObjectId()
    const unico = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const crearOrden = (extra = {}) =>
      new Order({
        tenantId: TENANT,
        idempotencyKey: `orden-${unico()}`,
        orderby: COMPRADOR,
        products: [
          {
            product: new mongoose.Types.ObjectId(),
            count: 1,
            priceCents: 100000,
            originalPriceCents: 100000,
            subtotalCents: 100000,
            originalSubtotalCents: 100000,
            titleSnapshot: 'Zapatilla',
            currency: 'ARS',
          },
        ],
        paymentIntent: {
          id: `pi-${unico()}`,
          provider: 'mercadopago',
          status: PAYMENT_STATUS.PENDING,
          currency: 'ARS',
          amountCents: 90000,
          originalAmountCents: 100000,
          discountAmountCents: 10000,
        },
        paymentStatus: PAYMENT_STATUS.PENDING,
        // Sin esto el test necesitaría un producto real; el stock no es lo que se mira.
        stockCommittedAt: new Date(),
        coupon: { couponId: cupon._id, code: cupon.code },
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

    const cambiarPago = async (o, paymentStatus) => {
      const res = {
        statusCode: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(body) {
          this.body = body
          return this
        },
      }

      await updateOrderPaymentStatus(
        {
          params: { id: String(o._id) },
          body: { paymentStatus },
          headers: {},
          ip: '10.0.0.1',
          tenantId: TENANT,
          tenant: { _id: TENANT },
          user: { _id: ADMIN, tenantId: TENANT, role: 'admin' },
        },
        res,
        () => undefined,
      )

      return res
    }

    const leerOrden = o => Order.findById(o._id).setOptions(opciones).lean()

    beforeAll(async () => {
      await Order.init()
    })

    afterEach(async () => {
      await Order.deleteMany({}).setOptions({ ignoreTenant: true })
    })

    test('consume el cupón, a nombre del comprador', async () => {
      // ESTA ES LA PROPIEDAD. Aprobando acá el uso no contaba.
      const o = await crearOrden()

      const res = await cambiarPago(o, PAYMENT_STATUS.APPROVED)
      const uso = await usoDe(o)

      expect(res.statusCode).toBe(200)
      expect((await leerCupon()).usageCount).toBe(1)
      expect((await usosDe(COMPRADOR)).count).toBe(1)
      expect(await usosDe(ADMIN)).toBeNull()
      expect(String(uso.user)).toBe(String(COMPRADOR))
      expect(uso.ipAddress).toBeNull()
      expect((await leerOrden(o)).couponConsumedAt).toBeInstanceOf(Date)
    })

    test('el comprador ya no puede repetir un cupón de un solo uso', async () => {
      await crearOrden().then(o => cambiarPago(o, PAYMENT_STATUS.APPROVED))

      await expect(
        ensureCouponUsageAllowedForUser({ coupon: cupon, userId: COMPRADOR, tenantId: TENANT }),
      ).rejects.toThrow('límite de uso')
    })

    test('si después llega el aviso de Mercado Pago no se cuenta dos veces', async () => {
      const o = await crearOrden()

      await cambiarPago(o, PAYMENT_STATUS.APPROVED)

      const guardada = await Order.findById(o._id).setOptions(opciones)
      await consumeOrderCouponIfNeeded({
        order: guardada,
        tenantId: TENANT,
        userId: guardada.orderby,
      })

      expect((await leerCupon()).usageCount).toBe(1)
    })

    test('y reembolsarla después lo devuelve', async () => {
      const o = await crearOrden()

      await cambiarPago(o, PAYMENT_STATUS.APPROVED)
      await devolver(await leerOrden(o))

      expect((await leerCupon()).usageCount).toBe(0)
    })

    test('sin cupón en la orden no registra nada', async () => {
      const o = await crearOrden({ coupon: undefined })

      expect((await cambiarPago(o, PAYMENT_STATUS.APPROVED)).statusCode).toBe(200)
      expect(await usoDe(o)).toBeNull()
    })

    test.each([PAYMENT_STATUS.REJECTED, PAYMENT_STATUS.CANCELLED])(
      'pasarla a %s no consume nada',
      async paymentStatus => {
        const o = await crearOrden({ stockCommittedAt: null })

        await cambiarPago(o, paymentStatus)

        expect((await leerCupon()).usageCount).toBe(0)
        expect(await usoDe(o)).toBeNull()
      },
    )

    test('una aprobación inválida no consume nada', async () => {
      const o = await crearOrden({ paymentStatus: PAYMENT_STATUS.REJECTED })

      expect((await cambiarPago(o, PAYMENT_STATUS.APPROVED)).statusCode).toBe(400)
      expect((await leerCupon()).usageCount).toBe(0)
      expect(await usoDe(o)).toBeNull()
    })

    describe('el stock de una orden aprobada a mano', () => {
      let producto

      const crearProducto = stock =>
        Product.create({
          tenantId: TENANT,
          title: 'Zapatilla',
          slug: `zapatilla-${unico()}`,
          description: 'Producto de prueba',
          marca: 'Marca',
          categoria: 'Test',
          subcategoria: 'General',
          price: 1000,
          stock,
          currency: 'ARS',
          sku: `SKU-${unico().slice(-10).toUpperCase()}`,
          status: 'active',
          visibility: 'visible',
        })

      const conProducto = () =>
        crearOrden({
          stockCommittedAt: null,
          products: [
            {
              product: producto._id,
              count: 1,
              priceCents: 100000,
              originalPriceCents: 100000,
              subtotalCents: 100000,
              originalSubtotalCents: 100000,
              titleSnapshot: 'Zapatilla',
              currency: 'ARS',
            },
          ],
        })

      // Como al iniciar un pago con Mercado Pago: la reserva ya descuenta las unidades.
      const conReserva = async () => {
        const o = await conProducto()

        await reserveStockAtomic(o.products, TENANT, { orderId: o._id })

        return o
      }

      const stock = async () =>
        (await Product.findById(producto._id).setOptions(opciones).lean()).stock

      beforeEach(async () => {
        await Product.deleteMany({}).setOptions({ ignoreTenant: true })
        producto = await crearProducto(10)
      })

      test('una orden con reserva no descuenta las unidades otra vez', async () => {
        // ESTA ES LA PROPIEDAD. La reserva ya las descontó: quedaban 8 de 10.
        const o = await conReserva()

        expect(await stock()).toBe(9)

        const res = await cambiarPago(o, PAYMENT_STATUS.APPROVED)
        const final = await leerOrden(o)

        expect(res.statusCode).toBe(200)
        expect(await stock()).toBe(9)
        expect(final.stockCommittedAt).toBeInstanceOf(Date)
        expect(final.stockReservedAt).toBeNull()
      })

      test('se puede aprobar la última unidad, que ya es de esta orden', async () => {
        await Product.updateOne({ _id: producto._id }, { stock: 1 }).setOptions(opciones)

        const o = await conReserva()

        expect(await stock()).toBe(0)
        expect((await cambiarPago(o, PAYMENT_STATUS.APPROVED)).statusCode).toBe(200)
        expect(await stock()).toBe(0)
      })

      test('sin reserva la venta sí descuenta las unidades', async () => {
        const o = await conProducto()

        await cambiarPago(o, PAYMENT_STATUS.APPROVED)

        expect(await stock()).toBe(9)
        expect((await leerOrden(o)).stockCommittedAt).toBeInstanceOf(Date)
      })

      test('sin stock y sin reserva no se puede aprobar', async () => {
        await Product.updateOne({ _id: producto._id }, { stock: 0 }).setOptions(opciones)

        const o = await conProducto()

        expect((await cambiarPago(o, PAYMENT_STATUS.APPROVED)).statusCode).toBe(400)
        expect((await leerOrden(o)).paymentStatus).toBe(PAYMENT_STATUS.PENDING)
      })

      test('reembolsarla después devuelve exactamente lo que se vendió', async () => {
        const o = await conReserva()

        await cambiarPago(o, PAYMENT_STATUS.APPROVED)

        const session = await mongoose.startSession()

        await session.withTransaction(() =>
          refundOrderWithInventoryRestore({
            orderModel: Order,
            orderId: String(o._id),
            tenantObjectId: TENANT,
            tenantId: TENANT,
            session,
            performedBy: ADMIN,
            reason: 'Prueba',
            req: { headers: {}, ip: '10.0.0.1', user: { role: 'admin' } },
            normalizeObjectId: id => new mongoose.Types.ObjectId(id),
            isValidId: () => true,
          }),
        )
        await session.endSession()

        expect(await stock()).toBe(10)
      })

      test('rechazarla libera la reserva una sola vez', async () => {
        const o = await conReserva()

        await cambiarPago(o, PAYMENT_STATUS.REJECTED)

        expect(await stock()).toBe(10)
      })
    })

    test('si el cupón falla no se toca el stock, para que el reintento no lo repita', async () => {
      const o = await crearOrden({ stockCommittedAt: null })
      const stock = jest.spyOn(Product, 'findOne')

      jest.spyOn(CouponUsage, 'create').mockRejectedValueOnce(new Error('sin conexión'))

      expect((await cambiarPago(o, PAYMENT_STATUS.APPROVED)).statusCode).toBe(400)
      expect(stock).not.toHaveBeenCalled()
      expect((await leerOrden(o)).paymentStatus).toBe(PAYMENT_STATUS.PENDING)
    })
  })
})
