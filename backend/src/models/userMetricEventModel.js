import mongoose from 'mongoose'

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

const normalizeString = value => String(value || '').trim()

const userMetricEventSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
      immutable: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: ALLOWED_EVENTS,
      index: true,
    },
    source: {
      type: String,
      enum: ['storefront', 'admin', 'agent', 'system'],
      default: 'storefront',
      index: true,
    },
    path: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '/',
    },
    referrer: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
    },
    cartId: {
      type: Schema.Types.ObjectId,
      ref: 'Cart',
      default: null,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },
    paymentId: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
      index: true,
    },
    searchQuery: {
      type: String,
      trim: true,
      maxlength: 160,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
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
    },
    commerce: {
      cartValue: { type: Number, min: 0, default: 0 },
      orderValue: { type: Number, min: 0, default: 0 },
      discountValue: { type: Number, min: 0, default: 0 },
      shippingValue: { type: Number, min: 0, default: 0 },
      taxValue: { type: Number, min: 0, default: 0 },
      itemsCount: { type: Number, min: 0, default: 0 },
    },
    items: [
      {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
        title: { type: String, trim: true, maxlength: 180, default: '' },
        sku: { type: String, trim: true, maxlength: 120, default: '' },
        quantity: { type: Number, min: 0, default: 0 },
        price: { type: Number, min: 0, default: 0 },
        subtotal: { type: Number, min: 0, default: 0 },
      },
    ],
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
    },
    attribution: {
      utmSource: { type: String, trim: true, maxlength: 120, default: '' },
      utmMedium: { type: String, trim: true, maxlength: 120, default: '' },
      utmCampaign: { type: String, trim: true, maxlength: 160, default: '' },
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
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
  },
)

userMetricEventSchema.index({ tenantId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, eventType: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, sessionId: 1, occurredAt: -1 })
userMetricEventSchema.index({ tenantId: 1, userId: 1, occurredAt: -1 })

userMetricEventSchema.pre('validate', function normalizeEvent(next) {
  this.path = normalizeString(this.path) || '/'
  this.referrer = normalizeString(this.referrer)
  this.searchQuery = normalizeString(this.searchQuery).slice(0, 160)
  this.category = normalizeString(this.category).slice(0, 120)
  this.sessionId = normalizeString(this.sessionId)
  this.source = normalizeString(this.source) || 'storefront'
  this.paymentId = normalizeString(this.paymentId).slice(0, 160)
  this.currency = normalizeString(this.currency).toUpperCase().slice(0, 12)

  if (!this.device) this.device = {}
  this.device.userAgent = normalizeString(this.device.userAgent).slice(0, 500)
  this.device.language = normalizeString(this.device.language).slice(0, 30)

  next()
})

const UserMetricEvent = mongoose.model('UserMetricEvent', userMetricEventSchema)

export default UserMetricEvent
