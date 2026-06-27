// 📁 src/routes/aiWebchatRoutes.js
import express from 'express'
import { sendWebchatMessage } from '../controller/aiWebchatCtrl.js'
import { aiWebchatLimiter } from '../middlewares/aiWebchatLimiter.js'
import { trackAiAgentEvent } from '../controller/aiAgentEventCtrl.js'
import {
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

router.use(resolveTenantByDomain, requireTenant)

router.post('/message', aiWebchatLimiter, sendWebchatMessage)
router.post('/event', aiWebchatLimiter, trackAiAgentEvent)

export default router
