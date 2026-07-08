// 📁 src/models/orderModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / MERCADO PAGO / VARIANTES / CUPONES / STOCK / AUDITORÍA

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

// =====================================================
// ENUMS DE DOMINIO
// =====================================================

export const ORDER_STATUS = {
  OPEN: 'open',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
}

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
}

export const FULFILLMENT_STATUS = {
  UNFULFILLED: 'unfulfilled',
  PREPARING: 'preparing',
  READY_TO_SHIP: 'ready_to_ship',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
}

export const REFUND_STATUS = {
  NONE: 'none',
  REQUESTED: 'requested',
  PARTIAL: 'partial',
  REFUNDED: 'refunded',
}

const ALLOWED_PAYMENT_PROVIDERS = ['mercadopago', 'cod']
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// =====================================================
// HELPERS
// =====================================================

const isSameTenant = (docTenantId, tenantId) => {
  return Boolean(
    docTenantId &&
      tenantId &&
      String(docTenantId) === String(tenantId),
  )
}

const normalizeEmail = value => {
  return String(value || '').trim().toLowerCase()
}

const deriveOrderStatus = doc => {
  if (doc.refundStatus === REFUND_STATUS.REFUNDED) {
    return ORDER_STATUS.REFUNDED
  }

  if (
    doc.paymentStatus === PAYMENT_STATUS.CANCELLED ||
    doc.cancellation?.cancelled === true
  ) {
    return ORDER_STATUS.CANCELLED
  }

  if (doc.fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED) {
    return ORDER_STATUS.DELIVERED
  }

  if (doc.fulfillmentStatus === FULFILLMENT_STATUS.SHIPPED) {
    return ORDER_STATUS.SHIPPED
  }

  if (
    doc.paymentStatus === PAYMENT_STATUS.APPROVED ||
    doc.fulfillmentStatus === FULFILLMENT_STATUS.PREPARING ||
    doc.fulfillmentStatus === FULFILLMENT_STATUS.READY_TO_SHIP
  ) {
    return ORDER_STATUS.PROCESSING
  }

  return ORDER_STATUS.OPEN
}

const sumBy = (items, getter) => {
  return (items || []).reduce((total, item) => {
    return total + Number(getter(item) || 0)
  }, 0)
}

const safeToObject = value => {
  if (!value) return {}

  if (typeof value.toObject === 'function') {
    return value.toObject()
  }

  if (typeof value === 'object') {
    return { ...value }
  }

  return {}
}

// =====================================================
// AUDIT LOG SCHEMA
// =====================================================

const auditLogEntrySchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        'created',
        'payment_updated',
        'payment_failed',
        'fulfillment_updated',
        'cancelled',
        'refunded',
        'stock_restored',
        'email_sent',
        'email_failed',
        'webhook_received',
        'webhook_processed',
        'modified',
        'deleted',
        'soft_deleted',
        'restored',
        'order_status_updated',
      ],
    },

    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    performedByRole: {
      type: String,
      enum: ['system', 'customer', 'admin', 'manager', 'webhook'],
      default: 'system',
    },

    previousState: {
      type: Schema.Types.Mixed,
      default: null,
    },

    newState: {
      type: Schema.Types.Mixed,
      default: null,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    ipAddress: {
      type: String,
      trim: true,
      default: null,
    },

    userAgent: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    _id: true,
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  },
)

// =====================================================
// SUBDOCUMENTOS
// =====================================================

const orderProductSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },

    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },

    count: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
    },

    color: {
      type: Schema.Types.ObjectId,
      ref: 'Color',
      default: null,
    },

    // Snapshots inmutables del producto al momento de compra
    titleSnapshot: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },

    slugSnapshot: {
      type: String,
      default: null,
      trim: true,
      immutable: true,
    },

    imageSnapshot: {
      type: String,
      default: null,
      trim: true,
      immutable: true,
    },

    skuSnapshot: {
      type: String,
      default: null,
      trim: true,
      immutable: true,
    },

    // Variante seleccionada
    variantId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    variantKey: {
      type: String,
      default: null,
      trim: true,
    },

    variantSku: {
      type: String,
      default: null,
      trim: true,
    },

    selectedAttributes: {
      type: Map,
      of: String,
      default: {},
    },

    // Precios en centavos
    priceCents: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },

    originalPriceCents: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },

    discountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      immutable: true,
    },

    promotionId: {
      type: Schema.Types.ObjectId,
      ref: 'PromotionalBlock',
      default: null,
      immutable: true,
    },

    promotionTitle: {
      type: String,
      default: null,
      trim: true,
      immutable: true,
    },

    promotionType: {
      type: String,
      default: null,
      trim: true,
      immutable: true,
    },

    subtotalCents: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },

    originalSubtotalCents: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },

    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
    },
  },
  {
    _id: false,
    strict: true,
  },
)

const cancellationSchema = new Schema(
  {
    cancelled: {
      type: Boolean,
      default: false,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    ipAddress: {
      type: String,
      trim: true,
      default: null,
    },

    userAgent: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    _id: false,
    timestamps: {
      createdAt: 'recordedAt',
      updatedAt: false,
    },
  },
)

const shipmentSchema = new Schema(
  {
    trackingNumber: {
      type: String,
      trim: true,
      default: null,
    },

    carrier: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },

    shippedAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    _id: false,
    timestamps: {
      createdAt: 'recordedAt',
      updatedAt: 'lastUpdatedAt',
    },
  },
)

const customerSnapshotSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    firstname: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },

    lastname: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },

    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
      maxlength: 255,
      validate: {
        validator: value => {
          if (!value) return true
          return EMAIL_REGEX.test(normalizeEmail(value))
        },
        message: 'Email del cliente inválido',
      },
    },

    mobile: {
      type: String,
      default: '',
      trim: true,
      maxlength: 50,
    },

    validatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  },
)

// =====================================================
// ORDER SCHEMA
// =====================================================

const orderSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },

    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    products: {
      type: [orderProductSchema],
      validate: [
        {
          validator: arr => Array.isArray(arr) && arr.length > 0,
          message: 'La orden debe contener al menos un producto',
        },
        {
          validator: arr => Array.isArray(arr) && arr.length <= 100,
          message: 'Máximo 100 productos por orden',
        },
      ],
    },

    paymentIntent: {
      id: {
        type: String,
        required: true,
        trim: true,
      },

      provider: {
        type: String,
        enum: ALLOWED_PAYMENT_PROVIDERS,
        required: true,
      },

      providerPaymentId: {
        type: String,
        default: null,
        trim: true,
      },

      status: {
        type: String,
        enum: Object.values(PAYMENT_STATUS),
        default: PAYMENT_STATUS.PENDING,
      },

      providerRawStatus: {
        type: String,
        default: null,
        trim: true,
        maxlength: 100,
      },

      statusDetail: {
        type: String,
        default: null,
        trim: true,
        maxlength: 100,
      },

      providerResponse: {
        type: Schema.Types.Mixed,
        default: null,
        select: false,
      },

      method: {
        type: String,
        maxlength: 50,
        trim: true,
        default: null,
      },

      installments: {
        type: Number,
        min: 1,
        max: 12,
        default: null,
      },

      payerEmail: {
        type: String,
        lowercase: true,
        trim: true,
        maxlength: 255,
        default: null,
        validate: {
          validator: value => {
            if (!value) return true
            return EMAIL_REGEX.test(normalizeEmail(value))
          },
          message: 'Email del pagador inválido',
        },
      },

      currency: {
        type: String,
        default: 'ARS',
        uppercase: true,
        trim: true,
      },

      amountCents: {
        type: Number,
        required: true,
        min: 0,
      },

      originalAmountCents: {
        type: Number,
        required: true,
        min: 0,
      },

      discountAmountCents: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    orderStatus: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.OPEN,
      lowercase: true,
      trim: true,
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      lowercase: true,
      trim: true,
      index: true,
    },

    fulfillmentStatus: {
      type: String,
      enum: Object.values(FULFILLMENT_STATUS),
      default: FULFILLMENT_STATUS.UNFULFILLED,
      lowercase: true,
      trim: true,
      index: true,
    },

    refundStatus: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.NONE,
      lowercase: true,
      trim: true,
      index: true,
    },

    orderby: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    customerSnapshot: {
      type: customerSnapshotSchema,
      required: true,
    },

    coupon: {
      couponId: {
        type: Schema.Types.ObjectId,
        ref: 'Coupon',
        default: null,
      },

      code: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      discountPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },

      discountAmountCents: {
        type: Number,
        min: 0,
        default: 0,
      },

      applicableProducts: {
        type: [Schema.Types.ObjectId],
        default: [],
      },
    },

    shippingAddress: {
      firstName: {
        type: String,
        required: true,
        maxlength: 100,
        trim: true,
      },

      lastName: {
        type: String,
        required: true,
        maxlength: 100,
        trim: true,
      },

      email: {
        type: String,
        required: true,
        maxlength: 255,
        trim: true,
        lowercase: true,
        validate: {
          validator: value => EMAIL_REGEX.test(normalizeEmail(value)),
          message: 'Email de envío inválido',
        },
      },

      phone: {
        type: String,
        required: true,
        maxlength: 50,
        trim: true,
      },

      address: {
        type: String,
    
        maxlength: 255,
        trim: true,
      },

      city: {
        type: String,
    
        maxlength: 100,
        trim: true,
      },

      zipCode: {
        type: String,
    
        maxlength: 20,
        trim: true,
      },

      country: {
        type: String,
    
        maxlength: 2,
        default: 'AR',
        uppercase: true,
        trim: true,
      },
    },

    shipment: {
      type: shipmentSchema,
      default: () => ({}),
    },

    cancellation: {
      type: cancellationSchema,
      default: () => ({}),
    },

    auditLog: {
      type: [auditLogEntrySchema],
      default: [],
    },

    stockRestoredAt: {
      type: Date,
      default: null,
    },

    stockCommittedAt: {
      type: Date,
      default: null,
    },

    stockReservedAt: {
      type: Date,
      default: null,
    },

    couponConsumedAt: {
      type: Date,
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    emailSent: {
      type: Boolean,
      default: false,
    },

    emailSentAt: {
      type: Date,
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deleteReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },

    emailResentAt: {
      type: Date,
      default: null,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    paymentError: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },

    paymentErrorCode: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
    },

    lastPaymentAttemptAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    optimisticConcurrency: true,
    strict: true,
  },
)

// =====================================================
// ÍNDICES MULTI-TENANT
// =====================================================

orderSchema.index(
  {
    tenantId: 1,
    'paymentIntent.providerPaymentId': 1,
  },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      isDeleted: false,
      'paymentIntent.providerPaymentId': {
        $exists: true,
        $ne: null,
      },
    },
  },
)

orderSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
      idempotencyKey: {
        $exists: true,
        $ne: null,
      },
    },
  },
)

orderSchema.index({ tenantId: 1, orderby: 1, createdAt: -1 })
orderSchema.index({ tenantId: 1, orderStatus: 1, createdAt: -1 })
orderSchema.index({ tenantId: 1, paymentStatus: 1, createdAt: -1 })
orderSchema.index({ tenantId: 1, fulfillmentStatus: 1, createdAt: -1 })
orderSchema.index({ tenantId: 1, refundStatus: 1, createdAt: -1 })
orderSchema.index({ tenantId: 1, 'paymentIntent.id': 1 })
orderSchema.index({ tenantId: 1, 'paymentIntent.amountCents': 1, createdAt: -1 })
orderSchema.index({ tenantId: 1, 'auditLog.performedBy': 1, 'auditLog.createdAt': -1 })

// =====================================================
// HOOKS
// =====================================================

orderSchema.pre('validate', function orderPreValidate(next) {
  if (!this.paymentStatus && this.paymentIntent?.status) {
    this.paymentStatus = this.paymentIntent.status
  }

  if (this.paymentIntent) {
    this.paymentIntent.status = this.paymentStatus
  }

  for (const product of this.products || []) {
    if (product.tenantId && String(product.tenantId) !== String(this.tenantId)) {
      return next(
        new Error(
          `Security violation: product tenant (${product.tenantId}) does not match order tenant (${this.tenantId})`,
        ),
      )
    }

    if (!product.tenantId) {
      product.tenantId = this.tenantId
    }
  }

  this.orderStatus = deriveOrderStatus(this)
  return next()
})

orderSchema.pre('save', function orderPreSave(next) {
  const productsSubtotalCents = sumBy(
    this.products,
    product => product.subtotalCents,
  )

  if (productsSubtotalCents !== this.paymentIntent.originalAmountCents) {
    return next(
      new Error(
        `INTEGRITY_ERROR: products total (${productsSubtotalCents}) != originalAmount (${this.paymentIntent.originalAmountCents})`,
      ),
    )
  }

  if (
    this.paymentIntent.discountAmountCents >
    this.paymentIntent.originalAmountCents
  ) {
    return next(
      new Error(
        `INTEGRITY_ERROR: discountAmountCents (${this.paymentIntent.discountAmountCents}) cannot exceed originalAmountCents (${this.paymentIntent.originalAmountCents})`,
      ),
    )
  }

  const expectedAmount =
    this.paymentIntent.originalAmountCents -
    this.paymentIntent.discountAmountCents

  if (this.paymentIntent.amountCents !== expectedAmount) {
    return next(
      new Error(
        `INTEGRITY_ERROR: amountCents (${this.paymentIntent.amountCents}) != original (${this.paymentIntent.originalAmountCents}) - discount (${this.paymentIntent.discountAmountCents})`,
      ),
    )
  }

  this.orderStatus = deriveOrderStatus(this)

  return next()
})

// =====================================================
// MÉTODOS DE AUDITORÍA
// =====================================================

orderSchema.methods.addAuditEntry = function addAuditEntry(entry = {}) {
  this.auditLog.push({
    action: entry.action || 'modified',
    performedBy: entry.performedBy || null,
    performedByRole: entry.performedByRole || 'system',
    previousState: entry.previousState || null,
    newState: entry.newState || null,
    reason: entry.reason || null,
    metadata: entry.metadata || {},
    ipAddress: entry.ipAddress || null,
    userAgent: entry.userAgent || null,
  })

  return this
}

// =====================================================
// MÉTODOS DE INSTANCIA
// =====================================================

orderSchema.methods.isPaid = function isPaid() {
  return this.paymentStatus === PAYMENT_STATUS.APPROVED
}

orderSchema.methods.getTotalAmountCents = function getTotalAmountCents() {
  return Number(this.paymentIntent?.amountCents || 0)
}

orderSchema.methods.getOriginalAmountCents = function getOriginalAmountCents() {
  return sumBy(this.products, product => product.subtotalCents)
}

orderSchema.methods.syncDerivedState = function syncDerivedState() {
  if (this.paymentIntent) {
    this.paymentIntent.status = this.paymentStatus
  }

  this.orderStatus = deriveOrderStatus(this)
  return this
}

orderSchema.methods.recordPaymentFailure = async function recordPaymentFailure(
  {
    tenantId,
    code = null,
    message = null,
    performedBy = null,
    session = null,
    req = null,
    metadata = {},
  } = {},
) {
  if (!isSameTenant(this.tenantId, tenantId)) {
    throw new Error('Access denied: tenant mismatch')
  }

  this.paymentError = message || 'Error procesando el pago'
  this.paymentErrorCode = code || null
  this.lastPaymentAttemptAt = new Date()

  this.addAuditEntry({
    action: 'payment_failed',
    performedBy,
    performedByRole: performedBy ? 'customer' : 'system',
    reason: this.paymentError,
    metadata: {
      code,
      ...metadata,
    },
    ipAddress: req?.ip,
    userAgent: req?.headers?.['user-agent'],
  })

  await this.save({ session, tenantId })
  return this
}

orderSchema.methods.updatePaymentStatus = async function updatePaymentStatus(
  nextPaymentStatus,
  { tenantId, performedBy = null, reason = null, session = null, req = null } = {},
) {
  if (!isSameTenant(this.tenantId, tenantId)) {
    throw new Error('Access denied: tenant mismatch')
  }

  const allowed = {
    pending: ['approved', 'rejected', 'cancelled'],
    approved: ['refunded'],
    rejected: [],
    cancelled: [],
    refunded: [],
  }

  const current = this.paymentStatus

  if (!allowed[current]?.includes(nextPaymentStatus)) {
    throw new Error(`Invalid payment transition: ${current} -> ${nextPaymentStatus}`)
  }

  const previousState = {
    paymentStatus: this.paymentStatus,
    orderStatus: this.orderStatus,
  }

  this.paymentStatus = nextPaymentStatus
  this.paymentError = null
  this.paymentErrorCode = null
  this.lastPaymentAttemptAt = new Date()

  if (nextPaymentStatus === PAYMENT_STATUS.APPROVED && !this.paidAt) {
    this.paidAt = new Date()
  }

  if (nextPaymentStatus === PAYMENT_STATUS.CANCELLED) {
    this.cancellation.cancelled = true
    this.cancellation.cancelledAt = new Date()
    this.cancellation.cancelledBy = performedBy
    this.cancellation.reason = reason || 'Cancelado'

    if (req) {
      this.cancellation.ipAddress = req.ip
      this.cancellation.userAgent = req.headers['user-agent']
    }
  }

  if (nextPaymentStatus === PAYMENT_STATUS.REFUNDED) {
    this.refundStatus = REFUND_STATUS.REFUNDED
  }

  this.syncDerivedState()

  this.addAuditEntry({
    action: 'payment_updated',
    performedBy,
    performedByRole: performedBy ? 'customer' : 'system',
    previousState,
    newState: {
      paymentStatus: this.paymentStatus,
      orderStatus: this.orderStatus,
    },
    reason,
    ipAddress: req?.ip,
    userAgent: req?.headers?.['user-agent'],
  })

  await this.save({ session, tenantId })
  return this
}

orderSchema.methods.updateFulfillmentStatus = async function updateFulfillmentStatus(
  nextFulfillmentStatus,
  { tenantId, performedBy = null, reason = null, session = null, req = null } = {},
) {
  if (!isSameTenant(this.tenantId, tenantId)) {
    throw new Error('Access denied: tenant mismatch')
  }

  const allowed = {
    unfulfilled: ['preparing', 'ready_to_ship', 'shipped'],
    preparing: ['ready_to_ship', 'shipped'],
    ready_to_ship: ['shipped'],
    shipped: ['delivered', 'returned'],
    delivered: [],
    returned: [],
  }

  const current = this.fulfillmentStatus

  if (!allowed[current]?.includes(nextFulfillmentStatus)) {
    throw new Error(`Invalid fulfillment transition: ${current} -> ${nextFulfillmentStatus}`)
  }

  const previousState = {
    fulfillmentStatus: this.fulfillmentStatus,
    orderStatus: this.orderStatus,
  }

  this.fulfillmentStatus = nextFulfillmentStatus

  if (nextFulfillmentStatus === FULFILLMENT_STATUS.SHIPPED && !this.shipment.shippedAt) {
    this.shipment.shippedAt = new Date()
    this.shipment.updatedBy = performedBy
  }

  if (nextFulfillmentStatus === FULFILLMENT_STATUS.DELIVERED && !this.shipment.deliveredAt) {
    this.shipment.deliveredAt = new Date()
    this.shipment.updatedBy = performedBy
  }

  this.syncDerivedState()

  this.addAuditEntry({
    action: 'fulfillment_updated',
    performedBy,
    performedByRole: performedBy ? 'admin' : 'system',
    previousState,
    newState: {
      fulfillmentStatus: this.fulfillmentStatus,
      orderStatus: this.orderStatus,
    },
    reason,
    ipAddress: req?.ip,
    userAgent: req?.headers?.['user-agent'],
  })

  await this.save({ session, tenantId })
  return this
}

orderSchema.methods.markCancelled = async function markCancelled(
  {
    tenantId,
    cancelledBy = null,
    reason = 'Cancelación manual',
    session = null,
    req = null,
  } = {},
) {
  if (!isSameTenant(this.tenantId, tenantId)) {
    throw new Error('Access denied: tenant mismatch')
  }

  if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED].includes(this.orderStatus)) {
    throw new Error(`Order already finalized as ${this.orderStatus}`)
  }

  const previousState = {
    orderStatus: this.orderStatus,
    paymentStatus: this.paymentStatus,
    cancellation: safeToObject(this.cancellation),
  }

  this.cancellation.cancelled = true
  this.cancellation.cancelledAt = new Date()
  this.cancellation.cancelledBy = cancelledBy
  this.cancellation.reason = reason

  if (req) {
    this.cancellation.ipAddress = req.ip
    this.cancellation.userAgent = req.headers['user-agent']
  }

  if (this.paymentStatus === PAYMENT_STATUS.PENDING) {
    this.paymentStatus = PAYMENT_STATUS.CANCELLED
  }

  this.syncDerivedState()

  this.addAuditEntry({
    action: 'cancelled',
    performedBy: cancelledBy,
    performedByRole: cancelledBy ? 'admin' : 'system',
    previousState,
    newState: {
      orderStatus: this.orderStatus,
      paymentStatus: this.paymentStatus,
      cancellation: safeToObject(this.cancellation),
    },
    reason,
    ipAddress: req?.ip,
    userAgent: req?.headers?.['user-agent'],
  })

  await this.save({ session, tenantId })
  return this
}

orderSchema.methods.markRefunded = async function markRefunded(
  { tenantId, performedBy = null, reason = null, session = null, req = null } = {},
) {
  if (!isSameTenant(this.tenantId, tenantId)) {
    throw new Error('Access denied: tenant mismatch')
  }

  if (this.paymentStatus !== PAYMENT_STATUS.APPROVED) {
    throw new Error('Only approved payments can be refunded')
  }

  const previousState = {
    paymentStatus: this.paymentStatus,
    refundStatus: this.refundStatus,
    orderStatus: this.orderStatus,
  }

  this.refundStatus = REFUND_STATUS.REFUNDED
  this.paymentStatus = PAYMENT_STATUS.REFUNDED
  this.syncDerivedState()

  this.addAuditEntry({
    action: 'refunded',
    performedBy,
    performedByRole: performedBy ? 'admin' : 'system',
    previousState,
    newState: {
      paymentStatus: this.paymentStatus,
      refundStatus: this.refundStatus,
      orderStatus: this.orderStatus,
    },
    reason,
    ipAddress: req?.ip,
    userAgent: req?.headers?.['user-agent'],
  })

  await this.save({ session, tenantId })
  return this
}

orderSchema.methods.restoreStock = async function restoreStock(
  { tenantId, performedBy = null, reason = null, session = null } = {},
) {
  if (!isSameTenant(this.tenantId, tenantId)) {
    throw new Error('Access denied: tenant mismatch')
  }

  if (this.stockRestoredAt) {
    throw new Error('Stock already restored')
  }

  const Product = mongoose.model('Product')

  for (const item of this.products) {
    if (item.variantId) {
      await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: this.tenantId,
          'variants._id': item.variantId,
        },
        {
          $inc: {
            'variants.$.stock': item.count,
            stock: item.count,
          },
        },
        { session },
      )
    } else {
      await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: this.tenantId,
        },
        {
          $inc: { stock: item.count },
        },
        { session },
      )
    }
  }

  this.stockRestoredAt = new Date()

  this.addAuditEntry({
    action: 'stock_restored',
    performedBy,
    performedByRole: performedBy ? 'admin' : 'system',
    reason: reason || 'Restauración por cancelación/reembolso',
  })

  await this.save({ session, tenantId })
  return this
}

// =====================================================
// STATICS
// =====================================================

orderSchema.statics.findByIdAndTenant = function findByIdAndTenant(
  id,
  tenantId,
  options = {},
) {
  return this.findOne({
    _id: id,
    tenantId,
    isDeleted: false,
  }).setOptions({
    tenantId,
    ...options,
  })
}

orderSchema.statics.findByUserAndTenant = function findByUserAndTenant(
  userId,
  tenantId,
  options = {},
) {
  const {
    page = 1,
    limit = 20,
    status,
    paymentStatus,
    fulfillmentStatus,
  } = options

  const query = {
    orderby: userId,
    tenantId,
    isDeleted: false,
  }

  if (status) query.orderStatus = status
  if (paymentStatus) query.paymentStatus = paymentStatus
  if (fulfillmentStatus) query.fulfillmentStatus = fulfillmentStatus

  return this.find(query)
    .setOptions({ tenantId })
    .sort({ createdAt: -1 })
    .skip((Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1))
    .limit(Math.max(Number(limit), 1))
}

orderSchema.statics.countByTenant = function countByTenant(tenantId, filters = {}) {
  return this.countDocuments({
    ...filters,
    tenantId,
    isDeleted: false,
  }).setOptions({ tenantId })
}

orderSchema.statics.aggregateByTenant = function aggregateByTenant(
  tenantId,
  pipeline = [],
) {
  return this.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(String(tenantId)),
        isDeleted: false,
      },
    },
    ...pipeline,
  ]).option({ tenantId })
}

// =====================================================
// TENANT PLUGIN
// =====================================================

orderSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

// =====================================================
// MODEL
// =====================================================

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema)

export default Order