import express from 'express'
import {
  createEnquiry,
  updateEnquiryStatus,
  deleteEnquiry,
  getEnquiryById,
  getAllEnquiries,
  replyEnquiry,
} from '../controller/enqCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.post('/reply/:id', authMiddleware, isAdmin, replyEnquiry)
router.post('/', createEnquiry)
router.get('/get', authMiddleware, isAdmin, getAllEnquiries)
router.get('/:id', authMiddleware, isAdmin, getEnquiryById)
router.put('/:id', authMiddleware, isAdmin, updateEnquiryStatus)
router.delete('/:id', authMiddleware, isAdmin, deleteEnquiry)

export default router
