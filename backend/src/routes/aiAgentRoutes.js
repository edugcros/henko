// 📁 src/routes/aiAgentRoutes.js
import express from 'express'
import {
  approveKnowledgeItem,
  createKnowledgeItem,
  getAiAgentConfig,
  listAiConversations,
  listAiLeads,
  listCartRecoveries,
  testAiAgentMessage,
  upsertAiAgentConfig,
  upsertCampaignRule,
} from '../controller/aiAgentCtrl.js'

import {
  getAiConversationById,
  updateAiConversationStatus,
  deleteAiConversation,
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

router.use(authMiddleware, isAdmin)
router.get('/config', getAiAgentConfig)
router.put('/config', upsertAiAgentConfig)
router.post('/test-message', testAiAgentMessage)
router.get('/leads', listAiLeads)
router.get('/cart-recoveries', listCartRecoveries)
router.post('/knowledge', createKnowledgeItem)
router.patch('/knowledge/:id/approve', approveKnowledgeItem)
router.put('/campaign-rules/:id?', upsertCampaignRule)

router.get('/metrics', authMiddleware, isAdmin, getAiAgentMetrics)

router.get('/conversations', authMiddleware,listAiConversations)
router.get('/conversations', authMiddleware, isAdmin, listAiConversation)
router.get('/conversations/:id', authMiddleware, isAdmin, getAiConversationById)
router.patch(
  '/conversations/:id/status',
  authMiddleware,
  isAdmin,
  updateAiConversationStatus,
)

router.delete(
  '/conversations/:id',
  authMiddleware,
  isAdmin,
  deleteAiConversation,
)

router.get(
  '/learning-suggestions',
  authMiddleware,
  isAdmin,
  listAiLearningSuggestions,
)

router.get(
  '/learning-suggestions/:id',
  authMiddleware,
  isAdmin,
  getAiLearningSuggestionById,
)

router.post(
  '/learning-suggestions/:id/approve',
  authMiddleware,
  isAdmin,
  approveAiLearningSuggestion,
)

router.post(
  '/learning-suggestions/:id/reject',
  authMiddleware,
  isAdmin,
  rejectAiLearningSuggestion,
)

router.post(
  '/learning-suggestions/:id/archive',
  authMiddleware,
  isAdmin,
  archiveAiLearningSuggestion,
)

export default router
