import mongoose from 'mongoose'

import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { toObjectId } from '../utils/requestContext.js'
import logger from '../../config/logger.js'

const isProd = process.env.NODE_ENV === 'production'

const isTransactionUnsupportedError = error => {
  const message = String(error?.message || '')

  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('replica set') ||
    message.includes('mongos')
  )
}

export const runOrderTransaction = async work => {
  const session = await mongoose.startSession()

  try {
    let result

    await session.withTransaction(async () => {
      result = await work(session)
    })

    return result
  } catch (error) {
    if (!isProd && isTransactionUnsupportedError(error)) {
      logger.warn(
        '⚠️ Mongo sin transacciones en desarrollo; usando fallback no transaccional',
      )
      return work(null)
    }

    throw error
  } finally {
    await session.endSession()
  }
}

export const validateUserTenantMembership = async ({
  userId,
  tenantId,
  session = null,
}) => {
  const [user, tenant] = await Promise.all([
    User.findOne({
      _id: toObjectId(userId),
      tenantId: toObjectId(tenantId),
      isBlocked: { $ne: true },
    })
      .session(session)
      .lean(),

    Tenant.findOne({
      _id: toObjectId(tenantId),
      status: 'active',
    })
      .session(session)
      .lean(),
  ])

  if (!user) {
    const error = new Error('Usuario no autorizado en este comercio')
    error.statusCode = 403
    throw error
  }

  if (!tenant) {
    const error = new Error('Comercio no disponible temporalmente')
    error.statusCode = 403
    throw error
  }

  return { user, tenant }
}

export const ensureAdminOrManager = req => {
  const role = req.user?.role

  if (!['admin', 'manager', 'owner', 'superadmin'].includes(role)) {
    const error = new Error('Permisos insuficientes')
    error.statusCode = 403
    throw error
  }
}
