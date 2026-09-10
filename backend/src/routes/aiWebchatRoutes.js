// 📁 src/routes/aiWebchatRoutes.js
import express from 'express'
import { sendWebchatMessage } from '../controller/aiWebchatCtrl.js'
import { aiWebchatLimiter } from '../middlewares/aiWebchatLimiter.js'
import { aiWebchatDailyCap } from '../middlewares/aiWebchatDailyCap.js'
import { trackAiAgentEvent } from '../controller/aiAgentEventCtrl.js'
import {
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

router.use(resolveTenantByDomain, requireTenant)

// Dos frenos que atacan cosas distintas: el limitador corta la ráfaga por
// minuto y el tope diario impide que la cuota mensual del comercio se vacíe en
// un rato. Solo en /message: /event no gasta IA.
router.post('/message', aiWebchatLimiter, aiWebchatDailyCap, sendWebchatMessage)
router.post('/event', aiWebchatLimiter, trackAiAgentEvent)

export default router
