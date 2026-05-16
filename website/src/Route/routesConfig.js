// 📄 src/routes/routesConfig.js — Configuración central de rutas para producción
import { lazy } from 'react'

// 🔹 Páginas esenciales (precarga inmediata)
import Home from '@pages/Home'
import About from '@pages/About'
import Contact from '@pages/Contact'
import PrivacyPolicy from '@pages/PrivacyPolicy'
import RefundPolicy from '@pages/RefundPolicy'
import ShippingPolicy from '@pages/ShippingPolicy'
import TermAndConditions from '@pages/TermAndConditions'
import OurStore from '@pages/OurStore'
import SingleProduct from '@pages/SingleProduct'
import Unauthorized from '@pages/Unauthorized'
import NotFound from '@pages/NotFound/NotFound'
import VerifyEmail from '../Components/VerifyEmail'

// 🔸 Páginas diferidas (lazy load)
const Cart = lazy(() => import('@pages/Cart'))
const CheckoutPage = lazy(() => import('@pages/CheckoutPage'))
const Wishlist = lazy(() => import('@pages/Wishlist'))
const CompareProduct = lazy(() => import('@pages/CompareProduct'))
const Login = lazy(() => import('@pages/Login'))
const Signup = lazy(() => import('@pages/Signup'))
const ForgotPassword = lazy(() => import('@pages/Forgotpassword'))
const ResetPassword = lazy(() => import('@pages/Resetpassword'))

// 🔴 NUEVO: Páginas adicionales (solo estas, no duplicar)
const OrderHistory = lazy(() => import('../Pages/OrderHistory'))
const Profile = lazy(() => import('../Pages/Profile'))

// ✅ Rutas públicas (no requieren autenticación)
export const publicRoutes = [
  { path: '/', Component: Home },
  { path: '/about', Component: About },
  { path: '/contact', Component: Contact },
  { path: '/product', Component: OurStore },
  { path: '/privacy-policy', Component: PrivacyPolicy },
  { path: '/refund-policy', Component: RefundPolicy },
  { path: '/shipping-policy', Component: ShippingPolicy },
  { path: '/terms-and-conditions', Component: TermAndConditions },
  { path: '/login', Component: Login },
  { path: '/signup', Component: Signup },
  { path: '/unauthorized', Component: Unauthorized },
  { path: '/verify-email', Component: VerifyEmail },
]

// ✅ Rutas públicas dinámicas (con parámetros)
export const publicDynamicRoutes = [
  { path: '/forgot-password', Component: ForgotPassword },
  { path: '/reset-password/:token', Component: ResetPassword },
  { path: '/product/:id', Component: SingleProduct },
]

// 🔐 Rutas protegidas (no requieren login pero son sensibles)
export const protectedRoutes = [
  // 💡 token incluido si lo requiere el backend
]

// 🔐 Rutas privadas (requieren autenticación y roles específicos)
export const privateRoutes = [
  { path: '/cart', Component: Cart, allowedRoles: ['user', 'admin'] },
  {
    path: '/checkout',
    Component: CheckoutPage,
    allowedRoles: ['user', 'admin'],
  },
  { path: '/wishlist', Component: Wishlist, allowedRoles: ['user', 'admin'] },
  {
    path: '/compare-product',
    Component: CompareProduct,
    allowedRoles: ['user', 'admin'],
  },
  { path: '/orders', Component: OrderHistory, allowedRoles: ['user', 'admin'] },
  { path: '/profile', Component: Profile, allowedRoles: ['user', 'admin'] },
]

// 🧠 Conjuntos para validaciones rápidas
export const publicRoutesSet = new Set(publicRoutes.map(route => route.path))
export const publicDynamicRoutesSet = new Set(publicDynamicRoutes.map(route => route.path))
export const protectedRoutesSet = new Set(protectedRoutes.map(route => route.path))
export const privateRoutesSet = new Set(privateRoutes.map(route => route.path))

// 🔁 Set global (si se requiere validar cualquier ruta)
export const allRoutesSet = new Set([
  ...publicRoutesSet,
  ...publicDynamicRoutesSet,
  ...protectedRoutesSet,
  ...privateRoutesSet,
])

// 🔚 Fallback para rutas no encontradas
export const fallbackRoute = { path: '*', Component: NotFound }
