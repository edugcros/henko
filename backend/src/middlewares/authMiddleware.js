import asyncHandler from 'express-async-handler'
import logger from '../../config/logger.js'
import {
  decodeAccessToken,
  getAccessTokenFromRequest,
} from '../utils/authRequest.js'
import { isValidObjectId } from '../utils/requestContext.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'

// =====================================================
// 🔐 AUTH MIDDLEWARE
// =====================================================
export const authMiddleware = asyncHandler(async (req, res, next) => {
  // ---------------------------------------------------
  // 🥇 PRIORIDAD REAL (alineado con axiosConfig)
  // ---------------------------------------------------
  const token = getAccessTokenFromRequest(req)
  
  if (!token || token === 'undefined') {
    return res.status(401).json({
      success: false,
      message: 'Token de acceso ausente',
    })
  }

  try {
    // -------------------------------------------------
    // 🔐 Verificar JWT
    // -------------------------------------------------
    const decoded = decodeAccessToken(token)

    if (!isValidObjectId(decoded.sub)) {
      return res
        .status(400)
        .json({ success: false, message: 'ID de usuario inválido en token' })
    }

    if (!isValidObjectId(decoded.tenantId)) {
      return res
        .status(400)
        .json({ success: false, message: 'ID de tenant inválido en token' })
    }

    const user = await User.findById(decoded.sub)
      .select('tenantId role email firstname lastname mobile isBlocked blockedUntil passwordChangedAt')
      .setOptions({ ignoreTenant: true })

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario inválido o inexistente',
      })
    }

    if (String(user.tenantId) !== String(decoded.tenantId)) {
      logger.warn(
        `Tenant mismatch en access token | user=${user._id} | tokenTenant=${decoded.tenantId} | userTenant=${user.tenantId}`,
      )

      return res.status(401).json({
        success: false,
        message: 'Token inválido para el tenant del usuario',
      })
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Usuario bloqueado',
      })
    }

    if (typeof user.changedPasswordAfter === 'function' && user.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        success: false,
        message: 'La contraseña fue modificada. Inicia sesión nuevamente.',
      })
    }

    const tenant = await Tenant.findById(user.tenantId).select('_id status')
    if (!tenant || tenant.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Tenant inválido o inactivo',
      })
    }

    // 3️⃣ Inyectar usuario
    req.user = {
      id: String(user._id),
      _id: user._id,
      role: user.role,
      tenantId: String(user.tenantId),
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      mobile: user.mobile,
    }

    next()
  } catch (err) {
    logger.warn(`JWT inválido o expirado: ${err.message}`)

    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado',
      expired: err.name === 'TokenExpiredError',
    })
  }
})

// =====================================================
// 🛡️ RBAC
// =====================================================
export const allowRoles = (...roles) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'No autenticado',
      })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Permisos insuficientes',
      })
    }

    next()
  })

export const isAdmin = allowRoles('admin')
