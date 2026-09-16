// 📁 src/controller/platformCtrl.js
//
// Reportes de plataforma — cruzan todos los comercios, protegidos por
// requirePlatformOwner (ver middlewares/platformOwnerMiddleware.js), no por
// el aislamiento por tenant que usa el resto del panel admin.

import expressAsyncHandler from 'express-async-handler'
import mongoose from 'mongoose'
import { getPlatformMarginReport } from '../services/platform/platformMarginService.js'
import { getPlatformSpendSnapshot } from '../services/ai/aiSpendReportService.js'
import { isValidPeriod } from '../services/ai/aiPeriod.js'
import {
  setPlatformAiOverride,
  getPlatformAiSettingHistory,
  setTenantAiPolicy,
  PLATFORM_AI_SETTINGS,
} from '../services/ai/platformAiSettingService.js'
import { AI_PLANS, getPlanCatalog, normalizePlan } from '../services/ai/aiPlanPolicy.js'

// Qué plan se puede cotizar: los dos del catálogo, porque los dos se pagan.
// El mapa se mantiene igual —y no se deriva de AI_PLANS— porque cada plan
// necesita su propia clave de ajuste, y agregar un plan sin decidir dónde se
// guarda su precio tiene que ser un error visible, no un precio que se pierde.
const PLANES_CON_PRECIO = Object.freeze({
  starter: PLATFORM_AI_SETTINGS.PLAN_PRICE_STARTER,
  pro: PLATFORM_AI_SETTINGS.PLAN_PRICE_PRO,
})

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
 * Los tres frenos, con la misma maniobra.
 *
 * POR QUE LOS TRES Y NO SOLO EL DE TOKENS
 *
 * El modelo (PLATFORM_AI_SETTINGS) y el servicio (setPlatformAiOverride) ya
 * soportaban los tres desde siempre. Lo que faltaba era ESTE endpoint: leia
 * solo `tokens` y escribia solo MONTHLY_TOKEN_BUDGET, asi que el techo en
 * PLATA y el reparto por comercio solo se podian tocar por variable de entorno
 * en Render — sin motivo, sin historial y sin que quedara registrado quien lo
 * cambio.
 *
 * Y el de plata es el que importa: entre gemini-3.6-flash y 3.1-flash-lite hay
 * 5x de tarifa, asi que el mismo tope de tokens puede costar veinte dolares o
 * cien segun que modelo este respondiendo, y eso lo decide la cadena de
 * respaldo y no nosotros.
 *
 * CADA CAMPO ES OPCIONAL, Y `null` QUITA EL OVERRIDE
 *
 * Mandar solo `usd` mueve solo ese. `usd: null` devuelve el mando a la
 * variable de entorno: sin eso, poner un valor aca seria irreversible sin un
 * deploy, que es exactamente lo que este endpoint vino a evitar.
 */
export const updateAiBudget = expressAsyncHandler(async (req, res) => {
  const { tokens, usd, perTenantShare, reason } = req.body || {}

  // Se pide el motivo y no se acepta vacio: dentro de tres meses el numero solo
  // no explica por que alguien duplico el techo un martes a las 3 de la manana,
  // y quien lo mire va a ser otra persona, o vos sin el contexto de hoy.
  const cleanReason = String(reason || '').trim()

  if (!cleanReason) {
    return res.status(400).json({
      success: false,
      message: 'Indicá por qué se cambia el techo.',
    })
  }

  /**
   * Cada freno con su validacion, porque miden cosas distintas.
   *
   * El reparto es una FRACCION y se acota entre 1% y 100%: en cero deja a
   * todos los comercios sin nada, y arriba de uno permite que uno solo se
   * lleve mas que el techo entero. Los dos techos son cantidades y solo se
   * exige que no sean negativas — un techo en cero es una decision valida
   * (apagar la IA) y distinta de no tener techo.
   */
  const CAMPOS = [
    {
      valor: tokens,
      setting: PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET,
      normalizar: v => Math.floor(v),
      valido: v => Number.isFinite(v) && v >= 0,
      error: 'El techo en tokens debe ser un número no negativo, o null para volver a la variable de entorno.',
    },
    {
      valor: usd,
      setting: PLATFORM_AI_SETTINGS.MONTHLY_USD_BUDGET,
      normalizar: v => Math.round(v * 100) / 100,
      valido: v => Number.isFinite(v) && v >= 0,
      error: 'El techo en dólares debe ser un número no negativo, o null para volver a la variable de entorno.',
    },
    {
      valor: perTenantShare,
      setting: PLATFORM_AI_SETTINGS.PER_TENANT_SHARE,
      normalizar: v => Math.round(v * 10000) / 10000,
      valido: v => Number.isFinite(v) && v >= 0.01 && v <= 1,
      error: 'El reparto por comercio debe estar entre 0.01 y 1, o null para volver a la variable de entorno.',
    },
  ]

  const cambios = CAMPOS.filter(campo => campo.valor !== undefined)

  if (cambios.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No se indicó ningún freno para cambiar.',
    })
  }

  for (const campo of cambios) {
    if (campo.valor === null) continue

    const numero = Number(campo.valor)
    if (!campo.valido(numero)) {
      return res.status(400).json({ success: false, message: campo.error })
    }
  }

  // Se validan TODOS antes de escribir NINGUNO: un pedido con dos frenos donde
  // el segundo es invalido no puede dejar el primero aplicado y el otro no,
  // porque quien lo mando se entera del error y asume que no paso nada.
  for (const campo of cambios) {
    await setPlatformAiOverride({
      setting: campo.setting,
      value: campo.valor === null ? null : campo.normalizar(Number(campo.valor)),
      changedByEmail: req.user?.email,
      changedByUserId: req.user?._id || null,
      reason: cleanReason.slice(0, 500),
    })
  }

  // Se devuelve el reporte entero y no un ok: la pantalla tiene que mostrar el
  // efecto del cambio —el porcentaje nuevo, el corte levantado— sin una segunda
  // vuelta que pueda fallar y dejarla mostrando lo viejo.
  const report = await getPlatformSpendSnapshot()

  return res.status(200).json({ success: true, data: report })
})

/**
 * PUT /api/platform/ai-spend/tenant/:tenantId
 *
 * Acota o apaga la IA de UN comercio.
 *
 * QUÉ FALTABA
 *
 * Hasta acá las tres palancas eran globales: los dos techos y el reparto. Si un
 * comercio se desbocaba, la única maniobra disponible era bajarle el reparto A
 * TODOS —castigar a los diez porque uno se desbocó— o bajar el techo global, que
 * es lo mismo con otro nombre. Y el autolímite que existe en el panel del
 * comercio lo pone EL COMERCIO: puede volver a subirlo cuando quiera, así que
 * no es un control de la plataforma.
 *
 * DOS COSAS DISTINTAS, EL MISMO ENDPOINT
 *
 * `share` ACOTA: el comercio sigue trabajando con menos techo. `suspended`
 * APAGA. Van juntas porque son la misma decisión sobre el mismo comercio y
 * quien la toma elige cuál de las dos: separarlas en dos endpoints obligaría a
 * dos viajes para "bajale el tope y si sigue, apagalo".
 *
 * Cada campo es opcional y se distingue ausente de null, igual que en los
 * techos: `share: null` lo devuelve a la fracción global, no mandarlo lo deja
 * como está.
 */
export const updateTenantAiPolicy = expressAsyncHandler(async (req, res) => {
  const { tenantId } = req.params
  const { share, suspended, suspendedReason, reason } = req.body || {}

  if (!mongoose.Types.ObjectId.isValid(String(tenantId || '').trim())) {
    return res.status(400).json({
      success: false,
      message: 'Comercio inválido.',
    })
  }

  // Mismo criterio que el techo: el motivo no es opcional. Apagarle la IA a un
  // comercio es la decisión más cara de esta pantalla y la que más se va a
  // tener que explicar.
  const cleanReason = String(reason || '').trim()

  if (!cleanReason) {
    return res.status(400).json({
      success: false,
      message: 'Indicá por qué se cambia la política de este comercio.',
    })
  }

  if (share === undefined && suspended === undefined) {
    return res.status(400).json({
      success: false,
      message: 'No se indicó ningún cambio.',
    })
  }

  // Se valida ANTES de escribir, igual que los techos: un pedido con el
  // interruptor válido y la fracción inválida no puede dejar aplicada la mitad,
  // porque quien lo mandó ve el error y asume que no pasó nada.
  if (share !== undefined && share !== null) {
    const numero = Number(share)

    if (!Number.isFinite(numero) || numero < 0.01 || numero > 1) {
      return res.status(400).json({
        success: false,
        message: 'La fracción del comercio debe estar entre 0.01 y 1, o null para usar la global.',
      })
    }
  }

  await setTenantAiPolicy({
    tenantId: String(tenantId).trim(),
    share: share === undefined ? undefined : share === null ? null : Math.round(Number(share) * 10000) / 10000,
    suspended: suspended === undefined ? undefined : Boolean(suspended),
    suspendedReason: String(suspendedReason || '').trim().slice(0, 300),
    changedByEmail: req.user?.email,
    reason: cleanReason.slice(0, 500),
  })

  // El reporte entero, igual que al mover un techo: la tabla tiene que mostrar
  // el efecto —el comercio apagado, el tope nuevo— sin una segunda vuelta que
  // pueda fallar y dejarla mostrando lo viejo.
  const report = await getPlatformSpendSnapshot()

  return res.status(200).json({ success: true, data: report })
})

/**
 * GET /api/platform/plan-prices
 *
 * Los precios vigentes y de dónde sale cada uno. El historial viene con ellos:
 * un precio sin su historia es un número, y lo que hace falta para decidir el
 * próximo es ver el anterior y por qué se cambió.
 */
export const getPlanPrices = expressAsyncHandler(async (req, res) => {
  const [plans, history] = await Promise.all([
    Promise.resolve(getPlanCatalog()),
    getPlatformAiSettingHistory(30),
  ])

  return res.status(200).json({
    success: true,
    data: {
      currency: 'ARS',
      plans,
      // Solo el historial de precios: el mismo registro guarda también los
      // cambios del techo de IA, que en esta pantalla son ruido.
      history: history.filter(row =>
        Object.values(PLANES_CON_PRECIO).includes(row.setting),
      ),
    },
  })
})

/**
 * PUT /api/platform/plan-prices
 *
 * Cambia el precio de un plan, en pesos. `priceArs: null` quita el override y
 * devuelve el mando a la variable de entorno o al default.
 */
export const updatePlanPrice = expressAsyncHandler(async (req, res) => {
  const { plan, priceArs, reason } = req.body || {}

  // Se valida el valor CRUDO, no el normalizado. normalizePlan cae al plan más
  // chico ante cualquier cosa, así que validar después de normalizar aceptaría
  // "gratis", "" o un typo y le pondría el precio al starter sin que nadie se
  // entere. La guarda de abajo dejó de ser alcanzable el día que el catálogo
  // quedó en dos planes y ambos tienen clave de precio.
  const rawPlan = String(plan || '').trim().toLowerCase()

  if (!AI_PLANS.includes(rawPlan)) {
    return res.status(400).json({
      success: false,
      message: `Plan inválido. Los planes con precio son: ${AI_PLANS.join(', ')}.`,
    })
  }

  const normalizedPlan = normalizePlan(rawPlan)
  const setting = PLANES_CON_PRECIO[normalizedPlan]

  if (!setting) {
    return res.status(400).json({
      success: false,
      message: `El plan ${normalizedPlan} no tiene dónde guardar su precio.`,
    })
  }

  const isRemoval = priceArs === null
  const value = isRemoval ? null : Number(priceArs)

  // Se admite el cero: un plan puede volverse gratis, y eso es una decisión
  // válida que hay que poder tomar desde acá.
  if (!isRemoval && (!Number.isFinite(value) || value < 0)) {
    return res.status(400).json({
      success: false,
      message: 'El precio debe ser un número de pesos no negativo, o null para volver al valor por defecto.',
    })
  }

  // Mismo criterio que el techo de gasto: dentro de tres meses el número solo
  // no explica por qué alguien subió el starter un 30%.
  const cleanReason = String(reason || '').trim()

  if (!cleanReason) {
    return res.status(400).json({
      success: false,
      message: 'Indicá por qué se cambia el precio.',
    })
  }

  await setPlatformAiOverride({
    setting,
    value: isRemoval ? null : Math.round(value),
    changedByEmail: req.user?.email,
    changedByUserId: req.user?._id || null,
    reason: cleanReason.slice(0, 500),
  })

  const history = await getPlatformAiSettingHistory(30)

  return res.status(200).json({
    success: true,
    data: {
      currency: 'ARS',
      plans: getPlanCatalog(),
      history: history.filter(row =>
        Object.values(PLANES_CON_PRECIO).includes(row.setting),
      ),
    },
  })
})

export default {
  getMarginReport,
  getAiSpendReport,
  updateAiBudget,
  getPlanPrices,
  updatePlanPrice,
}
