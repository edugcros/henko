import express from 'express'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import { uploadPhoto } from '../middlewares/uploadImage.js'
import { requireAiEntitlement } from '../middlewares/aiEntitlementMiddleware.js'
import { AI_METRICS } from '../services/ai/aiPlanPolicy.js'
import {
  handleRemoveBackground,
  handleGenerateVariation,
  handleImageAiStatus,
} from '../controller/imageAiCtrl.js'

const router = express.Router()

router.use(authMiddleware)
router.use(isAdmin)

router.get('/status', handleImageAiStatus)

// Quitar el fondo corre en el propio proceso y no le cuesta plata a nadie
// (ver services/ai/backgroundRemoval.js), así que no lleva cuota: lo que
// limita ahí es la memoria del contenedor, no la factura.
router.post('/remove-background', uploadPhoto.single('image'), handleRemoveBackground)

// Generar fondo sí se paga por imagen. El middleware corta temprano al que ya
// no tiene cupo; el cobro atómico lo hace el controller pegado a la llamada.
router.post(
  '/generate-variation',
  requireAiEntitlement(AI_METRICS.IMAGE_EDITS),
  uploadPhoto.single('image'),
  handleGenerateVariation,
)

export default router
