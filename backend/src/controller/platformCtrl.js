// 📁 src/controller/platformCtrl.js
//
// Reportes de plataforma — cruzan todos los comercios, protegidos por
// requirePlatformOwner (ver middlewares/platformOwnerMiddleware.js), no por
// el aislamiento por tenant que usa el resto del panel admin.

import expressAsyncHandler from 'express-async-handler'
import { getPlatformMarginReport } from '../services/platform/platformMarginService.js'
import { getPlatformSpendSnapshot } from '../services/ai/aiSpendReportService.js'
import { isValidPeriod } from '../services/ai/aiPeriod.js'
import {
  setPlatformAiOverride,
  PLATFORM_AI_SETTINGS,
} from '../services/ai/platformAiSettingService.js'

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

/**
 * PUT /api/platform/ai-spend/budget
 *
 * Mueve el techo de gasto sin reiniciar el servicio. Es la única maniobra útil
 * cuando el disyuntor ya cortó: la variable de entorno exige un deploy, y la IA
 * está caída para todos los comercios de la key compartida mientras tanto.
 *
 * `tokens: null` quita el override y devuelve el mando a la variable de
 * entorno. Sin eso, poner un valor acá sería irreversible sin un deploy — que
 * es exactamente lo que esto vino a evitar.
 */
export const updateAiBudget = expressAsyncHandler(async (req, res) => {
  const { tokens, reason } = req.body || {}

  const isRemoval = tokens === null
  const value = isRemoval ? null : Number(tokens)

  if (!isRemoval && (!Number.isFinite(value) || value < 0)) {
    return res.status(400).json({
      success: false,
      message: 'El techo debe ser un número de tokens no negativo, o null para volver a la variable de entorno.',
    })
  }

  // Se pide el motivo y no se acepta vacío: dentro de tres meses el número solo
  // no explica por qué alguien duplicó el techo un martes a las 3 de la mañana,
  // y quien lo mire va a ser otra persona, o vos sin el contexto de hoy.
  const cleanReason = String(reason || '').trim()

  if (!cleanReason) {
    return res.status(400).json({
      success: false,
      message: 'Indicá por qué se cambia el techo.',
    })
  }

  await setPlatformAiOverride({
    setting: PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET,
    value: isRemoval ? null : Math.floor(value),
    changedByEmail: req.user?.email,
    changedByUserId: req.user?._id || null,
    reason: cleanReason.slice(0, 500),
  })

  // Se devuelve el reporte entero y no un ok: la pantalla tiene que mostrar el
  // efecto del cambio —el porcentaje nuevo, el corte levantado— sin una segunda
  // vuelta que pueda fallar y dejarla mostrando lo viejo.
  const report = await getPlatformSpendSnapshot()

  return res.status(200).json({ success: true, data: report })
})

export default { getMarginReport, getAiSpendReport, updateAiBudget }
