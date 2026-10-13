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
import {
  getMarginReport,
  getAiSpendReport,
  getTenantAiSpendDetail,
  updateAiBudget,
  updateTenantAiPolicy,
  getPlanPrices,
  updatePlanPrice,
  getUsdRate,
  updateUsdRate,
  updateTenantStatus,
  deleteTenant,
} from '../controller/platformCtrl.js'

const router = express.Router()

router.use(authMiddleware, isAdmin, requirePlatformOwner)

router.get('/margin', getMarginReport)
router.get('/ai-spend', getAiSpendReport)

// UN comercio día por día, contra el mes anterior y repartido por función.
// Aparte del reporte general y no adentro: es una serie de treinta y un
// valores por comercio, y la pantalla se abre para mirar el total.
//
// Misma ruta que la escritura de política, distinto verbo: las dos hablan del
// mismo comercio en la misma pantalla, y partirlas en dos espacios de nombres
// obligaría a recordar cuál es cuál.
router.get('/ai-spend/tenant/:tenantId', getTenantAiSpendDetail)

// Mueve un límite de seguridad, así que queda registrada con autor y motivo
// (ver models/platformAiSettingModel.js).
router.put('/ai-spend/budget', updateAiBudget)

// Lo mismo pero para UN comercio: acotarlo o apagarlo sin tocar a los demás.
// El segmento fijo 'tenant' antes del parámetro es lo que mantiene el espacio
// de rutas sin ambigüedad, sin depender del orden de declaración.
router.put('/ai-spend/tenant/:tenantId', updateTenantAiPolicy)

// Precios de los planes. Misma clase de escritura que el techo: cambia lo que
// se le cobra a un comercio, así que queda con autor y motivo.
router.get('/plan-prices', getPlanPrices)
router.put('/plan-prices', updatePlanPrice)

// El tipo de cambio. Es lo único que cruza las dos monedas del negocio —planes
// en pesos, proveedores de IA en dólares— así que de este número depende el
// margen de todos los comercios. Estaba solo en una variable de entorno, o sea
// que corregirlo exigía un deploy y mientras tanto la rentabilidad se informaba
// con un dólar viejo.
router.get('/usd-rate', getUsdRate)
router.put('/usd-rate', updateUsdRate)

// Suspender o reactivar un comercio ENTERO. No borra nada: el corte ya lo
// aplica tenantMiddleware, que resuelve unicamente comercios con status
// 'active'. Esto solo mueve la perilla, y deja el motivo y el autor en la fila.
router.put('/tenant/:tenantId/status', updateTenantStatus)

// Baja del comercio. Verbo distinto y ruta distinta de la suspension a
// proposito: es la unica operacion de esta pantalla que no se deshace con un
// clic, y compartir endpoint con algo reversible invita a confundirlas.
//
// NO borra el libro de consumo de IA: esas filas registran lo que HENKO pago, y
// sin ellas el gasto mensual de la plataforma dejaria de cuadrar con lo que
// facturo Google.
router.delete('/tenant/:tenantId', deleteTenant)

export default router
