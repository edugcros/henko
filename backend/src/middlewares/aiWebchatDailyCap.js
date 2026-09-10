// 📁 src/middlewares/aiWebchatDailyCap.js
//
// Tope diario de mensajes del chat público, por comercio.
//
// EL PROBLEMA QUE RESUELVE
//
// /ai-webchat/message es el único endpoint de IA sin autenticar: es el chat de
// la tienda. Ya tiene un limitador por minuto anclado en tenant + IP, que está
// bien hecho, y que no alcanza para esto.
//
// Un plan free tiene 300 mensajes al mes. A 20 por minuto —el límite vigente—
// se agotan en quince minutos desde una sola IP. El gasto lo paga HENKO, porque
// corre sobre la key compartida, y el comercio se queda sin asistente el resto
// del mes sin haber hecho nada. Un límite por minuto no protege un presupuesto
// mensual: solo decide a qué velocidad se vacía.
//
// DE DÓNDE SALE EL NÚMERO
//
// De la cuota que el plan ya tiene, no de una constante nueva que habría que
// mantener en paralelo y que se desincronizaría con los planes. Un día puede
// valer hasta FACTOR veces un día promedio del mes; más que eso deja de
// parecerse a uso y empieza a parecerse a un vaciado.
//
// Con FACTOR = 3 y un free de 300 mensajes: 30 por día, y el mes no se puede
// agotar en menos de diez días. Un comercio con un día excepcional entra
// cómodo; un ataque desde mil IPs distintas, no.
//
// LO QUE NO HACE
//
// No reemplaza al limitador por minuto: ese frena la ráfaga y este el vaciado.
// Y no toca la cuota mensual — cuando el tope diario corta, el comercio
// conserva lo que le quedaba del mes, que es justamente el punto.

import { cacheIncr } from '../utils/cache.js'
import { getPlanLimit, AI_METRICS, UNLIMITED } from '../services/ai/aiPlanPolicy.js'
import { loadTenantAiProfile } from '../services/ai/aiCredentialsService.js'
import logger from '../../config/logger.js'

const readEnvNumber = (name, fallback) => {
  const raw = String(process.env[name] || '').trim()
  if (!raw) return fallback

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Cuántas veces un día puede pasarse del promedio del mes antes de cortar. */
const getBurstFactor = () => readEnvNumber('AI_WEBCHAT_DAILY_BURST_FACTOR', 3)

/** Piso, para que un plan chico no quede con un tope inusable. */
const getFloor = () => readEnvNumber('AI_WEBCHAT_DAILY_MIN', 10)

/** Tope para los planes con mensajes ilimitados, que no tienen de dónde derivarlo. */
const getUnlimitedCap = () => readEnvNumber('AI_WEBCHAT_DAILY_MAX', 500)

export const resolveDailyCap = plan => {
  const monthly = getPlanLimit(plan, AI_METRICS.AGENT_MESSAGES)

  if (monthly === UNLIMITED) return getUnlimitedCap()

  return Math.max(getFloor(), Math.ceil((monthly / 30) * getBurstFactor()))
}

/** 'YYYY-MM-DD' en UTC, igual criterio que el período mensual del medidor. */
const today = () => new Date().toISOString().slice(0, 10)

export const aiWebchatDailyCap = async (req, res, next) => {
  const tenantId = String(req.tenantId || req.tenant?._id || '').trim()

  // Sin tenant no hay a quién cobrarle ni a quién proteger. requireTenant ya
  // corrió antes que esto, así que llegar acá sin tenant sería un error de
  // cadena y no algo que este middleware deba decidir.
  if (!tenantId) return next()

  try {
    const profile = await loadTenantAiProfile(tenantId)

    // Con key propia el gasto no es de la plataforma. El comercio puede
    // regalar su presupuesto si quiere; no es nuestro.
    if (profile.keySource === 'tenant') return next()

    const cap = resolveDailyCap(profile.plan)
    const key = `ai:webchat:daily:${tenantId}:${today()}`

    // 36 horas de vida: más que el día que cuenta, para que un cambio de huso
    // o un reloj corrido no borre el contador antes de tiempo.
    const used = await cacheIncr(key, 36 * 3600)

    if (used > cap) {
      logger.warn('[AI WEBCHAT] Tope diario alcanzado', {
        tenantId,
        plan: profile.plan,
        used,
        cap,
      })

      return res.status(429).json({
        success: false,
        code: 'AI_WEBCHAT_DAILY_LIMIT',
        message: 'El asistente alcanzó su límite de consultas por hoy. Volvé a intentar mañana.',
      })
    }

    return next()
  } catch (error) {
    // Un fallo de la caché no puede dejar sin chat a una tienda. Se sigue de
    // largo: por debajo siguen estando el limitador por minuto y la cuota
    // mensual, que es el freno duro.
    logger.warn('[AI WEBCHAT] No se pudo evaluar el tope diario', {
      tenantId,
      error: error.message,
    })

    return next()
  }
}

export default { aiWebchatDailyCap, resolveDailyCap }
