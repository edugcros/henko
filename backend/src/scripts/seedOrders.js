// 📁 src/scripts/seedOrders.js
import mongoose from 'mongoose'
import Order from '../models/orderModel.js'
import crypto from 'crypto'

export const seedOrders = async (tenantId, userId, count = 20) => {
  const statuses = ['processing', 'shipped', 'delivered', 'payment_pending']
  const tId = new mongoose.Types.ObjectId(tenantId)
  const uId = new mongoose.Types.ObjectId(userId)

  const dummyProducts = [
    { id: new mongoose.Types.ObjectId(), title: 'Producto Pro A', price: 150000 },
    { id: new mongoose.Types.ObjectId(), title: 'Producto Pro B', price: 85050 },
  ]

  const orders = []

  for (let i = 0; i < count; i++) {
    const subtotal = dummyProducts[0].price + (i * 100)
    const date = new Date()
    date.setDate(date.getDate() - Math.floor(Math.random() * 30))

    orders.push({
      tenantId: tId, // ID del comercio
      orderby: uId,  // ID del usuario
      products: [{
        product: dummyProducts[0].id,
        count: 1,
        priceCents: subtotal,
        subtotalCents: subtotal,
        // 🛡️ IMPORTANTE: Si el sub-esquema de productos en la orden requiere tenantId
        tenantId: tId, 
      }],
      paymentIntent: {
        provider: 'mercadopago',
        id: crypto.randomUUID(),
        status: statuses[Math.floor(Math.random() * statuses.length)],
        currency: 'ARS',
        amountCents: subtotal,
        originalAmountCents: subtotal,
        discountAmountCents: 0,
        // tenantId: tId // Agrégalo si tu esquema de paymentIntent también lo pide
      },
      orderStatus: statuses[Math.floor(Math.random() * statuses.length)],
      shippingAddress: {
        firstName: 'Cliente',
        lastName: `Prueba ${i}`,
        email: `test${i}@example.com`,
        address: 'Calle Falsa 123',
        city: 'CABA',
        country: 'AR',
      },
      createdAt: date,
      updatedAt: date,
    })
  }

  // Ejecutamos la inserción
  // 💡 Nota: insertMany es más rápido que loops de .save()
  await Order.insertMany(orders)
  
  console.log(`✅ ${count} órdenes de prueba creadas exitosamente para el tenant ${tenantId}`)
}