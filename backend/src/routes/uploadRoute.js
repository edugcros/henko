import express from 'express'
import { uploadProductImage, deleteProductImage } from '../controller/uploadCtrl.js'
import { uploadPhoto, productImgResize } from '../middlewares/uploadImage.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

// POST /api/product/:productId/upload-image
router.post(
  '/:productId/upload-image',
  authMiddleware,
  isAdmin,
  uploadPhoto.single('images'),
  productImgResize,
  uploadProductImage,
)

// DELETE /api/product/:productId/:public_id
router.delete(
  '/:productId/:public_id',
  authMiddleware,
  isAdmin,
  deleteProductImage,
)

export default router
