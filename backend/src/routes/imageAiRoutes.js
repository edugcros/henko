import express from 'express'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import { uploadPhoto } from '../middlewares/uploadImage.js'
import {
  handleRemoveBackground,
  handleGenerateVariation,
  handleImageAiStatus,
} from '../controller/imageAiCtrl.js'

const router = express.Router()

router.use(authMiddleware)
router.use(isAdmin)

router.get('/status', handleImageAiStatus)
router.post('/remove-background', uploadPhoto.single('image'), handleRemoveBackground)
router.post('/generate-variation', uploadPhoto.single('image'), handleGenerateVariation)

export default router
