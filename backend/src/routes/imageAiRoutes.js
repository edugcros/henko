import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { SharedRateLimitStore } from '../middlewares/sharedRateLimitStore.js'
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

// El recorte local es gratuito en proveedor, pero consume CPU/RAM del backend.
// El límite usa el store compartido del proyecto para que escale entre procesos.
const removeBackgroundLimiter = rateLimit({
  store: new SharedRateLimitStore('image-ai-remove-bg'),
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `${req.tenantId || req.user?.tenantId || 'no-tenant'}:${ipKeyGenerator(req.ip)}`,
  message: {
    success: false,
    code: 'IMAGE_AI_RATE_LIMIT',
    message: 'Alcanzaste el límite temporal de eliminación de fondos. Intentá nuevamente más tarde.',
  },
})

router.use(authMiddleware)
router.use(isAdmin)

router.get('/status', handleImageAiStatus)

// Quitar el fondo corre en el propio proceso y no le cuesta plata a nadie
// (ver services/ai/backgroundRemoval.js), así que no lleva cuota: lo que
// limita ahí es la memoria del contenedor, no la factura.
router.post(
  '/remove-background',
  removeBackgroundLimiter,
  uploadPhoto.single('image'),
  handleRemoveBackground,
)

// Generar fondo sí se paga por imagen. El middleware corta temprano al que ya
// no tiene cupo; el cobro atómico lo hace el controller pegado a la llamada.
router.post(
  '/generate-variation',
  requireAiEntitlement(AI_METRICS.IMAGE_EDITS),
  uploadPhoto.single('image'),
  handleGenerateVariation,
)

export default router
