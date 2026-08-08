import express from 'express'
import { getPaymentConfig, updatePaymentConfig } from '../controller/paymentConfigCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.use(authMiddleware)
router.use(isAdmin)

router.get('/', getPaymentConfig)
router.put('/', updatePaymentConfig)

export default router
