// 📁 src/services/ai/platformAiSettingService.js
//
// Lectura y escritura de los ajustes de plataforma que se pueden cambiar en
// caliente (ver models/platformAiSettingModel.js para el porqué).
//
// EL PROBLEMA DE LA LECTURA
//
// getPlatformMonthlyTokenBudget() es SÍNCRONA y se llama en el camino caliente:
// en cada reserva de presupuesto y en cada registro de consumo. Volverla
// asíncrona para poder consultar la base cascadea por toda la capa de política
// —getSharedKeyTenantCap, resolveEffectiveLimit, reserveAiBudget— y convierte
// un cambio de configuración en un refactor del medidor entero.
//
// La solución es leer de memoria y refrescar en segundo plano. Un techo mensual
// tolera perfectamente estar desactualizado unos segundos: el error posible es
// gastar unos tokens de más contra un techo viejo, y el número está en el orden
// de los cientos de millones.
//
// Consecuencias que hay que tener presentes:
//
//  - Después de arrancar, la primera lectura devuelve la variable de entorno
//    hasta que termina el primer refresh. Es correcto: sin datos todavía, el
//    valor configurado es la mejor respuesta disponible.
//  - Con varias instancias, un cambio tarda hasta REFRESH_MS en verse en las
//    otras. La que recibe el cambio lo aplica en el acto.

import logger from '../../../config/logger.js'
import PlatformAiSetting, {
  PLATFORM_AI_SETTINGS,
} from '../../models/platformAiSettingModel.js'
import AiPlatformUsage from '../../models/aiPlatformUsageModel.js'
import { getCurrentPeriod } from './aiPeriod.js'

export { PLATFORM_AI_SETTINGS }

const REFRESH_MS = 30_000

// null significa dos cosas distintas y hay que poder distinguirlas: "todavía no
// se leyó de la base" y "se leyó y no hay override". Por eso el estado guarda
// `loadedAt` aparte del valor.
const state = {
  values: new Map(),
  loadedAt: 0,
  refreshing: false,
}

const readLatest = async () => {
  const rows = await Promise.all(
    Object.values(PLATFORM_AI_SETTINGS).map(async setting => {
      const [row] = await PlatformAiSetting.find({ setting })
        .sort({ createdAt: -1 })
        .limit(1)
        .lean()

      return [setting, row?.value ?? null]
    }),
  )

  return new Map(rows)
}

/**
 * Refresca la memoria desde la base. No lanza: si falla, se sigue con lo que
 * había, que es mejor que quedarse sin techo por un problema de la base.
 */
export const refreshPlatformAiSettings = async () => {
  if (state.refreshing) return
  state.refreshing = true

  try {
    state.values = await readLatest()
    state.loadedAt = Date.now()
  } catch (error) {
    logger.warn('[AI SETTINGS] No se pudieron refrescar los ajustes de plataforma', {
      error: error.message,
    })
  } finally {
    state.refreshing = false
  }
}

/**
 * Override vigente de un ajuste, o null si no hay.
 *
 * Síncrona a propósito. Dispara el refresh si el dato está viejo y devuelve lo
 * que tiene: esperar acá volvería asíncrono a todo el que llame.
 */
export const getPlatformAiOverride = setting => {
  if (Date.now() - state.loadedAt > REFRESH_MS) {
    refreshPlatformAiSettings().catch(() => undefined)
  }

  const value = state.values.get(setting)
  return value === undefined ? null : value
}

/**
 * Al cambiar el techo, borra el estado de aviso del período en curso.
 *
 * Sin esto los avisos se apagan solos, y el modo de falla es silencioso:
 * `alertedThreshold` guarda un escalón —50, 80— pero ese porcentaje está
 * expresado contra el techo que regía cuando se emitió. Si se llegó al 80% de
 * 200M y ahí se sube el techo a 400M, el consumo pasa a ser el 40% y el guardia
 * `alertedThreshold >= reached` sigue dando verdadero para todo lo que venga:
 * al volver a 80% —de 400M ahora— no avisa, porque para el contador ese escalón
 * ya se anunció. El período entero se queda sin avisos justo después de la
 * única maniobra que indica que alguien está mirando el gasto de cerca.
 *
 * Se limpia también breakerTrippedAt cuando el techo sube por encima del
 * consumo: quedaría marcando un corte que ya no está vigente, y la pantalla lo
 * muestra como si la IA siguiera caída.
 *
 * Bajar el techo NO limpia nada: los avisos ya emitidos siguen siendo ciertos y
 * el corte, si estaba, sigue estándolo.
 */
const resetPeriodAlertState = async (previousValue, nextValue) => {
  // Con cualquiera de los dos en null el techo pasa a salir de la variable de
  // entorno o a dejar de existir: en ambos casos el escalón guardado ya no
  // significa lo mismo, así que se limpia igual.
  const subeElTecho =
    previousValue === null || nextValue === null || Number(nextValue) > Number(previousValue)

  if (!subeElTecho) return

  const period = getCurrentPeriod()

  try {
    await AiPlatformUsage.updateOne(
      { period },
      { $set: { alertedThreshold: 0, breakerTrippedAt: null } },
    )
  } catch (error) {
    // No se propaga: el cambio de techo ya se registró y es lo que importaba.
    // Un aviso de más es preferible a rechazar la maniobra.
    logger.warn('[AI SETTINGS] No se pudo reiniciar el estado de avisos del período', {
      period,
      error: error.message,
    })
  }
}

/**
 * Registra un cambio y lo aplica en esta instancia inmediatamente.
 *
 * @param {object} params
 * @param {string} params.setting     una de PLATFORM_AI_SETTINGS
 * @param {number|null} params.value  null = volver a la variable de entorno
 * @param {string} params.changedByEmail
 * @param {string} [params.reason]
 */
export const setPlatformAiOverride = async ({
  setting,
  value,
  changedByEmail,
  changedByUserId = null,
  reason = '',
}) => {
  if (!Object.values(PLATFORM_AI_SETTINGS).includes(setting)) {
    throw new Error(`Ajuste desconocido: ${setting}`)
  }

  // Se lee de la base y no de la memoria: el previousValue va a un registro de
  // auditoría, y una caché de hasta 30 segundos puede no reflejar un cambio que
  // hizo otra instancia hace un momento.
  const current = await readLatest()
  const previousValue = current.get(setting) ?? null

  const row = await PlatformAiSetting.create({
    setting,
    value,
    previousValue,
    changedByEmail,
    changedByUserId,
    reason,
  })

  // Sin esperar al refresh: quien acaba de subir el techo porque se cortó el
  // servicio necesita que valga ya, no dentro de medio minuto.
  state.values.set(setting, value)
  state.loadedAt = Date.now()

  if (setting === PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET) {
    await resetPeriodAlertState(previousValue, value)
  }

  logger.info('[AI SETTINGS] Ajuste de plataforma cambiado', {
    setting,
    previousValue,
    value,
    changedByEmail,
  })

  return row
}

/** El historial completo de un ajuste, del más reciente al más viejo. */
export const getPlatformAiSettingHistory = async (limit = 20) => {
  const rows = await PlatformAiSetting.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
    .lean()

  return rows.map(row => ({
    setting: row.setting,
    value: row.value,
    previousValue: row.previousValue,
    changedByEmail: row.changedByEmail,
    reason: row.reason || '',
    createdAt: row.createdAt,
  }))
}

export default {
  PLATFORM_AI_SETTINGS,
  getPlatformAiOverride,
  setPlatformAiOverride,
  refreshPlatformAiSettings,
  getPlatformAiSettingHistory,
}
