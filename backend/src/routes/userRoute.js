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
// Debe llegar x-tenant-domain = admin.<tenant>.<root-domain>
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
  csrfProtection,
  createUser,
)

// Registro SaaS: crea tenant + admin principal.
// Público, con limitador y validaciones fuertes en controller.
router.post(
  '/register-admin',
  registerAdminLimiter,
  createUserAdmin,
)

// Refresh token.
// Como usa cookie y rota sesión, debe estar protegido con CSRF.
router.post(
  '/refresh',
  csrfProtection,
  handleRefreshToken,
)

// Recuperación de contraseña tenant-aware.
// Esto evita ambigüedad si el mismo email existe en distintas tiendas.
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

// Logout usa refresh cookie; no requiere authMiddleware para poder cerrar
// incluso cuando el access token ya expiró, pero sí CSRF.
router.post(
  '/logout',
  csrfProtection,
  logout,
)

// Cambios sensibles sobre cuenta propia.
router.put(
  '/password',
  resolveTenantByDomain,
  authMiddleware,
  csrfProtection,
  updatePassword,
)

router.put(
  '/edit-user',
  resolveTenantByDomain,
  authMiddleware,
  csrfProtection,
  updateUser,
)

router.put(
  '/save-address',
  resolveTenantByDomain,
  authMiddleware,
  csrfProtection,
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
  csrfProtection,
  toggleWishlist,
)

// ======================================================
// 🛒 4. CARRITO
// ======================================================

router.post(
  '/cart',
  resolveTenantByDomain,
  authMiddleware,
  csrfProtection,
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
  csrfProtection,
  emptyCart,
)

router.delete(
  '/cart/:productId',
  resolveTenantByDomain,
  authMiddleware,
  csrfProtection,
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
  csrfProtection,
  blockUser,
)

router.put(
  '/unblock-user/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  csrfProtection,
  unblockUser,
)

router.delete(
  '/delete-user/:id',
  resolveTenantByDomain,
  authMiddleware,
  isAdmin,
  csrfProtection,
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