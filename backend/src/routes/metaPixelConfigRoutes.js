import express from 'express'
import { getMetaPixelConfig, updateMetaPixelConfig } from '../controller/metaPixelConfigCtrl.js'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.use(authMiddleware)
router.use(isAdmin)

router.get('/', getMetaPixelConfig)
router.put('/', updateMetaPixelConfig)

export default router
