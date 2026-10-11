// 📁 src/models/userMetricEventModel.js
import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'
import { env } from '../../config/env.js'

const { Schema } = mongoose

export const USER_METRIC_EVENTS = {
  PAGE_VIEW: 'page_view',
  PRODUCT_IMPRESSION: 'product_impression',
  PRODUCT_CLICK: 'product_click',
  PRODUCT_VIEW: 'product_view',
  SEARCH: 'search',
  ADD_TO_CART: 'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  WISHLIST_ADD: 'wishlist_add',
  WISHLIST_REMOVE: 'wishlist_remove',
  CHECKOUT_START: 'checkout_start',
  CHECKOUT_STEP: 'checkout_step',
  PAYMENT_ATTEMPT: 'payment_attempt',
  PAYMENT_APPROVED: 'payment_approved',
  PAYMENT_REJECTED: 'payment_rejected',
  PURCHASE: 'purchase',
  LOGIN: 'login',
  LOGOUT: 'logout',
}

const ALLOWED_EVENTS = Object.values(USER_METRIC_EVENTS)

const ALLOWED_SOURCES = [
  'storefront',
  'website',
  'admin',
  'agent',
  'system',
  'webchat',
  'whatsapp',
  'unknown',
]

const normalizeString = value => String(value || '').trim()

const normalizeLower = value => normalizeString(value).toLowerCase()

const normalizeUpper = value => normalizeString(value).toUpperCase()

const toNumber = (value, defaultValue = 0) => {
  const number = Number(value)

  return Number.isFinite(number) ? number : defaultValue
}

const toObjectIdOrNull = value => {
  const clean = normalizeString(value)

  return mongoose.Types.ObjectId.isValid(clean) ? new mongoose.Types.ObjectId(clean) : null
}

const metricItemSchema = new Schema(
  {
    productId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
      index: true,
    },
    productObjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
      set: toObjectIdOrNull,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
    },
    sku: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    quantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    subtotal: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    _id: false,
  },
)

const viewportSchema = new Schema(
  {
    width: {
      type: Number,
      min: 0,
      default: 0,
    },
    height: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    _id: false,
  },
)

const userMetricEventSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
      set: toObjectIdOrNull,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
      set: toObjectIdOrNull,
    },

    eventId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
    },

    sessionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
      index: true,
    },

    tenantDomain: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 180,
      default: '',
      index: true,
    },

    eventType: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      enum: ALLOWED_EVENTS,
      index: true,
      set: normalizeLower,
    },

    source: {
      type: String,
      lowercase: true,
      trim: true,
      enum: ALLOWED_SOURCES,
      default: 'storefront',
      index: true,
      set: value => {
        const source = normalizeLower(value)

        return ALLOWED_SOURCES.includes(source) ? source : 'unknown'
      },
    },

    path: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '/',
    },

    referrer: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
      set: toObjectIdOrNull,
    },

    productRef: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
      index: true,
    },

    cartId: {
      type: Schema.Types.ObjectId,
      ref: 'Cart',
      default: null,
      index: true,
      set: toObjectIdOrNull,
    },

    orderObjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
      set: toObjectIdOrNull,
    },

    // String para compatibilidad con frontend, Mercado Pago, referencias externas o tests.
    orderId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
    },

    paymentId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
      index: true,
    },

    searchQuery: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
      index: true,
    },

    category: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
      index: true,
    },

    value: {
      type: Number,
      min: 0,
      default: 0,
    },

    quantity: {
      type: Number,
      min: 0,
      default: 0,
    },

    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 12,
      default: '',
      set: normalizeUpper,
    },

    commerce: {
      cartValue: { type: Number, min: 0, default: 0 },
      orderValue: { type: Number, min: 0, default: 0 },
      discountValue: { type: Number, min: 0, default: 0 },
      shippingValue: { type: Number, min: 0, default: 0 },
      taxValue: { type: Number, min: 0, default: 0 },
      itemsCount: { type: Number, min: 0, default: 0 },
    },

    items: {
      type: [metricItemSchema],
      default: [],
    },

    device: {
      type: {
        type: String,
        enum: ['desktop', 'mobile', 'tablet', 'unknown'],
        default: 'unknown',
      },
      userAgent: {
        type: String,
        trim: true,
        maxlength: 500,
        default: '',
      },
      language: {
        type: String,
        trim: true,
        maxlength: 30,
        default: '',
      },
      platform: {
        type: String,
        trim: true,
        maxlength: 80,
        default: '',
      },
      viewport: {
        type: viewportSchema,
        default: () => ({}),
      },
    },

    attribution: {
      utmSource: { type: String, trim: true, maxlength: 120, default: '' },
      utmMedium: { type: String, trim: true, maxlength: 120, default: '' },
      utmCampaign: { type: String, trim: true, maxlength: 160, default: '' },
      utmContent: { type: String, trim: true, maxlength: 160, default: '' },
      utmTerm: { type: String, trim: true, maxlength: 160, default: '' },
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    occurredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
    },
    toObject: {
      virtuals: true,
      versionKey: false,
    },
  },
)

userMetricEventSchema.pre('validate', function normalizeEvent(next) {
  this.path = normalizeString(this.path) || '/'
  this.referrer = normalizeString(this.referrer).slice(0, 1000)
  this.searchQuery = normalizeString(this.searchQuery).slice(0, 160)
  this.category = normalizeString(this.category).slice(0, 120)
  this.sessionId = normalizeString(this.sessionId).slice(0, 180)
  this.tenantDomain = normalizeLower(this.tenantDomain).slice(0, 180)
  this.source = normalizeLower(this.source) || 'storefront'
  this.eventType = normalizeLower(this.eventType)
  this.paymentId = normalizeString(this.paymentId).slice(0, 180)
  this.orderId = normalizeString(this.orderId).slice(0, 180)
  this.currency = normalizeUpper(this.currency).slice(0, 12)

  this.value = Math.max(0, toNumber(this.value, 0))
  this.quantity = Math.max(0, toNumber(this.quantity, 0))

  if (!this.orderObjectId && this.orderId) {
    this.orderObjectId = toObjectIdOrNull(this.orderId)
  }

  if (!this.productRef && this.productId) {
    this.productRef = normalizeString(this.productId)
  }

  if (!this.device) this.device = {}
  this.device.userAgent = normalizeString(this.device.userAgent).slice(0, 500)
  this.device.language = normalizeString(this.device.language).slice(0, 30)
  this.device.platform = normalizeString(this.device.platform).slice(0, 80)

  if (!this.device.type) {
    this.device.type = 'unknown'
  }

  if (this.device.viewport) {
    this.device.viewport.width = Math.max(0, toNumber(this.device.viewport.width, 0))
    this.device.viewport.height = Math.max(0, toNumber(this.device.viewport.height, 0))
  }

  if (Array.isArray(this.items)) {
    this.items = this.items.map(item => {
      const productId = normalizeString(item.productId).slice(0, 120)

      return {
        ...item,
        productId,
        productObjectId: item.productObjectId || toObjectIdOrNull(productId),
        title: normalizeString(item.title).slice(0, 180),
        sku: normalizeString(item.sku).slice(0, 120),
        quantity: Math.max(0, toNumber(item.quantity, 0)),
        price: Math.max(0, toNumber(item.price, 0)),
        subtotal: Math.max(0, toNumber(item.subtotal, 0)),
      }
    })
  }

  next()
})

// RETENCIÓN: esta colección no puede crecer para siempre.
//
// Es la que más crece de todas y era la única de las ocho de alto crecimiento
// sin vencimiento. Recibe cinco inserts por carga de página, de cada visitante,
// de cada tienda. Con una tienda no se nota; con cien comercios es el renglón
// que primero rompe: el almacenamiento crece sin techo, las consultas del panel
// se degradan porque escanean cada vez más documentos, y la factura sube sola.
//
// POR QUÉ UN TTL ACÁ Y UN SCRIPT EN EL LEDGER DE IA
//
// pruneAiLedger.js argumenta —bien— que un TTL "borra solo, en silencio" y que
// el ledger es materia prima del análisis de rentabilidad. Ese razonamiento no
// se traslada: el ledger son miles de filas por mes y es material financiero;
// esto es telemetría de comportamiento de volumen altísimo. Un script que
// alguien tiene que acordarse de correr se olvida, y la colección vuelve a
// crecer sin techo. Para telemetría el vencimiento automático ES la decisión
// correcta.
//
// POR QUÉ createdAt Y NO occurredAt
//
// occurredAt lo manda el cliente (userMetricsCtrl lee rawEvent.occurredAt).
// Un TTL sobre un campo que elige quien llama es evadible: con una fecha futura
// los documentos nunca vencen. createdAt lo pone el servidor vía
// timestamps: true.
//
// OJO AL ACTIVARLO: crear este índice sobre una colección que ya tiene
// historia dispara el borrado de todo lo vencido de una sola vez. Por eso en
// producción autoIndex está apagado (config/connectDB.js) y la puesta en
// marcha va por src/scripts/pruneUserMetrics.js, que primero informa cuánto se
// va a perder y borra en lotes.
userMetricEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: Math.max(1, Number(env?.metrics?.retentionDays || 90)) * 24 * 60 * 60 },
)

userMetricEventSchema.index({ tenantId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, eventType: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, source: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, sessionId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, userId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, tenantDomain: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, productId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, productRef: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, orderId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, orderObjectId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, paymentId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, category: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, searchQuery: 1, occurredAt: -1 })

userMetricEventSchema.index(
  { tenantId: 1, eventId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      eventId: {
        $type: 'string',
        $gt: '',
      },
    },
  },
)

userMetricEventSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const UserMetricEvent =
  mongoose.models.UserMetricEvent || mongoose.model('UserMetricEvent', userMetricEventSchema)

export default UserMetricEvent
