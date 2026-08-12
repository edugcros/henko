import express from 'express'
import { resolveTenant } from '../controller/tenantCtrl.js'
import {
  getTenantSettings,
  updateTenantSettings,
  updateOnboardingStep,
  getEmailDomain,
  updateEmailDomain,
  verifyEmailDomain,
  deleteEmailDomain,
} from '../controller/tenantSettingsCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.get('/resolve', resolveTenant)

router.get('/me/settings', authMiddleware, isAdmin, getTenantSettings)
router.put('/me/settings', authMiddleware, isAdmin, updateTenantSettings)
router.put('/me/onboarding', authMiddleware, isAdmin, updateOnboardingStep)

// Dominio de envío propio del comercio (SPF/DKIM verificados por DNS).
router.get('/me/email-domain', authMiddleware, isAdmin, getEmailDomain)
router.put('/me/email-domain', authMiddleware, isAdmin, updateEmailDomain)
router.post('/me/email-domain/verify', authMiddleware, isAdmin, verifyEmailDomain)
router.delete('/me/email-domain', authMiddleware, isAdmin, deleteEmailDomain)

export default router
