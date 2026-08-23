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
  resendVerificationEmail,
  resendVerificationLimiter,
  resetPassword,
  updatePassword,
  getAllUsers,
  getUserById,
  deleteUser,
  updateUser,
  blockUser,
  unblockUser,
  verifyUserManually,
  getWishlist,
  toggleWishlist,
  saveAddress,
  validateAddress,
  userCart,
  getUserCart,
  emptyCart,
  removeFromCart,
  createUserAdmin,
  verifyEmail,
} from '../controller/userCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import {
  requireAdminDomain,
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

import {
  csrfProtectionDynamic,
} from '../middlewares/csrfMiddleware.js'
import { verifyTurnstile } from '../middlewares/turnstileMiddleware.js'
import { env } from '../../config/env.js'

const router = express.Router()
const adminContext = [
  resolveTenantByDomain,
  requireTenant,
  requireAdminDomain,
  authMiddleware,
  isAdmin,
]

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

router.get('/csrf-token', (req, res) => {
  // CSRF_ENABLED=false apaga csrfProtectionDynamic a nivel global (ver
  // app.js), así que req.csrfToken nunca se define. Sin esta rama, este
  // mismo endpoint devolvía 500 en cada request mientras la protección
  // estuviera deshabilitada, en vez de reflejar ese estado.
  if (!env.csrfEnabled) {
    return res.status(200).json({
      success: true,
      csrfEnabled: false,
      csrfToken: null,
    })
  }

  try {
    if (typeof req.csrfToken !== 'function') {
      return res.status(500).json({
        success: false,
        code: 'CSRF_NOT_INITIALIZED',
        message: 'El middleware CSRF no fue inicializado correctamente',
      })
    }

    const csrfToken = req.csrfToken()

    return res.status(200).json({
      success: true,
      csrfEnabled: true,
      csrfToken,
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: 'CSRF_TOKEN_GENERATION_FAILED',
      message: 'No fue posible generar el token CSRF',
    })
  }
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
// 🔓 1. RUTAS PÚBLICAS
// ======================================================

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
  verifyTurnstile,
  resolveTenantByDomain,
  createUser,
)

// Registro SaaS: crea tenant + admin principal.
router.post(
  '/register-admin',
  registerAdminLimiter,
  verifyTurnstile,
  createUserAdmin,
)

// Refresh token.
router.post(
  '/refresh',
  handleRefreshToken,
)

// Reenvío del correo de verificación, tenant-aware.
// Sin esta ruta, un correo de alta que no llegaba dejaba la cuenta bloqueada
// sin salida: el login exige verificación y el alta rechaza el email repetido.
router.post(
  '/resend-verification',
  resendVerificationLimiter,
  resolveTenantByDomain,
  resendVerificationEmail,
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
  logout,
)

// Cambios sensibles sobre cuenta propia.
router.put(
  '/password',
  resolveTenantByDomain,
  authMiddleware,
  updatePassword,
)

router.put(
  '/edit-user',
  resolveTenantByDomain,
  authMiddleware,
  updateUser,
)

router.put(
  '/save-address',
  resolveTenantByDomain,
  authMiddleware,
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
  toggleWishlist,
)

// ======================================================
// 🛒 4. CARRITO
// ======================================================

router.post(
  '/cart',
  resolveTenantByDomain,
  authMiddleware,
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
  emptyCart,
)

router.delete(
  '/cart/:productId',
  resolveTenantByDomain,
  authMiddleware,
  removeFromCart,
)

// ======================================================
// 🔐 5. ADMINISTRACIÓN DE USUARIOS
// ======================================================

router.get(
  '/all-users',
  adminContext,
  getAllUsers,
)

router.put(
  '/block-user/:id',
  adminContext,
  blockUser,
)

router.put(
  '/unblock-user/:id',
  adminContext,
  unblockUser,
)

router.put(
  '/verify-user/:id',
  adminContext,
  verifyUserManually,
)

router.delete(
  '/delete-user/:id',
  adminContext,
  deleteUser,
)

// ⚠️ Debe ir al final porque captura rutas dinámicas.
router.get(
  '/:id',
  adminContext,
  getUserById,
)

export default router
