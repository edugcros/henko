import mongoose from 'mongoose'

import { toObjectId } from '../utils/requestContext.js'
import logger from '../../config/logger.js'

const { Schema } = mongoose

const PaymentAttemptSchema = new Schema(
  {
    resourceKey: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 1,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300,
    },
  },
  { timestamps: true },
)

PaymentAttemptSchema.index(
  { tenantId: 1, userId: 1, resourceKey: 1 },
  { unique: true },
)

const PaymentAttempt =
  mongoose.models.PaymentAttempt ||
  mongoose.model('PaymentAttempt', PaymentAttemptSchema)

const DistributedLockSchema = new Schema(
  {
    resource: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    acquiredAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 120,
    },
  },
  { timestamps: true },
)

const DistributedLock =
  mongoose.models.DistributedLock ||
  mongoose.model('DistributedLock', DistributedLockSchema)

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const getSafeErrorMessage = error => {
  return error?.message || 'Error inesperado'
}

export const checkPaymentRateLimit = async (resourceKey, userId, tenantId) => {
  try {
    const normalizedResourceKey = sanitizeString(resourceKey, 'unknown')
    const attempt = await PaymentAttempt.findOneAndUpdate(
      {
        tenantId: toObjectId(tenantId),
        userId: toObjectId(userId),
        resourceKey: normalizedResourceKey,
      },
      {
        $inc: { attempts: 1 },
        $set: {
          lastAttemptAt: new Date(),
          tenantId: toObjectId(tenantId),
          userId: toObjectId(userId),
          resourceKey: normalizedResourceKey,
        },
      },
      {
        upsert: true,
        new: true,
      },
    )

    if (attempt.attempts > 5) {
      const timeSinceLastAttempt = Date.now() - attempt.lastAttemptAt.getTime()
      const waitTime = Math.max(0, 300000 - timeSinceLastAttempt)

      if (waitTime > 0) {
        const error = new Error(
          `RATE_LIMIT_EXCEEDED: Espera ${Math.ceil(waitTime / 1000)} segundos`,
        )
        error.statusCode = 429
        throw error
      }

      await PaymentAttempt.updateOne(
        { _id: attempt._id },
        {
          $set: {
            attempts: 1,
            lastAttemptAt: new Date(),
          },
        },
      )
    }

    return attempt.attempts
  } catch (error) {
    if (error.message?.includes('RATE_LIMIT_EXCEEDED')) {
      throw error
    }

    logger.error('❌ Error en rate limiting', {
      message: getSafeErrorMessage(error),
      tenantId: String(tenantId),
      resourceKey: String(resourceKey),
    })

    return 1
  }
}

export const acquirePaymentLock = async (resourceId, tenantId, ttlSeconds = 60) => {
  const resource = `payment:${String(resourceId)}`
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  try {
    await DistributedLock.create({
      resource,
      tenantId: toObjectId(tenantId),
      expiresAt,
    })

    return true
  } catch (error) {
    if (error.code === 11000) {
      logger.warn('🔒 Lock ya existe para pago', {
        resource,
        tenantId: String(tenantId),
      })

      return false
    }

    throw error
  }
}

export const releasePaymentLock = async resourceId => {
  const resource = `payment:${String(resourceId)}`

  try {
    await DistributedLock.deleteOne({ resource })
  } catch (error) {
    logger.error('❌ Error liberando lock de pago', {
      resource,
      message: getSafeErrorMessage(error),
    })
  }
}
