// 📁 src/controller/userCtrl.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT

import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import Tenant from '../models/tenantModel.js'
import UserMetricEvent, {
  USER_METRIC_EVENTS,
} from '../models/userMetricEventModel.js'

import { resolveCartPricing } from '../services/cartPricingService.js'
import { notifyWishlistPromotions } from '../services/wishlistPromotionNotifierService.js'
import { env } from '../../config/env.js'
import { verifyRefreshToken } from '../../config/generateRefreshToken.js'
import { generateAccessToken } from '../../config/generateAccessToken.js'
import { generateRefreshToken } from '../../config/generateRefreshToken.js'

import { buildFrontendUrl } from '../utils/frontendUrl.js'
import { withOptionalTransaction } from '../utils/withOptionalTransaction.js'
import { normalizeArgentinePhone } from '../utils/normalizePhone.js'
import { sendResetPasswordEmail, sendVerificationEmail } from '../services/email/verificationEmail.service.js'
import { sendResponse } from '../utils/response.js'
import { getCookieDomain } from '../utils/cookieHelper.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
} from '../utils/requestContext.js'

import expressAsyncHandler from 'express-async-handler'
import { body, validationResult } from 'express-validator'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import process from 'process'
import mongoose from 'mongoose'

import logger from '../../config/logger.js'

// =====================================================
// CONSTANTES
// =====================================================

const isProd = env.isProduction ?? process.env.NODE_ENV === 'production'
const MAX_CART_QUANTITY = Number(process.env.MAX_CART_QUANTITY || 99)
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000
const DEFAULT_REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const SAFE_USER_SELECT =
  '-password -refreshToken -passwordResetToken -passwordResetExpires -emailVerificationToken -emailVerificationExpires -__v'

const USER_PROFILE_FIELDS = ['firstname', 'lastname', 'mobile', 'address']

// =====================================================
// HELPERS GENERALES
// =====================================================

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex')

const normalizeEmail = value => String(value || '').trim().toLowerCase()

const normalizeSlug = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const normalizeDomain = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(',')[0]
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/:\d+$/, '')
}

const uniqueValues = values => {
  return [...new Set(values.filter(Boolean).map(value => String(value).toLowerCase()))]
}

const isValidId = isValidObjectId

const requireValidId = (id, message = 'ID inválido') => {
  if (!isValidId(id)) {
    const error = new Error(message)
    error.statusCode = 400
    throw error
  }
}

const getRequestUserId = getUserIdFromRequest

const sanitizeProfilePayload = payload => {
  const clean = {}

  for (const field of USER_PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, field)) {
      const value = payload[field]

      if (field === 'mobile') {
        clean.mobile = normalizeArgentinePhone(value)
      } else {
        clean[field] = String(value || '').trim()
      }
    }
  }

  return clean
}

const parseDurationToMs = (value, fallbackMs) => {
  const input = String(value || '').trim().toLowerCase()
  const match = input.match(/^(\d+)(ms|s|m|h|d)$/)

  if (!match) return fallbackMs

  const amount = Number(match[1])
  const unit = match[2]

  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return amount * multipliers[unit]
}

const getRefreshCookieMaxAge = () => {
  return parseDurationToMs(
    process.env.JWT_REFRESH_EXPIRES,
    DEFAULT_REFRESH_COOKIE_MAX_AGE_MS,
  )
}

const buildTenantDomains = storeSlug => {
  if (env.isProduction && !env.publicBaseDomain) {
    throw new Error('PUBLIC_BASE_DOMAIN no configurado para producción')
  }

  const baseDomain = env.isProduction
    ? env.publicBaseDomain
    : env.tenantPublicBaseDomain || env.publicBaseDomain || 'henko.local'

  const shopDomain = `${storeSlug}.${baseDomain}`
  const adminDomain = `admin.${storeSlug}.${baseDomain}`
  const protocol = env.isProduction ? 'https' : 'http'

  return {
    shopDomain,
    adminDomain,
    shopUrl: env.isProduction
      ? `${protocol}://${shopDomain}`
      : `${protocol}://${shopDomain}:3002`,
    adminUrl: env.isProduction
      ? `${protocol}://${adminDomain}`
      : `${protocol}://${adminDomain}:3001`,
  }
}

const getDomainCandidates = value => {
  const domain = normalizeDomain(value)
  return uniqueValues([domain, domain.replace(/^www\./, '')])
}

const getTenantDomainFromRequest = req => {
  return (
    req.headers['x-tenant-domain'] ||
    req.headers['x-forwarded-host'] ||
    req.headers.host ||
    ''
  )
}

const getMetricSessionIdFromRequest = req => {
  return (
    req.headers['x-metric-session-id'] ||
    req.headers['x-session-id'] ||
    crypto.randomUUID()
  )
}

const recordAuthMetric = ({ req, user, tenant, eventType, source }) => {
  if (!tenant?._id || !user?._id) return

  UserMetricEvent.create({
    tenantId: tenant._id,
    userId: user._id,
    sessionId: getMetricSessionIdFromRequest(req),
    eventType,
    source,
    path: req.originalUrl || req.path || '/',
    device: {
      userAgent: req.headers['user-agent'] || '',
      language: req.headers['accept-language'] || '',
    },
    metadata: {
      role: user.role,
    },
  }).catch(error => {
    logger.warn(`No se pudo registrar métrica de autenticación: ${error.message}`)
  })
}

const scheduleWishlistPromotionNotification = ({
  tenantId,
  userId,
  productId,
}) => {
  setTimeout(async () => {
    try {
      const result = await notifyWishlistPromotions({
        tenantId,
        userId,
        productId,
        dryRun: false,
        limit: 1,
      })

      logger.info('[Wishlist] Aviso de promoción procesado al agregar favorito', {
        tenantId: String(tenantId),
        userId: String(userId),
        productId: String(productId),
        scannedPromotions: result.scannedPromotions,
        matchedUsers: result.matchedUsers,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
      })
    } catch (error) {
      logger.error('[Wishlist] Error procesando aviso de promoción', {
        tenantId: String(tenantId),
        userId: String(userId),
        productId: String(productId),
        error: error.stack || error.message,
      })
    }
  }, 0)
}

const resolveAdminTenantFromRequest = async req => {
  const candidates = getDomainCandidates(getTenantDomainFromRequest(req))
  if (!candidates.length) return null

  return Tenant.findOne({
    status: 'active',
    $or: [
      { 'adminDomains.hostname': { $in: candidates } },
      { 'adminDomains.normalizedHostname': { $in: candidates } },
      { legacyAdminDomains: { $in: candidates } },
    ],
  }).select('_id name domains adminDomains slug status plan')
}

const serializeTenant = tenant => ({
  _id: tenant._id,
  name: tenant.name,
  slug: tenant.slug,
  status: tenant.status,
  plan: tenant.plan,
  domains: tenant.domains,
  adminDomains: tenant.adminDomains,
})

const serializeUserWithTenant = (user, tenant) => ({
  ...user.toSafeObject(),
  tenantId: tenant._id,
  tenant: serializeTenant(tenant),
})

const clearAuthCookies = (res, req) => {
  const cookieDomain = getCookieDomain(req)
  const secure = env.cookieSecure ?? isProd
  const sameSite = env.cookieSameSite || (isProd ? 'None' : 'Lax')

  const httpOnlyCookieOptions = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    domain: cookieDomain,
  }

  res.clearCookie('token', httpOnlyCookieOptions)
  res.clearCookie('refreshToken', httpOnlyCookieOptions)
  res.clearCookie('_csrf', httpOnlyCookieOptions)
  res.clearCookie(env.csrfCookieName || 'XSRF-TOKEN', {
    ...httpOnlyCookieOptions,
    httpOnly: false,
  })
}

const sendAuthCookies = (res, req, refreshToken) => {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure ?? isProd,
    sameSite: env.cookieSameSite || (isProd ? 'None' : 'Lax'),
    domain: getCookieDomain(req),
    path: '/',
    maxAge: getRefreshCookieMaxAge(),
  })
}

const toSafeQuantity = value => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  if (parsed > MAX_CART_QUANTITY) return MAX_CART_QUANTITY
  return parsed
}

const getVariantByIdentifier = (product, variantId) => {
  if (!variantId || !Array.isArray(product?.variants)) return null

  return (
    product.variants.find(
      variant =>
        String(variant._id) === String(variantId) ||
        String(variant.id) === String(variantId) ||
        String(variant.key) === String(variantId) ||
        String(variant.sku) === String(variantId),
    ) || null
  )
}

const getTenantScopedUserQuery = (req, userId) => {
  const tenantId = req.tenantId
  requireValidId(userId, 'Usuario inválido')
  requireValidId(tenantId, 'Tenant inválido')

  return {
    _id: userId,
    tenantId,
  }
}

// =====================================================
// CSRF
// =====================================================

export const getCsrfToken = expressAsyncHandler(async (req, res) => {
  const csrfToken = req.csrfToken()
  const cookieDomain = getCookieDomain(req)

  res.cookie(env.csrfCookieName || 'XSRF-TOKEN', csrfToken, {
    httpOnly: false,
    secure: env.csrfCookieSecure,
    sameSite: env.csrfCookieSameSite,
    domain: cookieDomain,
    path: '/',
    maxAge: 15 * 60 * 1000,
  })

  return res.status(200).json({ success: true, csrfToken })
})

// =====================================================
// EMAIL VERIFICATION
// =====================================================

export const verifyEmail = expressAsyncHandler(async (req, res) => {
  const token = String(req.query?.token || '').trim()

  if (!token) {
    return sendResponse(res, 400, false, 'Token no proporcionado.')
  }

  const user = await User.findOne({
    emailVerificationToken: hashToken(token),
    emailVerificationExpires: { $gt: Date.now() },
  }).setOptions({ ignoreTenant: true })

  if (!user) {
    return sendResponse(res, 400, false, 'Token inválido o expirado.')
  }

  user.isEmailVerified = true
  user.emailVerificationToken = undefined
  user.emailVerificationExpires = undefined
  await user.save({ validateBeforeSave: false })

  return sendResponse(
    res,
    200,
    true,
    'Email verificado correctamente. Ya puedes iniciar sesión.',
  )
})

// =====================================================
// REGISTRO DE USUARIO STOREFRONT
// =====================================================

export const createUser = [
  body('email').isEmail().withMessage('Correo inválido').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Mínimo 8 caracteres').trim(),
  body('firstname').notEmpty().withMessage('Nombre obligatorio').trim(),
  body('lastname').notEmpty().withMessage('Apellido obligatorio').trim(),
  body('mobile').notEmpty().withMessage('El móvil es obligatorio').trim(),

  expressAsyncHandler(async (req, res) => {
    const { tenantId, tenant } = req

    if (!tenantId || !tenant) {
      return sendResponse(res, 400, false, 'No se pudo identificar el comercio de origen.')
    }

    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return sendResponse(
        res,
        400,
        false,
        'Error de validación',
        errors.array().map(err => err.msg),
      )
    }

    const email = normalizeEmail(req.body.email)
    const { password, firstname, lastname, mobile } = req.body
    const finalMobile = normalizeArgentinePhone(mobile)

    const existingUser = await User.exists({ email, tenantId })
    if (existingUser) {
      return sendResponse(
        res,
        409,
        false,
        'Ya existe una cuenta con ese correo en este comercio.',
      )
    }

    const newUser = new User({
      email,
      password,
      firstname,
      lastname,
      mobile: finalMobile,
      role: 'user',
      tenantId,
      isEmailVerified: false,
    })

    const rawToken = newUser.createEmailVerificationToken()
    await newUser.save()

    try {
      await sendVerificationEmail(newUser, tenant, rawToken)
    } catch (error) {
      logger.error(`Error enviando email de verificación: ${error.message}`)
    }

    logger.info(`Cliente registrado | email=${email} | tenant=${tenant.name}`)

    return sendResponse(
      res,
      201,
      true,
      'Registro completado con éxito. Por favor verifica tu email.',
      {
        id: newUser._id,
        email: newUser.email,
        firstname: newUser.firstname,
        tenantName: tenant.name,
      },
    )
  }),
]

// =====================================================
// REGISTRO SaaS TENANT + ADMIN
// =====================================================

export const createUserAdmin = [
  body('email').isEmail().withMessage('Correo inválido').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres'),
  body('firstname').notEmpty().withMessage('Nombre es obligatorio').trim(),
  body('lastname').notEmpty().withMessage('Apellido es obligatorio').trim(),
  body('mobile').notEmpty().withMessage('Móvil es obligatorio').trim(),
  body('storeName')
    .notEmpty()
    .withMessage('Nombre de tienda obligatorio')
    .trim()
    .isLength({ min: 3, max: 80 })
    .withMessage('El nombre de tienda debe tener entre 3 y 80 caracteres'),
  body('storeSlug')
    .notEmpty()
    .withMessage('Identificador de tienda obligatorio')
    .trim()
    .custom(value => {
      const slug = normalizeSlug(value)
      if (!slug || slug.length < 3) throw new Error('Identificador de tienda inválido')
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new Error('Usá solo letras, números y guiones')
      }
      return true
    }),
  body('plan')
    .optional()
    .isIn(['starter', 'pro'])
    .withMessage('El plan seleccionado no es válido'),

  expressAsyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return sendResponse(res, 400, false, 'Error de validación', errors.array())
    }

    const email = normalizeEmail(req.body.email)
    const {
      password,
      firstname,
      lastname,
      mobile,
      storeName,
      storeSlug,
    } = req.body
    const finalSlug = normalizeSlug(storeSlug)
    const finalMobile = normalizeArgentinePhone(mobile)
    const plan = ['starter', 'pro'].includes(req.body.plan)
      ? req.body.plan
      : 'starter'

    const { shopDomain, adminDomain, shopUrl, adminUrl } = buildTenantDomains(finalSlug)
    const shopDomainCandidates = uniqueValues([shopDomain, normalizeDomain(shopDomain)])
    const adminDomainCandidates = uniqueValues([adminDomain, normalizeDomain(adminDomain)])

    const adminId = new mongoose.Types.ObjectId()
    const rawEmailToken = crypto.randomBytes(32).toString('hex')

    let result

    try {
      result = await withOptionalTransaction(async session => {
        const opts = { session }

        const [emailExists, slugExists, domainExists] = await Promise.all([
          User.exists({ email }).setOptions({ ignoreTenant: true }).session(session),
          Tenant.exists({ slug: finalSlug }).session(session),
          Tenant.exists({
            $or: [
              { 'domains.hostname': { $in: shopDomainCandidates } },
              { 'domains.normalizedHostname': { $in: shopDomainCandidates } },
              { 'adminDomains.hostname': { $in: adminDomainCandidates } },
              { 'adminDomains.normalizedHostname': { $in: adminDomainCandidates } },
              { legacyDomains: { $in: shopDomainCandidates } },
              { legacyAdminDomains: { $in: adminDomainCandidates } },
            ],
          }).session(session),
        ])

        if (emailExists) throw new Error('EMAIL_EXISTS')
        if (slugExists) throw new Error('SLUG_EXISTS')
        if (domainExists) throw new Error('DOMAIN_EXISTS')

        const [tenant] = await Tenant.create(
          [
            {
              name: storeName,
              slug: finalSlug,
              ownerUserId: adminId,
              plan,
              status: 'active',
              subscriptionStatus: 'trialing',
              domains: [
                {
                  hostname: shopDomain,
                  normalizedHostname: normalizeDomain(shopDomain),
                  type: 'platform_subdomain',
                  context: 'storefront',
                  status: 'active',
                  isPrimary: true,
                  verifiedAt: new Date(),
                  sslStatus: env.isProduction ? 'active' : 'not_required',
                },
              ],
              adminDomains: [
                {
                  hostname: adminDomain,
                  normalizedHostname: normalizeDomain(adminDomain),
                  type: 'platform_subdomain',
                  context: 'admin',
                  status: 'active',
                  isPrimary: true,
                  verifiedAt: new Date(),
                  sslStatus: env.isProduction ? 'active' : 'not_required',
                },
              ],
              currency: 'ARS',
              locale: 'es-AR',
              timezone: 'America/Argentina/Buenos_Aires',
              country: 'AR',
              onboarding: {
                completed: false,
                step: 'store',
                completedAt: null,
              },
              settings: {
                checkout: { allowGuestCheckout: true, defaultCurrency: 'ARS' },
                features: {
                  promotionalBlocks: true,
                  aiProductEnrichment: true,
                  customDomain: true,
                },
              },
            },
          ],
          opts,
        )

        const [admin] = await User.create(
          [
            {
              _id: adminId,
              email,
              password,
              firstname,
              lastname,
              mobile: finalMobile,
              role: 'admin',
              tenantId: tenant._id,
              emailVerificationToken: hashToken(rawEmailToken),
              emailVerificationExpires: Date.now() + EMAIL_VERIFY_TTL_MS,
              isEmailVerified: false,
            },
          ],
          opts,
        )

        return { admin, tenant, shopDomain, adminDomain, shopUrl, adminUrl }
      })
    } catch (error) {
      if (error.message === 'EMAIL_EXISTS') {
        return sendResponse(res, 409, false, 'El email ya está registrado')
      }
      if (error.message === 'SLUG_EXISTS') {
        return sendResponse(res, 409, false, 'Ese identificador de tienda ya está en uso')
      }
      if (error.message === 'DOMAIN_EXISTS') {
        return sendResponse(res, 409, false, 'El dominio ya está en uso')
      }

      logger.error(`Error creando tenant/admin: ${error.stack || error.message}`)
      throw error
    }

    try {
      await sendVerificationEmail(result.admin, result.tenant, rawEmailToken)
      logger.info(`Email de verificación enviado a: ${email}`)
    } catch (emailErr) {
      logger.error(`Fallo envío email verificación: ${emailErr.message}`)
    }

    return sendResponse(
      res,
      201,
      true,
      'Registro exitoso. Verificá tu email para activar el panel.',
      {
        user: {
          id: result.admin._id,
          email: result.admin.email,
          firstname: result.admin.firstname,
          lastname: result.admin.lastname,
          role: result.admin.role,
          tenantId: result.tenant._id,
        },
        tenant: {
          id: result.tenant._id,
          name: result.tenant.name,
          slug: result.tenant.slug,
          status: result.tenant.status,
          plan: result.tenant.plan,
          shopUrl: result.shopUrl,
          adminUrl: result.adminUrl,
          domains: result.tenant.domains,
          adminDomains: result.tenant.adminDomains,
        },
        urls: {
          storefront: result.shopUrl,
          admin: result.adminUrl,
        },
        requiresEmailVerification: true,
      },
    )
  }),
]

// =====================================================
// LOGIN
// =====================================================

const loginHandler = expressAsyncHandler(async (req, res, isAdmin = false) => {
  const email = normalizeEmail(req.body?.email)
  const password = req.body?.password
  const currentContextTenantId = req.tenantId

  if (!email || !password) {
    return sendResponse(res, 400, false, 'Correo y contraseña son obligatorios')
  }

  if (!currentContextTenantId) {
    return sendResponse(res, 400, false, 'No se pudo identificar el comercio.')
  }

  const user = await User.findOne({ email, tenantId: currentContextTenantId }).select(
    '+password +refreshToken +failedLoginAttempts +isBlocked +blockedUntil',
  )

  if (!user) {
    logger.warn(`Usuario inexistente o fuera de tenant: ${email}`)
    return sendResponse(res, 401, false, 'Credenciales inválidas')
  }

  if (!user.isEmailVerified) {
    return res.status(401).json({
      success: false,
      message:
        'Tu cuenta aún no ha sido verificada. Por favor, revisa tu correo electrónico para activarla.',
      isNotVerified: true,
    })
  }

  if (isAdmin && user.role !== 'admin') {
    logger.warn(`Acceso admin denegado para: ${email}`)
    return sendResponse(res, 403, false, 'Acceso restringido')
  }

  let tenant = null

  if (isAdmin) {
    tenant = await resolveAdminTenantFromRequest(req)

    if (!tenant) {
      return sendResponse(res, 404, false, 'Tienda no encontrada')
    }

    if (!user.tenantId.equals(tenant._id)) {
      logger.warn(
        `Admin fuera de tenant | user=${email} | userTenant=${user.tenantId} | resolvedTenant=${tenant._id}`,
      )
      return sendResponse(res, 403, false, 'Admin fuera de su tenant')
    }
  } else {
    tenant = await Tenant.findById(user.tenantId).select(
      '_id name domains adminDomains slug status plan',
    )

    if (!tenant || tenant.status !== 'active') {
      return sendResponse(res, 400, false, 'Tenant inválido o inactivo')
    }
  }

  if (user.isBlocked) {
    if (user.blockedUntil && user.blockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.blockedUntil - Date.now()) / 60000)
      return sendResponse(
        res,
        403,
        false,
        `Cuenta bloqueada temporalmente. Intente en ${minutesLeft} minutos.`,
      )
    }

    await User.findByIdAndUpdate(
      user._id,
      { isBlocked: false, failedLoginAttempts: 0, blockedUntil: null },
      { validateBeforeSave: false },
    ).setOptions({ ignoreTenant: true })
  }

  const isPasswordValid = await user.isPasswordMatched(password)

  if (!isPasswordValid) {
    const attempts = (user.failedLoginAttempts || 0) + 1
    const maxAttempts = Number(process.env.MAX_LOGIN_ATTEMPTS) || 5
    const blockMinutes = Number(process.env.BLOCK_MINUTES) || 15
    const update = { failedLoginAttempts: attempts }

    if (attempts >= maxAttempts) {
      update.isBlocked = true
      update.blockedUntil = new Date(Date.now() + blockMinutes * 60 * 1000)
    }

    await User.findByIdAndUpdate(user._id, update, {
      validateBeforeSave: false,
    }).setOptions({ ignoreTenant: true })

    if (attempts >= maxAttempts) {
      return sendResponse(
        res,
        403,
        false,
        `Demasiados intentos fallidos. Cuenta bloqueada ${blockMinutes} minutos.`,
      )
    }

    return sendResponse(res, 401, false, 'Credenciales inválidas')
  }

  const accessToken = generateAccessToken(user._id, {
    role: user.role,
    tenantId: tenant._id,
  })

  const { refreshToken, hashedJti } = await generateRefreshToken(user._id, {
    tenantId: tenant._id,
    role: user.role,
  })

  await User.findByIdAndUpdate(
    user._id,
    {
      failedLoginAttempts: 0,
      isBlocked: false,
      blockedUntil: null,
      refreshToken: hashedJti,
    },
    { validateBeforeSave: false, new: true },
  ).setOptions({ ignoreTenant: true })

  sendAuthCookies(res, req, refreshToken)
  logger.info(`Login exitoso: ${email} (${user.role}) | tenant=${tenant._id}`)
  recordAuthMetric({
    req,
    user,
    tenant,
    eventType: USER_METRIC_EVENTS.LOGIN,
    source: isAdmin ? 'admin' : 'storefront',
  })

  return res.status(200).json({
    success: true,
    data: {
      user: serializeUserWithTenant(user, tenant),
      token: accessToken,
    },
  })
})

export const loginUser = (req, res) => loginHandler(req, res, false)
export const loginAdmin = (req, res) => loginHandler(req, res, true)

// =====================================================
// CURRENT USER / REFRESH / LOGOUT
// =====================================================

export const getCurrentUser = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const userQuery = getTenantScopedUserQuery(req, userId)

  const user = await User.findOne(userQuery).populate({
    path: 'tenantId',
    select: 'name domains adminDomains slug status plan',
  })

  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  const tenant = user.tenantId
  if (!tenant) return sendResponse(res, 400, false, 'Tenant inválido')

  return sendResponse(
    res,
    200,
    true,
    'Usuario actual obtenido',
    serializeUserWithTenant(user, tenant),
  )
})

export const handleRefreshToken = expressAsyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken
  if (!refreshToken) return sendResponse(res, 403, false, 'No hay token de refresco')

  let decoded
  try {
    decoded = await verifyRefreshToken(refreshToken)
  } catch (err) {
    logger.warn(`Refresh token inválido o expirado: ${err.message}`)
    return sendResponse(res, 403, false, 'Token inválido o expirado')
  }

  const user = await User.findById(decoded.sub)
    .select('+refreshToken role tenantId email isBlocked')
    .setOptions({ ignoreTenant: true })

  if (!user || !user.refreshToken || user.isBlocked) {
    return sendResponse(res, 403, false, 'Usuario inválido')
  }

  const isValidJti = await bcrypt.compare(decoded.jti, user.refreshToken)
  if (!isValidJti) {
    user.refreshToken = null
    await user.save({ validateBeforeSave: false })
    return sendResponse(res, 403, false, 'Token de refresco inválido')
  }

  const tenant = await Tenant.findById(user.tenantId).select('_id status')
  if (!tenant || tenant.status !== 'active') {
    return sendResponse(res, 403, false, 'Tenant inválido o inactivo')
  }

  const newAccessToken = generateAccessToken(user._id, {
    role: user.role,
    tenantId: user.tenantId,
  })

  const { refreshToken: newRefreshToken, hashedJti } = await generateRefreshToken(
    user._id,
    {
      tenantId: user.tenantId,
      role: user.role,
    },
  )

  user.refreshToken = hashedJti
  await user.save({ validateBeforeSave: false })
  sendAuthCookies(res, req, newRefreshToken)

  logger.info(`Tokens renovados exitosamente para ${user.email}`)

  return res.status(200).json({
    success: true,
    message: 'Tokens renovados correctamente',
    token: newAccessToken,
    accessToken: newAccessToken,
  })
})

export const logout = expressAsyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET)
      const user = await User.findByIdAndUpdate(
        decoded.sub || decoded.id,
        { refreshToken: null },
        { validateBeforeSave: false, new: false },
      ).setOptions({ ignoreTenant: true })

      if (user?.tenantId) {
        recordAuthMetric({
          req,
          user,
          tenant: { _id: user.tenantId },
          eventType: USER_METRIC_EVENTS.LOGOUT,
          source: user.role === 'admin' ? 'admin' : 'storefront',
        })
      }
    } catch (err) {
      logger.warn(`Refresh token inválido o expirado al cerrar sesión: ${err.message}`)
    }
  }

  clearAuthCookies(res, req)
  return sendResponse(res, 200, true, 'Sesión cerrada correctamente')
})

// =====================================================
// PASSWORDS
// =====================================================

export const updatePassword = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const userQuery = getTenantScopedUserQuery(req, userId)
  const { currentPassword, newPassword } = req.body || {}

  if (!currentPassword || !newPassword) {
    return sendResponse(res, 400, false, 'Ambas contraseñas son necesarias')
  }

  if (String(newPassword).length < 8) {
    return sendResponse(res, 400, false, 'La nueva contraseña debe tener al menos 8 caracteres.')
  }

  const user = await User.findOne(userQuery).select('+password')
  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  const isMatch = await user.isPasswordMatched(currentPassword)
  if (!isMatch) return sendResponse(res, 400, false, 'La contraseña actual es incorrecta')

  user.password = newPassword
  user.passwordChangedAt = Date.now()
  user.refreshToken = null
  await user.save()

  logger.info(`Contraseña actualizada correctamente para usuario ${user.email}`)
  return sendResponse(res, 200, true, 'Contraseña actualizada correctamente')
})

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiadas solicitudes. Por favor, intenta de nuevo en 15 minutos.',
  },
})

export const forgotPassword = expressAsyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const tenantId = req.tenantId

  if (!email || !tenantId) {
    return sendResponse(res, 200, true, 'Si el correo existe, un enlace será enviado.')
  }

  const user = await User.findOne({ email, tenantId })

  if (!user) {
    logger.warn(`Intento de recuperación para email no encontrado: ${email}`)
    return sendResponse(res, 200, true, 'Si el correo existe, un enlace será enviado.')
  }

  const resetToken = crypto.randomBytes(32).toString('hex')
  user.passwordResetToken = hashToken(resetToken)
  user.passwordResetExpires = Date.now() + PASSWORD_RESET_TTL_MS
  await user.save({ validateBeforeSave: false })

  const resetUrl = buildFrontendUrl(`/reset-password/${resetToken}`, req)

  try {
    await sendResetPasswordEmail(user, resetUrl)
    logger.info(`Correo de recuperación enviado a ${user.email}`)
    return sendResponse(res, 200, true, 'Si el correo existe, un enlace será enviado.')
  } catch (error) {
    await User.findByIdAndUpdate(user.id, {
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
    })
    logger.error(`Error enviando correo a ${user.email}: ${error.message}`)
    return sendResponse(res, 500, false, 'Hubo un problema al enviar el correo.')
  }
})

export const resetPassword = expressAsyncHandler(async (req, res) => {
  const token = String(req.body?.token || '').trim()
  const password = String(req.body?.password || '')

  if (!token || !password) {
    return sendResponse(res, 400, false, 'Token y nueva contraseña son obligatorios')
  }

  if (password.length < 8) {
    return sendResponse(res, 400, false, 'La contraseña debe tener al menos 8 caracteres.')
  }

  const user = await User.findOne({
    passwordResetToken: hashToken(token),
    passwordResetExpires: { $gt: Date.now() },
  }).setOptions({ ignoreTenant: true })

  if (!user) {
    return sendResponse(res, 400, false, 'Token inválido o expirado. Solicita uno nuevo.')
  }

  user.password = password
  user.passwordChangedAt = Date.now()
  user.passwordResetToken = undefined
  user.passwordResetExpires = undefined
  user.refreshToken = null
  await user.save()

  logger.info(`Contraseña restablecida para: ${user.email}`)
  return sendResponse(
    res,
    200,
    true,
    'Contraseña restablecida correctamente. Ya puedes iniciar sesión.',
  )
})

// =====================================================
// PROFILE / ADMIN USERS
// =====================================================

export const updateUser = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const userQuery = getTenantScopedUserQuery(req, userId)
  const updateData = sanitizeProfilePayload(req.body)

  if (!Object.keys(updateData).length) {
    return sendResponse(res, 400, false, 'No hay campos permitidos para actualizar')
  }

  const updated = await User.findOneAndUpdate(userQuery, updateData, {
    new: true,
    runValidators: true,
    select: SAFE_USER_SELECT,
  })

  if (!updated) return sendResponse(res, 404, false, 'Usuario no encontrado')

  logger.info(`Usuario actualizado: ${updated.email}`)
  return sendResponse(res, 200, true, 'Usuario actualizado', updated)
})

export const getAllUsers = expressAsyncHandler(async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return sendResponse(res, 403, false, 'Acceso denegado')
  }

  const tenantId = req.user.tenantId
  if (!tenantId) return sendResponse(res, 400, false, 'Tenant inválido')

  const users = await User.find({ tenantId }).select(SAFE_USER_SELECT)
  logger.info(
    `Tenant ${tenantId} | Admin ${req.user.email || req.user._id} obtuvo ${users.length} usuarios`,
  )
  return sendResponse(res, 200, true, 'Usuarios obtenidos', users)
})

export const getUserById = expressAsyncHandler(async (req, res) => {
  const { id } = req.params
  requireValidId(id)

  const user = await User.findOne({
    _id: id,
    tenantId: req.user.tenantId,
  }).select(SAFE_USER_SELECT)

  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  return sendResponse(res, 200, true, 'Usuario obtenido', user)
})

export const deleteUser = expressAsyncHandler(async (req, res) => {
  const { id } = req.params
  requireValidId(id)

  const user = await User.findOneAndDelete({
    _id: id,
    tenantId: req.user.tenantId,
  })

  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  logger.info(`Usuario eliminado: ${user.email}`)
  return sendResponse(res, 200, true, 'Usuario eliminado correctamente')
})

export const blockUser = expressAsyncHandler(async (req, res) => {
  const { id } = req.params
  requireValidId(id)

  const user = await User.findOneAndUpdate(
    { _id: id, tenantId: req.user.tenantId },
    { isBlocked: true },
    { new: true },
  ).select(SAFE_USER_SELECT)

  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  logger.info(`Usuario bloqueado: ${user.email}`)
  return sendResponse(res, 200, true, 'Usuario bloqueado correctamente', user)
})

export const unblockUser = expressAsyncHandler(async (req, res) => {
  const { id } = req.params
  requireValidId(id)

  const user = await User.findOneAndUpdate(
    { _id: id, tenantId: req.user.tenantId },
    { isBlocked: false, blockedUntil: null, failedLoginAttempts: 0 },
    { new: true },
  ).select(SAFE_USER_SELECT)

  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  logger.info(`Usuario desbloqueado: ${user.email}`)
  return sendResponse(res, 200, true, 'Usuario desbloqueado correctamente', user)
})

// =====================================================
// WISHLIST
// =====================================================

export const getWishlist = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const tenantId = req.tenantId

  requireValidId(userId, 'Usuario inválido')
  requireValidId(tenantId, 'Tenant inválido')

  const user = await User.findOne({ _id: userId, tenantId }).populate({
    path: 'wishlist',
    match: { tenantId },
    select: 'title price images slug stock tenantId',
  })

  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  return sendResponse(res, 200, true, 'Wishlist obtenida', user.wishlist.filter(Boolean))
})

export const toggleWishlist = expressAsyncHandler(async (req, res) => {
  const { productId } = req.params
  const userId = getRequestUserId(req)
  const tenantId = req.tenantId

  requireValidId(userId, 'Usuario inválido')
  requireValidId(productId, 'ID de producto inválido')
  requireValidId(tenantId, 'Tenant inválido')

  const product = await Product.findOne({ _id: productId, tenantId })
  if (!product) {
    return sendResponse(res, 404, false, 'El producto no pertenece a este comercio o no existe.')
  }

  const user = await User.findOne({ _id: userId, tenantId })
  if (!user) return sendResponse(res, 404, false, 'Usuario no encontrado')

  const alreadyAdded = user.wishlist.some(id => String(id) === String(productId))
  const updateAction = alreadyAdded
    ? { $pull: { wishlist: productId } }
    : { $addToSet: { wishlist: productId } }

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, tenantId },
    updateAction,
    { new: true },
  ).populate({
    path: 'wishlist',
    match: { tenantId },
    select: 'title price images slug stock tenantId',
  })

  const message = alreadyAdded
    ? 'Producto eliminado de la lista de deseos.'
    : 'Producto añadido a la lista de deseos.'

  if (!alreadyAdded) {
    scheduleWishlistPromotionNotification({
      tenantId,
      userId,
      productId,
    })
  }

  return sendResponse(res, 200, true, message, updatedUser.wishlist.filter(Boolean))
})

// =====================================================
// ADDRESS
// =====================================================

export const validateAddress = [
  body('address')
    .trim()
    .notEmpty()
    .withMessage('La dirección es obligatoria')
    .isString()
    .withMessage('La dirección debe ser un texto válido'),
]

export const saveAddress = [
  ...validateAddress,
  expressAsyncHandler(async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return sendResponse(
        res,
        400,
        false,
        'Error de validación',
        errors.array().map(err => err.msg),
      )
    }

    const userId = getRequestUserId(req)
    const userQuery = getTenantScopedUserQuery(req, userId)

    const updatedUser = await User.findOneAndUpdate(
      userQuery,
      { address: req.body.address },
      { new: true, runValidators: true, select: SAFE_USER_SELECT },
    )

    if (!updatedUser) return sendResponse(res, 404, false, 'Usuario no encontrado')

    return sendResponse(
      res,
      200,
      true,
      'Dirección actualizada correctamente',
      updatedUser,
    )
  }),
]

// =====================================================
// CART
// =====================================================

export const userCart = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const tenantId = req.tenantId
  const {
    productId,
    quantity,
    colorId,
    size,
    gender,
    variantId,
    selectedAttributes,
    variantAttributes,
  } = req.body || {}

  requireValidId(userId, 'No autorizado')
  requireValidId(productId, 'productId inválido')
  requireValidId(tenantId, 'tenantId inválido')

  const normalizedQuantity = toSafeQuantity(quantity || 1)
  if (!normalizedQuantity) {
    return sendResponse(res, 400, false, 'Cantidad inválida')
  }

  const product = await Product.findOne({ _id: productId, tenantId })
    .select('price title images currency stock isDeleted hasVariants variants tenantId')
    .lean()

  if (!product || product.isDeleted) {
    return sendResponse(res, 404, false, 'Producto no disponible')
  }

  const hasVariants = Boolean(product.hasVariants || product.variants?.length > 0)
  let resolvedVariant = null
  let resolvedAttributes = selectedAttributes || variantAttributes || {}

  if (hasVariants) {
    if (!variantId) return sendResponse(res, 400, false, 'Debes seleccionar una variante válida')

    resolvedVariant = getVariantByIdentifier(product, variantId)
    if (!resolvedVariant) {
      return sendResponse(res, 404, false, 'La variante seleccionada no existe para este producto')
    }
    if (resolvedVariant.isActive === false) {
      return sendResponse(res, 400, false, 'La variante seleccionada está inactiva')
    }
    if (Number(resolvedVariant.stock || 0) < normalizedQuantity) {
      return sendResponse(
        res,
        400,
        false,
        `Stock insuficiente para la variante. Disponible: ${resolvedVariant.stock || 0}`,
      )
    }

    resolvedAttributes = resolvedVariant.attributes || resolvedVariant.combinacion || {}
  } else if (Number(product.stock || 0) < normalizedQuantity) {
    return sendResponse(res, 400, false, `Stock insuficiente. Disponible: ${product.stock || 0}`)
  }

  let cart = await Cart.findOne({ userId, tenantId })
  if (!cart) cart = await Cart.create({ userId, tenantId, products: [] })

  const pricing = await resolveCartPricing({
    tenantId,
    product,
    variant: resolvedVariant,
  })

  const finalVariantId = resolvedVariant?._id || null
  const finalVariantSku = resolvedVariant?.sku || null
  const finalCartKey = finalVariantId
    ? `${productId}::${finalVariantId}`
    : `${productId}::base`
  const finalImage =
    resolvedVariant?.image?.url ||
    product.images?.[0]?.url ||
    '/assets/images/placeholder.png'
  const finalTitle = product.title || 'Producto sin título'

  const variantSnapshot = hasVariants
    ? {
      id: finalVariantId,
      sku: finalVariantSku,
      price: pricing.price,
      originalPrice: pricing.originalPrice,
      discountPercentage: pricing.discountPercentage,
      hasPromotion: pricing.hasPromotion,
      promotionId: pricing.promotionId,
      promotionTitle: pricing.promotionTitle,
      promotionType: pricing.promotionType,
      stock: Number(resolvedVariant?.stock || 0),
      image: finalImage,
      attributes: resolvedAttributes,
    }
    : null

  const { action } = await cart.addOrUpdateProduct({
    product,
    quantity: normalizedQuantity,
    tenantId,
    colorId: colorId || null,
    size: size || null,
    gender: gender || null,
    variantId: finalVariantId,
    variantSku: finalVariantSku,
    variantSKU: finalVariantSku,
    selectedAttributes: resolvedAttributes,
    variantAttributes: resolvedAttributes,
    selectedVariant: variantSnapshot,
    cartKey: finalCartKey,
    title: finalTitle,
    image: finalImage,
    price: pricing.price,
    originalPrice: pricing.originalPrice,
    discountPercentage: pricing.discountPercentage,
    hasPromotion: pricing.hasPromotion,
    promotionId: pricing.promotionId,
    promotionTitle: pricing.promotionTitle,
    promotionType: pricing.promotionType,
    currency: product.currency || 'ARS',
  })

  await cart.populate([
    {
      path: 'products.productId',
      select: 'title price images stock variants hasVariants tenantId',
    },
    { path: 'products.colorId', select: 'title' },
  ])

  return res.status(200).json({
    success: true,
    message:
      action === 'added'
        ? 'Producto agregado al carrito'
        : 'Cantidad actualizada en el carrito',
    data: {
      products: cart.products,
      cartTotal: cart.cartTotal,
      totalAfterDiscount: cart.totalAfterDiscount,
    },
  })
})

export const getUserCart = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const tenantId = req.tenantId

  requireValidId(userId, 'No autorizado')
  requireValidId(tenantId, 'tenantId inválido')

  const cart = await Cart.findOne({ userId, tenantId })
    .populate('products.productId', 'title price images stock variants hasVariants tenantId')
    .populate('products.colorId', 'title')
    .populate('appliedCoupon', 'code discount')
    .lean()

  if (!cart) {
    return res.status(200).json({
      success: true,
      data: {
        products: [],
        cartTotal: 0,
        totalAfterDiscount: 0,
        appliedCoupon: null,
      },
    })
  }

  return res.status(200).json({
    success: true,
    data: {
      products: cart.products,
      cartTotal: cart.cartTotal,
      totalAfterDiscount: cart.totalAfterDiscount,
      appliedCoupon: cart.appliedCoupon,
    },
  })
})

export const removeFromCart = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const tenantId = req.tenantId
  const { productId } = req.params
  const { variantId, cartKey } = req.query

  requireValidId(userId, 'No autorizado')
  requireValidId(productId, 'ID de producto inválido')
  requireValidId(tenantId, 'tenantId inválido')

  const cart = await Cart.findOne({ userId, tenantId })
  if (!cart) return sendResponse(res, 404, false, 'Carrito no encontrado')

  const initialLength = cart.products.length
  await cart.removeProduct({ productId, variantId: variantId || null, cartKey: cartKey || null })

  if (cart.products.length === initialLength) {
    return sendResponse(res, 404, false, 'Item no encontrado en el carrito')
  }

  await cart.populate([
    {
      path: 'products.productId',
      select: 'title price images stock variants hasVariants tenantId',
    },
    { path: 'products.colorId', select: 'title' },
    { path: 'appliedCoupon', select: 'code discount' },
  ])

  return res.status(200).json({
    success: true,
    message: 'Producto eliminado del carrito',
    data: {
      products: cart.products,
      cartTotal: cart.cartTotal,
      totalAfterDiscount: cart.totalAfterDiscount,
      appliedCoupon: cart.appliedCoupon,
    },
  })
})

export const emptyCart = expressAsyncHandler(async (req, res) => {
  const userId = getRequestUserId(req)
  const tenantId = req.tenantId

  requireValidId(userId, 'No autorizado')
  requireValidId(tenantId, 'tenantId inválido')

  await Cart.deleteOne({ userId, tenantId })
  return sendResponse(res, 200, true, 'Carrito vacío correctamente')
})
