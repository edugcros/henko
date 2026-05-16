// admin/src/routes/routesConfig.js
import react  from 'react'

import pages from '@pages'

// ✅ Rutas públicas (login, recuperación, etc.)
export const publicRoutes = [
  { path: '/login', Component: pages.Login },
  { path: '/forgot-password', Component: pages.Forgotpassword },
  { path: '/signup', Component: pages.AdminRegister },
  { path: '/subscripcion', Component: pages.SubscriptionPage },
]
// ✅ Rutas públicas dinámicas (con parámetros como tokens)
export const publicDynamicRoutes = [
  { path: '/reset-password/:token', Component: pages.Resetpassword },
    {
    path: '/admin/edit-product/:productId',
    Component: pages.EditProduct,
  },
]

// 🔐 Rutas protegidas (requieren login pero no rol específico)
export const protectedRoutes = [
  // Reservado para futuro: perfil, configuraciones básicas, etc.
]

// 🔐 Rutas privadas del Admin (requieren autenticación y rol `admin`)
export const privateRoutes = [
  { path: '', Component: pages.Dashboard, allowedRoles: ['admin'] }, // Es la raíz relativa dentro de "/admin"
  {
    path: '/admin/orders',
    Component: pages.AdminOrdersPage,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/store-design',
    Component: pages.ThemeCustomizer,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/promotional-blocks',
    Component: pages.PromotionalBlocksPage,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/customers',
    Component: pages.Customers,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/enquiries',
    Component: pages.Enquiries,
    allowedRoles: ['admin'],
  },

  // 📦 Catálogo
  {
    path: '/admin/addproduct',
    Component: pages.Addproduct,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/productlist',
    Component: pages.Productlist,
    allowedRoles: ['admin'],
  },

  // 💸 Cupones / Marketing
  {
    path: '/admin/addcoupon',
    Component: pages.CouponsPage,
    allowedRoles: ['admin'],
  },
]

// 🧠 Conjuntos de rutas para validaciones automáticas
export const publicRoutesSet = new Set(publicRoutes.map(route => route.path))
export const publicDynamicRoutesSet = new Set(
  publicDynamicRoutes.map(route => route.path),
)
export const protectedRoutesSet = new Set(
  protectedRoutes.map(route => route.path),
)
export const privateRoutesSet = new Set(privateRoutes.map(route => route.path))

// 🔁 Set global para validaciones si se requiere
export const allRoutesSet = new Set([
  ...publicRoutesSet,
  ...publicDynamicRoutesSet,
  ...protectedRoutesSet,
  ...privateRoutesSet,
])

// 🔚 Fallback en rutas no encontradas
export const fallbackRoute = { path: '*', Component: pages.NotFound }
