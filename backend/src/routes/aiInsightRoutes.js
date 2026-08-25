// 📁 src/routes/aiInsightRoutes.js
//
// Mismo esqueleto que las rutas de learning-suggestions en aiAgentRoutes.js.
import express from 'express'
import {
  acknowledgeAiInsight,
  archiveAiInsight,
  dismissAiInsight,
  getAiInsightById,
  listAiInsights,
  previewReactivationMessage,
  sendAiInsightReactivationMessage,
} from '../controller/aiInsightCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

// Admin autenticado: el tenant se autoriza desde req.user.tenantId en el
// controller (resolveAuthorizedTenantFromRequest), mismo patrón que
// aiAgentRoutes.js.
router.use(authMiddleware)
router.use(isAdmin)

router.get('/', listAiInsights)
router.get('/:id', getAiInsightById)
router.post('/:id/acknowledge', acknowledgeAiInsight)
router.post('/:id/dismiss', dismissAiInsight)
router.post('/:id/archive', archiveAiInsight)
router.post('/:id/reactivation-message/preview', previewReactivationMessage)
router.post('/:id/reactivation-message/send', sendAiInsightReactivationMessage)

export default router
