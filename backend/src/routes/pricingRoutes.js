// 📁 src/routes/pricingRoutes.js

import express from 'express'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import {
  applyPrice,
  getPricingPolicy,
  recommendPrice,
  updatePricingPolicy,
} from '../controller/pricingController.js'

const router = express.Router()

// Todo el módulo es del panel: nadie del storefront tiene por qué ver los
// costos ni la política de precios de un comercio.
router.use(authMiddleware, isAdmin)

router.get('/policy', getPricingPolicy)
router.put('/policy', updatePricingPolicy)

// El único endpoint que puede gastar una llamada de IA, y solo cuando el
// producto tiene señales que lo justifiquen. El consumo se cobra contra
// MARKET_ANALYSES / MARKET_TOKENS, que ya tienen topes por plan.
router.post('/recommend/:productId', recommendPrice)

// Aplicar el precio. Es el paso que faltaba: el motor recomendaba y no había
// forma de ejecutar la recomendación desde el panel.
router.post('/apply/:productId', applyPrice)

export default router
