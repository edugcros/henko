// 📁 src/routes/marketIntelligenceRoutes.js
//
// TODO CRÍTICO: los nombres de los middlewares de auth son una SUPOSICIÓN.
// No conozco los tuyos. Antes de usar este archivo, reemplazá `authMiddleware` y
// `isAdmin` por los middlewares reales del proyecto — si quedan mal, el
// endpoint puede terminar expuesto sin protección de tenant, que en una
// app multi-tenant es una fuga de datos entre comercios.

import express from 'express'
import { authMiddleware, isAdmin } from '../middlewares/authMiddleware.js'
import { analyzeProduct, getAnalysisHistory } from '../controller/marketIntelligenceController.js'

const router = express.Router()

// Todas las rutas requieren sesión autenticada + rol isAdmin del comercio.
// El análisis consume cuota de Gemini y de la API de MELI, así que no debe
// quedar accesible a usuarios finales de la tienda.
router.use(authMiddleware, isAdmin)

router.post('/analyze', analyzeProduct)
router.get('/history', getAnalysisHistory)

export default router

// ============================================================================
// REGISTRO EN TU APP PRINCIPAL (server.js / app.js):
//
//   import marketIntelligenceRoutes from './routes/marketIntelligenceRoutes.js'
//   app.use('/api/isAdmin/market-intelligence', marketIntelligenceRoutes)
//
// TODO: confirmar el prefijo real que usás para rutas de isAdmin — si el
// resto del proyecto usa otro (ej. '/api/v1/isAdmin/...'), alinealo o el
// frontend va a apuntar a la URL equivocada.
// ============================================================================
