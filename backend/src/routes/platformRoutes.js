// 📁 src/routes/platformRoutes.js
//
// Única ruta de todo el sistema deliberadamente NO acotada a un tenant —
// sin resolveTenantByDomain/requireTenant en la cadena, es un reporte
// cruzado entre comercios. authMiddleware igual exige un JWT válido de
// algún comercio (no hay login "sin tenant" en este sistema); el gate de
// email (requirePlatformOwner) decide si esa cuenta además puede ver
// reportes de plataforma.

import express from 'express'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import { requirePlatformOwner } from '../middlewares/platformOwnerMiddleware.js'
import { getMarginReport } from '../controller/platformCtrl.js'

const router = express.Router()

router.use(authMiddleware, isAdmin, requirePlatformOwner)

router.get('/margin', getMarginReport)

export default router
