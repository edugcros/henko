// 📁 backend/src/routes/aiLeadAdminRoutes.js
import express from 'express'
import {
  deleteAiLead,
  discardAiLead,
  getAiLeadById,
  getAiLeadSummary,
  listAiLeads,
  markAiLeadLost,
  markAiLeadWon,
  patchAiLeadAssign,
  patchAiLeadFollowUp,
  patchAiLeadStatus,
  postAiLeadNote,
  removeLeadProductOfInterest,
  updateLeadProductsOfInterest,
} from '../controller/aiLeadAdminCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.use(authMiddleware)
router.use(isAdmin)

// Importante: summary antes de :leadId.
router.get('/leads/summary', getAiLeadSummary)
router.get('/leads', listAiLeads)
router.get('/leads/:leadId', getAiLeadById)

router.patch('/leads/:leadId/status', patchAiLeadStatus)
router.patch('/leads/:leadId/assign', patchAiLeadAssign)
router.patch('/leads/:leadId/follow-up', patchAiLeadFollowUp)
router.patch('/leads/:leadId/products-of-interest', updateLeadProductsOfInterest)

router.post('/leads/:leadId/notes', postAiLeadNote)
router.post('/leads/:leadId/mark-won', markAiLeadWon)
router.post('/leads/:leadId/mark-lost', markAiLeadLost)
router.post('/leads/:leadId/discard', discardAiLead)

router.delete(
  '/leads/:leadId/products-of-interest/:productRef',
  removeLeadProductOfInterest,
)

router.delete('/leads/:leadId', deleteAiLead)

export default router