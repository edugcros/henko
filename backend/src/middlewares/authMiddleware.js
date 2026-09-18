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
  const path = req.path || req.url
  logger.debug(`[AUTH] Validando - Path: ${path}`)

  // ---------------------------------------------------
  // 🥇 PRIORIDAD REAL (alineado con axiosConfig)
  // ---------------------------------------------------
  const token = getAccessTokenFromRequest(req)

  logger.debug('[AUTH] Credenciales recibidas', {
    hasCookieToken: Boolean(req.cookies?.token),
    hasCookieRefreshToken: Boolean(req.cookies?.refreshToken),
    hasAuthorization: Boolean(req.headers.authorization),
    hasXAccessToken: Boolean(req.headers['x-access-token']),
    origin: req.headers.origin || null,
    host: req.headers.host || null,
    forwardedHost: req.headers['x-forwarded-host'] || null,
    forwardedProto: req.headers['x-forwarded-proto'] || null,
    path,
  })

  logger.debug(
    `[AUTH] Credenciales recibidas | cookieToken=${Boolean(req.cookies?.token)} | authorization=${Boolean(req.headers.authorization)} | xAccessToken=${Boolean(req.headers['x-access-token'])}`,
  )

  if (!token || token === 'undefined') {
    logger.warn(`[AUTH] ❌ Token ausente - Path: ${path}`)
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
    logger.debug(`[AUTH] Token decodificado - userId: ${decoded.sub}, tenantId: ${decoded.tenantId}`)

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
      .setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-del-token' })

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

    // 4️⃣ EL COMERCIO DEL TOKEN TIENE QUE SER EL DEL DOMINIO
    //
    // El comercio del dominio sale de `x-tenant-domain`, un header que manda el
    // cliente y que gana sobre el host real (ver getHostResolutionInput). El del
    // token sale del JWT y está verificado contra el usuario unas líneas arriba.
    // Que no coincidan significa que alguien está pidiendo operar sobre un
    // comercio que no es el suyo.
    //
    // POR QUÉ ACÁ Y NO EN CADA RUTA
    //
    // Este es el único punto donde los dos datos existen a la vez:
    // resolveTenantByDomain corre antes y deja req.tenantId; el JWT se resuelve
    // recién acá. Ponerlo en las cadenas de ruta serían 57 lugares que hay que
    // acordarse de tocar, y el que se olvide no falla: queda abierto.
    //
    // MEDIDO: HOY ESTO YA SE BLOQUEA, PERO POR CASUALIDAD
    //
    // Una prueba contra la base real (tenantHeaderIsolation.test.js) mostró que
    // el intento no escribe nada — lo corta tenantPlugin al ver que el filtro no
    // coincide con el contexto. Pero eso es una EXCEPCIÓN de la capa de datos:
    // devuelve 500, deja un stack trace por intento, y solo salta si el
    // controller consulta antes de escribir. Un `Model.create()` directo no la
    // dispararía.
    //
    // Acá la respuesta es una decisión de autorización: 403, sin tocar la base.
    //
    // Si no hay comercio de dominio —las rutas de plataforma corren a propósito
    // sin resolveTenantByDomain— no hay nada que comparar y se sigue de largo.
    const domainTenantId = req.tenantId ? String(req.tenantId) : null

    if (domainTenantId && domainTenantId !== String(user.tenantId)) {
      logger.warn(
        `🚨 Tenant mismatch entre token y dominio | user=${user._id} | userTenant=${user.tenantId} | domainTenant=${domainTenantId} | ip=${req.ip} | endpoint=${req.method} ${req.originalUrl}`,
      )

      return res.status(403).json({
        success: false,
        message: 'Tenant inconsistente entre usuario autenticado y dominio',
      })
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
