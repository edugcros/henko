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
//
// CADA RESPUESTA LLEVA UN `code` ADEMÁS DEL MENSAJE
//
// El mensaje es para la persona y está en castellano; el código es para el
// cliente. Sin él, distinguir "token vencido" de "usuario bloqueado" obliga al
// frontend a comparar texto en castellano, y entonces corregir una tilde en un
// mensaje rompe una decisión de producto en otro repositorio.
//
// Los mensajes NO se tocaron: agregar el código es aditivo, así que nada de lo
// que ya funcionaba cambia de forma.
export const authMiddleware = asyncHandler(async (req, res, next) => {
  const path = req.path || req.url

  logger.debug('[AUTH] Validando solicitud', {
    method: req.method,
    path,
  })

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

  // `'null'` además de `'undefined'`: un cliente que serializa un token vacío
  // manda el string. Igual moriría en decodeAccessToken, pero con un 401 que
  // dice "token inválido" en vez de "token ausente", que es lo que pasó.
  if (!token || token === 'undefined' || token === 'null') {
    logger.warn('[AUTH] Token ausente', {
      method: req.method,
      path,
    })

    return res.status(401).json({
      success: false,
      message: 'Token de acceso ausente',
      code: 'AUTH_TOKEN_MISSING',
    })
  }

  try {
    // -------------------------------------------------
    // 🔐 Verificar JWT
    // -------------------------------------------------
    const decoded = decodeAccessToken(token)

    logger.debug('[AUTH] Token decodificado', {
      userId: decoded.sub,
      tenantId: decoded.tenantId,
      role: decoded.role || null,
    })

    if (!isValidObjectId(decoded.sub)) {
      logger.warn('[AUTH] ID de usuario inválido en el token', {
        userId: String(decoded.sub),
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(400).json({
        success: false,
        message: 'ID de usuario inválido en token',
        code: 'INVALID_USER_ID',
      })
    }

    if (!isValidObjectId(decoded.tenantId)) {
      logger.warn('[AUTH] ID de comercio inválido en el token', {
        tenantId: String(decoded.tenantId),
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(400).json({
        success: false,
        message: 'ID de tenant inválido en token',
        code: 'INVALID_TENANT_ID',
      })
    }

    const user = await User.findById(decoded.sub)
      .select('tenantId role email firstname lastname mobile isBlocked blockedUntil passwordChangedAt')
      .setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-del-token' })

    if (!user) {
      logger.warn('[AUTH] Usuario inexistente', {
        userId: String(decoded.sub),
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(401).json({
        success: false,
        message: 'Usuario inválido o inexistente',
        code: 'AUTH_USER_NOT_FOUND',
      })
    }

    if (String(user.tenantId) !== String(decoded.tenantId)) {
      logger.warn('[AUTH] 🚨 Tenant mismatch en access token', {
        user: String(user._id),
        tokenTenant: String(decoded.tenantId),
        userTenant: String(user.tenantId),
        ip: req.ip,
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(401).json({
        success: false,
        message: 'Token inválido para el tenant del usuario',
        code: 'TOKEN_TENANT_MISMATCH',
      })
    }

    if (user.isBlocked) {
      logger.warn('[AUTH] Usuario bloqueado', {
        user: String(user._id),
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(403).json({
        success: false,
        message: 'Usuario bloqueado',
        code: 'USER_BLOCKED',
      })
    }

    if (typeof user.changedPasswordAfter === 'function' && user.changedPasswordAfter(decoded.iat)) {
      logger.warn('[AUTH] Token anterior al último cambio de contraseña', {
        user: String(user._id),
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(401).json({
        success: false,
        message: 'La contraseña fue modificada. Inicia sesión nuevamente.',
        code: 'PASSWORD_CHANGED',
      })
    }

    const tenant = await Tenant.findById(user.tenantId).select('_id status')

    // Inexistente e inactivo se separan: el primero es un dato roto —un usuario
    // apuntando a un comercio que no está—, el segundo es una decisión de
    // negocio. Con un solo código el panel no puede distinguir "te suspendimos"
    // de "algo se rompió", que son dos pantallas distintas.
    if (!tenant) {
      logger.warn('[AUTH] Comercio inexistente', {
        tenantId: String(user.tenantId),
        user: String(user._id),
      })

      return res.status(403).json({
        success: false,
        message: 'Tenant inválido o inactivo',
        code: 'TENANT_NOT_FOUND',
      })
    }

    if (tenant.status !== 'active') {
      logger.warn('[AUTH] Comercio inactivo', {
        tenantId: String(user.tenantId),
        status: tenant.status,
        user: String(user._id),
      })

      return res.status(403).json({
        success: false,
        message: 'Tenant inválido o inactivo',
        code: 'TENANT_INACTIVE',
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
      logger.warn('[AUTH] 🚨 Tenant mismatch entre token y dominio', {
        user: String(user._id),
        userTenant: String(user.tenantId),
        domainTenant: domainTenantId,
        ip: req.ip,
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(403).json({
        success: false,
        message: 'Tenant inconsistente entre usuario autenticado y dominio',
        code: 'TENANT_MISMATCH',
      })
    }

    next()
  } catch (err) {
    logger.warn('[AUTH] JWT inválido o expirado', {
      message: err.message,
      name: err.name,
      ip: req.ip,
      endpoint: `${req.method} ${req.originalUrl}`,
    })

    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado',
      expired: err.name === 'TokenExpiredError',
      code: 'AUTH_TOKEN_INVALID',
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
        code: 'AUTH_REQUIRED',
      })
    }

    if (!roles.includes(req.user.role)) {
      // Se registra: un permiso insuficiente repetido sobre el mismo endpoint
      // es la diferencia entre un menú mal armado y alguien probando puertas.
      logger.warn('[RBAC] Permiso insuficiente', {
        user: req.user.id,
        tenantId: req.user.tenantId,
        role: req.user.role,
        requiredRoles: roles,
        ip: req.ip,
        endpoint: `${req.method} ${req.originalUrl}`,
      })

      return res.status(403).json({
        success: false,
        message: 'Permisos insuficientes',
        code: 'INSUFFICIENT_PERMISSIONS',
      })
    }

    next()
  })

export const isAdmin = allowRoles('admin')
