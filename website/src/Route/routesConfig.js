// 📄 src/Route/routesConfig.js
// Configuración centralizada de rutas para producción

import { lazy } from 'react'

// 🔹 Páginas esenciales
import Home from '@pages/Home'
import About from '@pages/About'
import Contact from '@pages/Contact'
import PrivacyPolicy from '@pages/PrivacyPolicy'
import RefundPolicy from '@pages/RefundPolicy'
import ShippingPolicy from '@pages/ShippingPolicy'
import TermAndConditions from '@pages/TermAndConditions'
import SingleProduct from '@pages/SingleProduct'
import Unauthorized from '@pages/Unauthorized'
import NotFound from '@pages/NotFound/NotFound.js'
import VerifyEmail from '@components/VerifyEmail'
import SubscriptionCTA from '@components/SubscriptionCTA'

// ⚠️ Desactivado hasta que exista un export default real.
// import SubscriptionCTA from '@components/SubscriptionCTA'

const lazyDefault = importer =>
  lazy(async () => {
    const module = await importer()

    if (!module?.default) {
      throw new Error(
        '[routesConfig] Lazy import inválido: el módulo no tiene export default.',
      )
    }

    return {
      default: module.default,
    }
  })

// 🔸 Páginas diferidas
const Cart = lazyDefault(() => import('@pages/Cart'))
const CheckoutPage = lazyDefault(() => import('@pages/CheckoutPage'))
const Wishlist = lazyDefault(() => import('@pages/Wishlist'))
const OurStore = lazyDefault(() => import('@pages/OurStore'))
const CompareProduct = lazyDefault(() => import('@pages/CompareProduct'))

// 🔐 Auth pages: solo usuarios NO logueados
const Login = lazyDefault(() => import('@pages/Login'))
const Signup = lazyDefault(() => import('@pages/Signup'))
const ForgotPassword = lazyDefault(() => import('@pages/Forgotpassword'))
const ResetPassword = lazyDefault(() => import('@pages/Resetpassword'))

// 🔒 Private pages
const OrderHistory = lazyDefault(() => import('@pages/OrderHistory'))
const Profile = lazyDefault(() => import('@pages/Profile'))

// ✅ Rutas públicas universales:
// entran usuarios logueados, no logueados y admins.
export const publicRoutes = [
  { path: '/', Component: Home },
  { path: '/about', Component: About },
  { path: '/contact', Component: Contact },
  { path: '/product', Component: OurStore },
  { path: '/privacy-policy', Component: PrivacyPolicy },
  { path: '/refund-policy', Component: RefundPolicy },
  { path: '/shipping-policy', Component: ShippingPolicy },
  { path: '/terms-and-conditions', Component: TermAndConditions },
  { path: '/unauthorized', Component: Unauthorized },
  { path: '/verify-email', Component: VerifyEmail },

  // Reactivar solo cuando el componente exista y tenga export default:
  { path: '/subscription-cta', Component: SubscriptionCTA },
]

// ✅ Rutas públicas dinámicas universales
export const publicDynamicRoutes = [
  { path: '/product/:id', Component: SingleProduct },
]

// 🔐 Rutas solo para usuarios NO logueados
export const authRoutes = [
  { path: '/login', Component: Login },
  { path: '/signup', Component: Signup },
  { path: '/forgot-password', Component: ForgotPassword },
  { path: '/reset-password/:token', Component: ResetPassword },
]

// 🔐 Rutas protegidas especiales
export const protectedRoutes = []

// 🔒 Rutas privadas: requieren login
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

// 🔚 Fallback
export const fallbackRoute = {
  path: '*',
  Component: NotFound,
}

// 🧠 Sets de validación
export const publicRoutesSet = new Set(publicRoutes.map(route => route.path))

export const publicDynamicRoutesSet = new Set(
  publicDynamicRoutes.map(route => route.path),
)

export const authRoutesSet = new Set(authRoutes.map(route => route.path))

export const protectedRoutesSet = new Set(
  protectedRoutes.map(route => route.path),
)

export const privateRoutesSet = new Set(privateRoutes.map(route => route.path))

export const allRoutesSet = new Set([
  ...publicRoutesSet,
  ...publicDynamicRoutesSet,
  ...authRoutesSet,
  ...protectedRoutesSet,
  ...privateRoutesSet,
])

if (process.env.NODE_ENV !== 'production') {
  console.table(
    [
      ...publicRoutes,
      ...publicDynamicRoutes,
      ...authRoutes,
      ...protectedRoutes,
      ...privateRoutes,
      fallbackRoute,
    ].map(route => ({
      path: route.path,
      componentType: typeof route.Component,
      isValid: Boolean(route.Component),
    })),
  )
}
