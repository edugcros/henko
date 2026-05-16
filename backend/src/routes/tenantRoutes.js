// 📁 src/routes/tenantRoutes.js
import express from 'express'
import { resolveTenant } from '../controller/tenantCtrl.js'

const router = express.Router()

router.get('/resolve', resolveTenant)

export default router