import mongoose from 'mongoose'

const { Schema } = mongoose

const wishlistPromotionNotificationSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    promotionId: {
      type: Schema.Types.ObjectId,
      ref: 'PromotionalBlock',
      required: true,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      default: 'pending',
      index: true,
    },
    discountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    errorMessage: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
)

wishlistPromotionNotificationSchema.index(
  { tenantId: 1, userId: 1, productId: 1, promotionId: 1 },
  { unique: true },
)

export default mongoose.model(
  'WishlistPromotionNotification',
  wishlistPromotionNotificationSchema,
)
