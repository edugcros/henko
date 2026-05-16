import express from 'express'
import {
  createColor,
  updateColor,
  deleteColor,
  getColorById,
  getAllColors,
} from '../controller/colorCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.post('/', authMiddleware, isAdmin, createColor)
router.put('/:id', authMiddleware, isAdmin, updateColor)
router.delete('/:id', authMiddleware, isAdmin, deleteColor)
router.get('/:id', getColorById)
router.get('/', getAllColors)

export default router
