// 📁 src/routes/aiAgentRoutes.js
import express from 'express'
import {
  approveKnowledgeItem,
  createKnowledgeItem,
  getAiAgentConfig,
  listCartRecoveries,
  testAiAgentMessage,
  upsertAiAgentConfig,
  upsertCampaignRule,
} from '../controller/aiAgentCtrl.js'

import {
  getAiConversationById,
  updateAiConversationStatus,
  deleteAiConversation,
  permanentlyDeleteAiConversation,
  listAiConversation,
  getAiAgentMetrics,
} from '../controller/aiAgentAdminCtrl.js'

import {
  approveAiLearningSuggestion,
  archiveAiLearningSuggestion,
  getAiLearningSuggestionById,
  listAiLearningSuggestions,
  rejectAiLearningSuggestion,
} from '../controller/aiAgentLearningCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

// Admin autenticado: el tenant se autoriza desde req.user.tenantId en controllers.
// No dependemos obligatoriamente del host api.* ni de x-tenant-domain.
router.use(authMiddleware)
router.use(isAdmin)

router.get('/config', getAiAgentConfig)
router.put('/config', upsertAiAgentConfig)
router.post('/test-message', testAiAgentMessage)

router.get('/metrics', getAiAgentMetrics)

router.get('/cart-recoveries', listCartRecoveries)

router.post('/knowledge', createKnowledgeItem)
router.patch('/knowledge/:id/approve', approveKnowledgeItem)

router.put('/campaign-rules/:id?', upsertCampaignRule)

router.get('/conversations', listAiConversation)
router.get('/conversations/:id', getAiConversationById)
router.patch('/conversations/:id/status', updateAiConversationStatus)
router.delete('/conversations/:id/permanent', permanentlyDeleteAiConversation)
router.delete('/conversations/:id', deleteAiConversation)

router.get('/learning-suggestions', listAiLearningSuggestions)
router.get('/learning-suggestions/:id', getAiLearningSuggestionById)
router.post('/learning-suggestions/:id/approve', approveAiLearningSuggestion)
router.post('/learning-suggestions/:id/reject', rejectAiLearningSuggestion)
router.post('/learning-suggestions/:id/archive', archiveAiLearningSuggestion)

export default router
