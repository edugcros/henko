import express from 'express'
import { sendEmailController } from '../controller/emailCtrl.js'
import { authMiddleware } from '../middlewares/authMiddleware.js'

const router = express.Router()

// Ruta para enviar correos manualmente
router.post('/send', authMiddleware, sendEmailController)

export default router
