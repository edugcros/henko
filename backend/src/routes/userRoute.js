// 📁 src/routes/userRoute.js
import express from 'express'
import rateLimit from 'express-rate-limit'

import {
  createUser,
  loginUser,
  loginAdmin,
  getCurrentUser,
  handleRefreshToken,
  logout,
  forgotPassword,
  forgotPasswordLimiter,
  resetPassword,
  updatePassword,
  getAllUsers,
  getUserById,
  deleteUser,
  updateUser,
  blockUser,
  unblockUser,
  getWishlist,
  toggleWishlist,
  saveAddress,
  validateAddress,
  userCart,
  getUserCart,
  emptyCart,
  removeFromCart,
  getCsrfToken,
  createUserAdmin,
  verifyEmail,
} from '../controller/userCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import { csrfProtection } from '../middlewares/csrfMiddleware.js'
import { resolveTenantByDomain } from '../middlewares/tenantMiddleware.js'

const router = express.Router()

// ======================================================
// 🛡️ RATE LIMITS PÚBLICOS SENSIBLES
// ======================================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos. Intente nuevamente en unos minutos.',
  },
})

const registerAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos de registro. Intente nuevamente en unos minutos.',
  },
})

// ======================================================
// 🧩 CSRF CONDICIONAL PARA PREDEPLOY / TÚNEL
// ======================================================

const normalizePath = value => {
  const normalized = String(value || '').replace(/\/+$/, '')
  return normalized || '/'
}

const isTrustedPredeployOrigin = req => {
  const origin = String(req.headers.origin || '').toLowerCase()

  return [
    'https://henko-web.vercel.app',
    'https://henko-admin.vercel.app',
  ].includes(origin)
}

const routePatternToRegex = pattern => {
  const normalized = normalizePath(pattern)

  const escaped = normalized
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\:([^/]+)/g, '[^/]+')

  return new RegExp(`^${escaped}$`)
}

const predeployCsrfExemptRoutes = [
  // Auth pública
  { method: 'POST', path: '/login' },
  { method: 'POST', path: '/admin-login' },
  { method: 'POST', path: '/register' },
  { method: 'POST', path: '/register-admin' },

  // Carrito storefront durante túnel
  { method: 'POST', path: '/cart' },
  { method: 'DELETE', path: '/cart/empty' },
  { method: 'DELETE', path: '/cart/:productId' },
  { method: 'POST', path: '/cart/cash-order' },

  // Wishlist durante túnel
  { method: 'PUT', path: '/wishlist/:productId' },

  // Sesión / refresh durante túnel
  { method: 'POST', path: '/logout' },
  { method: 'POST', path: '/refresh' },

  // Perfil durante túnel
  { method: 'PUT', path: '/password' },
  { method: 'PUT', path: '/edit-user' },
  { method: 'PUT', path: '/save-address' },

  // Admin durante túnel
  { method: 'PUT', path: '/block-user/:id' },
  { method: 'PUT', path: '/unblock-user/:id' },
  { method: 'DELETE', path: '/delete-user/:id' },
]

const matchesPredeployExemptRoute = req => {
  const requestPath = normalizePath(req.path)

  return predeployCsrfExemptRoutes.some(route => {
    return (
      route.method === req.method &&
      routePatternToRegex(route.path).test(requestPath)
    )
  })
}

const shouldSkipCsrfForPredeploy = req => {
  return (
    process.env.PREDEPLOY_TUNNEL_MODE === 'true' &&
    isTrustedPredeployOrigin(req) &&
    matchesPredeployExemptRoute(req)
  )
}

const conditionalCsrfProtection = (req, res, next) => {
  if (shouldSkipCsrfForPredeploy(req)) {
    return next()
  }

  return csrfProtection(req, res, next)
}

// ======================================================
// 🔓 1. RUTAS PÚBLICAS
// ======================================================

// Bootstrap CSRF.
// Debe quedar público para que el frontend obtenga el token inicial.
router.get('/csrf-token', getCsrfToken)

// Verificación de email por token global seguro.
// No requiere tenant porque el token ya es aleatorio, hasheado y de un solo uso.
router.get('/verify-email', verifyEmail)

// Login storefront por dominio actual.
router.post(
  '/login',
  authLimiter,
  resolveTenantByDomain,
  loginUser,
)

// Login panel admin por dominio admin actual.
router.post(
  '/admin-login',
  authLimiter,
  resolveTenantByDomain,
  loginAdmin,
)

// Registro de comprador dentro de una tienda existente.
router.post(
  '/register',
  authLimiter,
  resolveTenantByDomain,
  conditionalCsrfProtection,
  createUser,
)

// Registro SaaS: crea tenant + admin principal.
router.post(
  '/register-admin',
  registerAdminLimiter,
  createUserAdmin,
)

// Refresh token.
// En producción real debe ir con CSRF.
// En túnel puede saltarse si PREDEPLOY_TUNNEL_MODE=true y origin es Vercel.
router.post(
  '/refresh',
  conditionalCsrfProtection,
  handleRefreshToken,
)

// Recuperación de contraseña tenant-aware.
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  resolveTenantByDomain,
  forgotPassword,
)

// Reset por token global seguro.
router.put(
  '/reset-password',
  resetPassword,
)

// ======================================================
// 👤 2. RUTAS PRIVADAS DEL USUARIO
// ======================================================

// Usuario actual en el contexto del dominio vigente.
router.get(
  '/me',
  resolveTenantByDomain,
  authMiddleware,
  getCurrentUser,
)

// Logout usa refresh cookie; no requiere authMiddleware para cerrar sesión.
router.post(
  '/logout',
  conditionalCsrfProtection,
  logout,
)

// Cambios sensibles sobre cuenta propia.
router.put(
  '/password',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  updatePassword,
)

router.put(
  '/edit-user',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  updateUser,
)

router.put(
  '/save-address',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  validateAddress,
  saveAddress,
)

// ======================================================
// 🧡 3. WISHLIST
// ======================================================

// GET no requiere CSRF.
router.get(
  '/wishlist',
  resolveTenantByDomain,
  authMiddleware,
  getWishlist,
)

router.put(
  '/wishlist/:productId',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  toggleWishlist,
)

// ======================================================
// 🛒 4. CARRITO
// ======================================================

router.post(
  '/cart',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  userCart,
)

// GET no requiere CSRF.
router.get(
  '/user-cart',
  resolveTenantByDomain,
  authMiddleware,
  getUserCart,
)

router.delete(
  '/cart/empty',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  emptyCart,
)

router.delete(
  '/cart/:productId',
  resolveTenantByDomain,
  authMiddleware,
  conditionalCsrfProtection,
  removeFromCart,
)

// ======================================================
// 🔐 5. ADMINISTRACIÓN DE USUARIOS
// ======================================================

router.get(
  '/all-users',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  getAllUsers,
)

router.put(
  '/block-user/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  conditionalCsrfProtection,
  blockUser,
)

router.put(
  '/unblock-user/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  conditionalCsrfProtection,
  unblockUser,
)

router.delete(
  '/delete-user/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  conditionalCsrfProtection,
  deleteUser,
)

// ⚠️ Debe ir al final porque captura rutas dinámicas.
router.get(
  '/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  getUserById,
)

export default router