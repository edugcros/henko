// 📁 src/scripts/reconcileAiAccounting.js
//
// Corrige el contador de gasto de IA de la plataforma desde el LIBRO, que es
// la fuente de verdad declarada.
//
// EL AGUJERO QUE CIERRA, Y NO ES UN BUG DE CÁLCULO
//
// `rebuildPlatformProjection({ apply: true })` existe desde que existe la
// reconciliación y hace exactamente esto. El problema es que NADA la invoca
// con `apply`: el reporte de gasto la llama siempre en modo lectura, y el
// ciclo automático sólo detecta y avisa. Es una decisión correcta —corregir
// un agregado como efecto secundario de abrir una pantalla es la clase de
// sorpresa que uno no quiere en el camino de la plata— pero dejaba el sistema
// detectando un descuadre cada hora, mandando un correo, y sin ninguna forma
// de arreglarlo.
//
// O sea: la capacidad estaba escrita y era inalcanzable. Esto es la puerta.
//
// EL CASO QUE LO PIDIÓ, MEDIDO
//
// Período 2026-10, el mismo informe el 13/10 a las 09:52 y el 15/10 a las
// 19:57, idéntico hasta la última cifra:
//
//   libro (sin BYOK)   0.236959
//   contador           0.042395   ← faltan 0.194564
//   reservado          0.050000   (no alcanza a explicarlo)
//
//   marketTokens · toolCalls   0.160000   11 filas   ← 82% de lo que falta
//   vision       · tokens      0.050496    7
//   agentTokens  · tokens      0.022101   14
//   marketTokens · tokens      0.004362    7
//
// Que los dos informes sean idénticos dice que el desvío NO se re-acumula:
// es deuda congelada. Con la salvedad de que en esas 58 horas tampoco hubo
// consumo nuevo —los conteos de filas no se movieron—, así que es evidencia
// a favor y no una prueba.
//
// POR QUÉ IMPORTA CORREGIRLO Y NO CONVIVIR CON EL AVISO
//
// Ese contador es el que mira el disyuntor. Mientras mida de menos, el corte
// por plata llega TARDE: con un techo configurado, el gasto real puede
// pasarlo mientras el medidor dice que queda margen. Hoy son centavos; el
// problema es la proporción, no el monto.
//
// Y un aviso que suena cada hora sin que nadie pueda hacer nada es la forma
// más rápida de que se deje de leer el aviso.
//
// Uso (sin --apply no escribe nada):
//   npm run reconcile:ai
//   npm run reconcile:ai -- --apply
//   npm run reconcile:ai:prod                 (informa contra producción)
//   npm run reconcile:ai:prod:apply
//   npm run reconcile:ai:prod -- --periodo=2026-09
//
// NO TOCA EL LIBRO. Sólo reescribe el agregado desde él. Si el libro
// estuviera incompleto, corregir contra él sería destruir el número bueno:
// por eso el script mira primero si faltan filas y se niega a aplicar.

import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import AiUsage from '../models/aiUsageModel.js'
import {
  auditAccounting,
  rebuildPlatformProjection,
  rebuildTenantProjection,
  backfillLedgerFromProviderCalls,
} from '../services/ai/aiAccountingService.js'
import { getCurrentPeriod, isValidPeriod } from '../services/ai/aiPeriod.js'

/**
 * El período a corregir. Sin la bandera, el mes en curso.
 *
 * SE DISTINGUE «NO LA PASÓ» DE «LA PASÓ MAL», Y NO ES UNA SUTILEZA
 *
 * Antes esto miraba sólo el valor: `--periodo=` daba cadena vacía y caía al
 * mes actual, y `--periodo=2026-09=extra` se truncaba a un `2026-09`
 * perfectamente válido. En una invocación con --apply armada desde una
 * variable de shell que quedó vacía, eso reescribe el contador del MES EN
 * CURSO creyendo que corrige uno cerrado — el error más caro que puede
 * cometer este script, y en silencio.
 *
 * Ahora la presencia de la bandera y la validez del valor se comprueban por
 * separado: si la pasaste, tiene que estar bien.
 */
const leerPeriodo = () => {
  const arg = process.argv.find(a => a === '--periodo' || a.startsWith('--periodo='))

  if (!arg) return getCurrentPeriod()

  // Se corta en el PRIMER '=' y se conserva el resto tal cual, para que
  // '2026-09=extra' llegue entero a la validación y la falle, en vez de
  // perder la cola y pasar.
  const valor = arg.slice('--periodo='.length).trim()

  if (!isValidPeriod(valor)) {
    throw new Error(
      `--periodo="${valor}" no es un período válido. Se espera YYYY-MM, por ejemplo 2026-09.`,
    )
  }

  return valor
}

const run = async () => {
  const period = leerPeriodo()
  const applyChanges = process.argv.includes('--apply')

  await connectDB()

  // ── 1. La foto completa, antes de tocar nada ───────────────────────────
  const auditoria = await auditAccounting(period)

  logger.info('[RECONCILIAR IA] Estado del período', {
    period,
    ...auditoria.cost,
    findings: auditoria.findings,
  })

  // El desglose por función va aparte y en renglones: es lo que permite ver
  // de dónde sale la diferencia, y aplastarlo dentro del objeto de arriba lo
  // volvería ilegible.
  auditoria.ledgerByMetric
    .filter(fila => fila.costUsd !== 0)
    .forEach(fila => {
      logger.info(
        `[RECONCILIAR IA]   ${fila.metric} · ${fila.unit}: ${fila.costUsd} USD (${fila.rows} filas)`,
      )
    })

  /**
   * EL DESVÍO DE TOKENS NO ENTRA EN `balanced`, Y HAY UN DISYUNTOR QUE LO MIRA.
   *
   * `auditAccounting` compara PLATA: los tres totales en dólares. Si una
   * escritura parcial dejó mal el contador de TOKENS pero el de dólares
   * coincide, `balanced` da true — y salir acá dejaría el techo de volumen
   * mal contado sin que nada vuelva a mirarlo.
   *
   * Por eso se le pregunta además a la reconciliación en modo lectura, que sí
   * compara las dos magnitudes. Dos preguntas distintas, las dos antes de
   * decidir que no hay nada que hacer.
   */
  const previo = await rebuildPlatformProjection({ period })

  /**
   * NO SE SALE TEMPRANO AUNQUE LAS DOS PRIMERAS PREGUNTAS DEN BIEN.
   *
   * Hay una tercera clase de desvío que ninguna de las dos ve: un contador de
   * CUOTA de un comercio —`counters.agentMessages`, por ejemplo— puede estar
   * mal sin que cambie ningún total en dólares ni los tokens de plataforma.
   * La auditoría da `balanced`, la reconciliación de plataforma no ve desvío,
   * y el comercio queda con cupo de más o denegado de menos.
   *
   * Así que el recorrido por comercio corre SIEMPRE y la conclusión de «no
   * hay nada que corregir» se saca al final, cuando ya se preguntaron las
   * tres cosas.
   */
  if (auditoria.balanced && !previo.hasDrift) {
    logger.info('[RECONCILIAR IA] Plata y plataforma cuadran; falta revisar por comercio', {
      period,
    })
  }

  if (auditoria.balanced && previo.hasDrift) {
    logger.warn('[RECONCILIAR IA] La plata cuadra pero el contador de TOKENS no', {
      period,
      tokens: previo.tokens,
      nota: 'El techo de volumen se mide con este número.',
    })
  }

  // ── 2. ¿El libro está completo? ────────────────────────────────────────
  //
  // ESTA GUARDA ES EL MOTIVO POR EL QUE ESTO ES UN SCRIPT Y NO UN BOTÓN.
  //
  // Corregir el contador contra el libro sólo tiene sentido si el libro está
  // entero. writeLedgerEntry escribe sin esperar y se traga los errores que
  // no son clave repetida —deliberado: la contabilidad no puede ser el motivo
  // por el que un comercio se quede sin IA—, así que una fila puede faltar.
  // Reescribir el agregado desde un libro incompleto no arregla el desvío:
  // reemplaza el número bueno por uno más chico y borra la evidencia.
  //
  // Y SI LA VERIFICACIÓN FALLA, FALLA CERRADO.
  //
  // Esto devolvía `null` ante un error y seguía de largo: `faltanFilas`
  // quedaba en cero y `--apply` atravesaba la guarda. O sea que el único
  // control que impide reescribir el contador desde un libro incompleto se
  // desactivaba justo cuando no se podía saber si el libro estaba completo —
  // una caída transitoria de Mongo alcanzaba. «No sé» no es «está todo bien».
  const relleno = await backfillLedgerFromProviderCalls({ period }).catch(error => {
    logger.error('[RECONCILIAR IA] No se pudo verificar si el libro está completo: NO se corrige', {
      period,
      error: error.message,
      queHacer:
        'Sin esa verificación no se puede saber si el libro está entero, y corregir contra uno ' +
        'incompleto destruye el número bueno. Probá de nuevo cuando la base responda.',
    })

    return null
  })

  if (!relleno) {
    await mongoose.disconnect()
    process.exitCode = 1
    return
  }

  const faltanFilas = Number(relleno.missing?.length || 0)

  if (faltanFilas > 0) {
    logger.error('[RECONCILIAR IA] El libro está incompleto: NO se corrige', {
      period,
      faltantes: faltanFilas,
      operaciones: relleno.missing.slice(0, 20).map(m => m.operationId),
      queHacer:
        'Reponé primero las filas con backfillLedgerFromProviderCalls({ period, apply: true }) ' +
        'y volvé a correr esto. Corregir contra un libro incompleto destruye el número bueno.',
    })

    await mongoose.disconnect()
    process.exitCode = 1
    return
  }

  // ── 3. El contador de PLATAFORMA ──────────────────────────────────────
  const informe = await rebuildPlatformProjection({ period, apply: applyChanges })

  if (!informe.hasDrift) {
    logger.info('[RECONCILIAR IA] El contador de plataforma ya coincide con el libro', { period })
  } else {
    logger.info('[RECONCILIAR IA] Diferencia del contador de plataforma', {
      period,
      tokens: informe.tokens,
      costo: informe.cost,
    })

    if (applyChanges) {
      // Nivel warn y no info: se acaba de reescribir el contador con el que
      // corta el disyuntor. Es el renglón que alguien va a buscar dentro de
      // tres meses para entender por qué el número saltó.
      logger.warn('[RECONCILIAR IA] Contador de plataforma corregido desde el libro', {
        period,
        antes: { tokens: informe.tokens.stored, costUsd: informe.cost.stored },
        ahora: { tokens: informe.tokens.ledger, costUsd: informe.cost.ledger },
        nota: 'El libro no se tocó. Sólo se reescribió el agregado que se deriva de él.',
      })
    }
  }

  // ── 4. Los contadores POR COMERCIO ────────────────────────────────────
  //
  // SON DOS AGREGADOS DISTINTOS Y DECIDEN COSAS DISTINTAS.
  //
  // El de plataforma decide si se corta la IA de TODOS. El del comercio
  // decide el cupo de UNO —y alimenta la columna de margen—, así que uno
  // desviado hacia abajo le regala consumo a ese comercio y hace parecer que
  // cuesta menos de lo que cuesta.
  //
  // Corregir sólo el primero dejaba al script diciendo «se corrigió y aún no
  // cuadra» sin poder hacer nada al respecto, que es la misma mitad de
  // herramienta que este script vino a completar.
  //
  // Se recorren los comercios QUE TIENEN CONTADOR del período y no la lista
  // entera de comercios: los que nunca consumieron no tienen nada que
  // reconciliar, y con miles de tiendas la diferencia es el tiempo de la
  // corrida.
  const comercios = await AiUsage.find({ period })
    .select('tenantId')
    .setOptions({ ignoreTenant: true, platformScope: 'platform:reconciliacion-ia' })
    .lean()

  const desviados = []

  for (const { tenantId } of comercios) {
    const porComercio = await rebuildTenantProjection({
      tenantId: String(tenantId),
      period,
      apply: applyChanges,
    })

    if (!porComercio.hasDrift) continue

    desviados.push(porComercio)

    // El libro incompleto de UN comercio no frena a los demás: cada contador
    // es independiente, y negarse a corregir los sanos porque a uno le faltan
    // filas sería castigar a todos por el estado de uno.
    if (!porComercio.ledgerComplete) {
      logger.error('[RECONCILIAR IA] Comercio con el libro incompleto: NO se corrigió', {
        tenantId: String(tenantId),
        period,
        faltan: porComercio.missingFromLedger.length,
      })
      process.exitCode = 1
      continue
    }

    logger.info(
      `[RECONCILIAR IA]   comercio ${tenantId}: costo ${porComercio.cost.drift} USD · ` +
        `contadores ${
          Object.entries(porComercio.counters)
            .filter(([, v]) => v.drift !== 0)
            .map(([k, v]) => `${k} ${v.drift > 0 ? '+' : ''}${v.drift}`)
            .join(', ') || 'sin desvío'
        }`,
    )
  }

  logger.info('[RECONCILIAR IA] Contadores por comercio', {
    period,
    revisados: comercios.length,
    desviados: desviados.length,
    corregidos: applyChanges ? desviados.filter(d => d.applied).length : 0,
  })

  // Comercios VIVOS a los que les falta el contador entero: no son huérfanos
  // —ésos ya no existen— sino una escritura de AiUsage que se perdió. El
  // recorrido de arriba no los alcanza, justamente porque no tienen
  // documento que recorrer.
  if (auditoria.cost.missingCounterTenants?.length) {
    logger.error('[RECONCILIAR IA] Comercios activos SIN contador en el período', {
      period,
      comercios: auditoria.cost.missingCounterTenants,
      queHacer:
        'Tienen filas en el libro y ningún AiUsage. Se repara con ' +
        'rebuildTenantProjection({ tenantId, period, apply: true }), que lo crea desde el libro.',
    })
    process.exitCode = 1
  }

  if (auditoria.balanced && !previo.hasDrift && desviados.length === 0) {
    logger.info('[RECONCILIAR IA] Las cuentas cuadran: no hay nada que corregir', { period })
  }

  if (!applyChanges) {
    logger.warn('[RECONCILIAR IA] Simulación: no se escribió nada', {
      period,
      plataformaQuedaria: informe.hasDrift
        ? { tokens: informe.tokens.ledger, costUsd: informe.cost.ledger }
        : 'sin cambios',
      comerciosACorregir: desviados.length,
      paraAplicar: 'volvé a correrlo con --apply',
    })

    await mongoose.disconnect()
    return
  }

  if (!informe.hasDrift && desviados.length === 0) {
    await mongoose.disconnect()
    return
  }

  // La verificación va acá y no en la confianza de que el update anduvo: si
  // después de corregir el informe sigue sin cuadrar, hay algo más que este
  // script no arregla y conviene enterarse ahora y no en el próximo aviso.
  const despues = await auditAccounting(period)

  if (despues.balanced) {
    logger.info('[RECONCILIAR IA] Verificado: las cuentas cuadran', { period })
  } else {
    // QUÉ HACER, NO "MIRÁ LOS FINDINGS".
    //
    // Este script corrige UN agregado: el contador de plataforma. Si después
    // de corregirlo sigue habiendo diferencia, es del otro —el de cada
    // comercio—, y ése se repara con rebuildTenantProjection, que es por
    // comercio y no global. Decir "mirá los findings" deja a quien lo corre
    // exactamente donde estaba.
    const quedaPorComercio = despues.findings.some(f => f.between.includes('tenantUsage'))

    logger.error('[RECONCILIAR IA] Se corrigió y AÚN NO cuadra', {
      period,
      ...despues.cost,
      findings: despues.findings,
      queHacer: quedaPorComercio
        ? 'La diferencia que queda es del agregado POR COMERCIO, no del de plataforma. ' +
          'Ese se repara con rebuildTenantProjection({ tenantId, period, apply: true }), ' +
          'comercio por comercio.'
        : 'La diferencia que queda no es de ninguno de los dos agregados: revisá el libro.',
    })
    process.exitCode = 1
  }

  await mongoose.disconnect()
}

run().catch(async error => {
  logger.error('[RECONCILIAR IA] Falló', { error: error.message })
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
