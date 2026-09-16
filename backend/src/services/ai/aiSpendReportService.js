// 📁 src/services/ai/aiSpendReportService.js
//
// Lecturas del libro de consumo.
//
// El ledger venía escribiendo sin que nadie lo leyera. Esta es la primera
// consulta que lo usa, y existe por una razón concreta: un aviso de
// presupuesto que dice "vas por el 80%" obliga a ir a investigar; uno que dice
// "vas por el 80% y el 70% se lo lleva visión" ya trae la respuesta.
//
// SOBRE EL CRUCE DE TENANTS
//
// Estas consultas son deliberadamente cross-tenant: la pregunta que contestan
// es "¿cuánto va a pagar HENKO este mes?", que no tiene sentido tenant por
// tenant. Por eso llevan `ignoreTenant`, que es justamente el tipo de opción
// que no debería aparecer sin justificar.
//
// Lo que las hace seguras es que no devuelven nada identificable: agrupan por
// métrica y por modelo, y lo que sale son totales. Ningún resultado de este
// archivo debe servirse a un comercio — es información de la plataforma.

import AiConsumptionLedger, { LEDGER_EVENT } from '../../models/aiConsumptionLedgerModel.js'
import AiPlatformUsage from '../../models/aiPlatformUsageModel.js'
import logger from '../../../config/logger.js'
import {
  getPlatformMonthlyTokenBudget,
  getPlatformMonthlyUsdBudget,
  getPerTenantShare,
  getPlatformBudgetSource,
  getPlatformUsdBudgetSource,
  UNLIMITED,
  degradationLevelFor,
  DEGRADATION_ECONOMY_PERCENT,
  DEGRADATION_ESSENTIAL_PERCENT,
} from './aiPlanPolicy.js'
import {
  getPlatformAiSettingHistory,
  getAllTenantAiPolicies,
} from './platformAiSettingService.js'
import Tenant from '../../models/tenantModel.js'
import { getCurrentPeriod } from './aiPeriod.js'
// La contabilidad vive aparte: este archivo REPORTA, aquel RECONCILIA.
import { rebuildPlatformProjection } from './aiAccountingService.js'

// `amount` mide unidades o tokens según la fila; sumar las dos juntas daría un
// número sin sentido. El campo `unit` es el que lo dice.
const sumTokens = {
  $sum: { $cond: [{ $eq: ['$unit', 'tokens'] }, '$amount', 0] },
}

const round = (value, decimals = 4) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Number(number.toFixed(decimals))
}

/**
 * Gasto del período agrupado por métrica, de lo más caro a lo más barato.
 *
 * Mira los 'consumed' y RESTA los 'refunded'. Las reservas quedan afuera:
 * siguen siendo intención.
 *
 * La resta es nueva y hace falta desde que el costo de tarifa plana se cobra en
 * el mismo movimiento que la cuota. Antes un 'consumed' solo se escribía cuando
 * la operación ya había salido bien, así que la devolución no tenía nada que
 * descontar; ahora la edición de imagen se cobra al reservar y se devuelve si
 * el proveedor falla, y sin esta resta el reporte contaría un gasto que se
 * revirtió.
 *
 * Para las métricas de tokens no cambia nada: sus filas de devolución llevan
 * costo cero, porque esos tokens sí se gastaron contra Google.
 *
 * @param {string} period
 * @returns {Promise<Array<{metric:string, costUsd:number, tokens:number, operations:number}>>}
 */
export const getPeriodSpendByMetric = async period => {
  if (!period) return []

  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }
  const conSigno = campo => ({ $cond: [esDevolucion, { $multiply: [campo, -1] }, campo] })

  const rows = await AiConsumptionLedger.aggregate([
    {
      $match: {
        period,
        event: { $in: [LEDGER_EVENT.CONSUMED, LEDGER_EVENT.REFUNDED] },
      },
    },
    {
      $group: {
        _id: '$metric',
        costUsd: { $sum: conSigno('$costUsd') },
        tokens: {
          $sum: conSigno({ $cond: [{ $eq: ['$unit', 'tokens'] }, '$amount', 0] }),
        },
        // Lo que se fue en HERRAMIENTAS, separado de lo que se fue en tokens.
        //
        // Va aparte porque las dos mitades llevan a palancas opuestas: si el
        // gasto se concentra en tokens, se toca el modelo o el prompt; si se
        // concentra en herramientas, cuántas páginas se extraen. Con un solo
        // número, la pregunta no tiene respuesta.
        //
        // Sobre 2026-09: marketTokens gastó USD 0,0585 en tokens y USD 1,5360
        // en créditos de Tavily. El 96% del costo de esa feature estaba
        // afuera del reporte.
        toolCostUsd: {
          $sum: conSigno({ $cond: [{ $eq: ['$unit', 'toolCalls'] }, '$costUsd', 0] }),
        },
        toolCalls: {
          $sum: conSigno({ $cond: [{ $eq: ['$unit', 'toolCalls'] }, '$amount', 0] }),
        },
        operations: { $sum: conSigno(1) },
      },
    },
    { $sort: { costUsd: -1 } },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  return rows.map(row => {
    const toolCostUsd = round(row.toolCostUsd || 0)

    return {
      metric: row._id,
      // El total de la feature: tokens MÁS herramientas. Sigue significando lo
      // mismo que antes —el gasto de esa métrica— y ahora incluye lo que antes
      // faltaba.
      costUsd: round(row.costUsd),
      // Y las dos mitades, para poder mirarlas por separado.
      tokenCostUsd: round(row.costUsd - toolCostUsd),
      toolCostUsd,
      tokens: row.tokens || 0,
      toolCalls: row.toolCalls || 0,
      operations: row.operations || 0,
    }
  })
}

/**
 * Lo mismo por modelo. Sirve para una decisión distinta: si el gasto se
 * concentra en un modelo caro, cambiar de modelo es una palanca que no
 * requiere tocar el producto.
 */
export const getPeriodSpendByModel = async period => {
  if (!period) return []

  const rows = await AiConsumptionLedger.aggregate([
    { $match: { period, event: LEDGER_EVENT.CONSUMED, model: { $ne: null } } },
    {
      $group: {
        _id: '$model',
        costUsd: { $sum: '$costUsd' },
        tokens: sumTokens,
        operations: { $sum: 1 },
        // Cuántas filas se calcularon con la tarifa conservadora por no tener
        // el modelo en el catálogo. Si esto crece, el catálogo quedó viejo y
        // el costo que muestra el panel está inflado.
        fallbackRows: { $sum: { $cond: ['$priceFallback', 1, 0] } },
      },
    },
    { $sort: { costUsd: -1 } },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  return rows.map(row => ({
    model: row._id,
    costUsd: round(row.costUsd),
    tokens: row.tokens || 0,
    operations: row.operations || 0,
    fallbackRows: row.fallbackRows || 0,
  }))
}

/**
 * Cuánta de la contabilidad del período es medida, y cuánta plata hay detrás
 * de cada clase de supuesto.
 *
 * Va en el reporte y no en una nota al pie porque cambia cómo hay que leer el
 * total. Un costo repartido con una proporción asumida y uno calculado con el
 * usageMetadata real no son la misma clase de dato, y quien mira el número para
 * decidir algo tiene que saber cuál está mirando.
 *
 * SOLO CUENTA LAS FILAS DE TOKENS, Y ESA ES LA CORRECCIÓN QUE MÁS IMPORTA.
 *
 * Antes miraba TODOS los movimientos, y el resultado mentía. Medido en
 * producción sobre 2026-09:
 *
 *   todos los movimientos   160 filas · 27 estimadas (17%) · 24 sin modelo
 *   solo las de tokens      132 filas ·  4 estimadas  (3%) ·  0 sin modelo
 *
 * Las 19 de diferencia son ediciones de imagen. Llevan costEstimated porque el
 * precio es por imagen y se cobra al reservar, y no llevan modelo porque no lo
 * tienen: las sirve Replicate, no Gemini. Contarlas como "contabilidad
 * supuesta" inflaba el defecto cuatro veces y tapaba la señal real. Lo que se
 * cobra por unidad se informa aparte, en `flatRate`.
 *
 * LAS CUATRO CLASES SON EXCLUYENTES Y SUMAN EL TOTAL.
 *
 * Si se contaran solapadas, una fila estimada Y con tarifa de respaldo sumaría
 * dos veces y el reporte no cerraría contra el gasto. Van de peor a mejor:
 *
 *   unknownModel   ni siquiera se sabe qué modelo respondió
 *   priceFallback  el modelo se sabe, pero no está en el catálogo
 *   estimated      la tarifa se sabe; el reparto entrada/salida fue supuesto
 *   measured       todo real
 *
 * UNA ACLARACIÓN DE NOMBRES QUE CUESTA CARA SI SE PASA POR ALTO.
 *
 * `priceFallback` (ledger) y `pricingFallback` (AiProviderCall) se escriben
 * casi igual y significan cosas distintas: el primero es "sé el modelo, no
 * tengo su tarifa"; el segundo, "no sé ni el modelo". Acá se usa el nombre del
 * campo que se está contando, y el segundo caso viaja como `unknownModel`,
 * que dice lo que es.
 */
export const getPeriodQuality = async period => {
  const ES_TOKENS = { $eq: [{ $ifNull: ['$unit', 'units'] }, 'tokens'] }
  const SIN_MODELO = { $in: [{ $ifNull: ['$model', null] }, [null, '']] }

  // Excluyentes y en orden de gravedad: la primera que aplica se queda la fila.
  const clase = {
    $switch: {
      branches: [
        { case: SIN_MODELO, then: 'unknownModel' },
        { case: { $eq: ['$priceFallback', true] }, then: 'priceFallback' },
        { case: { $eq: ['$costEstimated', true] }, then: 'estimated' },
      ],
      default: 'measured',
    },
  }

  const filas = await AiConsumptionLedger.aggregate([
    { $match: { period, event: LEDGER_EVENT.CONSUMED } },
    {
      $group: {
        _id: { tokens: ES_TOKENS, clase },
        rows: { $sum: 1 },
        costUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
      },
    },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  const acc = {
    measured: { rows: 0, costUsd: 0 },
    estimated: { rows: 0, costUsd: 0 },
    priceFallback: { rows: 0, costUsd: 0 },
    unknownModel: { rows: 0, costUsd: 0 },
  }
  const flatRate = { rows: 0, costUsd: 0 }

  for (const f of filas) {
    const destino = f._id.tokens ? acc[f._id.clase] : flatRate
    if (!destino) continue
    destino.rows += f.rows
    destino.costUsd += f.costUsd
  }

  const rows =
    acc.measured.rows + acc.estimated.rows + acc.priceFallback.rows + acc.unknownModel.rows
  const costUsd =
    acc.measured.costUsd +
    acc.estimated.costUsd +
    acc.priceFallback.costUsd +
    acc.unknownModel.costUsd

  return {
    // Los tres nombres que el panel ya leía. Siguen significando lo mismo, pero
    // ahora sobre las filas de tokens, que es donde la pregunta tiene sentido.
    rows,
    estimatedRows: acc.estimated.rows,
    fallbackRows: acc.priceFallback.rows,

    // El total de tokens, para que la suma de las cuatro clases se pueda
    // verificar contra él en vez de tener que confiar.
    costUsd: round(costUsd, 6),

    measured: acc.measured.rows,
    measuredCostUsd: round(acc.measured.costUsd, 6),
    estimated: acc.estimated.rows,
    estimatedCostUsd: round(acc.estimated.costUsd, 6),
    priceFallback: acc.priceFallback.rows,
    fallbackCostUsd: round(acc.priceFallback.costUsd, 6),
    unknownModel: acc.unknownModel.rows,
    unknownModelCostUsd: round(acc.unknownModel.costUsd, 6),

    // El número que contesta la pregunta de una sola lectura: qué porcentaje
    // del gasto en tokens salió de una medición y no de un supuesto. null
    // cuando no hubo gasto — es distinto de 0%.
    measuredShare: costUsd > 0 ? round((acc.measured.costUsd / costUsd) * 100, 1) : null,

    // Imágenes y mensajes: precio por unidad, no por token. No entra en el
    // porcentaje de arriba porque no hay desglose que medir ni suponer.
    flatRate: { rows: flatRate.rows, costUsd: round(flatRate.costUsd, 6) },
  }
}

/**
 * Todo lo que hace falta para contestar "¿cuánto va a pagar HENKO este mes y
 * en qué?" en una sola lectura.
 *
 * Junta las dos fuentes a propósito, porque miden cosas distintas y verlas
 * juntas es el control:
 *
 *  - AiPlatformUsage.tokens es lo que el DISYUNTOR cuenta. Es la cifra que
 *    decide si se corta, y la única que importa para saber cuánto falta.
 *  - El ledger explica ese número: qué función y qué modelo lo consumieron.
 *
 * Pueden no coincidir, y eso no es un error: el consumo de los comercios con
 * key propia entra al ledger con costo 0 y NO al contador de plataforma,
 * porque no lo paga HENKO. Por eso el desglose se informa aparte del total
 * contra el techo en vez de mezclarlos en un solo número.
 */
/**
 * Quien paga cada consumo, separado de cuanto se consume.
 *
 * Es la respuesta al "separar claramente costo de HENKO y consumo del tenant":
 * las dos cifras existen siempre y solo coinciden cuando la key es de la
 * plataforma. Mezclarlas es mezclar la caja de HENKO con la del comercio.
 */
const getSpendByKeySource = async period => {
  const rows = await AiConsumptionLedger.aggregate([
    { $match: { period, event: LEDGER_EVENT.CONSUMED } },
    {
      $group: {
        _id: { $ifNull: ['$keySource', 'unknown'] },
        platformCostUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
        tenantProviderCostUsd: {
          // Las filas viejas no tienen el campo: ahi el costo del proveedor es
          // el mismo que el de plataforma, porque antes de BYOK toda key era
          // de HENKO.
          $sum: { $ifNull: ['$tenantProviderCostUsd', { $ifNull: ['$costUsd', 0] }] },
        },
        tokens: {
          $sum: { $cond: [{ $eq: [{ $ifNull: ['$unit', 'units'] }, 'tokens'] }, '$amount', 0] },
        },
        rows: { $sum: 1 },
      },
    },
    { $sort: { platformCostUsd: -1 } },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  return rows.map(row => ({
    keySource: row._id,
    rows: row.rows,
    tokens: row.tokens || 0,
    platformCostUsd: round(row.platformCostUsd, 6),
    tenantProviderCostUsd: round(row.tenantProviderCostUsd, 6),
  }))
}


/**
 * Quién se está gastando el presupuesto.
 *
 * POR QUÉ FALTABA Y POR QUÉ IMPORTA
 *
 * Todo el reporte era agregado: por métrica, por modelo, por calidad, por
 * origen de key. Ninguna de esas vistas contesta la pregunta que uno se hace
 * cuando el disyuntor corta — "¿quién fue?" — y el dato estaba a mano: AiUsage
 * es por comercio y el ledger tiene tenantId en cada fila.
 *
 * Con un comercio, el agregado y el detalle son el mismo número. Con diez, el
 * agregado deja de servir para decidir nada: un techo compartido sin saber
 * quién lo consume solo permite castigar a todos por igual.
 *
 * SE LEE DEL LEDGER Y NO DE AiUsage, a propósito. AiUsage es la proyección y
 * puede driftear —ya pasó, 17.223 tokens— mientras que el libro es la fuente
 * de verdad. Y permite separar lo que paga HENKO de lo que consume el
 * comercio, que en AiUsage vive en un solo número.
 */
export const getPeriodSpendByTenant = async period => {
  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }
  const conSigno = campo => ({ $cond: [esDevolucion, { $multiply: [campo, -1] }, campo] })

  const filas = await AiConsumptionLedger.aggregate([
    {
      $match: {
        period,
        event: { $in: [LEDGER_EVENT.CONSUMED, LEDGER_EVENT.REFUNDED] },
      },
    },
    {
      $group: {
        _id: '$tenantId',
        // Lo que paga HENKO. Es lo que pega contra el techo.
        platformCostUsd: { $sum: conSigno({ $ifNull: ['$costUsd', 0] }) },
        // Lo que le cobró el proveedor a la key usada, sea de quien sea. Con
        // key propia del comercio el de arriba es cero y este no.
        tenantProviderCostUsd: {
          $sum: conSigno({
            $ifNull: ['$tenantProviderCostUsd', { $ifNull: ['$costUsd', 0] }],
          }),
        },
        tokens: {
          $sum: conSigno({
            $cond: [{ $eq: [{ $ifNull: ['$unit', 'units'] }, 'tokens'] }, '$amount', 0],
          }),
        },
        toolCalls: {
          $sum: conSigno({
            $cond: [{ $eq: [{ $ifNull: ['$unit', 'units'] }, 'toolCalls'] }, '$amount', 0],
          }),
        },
        operations: { $sum: conSigno(1) },
        // Con qué key vino el consumo. Un comercio puede cambiar de key a
        // mitad de mes, así que se recolectan todas las que aparecieron.
        keySources: { $addToSet: '$keySource' },
      },
    },
    { $sort: { platformCostUsd: -1 } },
    // El nombre del comercio: sin él la tabla es una lista de ObjectId y no se
    // puede actuar sobre ella.
    {
      $lookup: {
        from: 'tenants',
        localField: '_id',
        foreignField: '_id',
        as: 'tenant',
      },
    },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  const budget = getPlatformMonthlyTokenBudget()
  const usdBudget = getPlatformMonthlyUsdBudget()
  const shareGlobal = getPerTenantShare()

  // Lo que el dueño de la plataforma decidió sobre cada comercio. Una consulta
  // para todos, no una por fila.
  const politicas = await getAllTenantAiPolicies().catch(() => ({}))

  const filasConPolitica = filas.map(fila => {
    const tenant = fila.tenant?.[0] || null
    const tenantId = String(fila._id)
    const tokens = fila.tokens || 0
    const platformCostUsd = round(fila.platformCostUsd, 6)
    const politica = politicas[tenantId] || null

    // El tope por comercio es una FRACCIÓN del techo global (ver
    // resolveEffectiveLimit en aiPlanPolicy.js). Mostrar cuánto de ESE tope
    // lleva usado es lo que convierte la tabla en algo accionable: un comercio
    // al 90% de su parte va a quedarse sin IA aunque la plataforma vaya al 30%.
    //
    // Y tiene que ser la fracción de ESTE comercio, no la global: si se le bajó
    // a la mitad, su tope real es la mitad y la columna estaría mintiendo justo
    // sobre el comercio que alguien decidió vigilar.
    const share = Number.isFinite(politica?.share) ? politica.share : shareGlobal
    const tokenCap = budget === UNLIMITED ? null : Math.floor(budget * share)

    return {
      tenantId,
      name: tenant?.name || tenant?.hostname || '(comercio eliminado)',
      plan: tenant?.plan || null,
      tokens,
      toolCalls: fila.toolCalls || 0,
      operations: fila.operations || 0,
      platformCostUsd,
      tenantProviderCostUsd: round(fila.tenantProviderCostUsd, 6),
      // Con key propia HENKO no paga, así que el comercio no consume techo.
      keySources: (fila.keySources || []).filter(Boolean),
      tokenCap,
      percentOfCap: tokenCap ? round((tokens / tokenCap) * 100, 1) : null,
      percentOfPlatformUsd:
        usdBudget === UNLIMITED || usdBudget <= 0
          ? null
          : round((platformCostUsd / usdBudget) * 100, 1),
      // La política, para que la tabla sea el lugar donde se mira Y se actúa.
      // `share: null` quiere decir "usa la global", y la pantalla tiene que
      // poder distinguir eso de "le pusieron justo la global".
      share: Number.isFinite(politica?.share) ? politica.share : null,
      suspended: politica?.suspended === true,
      suspendedReason: politica?.suspendedReason || null,
    }
  })

  // Un comercio suspendido dejó de consumir, así que no tiene filas en el libro
  // y se caía de la tabla — justo el que alguien decidió vigilar, invisible en
  // la pantalla desde donde se lo tiene que poder levantar. Se agregan en cero.
  const yaEstan = new Set(filasConPolitica.map(f => f.tenantId))
  const faltantes = Object.entries(politicas).filter(
    ([tenantId, politica]) => !yaEstan.has(tenantId) && politica.suspended,
  )

  if (faltantes.length === 0) return filasConPolitica

  const tenants = await Tenant.find({ _id: { $in: faltantes.map(([id]) => id) } })
    .select('name hostname plan')
    .setOptions({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })
    .lean()

  const porId = new Map(tenants.map(t => [String(t._id), t]))

  const enCero = faltantes.map(([tenantId, politica]) => {
    const tenant = porId.get(tenantId) || null

    return {
      tenantId,
      name: tenant?.name || tenant?.hostname || '(comercio eliminado)',
      plan: tenant?.plan || null,
      tokens: 0,
      toolCalls: 0,
      operations: 0,
      platformCostUsd: 0,
      tenantProviderCostUsd: 0,
      keySources: [],
      tokenCap: null,
      percentOfCap: null,
      percentOfPlatformUsd: null,
      share: Number.isFinite(politica.share) ? politica.share : null,
      suspended: true,
      suspendedReason: politica.suspendedReason || null,
    }
  })

  return [...filasConPolitica, ...enCero]
}

// ─── RITMO DE QUEMA Y PRONÓSTICO ─────────────────────────────────────────────
//
// Todo lo de arriba contesta "cuánto llevo". Ninguna contesta "cuánto voy a
// llevar", que es la única que permite actuar ANTES.
//
// La diferencia entre las dos es el tiempo que uno tiene para hacer algo. El
// disyuntor corta cuando ya se gastó; el aviso del 80% avisa cuando faltan dos
// días a ritmo normal y unas horas a ritmo desbocado. Un pronóstico que dice
// "al ritmo de esta semana llegás al techo el día 18" avisa el día 6.

/** Cuántos días tiene el mes del período. Día 0 del mes siguiente, en UTC. */
const diasDelPeriodo = period => {
  const [anio, mes] = String(period).split('-').map(Number)
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/**
 * El gasto día por día del período.
 *
 * Sale del LIBRO y no del contador agregado: el contador tiene un solo número
 * por mes y no se puede derivar de él ninguna serie. Es también la base de la
 * detección de anomalías, que necesita comparar un día contra los anteriores.
 *
 * @returns {Promise<Array<{day: number, costUsd: number, tokens: number, operations: number}>>}
 */
export const getPeriodDailySpend = async period => {
  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }
  const conSigno = campo => ({ $cond: [esDevolucion, { $multiply: [campo, -1] }, campo] })

  const filas = await AiConsumptionLedger.aggregate([
    {
      $match: {
        period,
        event: { $in: [LEDGER_EVENT.CONSUMED, LEDGER_EVENT.REFUNDED] },
      },
    },
    {
      $group: {
        // UTC, igual que el período: agrupar en hora local haría que el gasto
        // del día 1 a las 00:30 de Buenos Aires cayera en el día anterior, que
        // ni siquiera pertenece a este período.
        _id: { $dayOfMonth: { date: '$createdAt', timezone: 'UTC' } },
        costUsd: { $sum: conSigno({ $ifNull: ['$costUsd', 0] }) },
        tokens: {
          $sum: conSigno({
            $cond: [{ $eq: [{ $ifNull: ['$unit', 'units'] }, 'tokens'] }, '$amount', 0],
          }),
        },
        operations: { $sum: conSigno(1) },
      },
    },
    { $sort: { _id: 1 } },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  return filas.map(fila => ({
    day: fila._id,
    costUsd: round(fila.costUsd, 6),
    tokens: fila.tokens || 0,
    operations: fila.operations || 0,
  }))
}

// Cuántos días mira el ritmo "reciente".
//
// SIETE Y NO TRES NI TREINTA. Tres días capturan cualquier pico —un bulk
// import de un martes proyecta un mes catastrófico que no va a pasar— y el mes
// entero diluye justamente lo que hay que ver: un comercio que se desbocó el
// día 20 queda escondido bajo diecinueve días normales. Siete además cubre la
// semana completa, y el consumo de una tienda tiene forma semanal: los fines de
// semana no se parecen a los martes.
const DIAS_RITMO_RECIENTE = 7

/**
 * A este ritmo, ¿cuándo se llega al techo?
 *
 * DOS RITMOS Y NO UNO, Y SE PROYECTA CON EL PEOR
 *
 * El promedio del mes es estable pero lento en reaccionar; el de los últimos
 * siete días ve el cambio pero se sacude con un pico. Se calculan los dos, se
 * proyecta con el MAYOR y se dice cuál se usó.
 *
 * Proyectar con el mayor no es pesimismo: este número existe para dar tiempo, y
 * un pronóstico que subestima el gasto no da ninguno. El costo de equivocarse
 * hacia arriba es mirar la pantalla un día de más; hacia abajo, es el
 * presupuesto agotado sin aviso.
 *
 * QUÉ PASA CON UN PERÍODO PASADO
 *
 * No se proyecta nada: ya terminó, y "va a llegar al techo el día 18" sobre un
 * mes cerrado es una afirmación sin sentido. Se devuelve la serie igual, que es
 * lo que sirve para mirar un mes viejo.
 */
export const buildForecast = ({ period, daily, spentUsd, usdBudget, now = new Date() }) => {
  const esPeriodoEnCurso = period === getCurrentPeriod()
  const diasDelMes = diasDelPeriodo(period)

  // Los días transcurridos incluyen el de hoy, que está a medio andar. Contarlo
  // entero bajaría el promedio diario y correría el pronóstico hacia adelante —
  // justo el error que este número no puede cometer.
  const diaDeHoy = esPeriodoEnCurso ? now.getUTCDate() : diasDelMes
  const diasCompletos = Math.max(1, diaDeHoy - 1)

  // Se excluye HOY de los dos promedios, por lo mismo.
  const cerrados = daily.filter(d => d.day < diaDeHoy)
  const gastoCerrado = cerrados.reduce((total, d) => total + d.costUsd, 0)

  const promedioDelMes = gastoCerrado / diasCompletos

  const recientes = cerrados.filter(d => d.day > diaDeHoy - 1 - DIAS_RITMO_RECIENTE)
  const diasRecientes = Math.min(diasCompletos, DIAS_RITMO_RECIENTE)
  const promedioReciente =
    recientes.reduce((total, d) => total + d.costUsd, 0) / Math.max(1, diasRecientes)

  const base = {
    dailyAvgUsd: round(promedioDelMes, 4),
    recentAvgUsd: round(promedioReciente, 4),
    daysElapsed: diasCompletos,
    daysInPeriod: diasDelMes,
    recentWindowDays: DIAS_RITMO_RECIENTE,
    daily,
  }

  // Sin techo en plata no hay nada contra qué proyectar, y sin días cerrados no
  // hay ritmo: el día 1 del mes, cualquier proyección sería inventada.
  if (!esPeriodoEnCurso || usdBudget === UNLIMITED || usdBudget <= 0 || cerrados.length === 0) {
    return { ...base, projectedUsd: null, exhaustionDay: null, willExhaust: null, basis: null }
  }

  const ritmo = Math.max(promedioDelMes, promedioReciente)
  const basis = promedioReciente >= promedioDelMes ? 'recent' : 'month'

  const diasQueFaltan = diasDelMes - diasCompletos
  const proyectado = spentUsd + ritmo * diasQueFaltan

  // El día en que el acumulado cruza el techo, si lo cruza dentro del mes.
  // Se resuelve con una división y no iterando día por día porque el ritmo es
  // constante por construcción: iterar daría el mismo número con más código.
  const loQueFalta = usdBudget - spentUsd
  const exhaustionDay =
    ritmo > 0 && loQueFalta >= 0 && Math.ceil(loQueFalta / ritmo) <= diasQueFaltan
      ? diasCompletos + Math.max(1, Math.ceil(loQueFalta / ritmo))
      : null

  return {
    ...base,
    projectedUsd: round(proyectado, 2),
    // Cuánto del techo se va a haber usado al cerrar el mes. Arriba de 100 es
    // la señal: el disyuntor va a cortar antes de que termine.
    projectedPercent: round((proyectado / usdBudget) * 100, 1),
    // null = a este ritmo no llega al techo este mes. Distinto de que falte el
    // dato para calcularlo, que es cuando todo el bloque viene en null.
    exhaustionDay,
    willExhaust: proyectado > usdBudget,
    // Con cuál de los dos ritmos se proyectó: el reciente avisa que algo cambió
    // esta semana, y es una información distinta de la proyección misma.
    basis,
  }
}

// ─── ANOMALÍAS ───────────────────────────────────────────────────────────────
//
// Todo lo demás compara contra un TECHO. Eso deja ciego el caso más común de
// desborde: un comercio chico que multiplica por cincuenta su consumo habitual
// y sigue lejísimos del techo, porque su techo estaba pensado para un comercio
// grande. No va a disparar ninguna alarma hasta que sea tarde, y para entonces
// se comió el presupuesto de todos.
//
// Lo que detecta esto es distinto: cada comercio contra SÍ MISMO. No importa
// cuánto gasta, importa cuánto cambió.

// Cuántos días de historia hacen falta antes de poder decir "esto es raro".
//
// Con menos, cualquier comercio nuevo aparecería como anomalía el día que
// empieza a usar el producto, que es exactamente lo que uno quiere que pase y
// no algo para alarmarse.
const MINIMO_DIAS_BASE = 3

// Cuánto tiene que multiplicar su propia costumbre para llamar la atención.
//
// TRES Y NO DOS. El consumo de una tienda tiene forma semanal: un lunes puede
// ser el doble de un domingo sin que pase nada raro. Duplicar generaría un
// aviso por semana y eso entrena a ignorarlos.
const FACTOR_ANOMALIA = 3

// Piso en plata, para que un múltiplo grande sobre nada no sea noticia.
//
// Sin esto, pasar de USD 0,001 a USD 0,01 son "diez veces más" y no significa
// nada. USD 0,25 en un día es, medido, unas 125 operaciones contra las ~5 que
// hace por día un comercio activo — y es el 15% de lo que la plataforma ENTERA
// puede gastar en un día con un techo de USD 50 al mes.
const PISO_ANOMALIA_USD = 0.25

/** La mediana, que es lo que hace que un solo pico no corrompa la base. */
const mediana = valores => {
  if (valores.length === 0) return 0

  const ordenados = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(ordenados.length / 2)

  return ordenados.length % 2 === 0
    ? (ordenados[medio - 1] + ordenados[medio]) / 2
    : ordenados[medio]
}

/**
 * Comercios que hoy están gastando muy por encima de SU propia costumbre.
 *
 * MEDIANA Y NO PROMEDIO. Un solo día desbocado dentro de la base levantaría el
 * promedio lo suficiente como para que el segundo día desbocado pareciera
 * normal — o sea que el mecanismo se desactivaría solo justo cuando empieza a
 * hacer falta. La mediana no se mueve por un valor extremo.
 *
 * SE COMPARA HOY, NO EL ÚLTIMO DÍA CERRADO. Un día de atraso puede ser todo el
 * presupuesto: el objetivo es enterarse mientras está pasando. La contra es que
 * a las 2 de la mañana el día lleva poco acumulado y no dispara nada — es un
 * falso negativo temprano, no un falso positivo, y esa es la dirección correcta
 * para equivocarse acá.
 *
 * @returns {Promise<Array>} ordenadas por cuánto se pasaron, la peor primero
 */
export const getSpendAnomalies = async (period, { now = new Date() } = {}) => {
  // Solo tiene sentido sobre el mes en curso: sobre uno cerrado no hay nada que
  // hacer con el dato.
  if (period !== getCurrentPeriod()) return []

  const hoy = now.getUTCDate()
  if (hoy <= MINIMO_DIAS_BASE) return []

  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }
  const conSigno = campo => ({ $cond: [esDevolucion, { $multiply: [campo, -1] }, campo] })

  const filas = await AiConsumptionLedger.aggregate([
    {
      $match: {
        period,
        event: { $in: [LEDGER_EVENT.CONSUMED, LEDGER_EVENT.REFUNDED] },
      },
    },
    {
      $group: {
        _id: {
          tenantId: '$tenantId',
          day: { $dayOfMonth: { date: '$createdAt', timezone: 'UTC' } },
        },
        costUsd: { $sum: conSigno({ $ifNull: ['$costUsd', 0] }) },
        operations: { $sum: conSigno(1) },
      },
    },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  // Por comercio: los días cerrados son la base, hoy es lo que se compara.
  const porComercio = new Map()

  for (const fila of filas) {
    const tenantId = String(fila._id.tenantId)
    const entrada = porComercio.get(tenantId) || { base: [], hoy: null }

    if (fila._id.day === hoy) {
      entrada.hoy = { costUsd: fila.costUsd || 0, operations: fila.operations || 0 }
    } else if (fila._id.day < hoy) {
      entrada.base.push(fila.costUsd || 0)
    }

    porComercio.set(tenantId, entrada)
  }

  const sospechosos = []

  for (const [tenantId, { base, hoy: consumoDeHoy }] of porComercio) {
    if (!consumoDeHoy || base.length < MINIMO_DIAS_BASE) continue
    if (consumoDeHoy.costUsd < PISO_ANOMALIA_USD) continue

    const habitual = mediana(base)

    // Un comercio que nunca gastó nada y hoy gasta: la división no sirve, pero
    // el caso es real y hay que reportarlo. Se informa el múltiplo en null, que
    // es distinto de "no se pasó".
    const factor = habitual > 0 ? consumoDeHoy.costUsd / habitual : null

    if (factor !== null && factor < FACTOR_ANOMALIA) continue

    sospechosos.push({
      tenantId,
      todayUsd: round(consumoDeHoy.costUsd, 4),
      todayOperations: consumoDeHoy.operations,
      typicalUsd: round(habitual, 4),
      // null = arrancó de cero, no hay múltiplo que calcular.
      factor: factor === null ? null : round(factor, 1),
      baselineDays: base.length,
    })
  }

  if (sospechosos.length === 0) return []

  // La peor primero. Las que arrancan de cero van arriba de todo: no tienen
  // múltiplo con qué ordenarse y son, por definición, un cambio total. Se
  // comparan por separado y no con un Infinity de relleno, porque dos null
  // darían Infinity − Infinity = NaN y un comparador que devuelve NaN deja el
  // orden indefinido.
  sospechosos.sort((a, b) => {
    if (a.factor === null && b.factor === null) return b.todayUsd - a.todayUsd
    if (a.factor === null) return -1
    if (b.factor === null) return 1
    return b.factor - a.factor
  })

  // El nombre del comercio: sin él la lista es de ObjectId y no se puede actuar
  // sobre ella. Una consulta para todos y no una por fila.
  const tenants = await Tenant.find({ _id: { $in: sospechosos.map(s => s.tenantId) } })
    .select('name hostname')
    .setOptions({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })
    .lean()

  const porId = new Map(tenants.map(t => [String(t._id), t]))

  return sospechosos.map(s => ({
    ...s,
    name: porId.get(s.tenantId)?.name || porId.get(s.tenantId)?.hostname || '(comercio eliminado)',
  }))
}

export const getPlatformSpendSnapshot = async (period = getCurrentPeriod()) => {
  const budget = getPlatformMonthlyTokenBudget()
  const usdBudget = getPlatformMonthlyUsdBudget()

  const [
    usage,
    byMetric,
    byModel,
    quality,
    byKeySource,
    byTenant,
    daily,
    anomalies,
    settingHistory,
    reconciliation,
  ] =
    await Promise.all([
      AiPlatformUsage.findOne({ period }).lean(),
      getPeriodSpendByMetric(period),
      getPeriodSpendByModel(period),
      getPeriodQuality(period),
      getSpendByKeySource(period),
      getPeriodSpendByTenant(period),
      getPeriodDailySpend(period),
      // No tumba el reporte si falla: es una señal adicional, y perderla no
      // puede dejar sin pantalla a quien necesita ver el gasto.
      getSpendAnomalies(period).catch(error => {
        logger.warn('[AI ANOMALÍAS] No se pudieron calcular', {
          period,
          error: error.message,
        })
        return []
      }),
      getPlatformAiSettingHistory(10).catch(() => []),
      // La diferencia entre el contador y el libro, SIN corregir. Va acá y no
      // en un script que alguien tiene que acordarse de correr: una
      // reconciliación que nadie mira es código muerto, y este contador es el
      // que decide si el disyuntor corta la IA de todos los comercios.
      //
      // Nunca escribe desde esta lectura. Corregir un agregado como efecto
      // secundario de abrir una pantalla es la clase de sorpresa que uno no
      // quiere en el camino de la plata: el reporte muestra, la corrección se
      // pide.
      rebuildPlatformProjection({ period }).catch(error => {
        logger.warn('[AI RECONCILE] No se pudo calcular la diferencia', {
          period,
          error: error.message,
        })
        return null
      }),
    ])

  const tokens = Number(usage?.tokens || 0)
  const hasBudget = budget !== UNLIMITED

  // Lo gastado Y lo comprometido: el pronóstico tiene que partir del mismo
  // número contra el que corta el disyuntor, o diría que hay margen donde el
  // medidor ya está cortando.
  const gastadoUsd =
    Number(usage?.estimatedCostUsd || 0) + Number(usage?.reservedCostUsd || 0)

  // El porcentaje del techo que esté MÁS CERCA de cortar — el mismo criterio
  // que usa el medidor para decidir el escalón, y el mismo que usa el aviso por
  // email. Con los dos techos puestos, mirar solo el de tokens deja pasar el
  // caso en que la cadena de respaldo entrega un modelo cinco veces más caro:
  // el gasto va por el 90% y el volumen por el 30%.
  const percentPeorTecho = Math.max(
    usdBudget !== UNLIMITED && usdBudget > 0 ? (gastadoUsd / usdBudget) * 100 : 0,
    hasBudget && budget > 0 ? (tokens / budget) * 100 : 0,
  )

  const forecast = buildForecast({
    period,
    daily,
    spentUsd: gastadoUsd,
    usdBudget,
  })

  return {
    period,
    budget: {
      // null y no 0: "sin disyuntor configurado" es una situación distinta de
      // "el techo es cero", y la pantalla las tiene que mostrar distinto.
      tokens: hasBudget ? budget : null,
      configured: hasBudget,
      // De dónde sale el valor vigente: 'panel' si lo cambió alguien desde acá,
      // 'env' si manda la variable de entorno, 'none' si no hay techo. Se
      // informa porque un override que gana en silencio sobre la variable
      // convierte "ya lo cambié en Render y no pasa nada" en un misterio.
      source: getPlatformBudgetSource(),
      // Los avisos viven en el mismo objeto que el techo porque se leen juntos:
      // un 47% no dice nada sin saber que el próximo escalón es 50.
      alertedThreshold: Number(usage?.alertedThreshold || 0),
      // El techo en PLATA, que es lo que HENKO paga. Va al lado del de tokens
      // y no en lugar de él: miden cosas distintas, y la pantalla tiene que
      // poder mostrar que el gasto va por el 90% mientras el volumen va por el
      // 30% — que es exactamente lo que pasa cuando la cadena de respaldo
      // entrega un modelo cinco veces más caro.
      usd: usdBudget === UNLIMITED ? null : usdBudget,
      usdConfigured: usdBudget !== UNLIMITED,
      usdSource: getPlatformUsdBudgetSource(),

      // Que fraccion del techo puede llevarse UN comercio.
      //
      // Va en el mismo objeto que los dos techos porque es el tercer freno y
      // se decide junto con ellos: subir el techo global sin mirar el reparto
      // le da mas margen a todos por igual, incluido el que se estaba
      // comiendo el presupuesto.
      //
      // Hasta ahora solo existia como variable de entorno y no se veia en
      // ningun lado, asi que era un limite que cortaba sin que nadie supiera
      // que estaba puesto.
      perTenantShare: getPerTenantShare(),
    },
    consumption: {
      tokens,
      percentUsed: hasBudget && budget > 0 ? round((tokens / budget) * 100, 1) : null,
      remainingTokens: hasBudget ? Math.max(0, budget - tokens) : null,
      // El costo del contador de plataforma, que es el que HENKO paga.
      estimatedCostUsd: round(usage?.estimatedCostUsd || 0, 2),
      // Plata comprometida por operaciones en vuelo, todavía sin liquidar. El
      // techo mira la SUMA de las dos; la auditoría contable, solo la gastada.
      reservedCostUsd: round(usage?.reservedCostUsd || 0, 2),
      percentUsdUsed:
        usdBudget !== UNLIMITED && usdBudget > 0
          ? round(
            ((Number(usage?.estimatedCostUsd || 0) +
                Number(usage?.reservedCostUsd || 0)) /
                usdBudget) *
                100,
            1,
          )
          : null,
      lastActivityAt: usage?.lastActivityAt || null,
    },
    breaker: {
      trippedAt: usage?.breakerTrippedAt || null,
      tripped: Boolean(usage?.breakerTrippedAt),
      // 'tokens' o 'usd'. La acción es distinta: si cortó la plata hay que
      // decidir si se gasta más; si cortó el volumen, hay que buscar qué está
      // consumiendo de más.
      reason: usage?.breakerReason || null,
    },
    // Hacia dónde va el mes. Es lo único de esta pantalla que mira adelante:
    // todo lo demás dice cuánto se gastó, y para cuando eso alarma, ya se
    // gastó.
    forecast,
    // Comercios que hoy están gastando muy por encima de SU propia costumbre.
    // Es la única señal que no compara contra un techo: un comercio chico puede
    // multiplicar por cincuenta su consumo y seguir lejísimos del suyo.
    anomalies,
    // En qué escalón de servicio está la plataforma AHORA, y dónde empieza cada
    // uno. Se deriva del mismo porcentaje que ya está en `consumption` y no de
    // una segunda medición: dos números que tendrían que coincidir y se
    // calculan por caminos distintos terminan no coincidiendo.
    //
    // Los umbrales viajan con el nivel porque sin ellos "modo economía" es una
    // etiqueta sin referencia: lo que hace falta saber es a cuánto está del
    // siguiente escalón.
    degradation: {
      level: degradationLevelFor(percentPeorTecho),
      percentUsed: round(percentPeorTecho, 1),
      economyAt: DEGRADATION_ECONOMY_PERCENT,
      essentialAt: DEGRADATION_ESSENTIAL_PERCENT,
    },
    // null cuando no se pudo calcular: es distinto de "no hay diferencia", y
    // la pantalla lo tiene que poder distinguir.
    reconciliation,
    byMetric,
    byModel,
    quality,
    // QUIEN PAGA, QUE NO ES LO MISMO QUE CUANTO SE CONSUME.
    //
    //   platformCostUsd        lo que paga HENKO
    //   tenantProviderCostUsd  lo que el proveedor le cobro a la key usada
    //
    // Con key de plataforma coinciden. Con key del comercio el primero es cero
    // y el segundo no, y antes ese segundo no se calculaba: el consumo BYOK
    // entraba al libro con costo cero y ahi moria. El comercio no sabia cuanto
    // gastaba y HENKO no sabia cuanto le estaba ahorrando esa key.
    byKeySource,
    // QUIÉN se lo gastó.
    //
    // Es la vista que convierte un total en algo sobre lo que se puede actuar.
    // Todo el resto del reporte es agregado —por métrica, por modelo, por
    // calidad, por origen de key— y ninguna de esas vistas contesta la
    // pregunta que uno se hace cuando el disyuntor corta: quién fue.
    //
    // Con un comercio, el agregado y el detalle son el mismo número. Con diez,
    // un techo compartido sin saber quién lo consume solo permite castigar a
    // todos por igual.
    byTenant,
    // Quién movió el techo, cuándo y por qué. Va en el mismo reporte porque un
    // salto en el consumo y un cambio de límite se leen juntos o no se leen.
    settingHistory,
  }
}

export default {
  getPeriodSpendByMetric,
  getPeriodSpendByModel,
  getPeriodQuality,
  getPeriodSpendByTenant,
  getPlatformSpendSnapshot,
}
