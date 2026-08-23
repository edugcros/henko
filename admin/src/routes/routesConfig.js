// admin/src/routes/routesConfig.js
import react from 'react'

import pages from '@pages'

// ✅ Rutas públicas (login, recuperación, etc.)
export const publicRoutes = [
  { path: '/login', Component: pages.Login },
  { path: '/forgot-password', Component: pages.Forgotpassword },
  { path: '/signup', Component: pages.AdminRegister },
  { path: '/subscripcion', Component: pages.SubscriptionPage },
  // Destino del enlace de verificación del alta. Es público porque la cuenta
  // todavía no está verificada y por lo tanto no hay sesión posible.
  { path: '/verify-email', Component: pages.VerifyEmailPage },
]
// ✅ Rutas públicas dinámicas (con parámetros como tokens)
//
// "Pública" acá significa alcanzable sin sesión, así que solo entran las que
// se autentican con el propio parámetro de la URL. La edición de producto
// estuvo en esta lista y no correspondía: se renderizaba fuera de
// PrivateRoute, y un visitante sin sesión veía la pantalla del panel vacía y
// sin sidebar en vez de que lo mandaran al login. Los datos nunca estuvieron
// expuestos — el backend exige authMiddleware + isAdmin — pero la pantalla sí.
export const publicDynamicRoutes = [
  { path: '/reset-password/:token', Component: pages.Resetpassword },
]

// 🔐 Rutas protegidas (requieren login pero no rol específico)
export const protectedRoutes = [
  // Reservado para futuro: perfil, configuraciones básicas, etc.
]

// 🔐 Rutas privadas del Admin (requieren autenticación y rol `admin`)
export const privateRoutes = [
  { path: '/admin/', Component: pages.Dashboard, allowedRoles: ['admin'] }, // Es la raíz relativa dentro de "/admin"
  {
    path: '/admin/ordenes',
    Component: pages.AdminOrdersPage,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/diseñoweb',
    Component: pages.ThemeCustomizer,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/promociones',
    Component: pages.PromotionalBlocksPage,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/redes-sociales',
    Component: pages.SocialPromotionPage,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/clientes',
    Component: pages.Customers,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/consultas',
    Component: pages.Enquiries,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/bandeja-entrada-ia-comercial',
    Component: pages.AiCommercialInboxPage,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/agente-ia-config',
    Component: pages.AiAgentConfigPage,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/agente-ia-aprendizaje',
    Component: pages.AiLearningReviewPage,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/agente-ia-panel',
    Component: pages.AiAgentDashboardPage,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/agente-ia-conocimiento',
    Component: pages.AiKnowledgeBasePage,
    allowedRoles: ['admin'],
  },

  {
    path: '/admin/agente-ia-campanas',
    Component: pages.AiCampaignRulesPage,
    allowedRoles: ['admin'],
  },

  // 🚀 Onboarding
  {
    path: '/admin/onboarding',
    Component: pages.OnboardingWizard,
    allowedRoles: ['admin'],
  },

  // ⚙️ Configuración del comercio
  {
    path: '/admin/configuracion-comercio',
    Component: pages.StoreSettingsPage,
    allowedRoles: ['admin'],
  },

  // 💳 Pagos
  {
    path: '/admin/configuracion-pagos',
    Component: pages.PaymentConfigPage,
    allowedRoles: ['admin'],
  },

  // 📊 Meta Pixel / Conversions API
  {
    path: '/admin/meta-pixel',
    Component: pages.MetaPixelConfigPage,
    allowedRoles: ['admin'],
    meta: { new: true },
  },

  // 🖼️ Editor IA de Imágenes
  {
    path: '/admin/editor-imagen-ia',
    Component: pages.ImageAiEditor,
    allowedRoles: ['admin'],
    meta: { new: true },
  },

  // 📦 Catálogo
  {
    path: '/admin/AddProduct',
    Component: pages.AddProduct,
    allowedRoles: ['admin'],
  },
  // Pantalla de detalle: se llega desde Productlist, no desde el menú (ver
  // HIDDEN_ROUTES en utils/adminMenu.jsx).
  {
    path: '/admin/edit-product/:productId',
    Component: pages.EditProduct,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/productlist',
    Component: pages.Productlist,
    allowedRoles: ['admin'],
  },
  {
    path: '/admin/product-analysis',
    Component: pages.ProductAnalysisPage,
    allowedRoles: ['admin'],
    meta: { new: true },
  },

  // 💸 Cupones / Marketing
  {
    path: '/admin/crear-cupon',
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
