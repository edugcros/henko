import { lazy } from 'react'
import Login from './Login'

// 📦 Todo lo demás carga bajo demanda.
//
// Antes esto era 27 imports estáticos, y con un solo entry point
// (src/index.js) webpack los metía a todos en el mismo grafo. El
// splitChunks.maxSize de webpack.prod.js los troceaba en pedazos de 250KB
// para bajarlos en paralelo, pero seguían siendo TODOS obligatorios en la
// primera carga — 3,08 MiB medidos, entrypoint marcado [big] por webpack.
// Alguien que entra a cambiar una contraseña bajaba también AddProduct
// (9.316 líneas) sin haberlo pedido.
//
// Login queda afuera de este lazy(): es la única pantalla que ve un usuario
// sin sesión, y evitar el parpadeo del Suspense ahí vale más que los KB que
// ahorra.
const Dashboard = lazy(() => import('./Dashboard'))
const Forgotpassword = lazy(() => import('./Forgotpassword'))
const Resetpassword = lazy(() => import('./Resetpassword'))
const AdminOrdersPage = lazy(() => import('./AdminOrdersPage'))
const AdminRegister = lazy(() => import('./AdminRegister'))
const Customers = lazy(() => import('./Customers'))
const Enquiries = lazy(() => import('./Enquiries'))
const AddProduct = lazy(() => import('./AddProduct'))
const Productlist = lazy(() => import('./Productlist'))
const SubscriptionPage = lazy(() => import('./SubscriptionPage'))
const CheckoutPage = lazy(() => import('./CheckoutPage'))
const SubscriptionManagementPage = lazy(
  () => import('./SubscriptionManagementPage'),
)
const NotFound = lazy(() => import('./NotFound'))
const ThemeCustomizer = lazy(() => import('./ThemeCustomizer'))
const CouponsPage = lazy(() => import('./CouponsPage'))
const EditProduct = lazy(() => import('./EditProduct'))
const PromotionalBlocksPage = lazy(() => import('./PromotionalBlocksPage'))
const SocialPromotionPage = lazy(() => import('./SocialPromotionPage'))
const ProductAnalysisPage = lazy(() => import('./ProductAnalysisPage'))
const AiCommercialInboxPage = lazy(() => import('./AiCommercialInboxPage'))
const AiAgentConfigPage = lazy(() => import('./AiAgentConfigPage'))
const AiLearningReviewPage = lazy(() => import('./AiLearningReviewPage'))
const AiAgentDashboardPage = lazy(() => import('./AiAgentDashboardPage'))
const AiKnowledgeBasePage = lazy(() => import('./AiKnowledgeBasePage'))
const AiCampaignRulesPage = lazy(() => import('./AiCampaignRulesPage'))
const PaymentConfigPage = lazy(() => import('./PaymentConfigPage'))
const MetaPixelConfigPage = lazy(() => import('./MetaPixelConfigPage'))
const OnboardingWizard = lazy(() => import('./OnboardingWizard'))
const ImageAiEditor = lazy(() => import('./ImageAiEditor'))
const PlatformMarginPage = lazy(() => import('./PlatformMarginPage'))
const AiInsightsPage = lazy(() => import('./AiInsightsPage'))
const StoreSettingsPage = lazy(() => import('./StoreSettingsPage'))
const VerifyEmailPage = lazy(() => import('./VerifyEmailPage'))
const MarketIntelligencePage = lazy(() => import('./MarketIntelligencePage'))


const pages = {
  Dashboard,
  EditProduct,
  Login,
  CheckoutPage,
  Forgotpassword,
  Resetpassword,
  AiCommercialInboxPage,
  AiAgentConfigPage,
  AiLearningReviewPage,
  AiAgentDashboardPage,
  AiKnowledgeBasePage,
  AiCampaignRulesPage,
  PaymentConfigPage,
  MetaPixelConfigPage,
  OnboardingWizard,
  MarketIntelligencePage,
  ImageAiEditor,
  PlatformMarginPage,
  SubscriptionManagementPage,
  AiInsightsPage,
  StoreSettingsPage,
  VerifyEmailPage,
  AdminOrdersPage,
  AdminRegister,
  AddProduct,
  Customers,
  ThemeCustomizer,
  PromotionalBlocksPage,
  SocialPromotionPage,
  ProductAnalysisPage,
  Enquiries,
  Productlist,
  CouponsPage,
  NotFound,
  SubscriptionPage,
}

export default pages
