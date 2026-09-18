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
  getDomains,
  addDomain,
  verifyDomain,
  deleteDomain,
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

// Dominios propios del comercio (la tienda y el panel, verificados por TXT).
//
// Sin resolveTenantByDomain a propósito, igual que el resto de /me: el comercio
// sale del JWT. Un comercio que está cargando su primer dominio todavía no
// puede entrar POR ese dominio, así que exigirlo sería pedirle que use lo que
// viene a configurar.
router.get('/me/domains', authMiddleware, isAdmin, getDomains)
router.post('/me/domains', authMiddleware, isAdmin, addDomain)
router.post('/me/domains/verify', authMiddleware, isAdmin, verifyDomain)
router.delete('/me/domains', authMiddleware, isAdmin, deleteDomain)

export default router
