// 📁 src/controller/platformCtrl.js
//
// Reportes de plataforma — cruzan todos los comercios, protegidos por
// requirePlatformOwner (ver middlewares/platformOwnerMiddleware.js), no por
// el aislamiento por tenant que usa el resto del panel admin.

import expressAsyncHandler from 'express-async-handler'
import { getPlatformMarginReport } from '../services/platform/platformMarginService.js'
import { getPlatformSpendSnapshot } from '../services/ai/aiSpendReportService.js'
import { isValidPeriod } from '../services/ai/aiPeriod.js'

export const getMarginReport = expressAsyncHandler(async (req, res) => {
  const period = String(req.query.period || '').trim() || undefined
  const report = await getPlatformMarginReport(period)

  return res.status(200).json({ success: true, data: report })
})

/**
 * GET /api/platform/ai-spend
 *
 * El gasto de IA del mes contra el techo, con el desglose de qué lo consume.
 * Hasta acá el ledger se escribía y solo lo leía el aviso de presupuesto, que
 * termina en una línea de log: la información existía y no había forma de
 * mirarla sin entrar a la base.
 */
export const getAiSpendReport = expressAsyncHandler(async (req, res) => {
  const requested = String(req.query.period || '').trim()

  // Un período inválido se rechaza en vez de caer al mes actual en silencio:
  // devolver septiembre a quien pidió '2026-13' es contestar otra pregunta.
  if (requested && !isValidPeriod(requested)) {
    return res.status(400).json({
      success: false,
      message: 'Período inválido. Se espera el formato YYYY-MM.',
    })
  }

  const report = await getPlatformSpendSnapshot(requested || undefined)

  return res.status(200).json({ success: true, data: report })
})

export default { getMarginReport, getAiSpendReport }
