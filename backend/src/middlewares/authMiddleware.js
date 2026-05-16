import jwt from 'jsonwebtoken'
import asyncHandler from 'express-async-handler'
import logger from '../../config/logger.js'
import mongoose from 'mongoose'

// =====================================================
// 🔎 Utils
// =====================================================
const parseBearer = req => {
  const auth = req.headers?.authorization
  if (!auth) return null

  const [type, token] = auth.split(' ')
  return type?.toLowerCase() === 'bearer' && token ? token : null
}

// =====================================================
// 🔐 AUTH MIDDLEWARE
// =====================================================
export const authMiddleware = asyncHandler(async (req, res, next) => {
  // ---------------------------------------------------
  // 🥇 PRIORIDAD REAL (alineado con axiosConfig)
  // ---------------------------------------------------
  const token =
    parseBearer(req) ||               // 1️⃣ Header Authorization
    req.cookies?.token ||             // 2️⃣ Cookie (fallback)
    req.headers['x-access-token'] ||  // 3️⃣ Legacy
    req.headers.token                 // 4️⃣ Legacy extremo
  
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    })

    if (!mongoose.Types.ObjectId.isValid(decoded.sub)) {
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
