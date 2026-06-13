// 📁 src/routes/whatsappRoutes.js
import express from 'express'
import { receiveWhatsappWebhook, verifyWhatsappWebhook } from '../controller/whatsappWebhookCtrl.js'

const router = express.Router()
router.get('/webhook', verifyWhatsappWebhook)
router.post('/webhook', receiveWhatsappWebhook)
export default router
