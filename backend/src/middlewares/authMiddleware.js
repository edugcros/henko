import asyncHandler from 'express-async-handler'
import logger from '../../config/logger.js'
import {
  decodeAccessToken,
  getAccessTokenFromRequest,
} from '../utils/authRequest.js'
import { isValidObjectId } from '../utils/requestContext.js'

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

    // 3️⃣ Inyectar usuario
    req.user = {
      id: decoded.sub,
      _id: decoded.sub,
      role: decoded.role,
      tenantId: decoded.tenantId,
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
