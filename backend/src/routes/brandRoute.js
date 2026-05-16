import express from 'express'
import {
  createBrand,
  updateBrand,
  deleteBrand,
  getBrandById,
  getAllBrands,
} from '../controller/brandCtrl.js'

import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.post('/', authMiddleware, isAdmin, createBrand)
router.put('/:id', authMiddleware, isAdmin, updateBrand)
router.delete('/:id', authMiddleware, isAdmin, deleteBrand)
router.get('/:id', getBrandById)
router.get('/', getAllBrands)

export default router
