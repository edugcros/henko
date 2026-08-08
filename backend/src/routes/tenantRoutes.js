import express from 'express'
import { resolveTenant } from '../controller/tenantCtrl.js'
import {
  getTenantSettings,
  updateTenantSettings,
  updateOnboardingStep,
} from '../controller/tenantSettingsCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.get('/resolve', resolveTenant)

router.get('/me/settings', authMiddleware, isAdmin, getTenantSettings)
router.put('/me/settings', authMiddleware, isAdmin, updateTenantSettings)
router.put('/me/onboarding', authMiddleware, isAdmin, updateOnboardingStep)

export default router
