// 📁 src/models/couponUserUsageCounterModel.js
// Contador atómico de "cuántas veces usó ESTE usuario ESTE cupón" — la
// contraparte por-usuario de Coupon.usageCount (que ya es atómico vía
// consumeCouponAtomic). Sin esto, el límite por usuario se validaba con un
// CouponUsage.countDocuments() de solo lectura (TOCTOU): dos creaciones de
// orden casi simultáneas del mismo usuario podían ambas leer un conteo por
// debajo del límite y pasar.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

const couponUserUsageCounterSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    coupon: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
)

couponUserUsageCounterSchema.index(
  { tenantId: 1, coupon: 1, user: 1 },
  { unique: true },
)

couponUserUsageCounterSchema.plugin(tenantPlugin, { addTenantField: false })

const CouponUserUsageCounter =
  mongoose.models.CouponUserUsageCounter ||
  mongoose.model('CouponUserUsageCounter', couponUserUsageCounterSchema)

export default CouponUserUsageCounter
