// 📁 src/controller/platformCtrl.js
//
// Reportes de plataforma — cruzan todos los comercios, protegidos por
// requirePlatformOwner (ver middlewares/platformOwnerMiddleware.js), no por
// el aislamiento por tenant que usa el resto del panel admin.

import expressAsyncHandler from 'express-async-handler'
import mongoose from 'mongoose'
import Tenant from '../models/tenantModel.js'
import logger from '../../config/logger.js'
import { getPlatformMarginReport } from '../services/platform/platformMarginService.js'
import {
  getPlatformSpendSnapshot,
  getTenantSpendDetail,
} from '../services/ai/aiSpendReportService.js'
import { isValidPeriod, getCurrentPeriod } from '../services/ai/aiPeriod.js'
import {
  setPlatformAiOverride,
  getPlatformAiSettingHistory,
  setTenantAiPolicy,
  getLatestPlatformAiSetting,
  PLATFORM_AI_SETTINGS,
} from '../services/ai/platformAiSettingService.js'
import {
  AI_PLANS,
  getPlanCatalog,
  normalizePlan,
  getUsdToArsRate,
} from '../services/ai/aiPlanPolicy.js'

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
 * GET /api/platform/ai-spend/tenant/:tenantId
 *
 * UN comercio, día por día, contra el mes anterior y repartido por función.
 *
 * POR QUÉ NO VIENE EN EL REPORTE GENERAL
 *
 * Porque es una serie de treinta y un valores POR COMERCIO, y el reporte
 * general se abre para mirar el total. Con cientos de comercios, meterla
 * adentro convertiría cada apertura de la pantalla en una descarga enorme para
 * contestar una pregunta que se hace sobre uno solo. Se pide cuando se abre la
 * ficha del comercio y no antes.
 *
 * QUÉ CONTESTA QUE LA TABLA NO
 *
 * La tabla dice que un comercio triplicó. Esto dice CUÁNDO —de a poco, que es
 * un negocio que crece, o en un día, que es un bug o un abuso— y EN QUÉ, que
 * es lo que decide qué palanca se toca.
 */
export const getTenantAiSpendDetail = expressAsyncHandler(async (req, res) => {
  const { tenantId } = req.params
  const requested = String(req.query.period || '').trim()

  if (!mongoose.Types.ObjectId.isValid(String(tenantId || '').trim())) {
    return res.status(400).json({ success: false, message: 'Comercio inválido.' })
  }

  // Mismo criterio que el reporte general: un período inválido se rechaza en
  // vez de caer al mes actual en silencio.
  if (requested && !isValidPeriod(requested)) {
    return res.status(400).json({
      success: false,
      message: 'Período inválido. Se espera el formato YYYY-MM.',
    })
  }

  const detail = await getTenantSpendDetail(
    String(tenantId).trim(),
    requested || getCurrentPeriod(),
  )

  // El servicio devuelve null solo si el id no es válido, y eso ya se filtró
  // arriba. Un comercio borrado NO es null: tiene filas en el libro y esa plata
  // se pagó, así que su detalle existe igual y viene marcado.
  if (!detail) {
    return res.status(400).json({ success: false, message: 'Comercio inválido.' })
  }

  return res.status(200).json({ success: true, data: detail })
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
      error:
        'El techo en tokens debe ser un número no negativo, o null para volver a la variable de entorno.',
    },
    {
      valor: usd,
      setting: PLATFORM_AI_SETTINGS.MONTHLY_USD_BUDGET,
      normalizar: v => Math.round(v * 100) / 100,
      valido: v => Number.isFinite(v) && v >= 0,
      error:
        'El techo en dólares debe ser un número no negativo, o null para volver a la variable de entorno.',
    },
    {
      valor: perTenantShare,
      setting: PLATFORM_AI_SETTINGS.PER_TENANT_SHARE,
      normalizar: v => Math.round(v * 10000) / 10000,
      valido: v => Number.isFinite(v) && v >= 0.01 && v <= 1,
      error:
        'El reparto por comercio debe estar entre 0.01 y 1, o null para volver a la variable de entorno.',
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
  const { share, usdCap, suspended, suspendedReason, reason } = req.body || {}

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

  if (share === undefined && usdCap === undefined && suspended === undefined) {
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

  // El techo en PLATA de este comercio, en dolares del mes.
  //
  // Se valida aparte del share porque son cosas distintas: el share reparte
  // proporcionalmente y tiene piso de 1%, asi que no puede expresar "este
  // comercio no me puede costar mas de veinte dolares". El cero se rechaza en
  // lugar de guardarse: dejaria al comercio sin IA, y para eso esta el
  // interruptor, que lo dice con esas palabras y se ve en la pantalla.
  if (usdCap !== undefined && usdCap !== null) {
    const numero = Number(usdCap)

    if (!Number.isFinite(numero) || numero <= 0) {
      return res.status(400).json({
        success: false,
        message:
          'El techo en dolares del comercio debe ser mayor a cero, o null para usar su fraccion.',
      })
    }
  }

  await setTenantAiPolicy({
    tenantId: String(tenantId).trim(),
    usdCap:
      usdCap === undefined
        ? undefined
        : usdCap === null
          ? null
          : Math.round(Number(usdCap) * 10000) / 10000,
    share:
      share === undefined
        ? undefined
        : share === null
          ? null
          : Math.round(Number(share) * 10000) / 10000,
    suspended: suspended === undefined ? undefined : Boolean(suspended),
    suspendedReason: String(suspendedReason || '')
      .trim()
      .slice(0, 300),
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
      history: history.filter(row => Object.values(PLANES_CON_PRECIO).includes(row.setting)),
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
  const rawPlan = String(plan || '')
    .trim()
    .toLowerCase()

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
      message:
        'El precio debe ser un número de pesos no negativo, o null para volver al valor por defecto.',
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
      history: history.filter(row => Object.values(PLANES_CON_PRECIO).includes(row.setting)),
    },
  })
})

/**
 * Cuántos días hace que alguien tocó el tipo de cambio, y de dónde sale.
 *
 * El número solo no alcanza: un 1530 puesto hoy y un 1530 que quedó de hace
 * tres meses se leen igual en la pantalla y significan cosas opuestas. Lo
 * segundo es el margen de todos los comercios mal medido, y siempre para el
 * mismo lado: el peso se devalúa, el costo real en pesos sube, y el margen se
 * sigue informando como si no hubiera pasado nada.
 */
const SIN_CARGAR = Object.freeze({
  source: 'env',
  updatedAt: null,
  updatedByEmail: null,
  ageDays: null,
})

const estadoDelTipoDeCambio = async () => {
  const rate = getUsdToArsRate()

  // Consulta enfocada a este ajuste y no un filtro sobre el historial general.
  // Ese historial trae las últimas 100 filas de TODOS los ajustes, así que la
  // fila del dólar se cae de la ventana cuando hay suficiente actividad del
  // techo —que se mueve en caliente cuando el disyuntor corta— y la pantalla
  // terminaba afirmando que nadie lo había cargado.
  const ultima = await getLatestPlatformAiSetting(PLATFORM_AI_SETTINGS.USD_ARS_RATE).catch(
    () => null,
  )

  // Sin fila, nadie lo puso desde el panel: el valor sale de la variable de
  // entorno o del default.
  if (!ultima?.createdAt) return { rate, ...SIN_CARGAR }

  // Con fila pero valor nulo, alguien QUITÓ el override y el mando volvió a la
  // variable de entorno. Informar 'panel' acá diría que el número lo decidió
  // una persona cuando en realidad es el default — la procedencia engañosa que
  // esta función existe para evitar.
  if (ultima.value === null || ultima.value === undefined) return { rate, ...SIN_CARGAR }

  const ageMs = Date.now() - new Date(ultima.createdAt).getTime()

  return {
    rate,
    source: 'panel',
    updatedAt: ultima.createdAt,
    updatedByEmail: ultima.changedByEmail || null,
    ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
  }
}

/**
 * GET /api/platform/usd-rate
 */
export const getUsdRate = expressAsyncHandler(async (_req, res) => {
  const estado = await estadoDelTipoDeCambio()

  const history = await getPlatformAiSettingHistory(30).catch(() => [])

  return res.status(200).json({
    success: true,
    data: {
      ...estado,
      history: history.filter(fila => fila.setting === PLATFORM_AI_SETTINGS.USD_ARS_RATE),
    },
  })
})

/**
 * PUT /api/platform/usd-rate
 *
 * Carga a mano los pesos por dólar. `rate: null` devuelve el mando a la
 * variable de entorno.
 */
export const updateUsdRate = expressAsyncHandler(async (req, res) => {
  const { rate, reason } = req.body || {}

  const isRemoval = rate === null
  const value = isRemoval ? null : Number(rate)

  // Acá el cero NO se admite, a diferencia del precio de un plan: un plan puede
  // ser gratis, pero un dólar a cero convertiría cualquier costo en cero pesos
  // y haría que todos los comercios parezcan rentables.
  if (!isRemoval && (!Number.isFinite(value) || value <= 0)) {
    return res.status(400).json({
      success: false,
      message:
        'El tipo de cambio debe ser un número de pesos mayor a cero, o null para volver al valor por defecto.',
    })
  }

  const cleanReason = String(reason || '').trim()

  if (!cleanReason) {
    return res.status(400).json({
      success: false,
      message: 'Indicá de dónde sacaste el valor del dólar.',
    })
  }

  await setPlatformAiOverride({
    setting: PLATFORM_AI_SETTINGS.USD_ARS_RATE,
    value: isRemoval ? null : Math.round(value),
    changedByEmail: req.user?.email,
    changedByUserId: req.user?._id || null,
    reason: cleanReason.slice(0, 500),
  })

  const estado = await estadoDelTipoDeCambio()
  const history = await getPlatformAiSettingHistory(30).catch(() => [])

  return res.status(200).json({
    success: true,
    data: {
      ...estado,
      history: history.filter(fila => fila.setting === PLATFORM_AI_SETTINGS.USD_ARS_RATE),
    },
  })
})

/**
 * PUT /api/platform/tenant/:tenantId/status
 *
 * Suspende o reactiva un comercio entero.
 *
 * QUÉ HACE Y QUÉ NO HACE
 *
 * Mueve `status` entre 'active' y 'suspended'. No borra NADA: los productos,
 * las órdenes, los clientes y el historial de facturación quedan intactos.
 *
 * El corte ya estaba implementado y no hace falta nada más: tenantMiddleware
 * resuelve únicamente comercios con status 'active', así que un suspendido deja
 * de responder tanto en su tienda como en su panel. Esto solo mueve la perilla.
 *
 * POR QUÉ SUSPENDER Y NO BORRAR
 *
 * El caso que motiva esta pantalla es un comercio que cuesta más de lo que
 * paga, y para eso frenarlo alcanza. Borrarlo sería irreversible justo con los
 * datos que harían falta si después discute un cobro o reclama. El enum del
 * modelo ya tiene 'deleted' para el día que haya un pedido concreto de baja de
 * datos; eso es otra operación y merece su propia confirmación.
 */
export const updateTenantStatus = expressAsyncHandler(async (req, res) => {
  const { tenantId } = req.params
  const { suspended, reason } = req.body || {}

  if (!mongoose.Types.ObjectId.isValid(String(tenantId || ''))) {
    return res.status(400).json({ success: false, message: 'Comercio inválido.' })
  }

  if (typeof suspended !== 'boolean') {
    return res.status(400).json({
      success: false,
      message: 'Indicá si el comercio queda suspendido (true) o activo (false).',
    })
  }

  const cleanReason = String(reason || '').trim()

  // Se exige motivo para suspender y no para reactivar: frenar a un comercio
  // que paga es lo que alguien va a discutir después, y sin motivo ni autor no
  // hay con qué responder. Volver a habilitarlo no necesita defensa.
  if (suspended && !cleanReason) {
    return res.status(400).json({
      success: false,
      message: 'Indicá por qué se suspende el comercio.',
    })
  }

  // Lectura con lean y escritura con findByIdAndUpdate: las dos esquivan el
  // hook pre('save') del modelo a propósito.
  //
  // normalizeTenant recorre this.domains, así que un documento cargado con
  // select parcial lo hace explotar con "Cannot read properties of undefined
  // (reading 'filter')" al guardar. Cargar el documento completo lo evitaría,
  // pero haría que un cambio de estado dispare además la normalización entera
  // de dominios — efectos que nadie pidió en una operación que mueve un campo.
  const tenant = await Tenant.findById(tenantId)
    .setOptions({ ignoreTenant: true, platformScope: 'platform:suspension-de-comercio' })
    .select('name status')
    .lean()

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'El comercio no existe.' })
  }

  // Un comercio ya borrado no se reactiva desde acá: esa es una decisión
  // distinta y esta pantalla no es el lugar para tomarla sin querer.
  if (tenant.status === 'deleted') {
    return res.status(409).json({
      success: false,
      message: 'El comercio está dado de baja. Reactivarlo no se hace desde esta pantalla.',
    })
  }

  const estadoAnterior = tenant.status

  // Al reactivar se limpian los tres campos: un comercio activo con un motivo
  // de suspensión colgado se lee como si siguiera suspendido.
  const cambios = {
    status: suspended ? 'suspended' : 'active',
    suspendedAt: suspended ? new Date() : null,
    suspendedReason: suspended ? cleanReason.slice(0, 500) : null,
    suspendedByEmail: suspended ? req.user?.email || null : null,
  }

  const actualizado = await Tenant.findByIdAndUpdate(tenantId, { $set: cambios }, { new: true })
    .setOptions({ ignoreTenant: true, platformScope: 'platform:suspension-de-comercio' })
    .select('name status suspendedAt suspendedReason suspendedByEmail')
    .lean()

  // Entre la lectura de arriba y esta escritura hay una ventana: si el comercio
  // se borro en el medio, findByIdAndUpdate devuelve null. Sin esta guarda la
  // linea siguiente tiraba TypeError y el manejador lo convertia en un 500
  // generico, dejando a quien lo ejecuto sin saber si el comercio quedo
  // suspendido o no. En un endpoint que corta servicio, eso no se adivina.
  if (!actualizado) {
    return res.status(404).json({ success: false, message: 'El comercio no existe.' })
  }

  // Nivel warn y no info: cortarle el servicio a un comercio que paga es un
  // evento que alguien va a querer encontrar en los logs sin filtrar ruido.
  logger.warn('[PLATAFORMA] Estado de comercio cambiado', {
    tenantId: String(actualizado._id),
    nombre: actualizado.name,
    de: estadoAnterior,
    a: actualizado.status,
    porEmail: req.user?.email || null,
    motivo: actualizado.suspendedReason,
  })

  return res.status(200).json({
    success: true,
    data: {
      tenantId: String(actualizado._id),
      name: actualizado.name,
      status: actualizado.status,
      suspendedAt: actualizado.suspendedAt,
      suspendedReason: actualizado.suspendedReason,
      suspendedByEmail: actualizado.suspendedByEmail,
    },
  })
})

/**
 * DELETE /api/platform/tenant/:tenantId
 *
 * Da de baja un comercio.
 *
 * QUÉ BORRA Y QUÉ NO
 *
 * Pone `status` en 'deleted'. Eso lo saca de toda operación —tenantMiddleware
 * resuelve únicamente comercios activos, así que deja de responder su tienda y
 * su panel, y sus dominios dejan de resolver— y lo saca del reporte de margen,
 * que ya filtra los borrados.
 *
 * NO borra el libro de consumo de IA, y eso es a propósito: esas filas son el
 * registro de lo que HENKO PAGÓ. Si desaparecieran, el gasto mensual de la
 * plataforma dejaría de cuadrar con lo que facturó Google y el historial del
 * disyuntor quedaría mal. El comercio sigue apareciendo en el reporte de gasto
 * marcado como dado de baja, que es lo correcto: el gasto ocurrió.
 *
 * Tampoco borra órdenes ni facturación, por el mismo motivo y porque es
 * documentación que hay que poder mostrar si alguien discute un cobro.
 *
 * POR QUÉ PIDE EL NOMBRE ESCRITO
 *
 * Es la única operación de esta pantalla que no se deshace con un clic. Un
 * botón de confirmación se aprieta por inercia; escribir el nombre obliga a
 * mirar cuál comercio es. Mismo criterio que usan las plataformas para borrar
 * un repositorio.
 */
export const deleteTenant = expressAsyncHandler(async (req, res) => {
  const { tenantId } = req.params
  const { confirmName, reason } = req.body || {}

  if (!mongoose.Types.ObjectId.isValid(String(tenantId || ''))) {
    return res.status(400).json({ success: false, message: 'Comercio inválido.' })
  }

  const cleanReason = String(reason || '').trim()

  if (!cleanReason) {
    return res.status(400).json({
      success: false,
      message: 'Indicá por qué se da de baja el comercio.',
    })
  }

  const tenant = await Tenant.findById(tenantId)
    .setOptions({ ignoreTenant: true, platformScope: 'platform:baja-de-comercio' })
    .select('name status')
    .lean()

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'El comercio no existe.' })
  }

  if (tenant.status === 'deleted') {
    return res.status(409).json({
      success: false,
      message: 'El comercio ya está dado de baja.',
    })
  }

  // La comparación es exacta salvo espacios al borde. No se normaliza de más
  // —ni acentos ni mayúsculas— porque el punto es que quien confirma haya
  // mirado el nombre, no que adivine una forma aproximada.
  if (String(confirmName || '').trim() !== tenant.name) {
    return res.status(400).json({
      success: false,
      message: `Para confirmar, escribí el nombre exacto del comercio: ${tenant.name}`,
    })
  }

  const actualizado = await Tenant.findByIdAndUpdate(
    tenantId,
    {
      $set: {
        status: 'deleted',
        // Se reusan los campos de suspensión en lugar de agregar otros tres:
        // responden la misma pregunta —por qué, cuándo y quién dejó a este
        // comercio fuera de servicio— y el estado ya distingue los dos casos.
        suspendedAt: new Date(),
        suspendedReason: cleanReason.slice(0, 500),
        suspendedByEmail: req.user?.email || null,
      },
    },
    { new: true },
  )
    .setOptions({ ignoreTenant: true, platformScope: 'platform:baja-de-comercio' })
    .select('name status suspendedAt suspendedReason suspendedByEmail')
    .lean()

  if (!actualizado) {
    return res.status(404).json({ success: false, message: 'El comercio no existe.' })
  }

  // Nivel warn, igual que la suspensión: es el evento que alguien va a buscar
  // en los logs cuando pregunte qué pasó con un comercio.
  logger.warn('[PLATAFORMA] Comercio dado de baja', {
    tenantId: String(actualizado._id),
    nombre: actualizado.name,
    porEmail: req.user?.email || null,
    motivo: actualizado.suspendedReason,
    nota: 'El libro de consumo de IA NO se borra: registra lo que HENKO pagó.',
  })

  return res.status(200).json({
    success: true,
    data: {
      tenantId: String(actualizado._id),
      name: actualizado.name,
      status: actualizado.status,
      deletedAt: actualizado.suspendedAt,
      reason: actualizado.suspendedReason,
      byEmail: actualizado.suspendedByEmail,
    },
  })
})

export default {
  getMarginReport,
  getAiSpendReport,
  getTenantAiSpendDetail,
  updateAiBudget,
  getUsdRate,
  updateUsdRate,
  updateTenantStatus,
  deleteTenant,
  getPlanPrices,
  updatePlanPrice,
}
