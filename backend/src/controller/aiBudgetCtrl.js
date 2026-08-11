// 📁 src/controller/aiBudgetCtrl.js
//
// Lectura del consumo de IA del mes y administración de la API key propia
// del comercio (BYOK).
//
// Sin estos endpoints el nuevo medidor sería invisible: el comercio vería
// que "la IA dejó de contestar" sin ninguna forma de saber por qué ni de
// resolverlo solo.

import asyncHandler from 'express-async-handler'
import { getAiBudgetSnapshot } from '../services/ai/aiBudgetService.js'
import {
  clearTenantAiKey,
  setTenantAiKey,
} from '../services/ai/aiCredentialsService.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'

const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
  }).tenantId

/**
 * GET /api/ai-agent/budget
 *
 * Todas las métricas del mes, el estado de la suscripción y de qué key sale
 * el gasto. Es la pantalla que contesta "¿por qué el asistente dejó de
 * responder?" sin abrir un ticket.
 */
export const getAiBudget = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const budget = await getAiBudgetSnapshot(tenantId)

  return res.status(200).json({
    success: true,
    data: budget,
  })
})

/**
 * PUT /api/ai-agent/credentials
 *
 * La key se verifica contra Google antes de guardarse y se persiste cifrada.
 * Nunca se devuelve: la respuesta es el snapshot, que solo dice si hay una
 * configurada.
 */
export const updateAiCredentials = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const apiKey = String(req.body?.geminiApiKey || '').trim()

  await setTenantAiKey({ tenantId, apiKey })
  const budget = await getAiBudgetSnapshot(tenantId)

  return res.status(200).json({
    success: true,
    message:
      'API key propia activada. A partir de ahora el consumo de IA de tu comercio se factura en tu propia cuenta de Google.',
    data: budget,
  })
})

/**
 * DELETE /api/ai-agent/credentials
 */
export const deleteAiCredentials = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  await clearTenantAiKey(tenantId)
  const budget = await getAiBudgetSnapshot(tenantId)

  return res.status(200).json({
    success: true,
    message:
      'API key propia desactivada. El consumo vuelve a contar contra los límites de tu plan.',
    data: budget,
  })
})

export default {
  getAiBudget,
  updateAiCredentials,
  deleteAiCredentials,
}
