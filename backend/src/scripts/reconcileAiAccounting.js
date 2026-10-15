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
import {
  auditAccounting,
  rebuildPlatformProjection,
  backfillLedgerFromProviderCalls,
} from '../services/ai/aiAccountingService.js'
import { getCurrentPeriod, isValidPeriod } from '../services/ai/aiPeriod.js'

const leerPeriodo = () => {
  const arg = process.argv.find(a => a.startsWith('--periodo='))
  const valor = arg?.split('=')[1]?.trim()

  if (!valor) return getCurrentPeriod()

  // Un período inválido se rechaza en vez de caer al mes actual en silencio:
  // corregir el contador del mes equivocado es peor que no corregir nada.
  if (!isValidPeriod(valor)) {
    throw new Error(`--periodo="${valor}" no es un período válido. Se espera YYYY-MM.`)
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

  if (auditoria.balanced) {
    logger.info('[RECONCILIAR IA] Las cuentas cuadran: no hay nada que corregir', { period })
    await mongoose.disconnect()
    return
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
  const relleno = await backfillLedgerFromProviderCalls({ period }).catch(error => {
    logger.warn('[RECONCILIAR IA] No se pudo verificar si el libro está completo', {
      error: error.message,
    })
    return null
  })

  const faltanFilas = Number(relleno?.missing?.length || 0)

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

  // ── 3. Qué cambiaría ───────────────────────────────────────────────────
  const informe = await rebuildPlatformProjection({ period, apply: applyChanges })

  if (!informe.hasDrift) {
    logger.info('[RECONCILIAR IA] El contador de plataforma ya coincide con el libro', { period })
    await mongoose.disconnect()
    return
  }

  logger.info('[RECONCILIAR IA] Diferencia del contador de plataforma', {
    period,
    tokens: informe.tokens,
    costo: informe.cost,
  })

  if (!applyChanges) {
    logger.warn('[RECONCILIAR IA] Simulación: no se escribió nada', {
      period,
      quedaria: { tokens: informe.tokens.ledger, costUsd: informe.cost.ledger },
      paraAplicar: 'volvé a correrlo con --apply',
    })

    await mongoose.disconnect()
    return
  }

  // Nivel warn y no info: se acaba de reescribir el contador con el que corta
  // el disyuntor. Es el renglón que alguien va a buscar dentro de tres meses
  // para entender por qué el número saltó.
  logger.warn('[RECONCILIAR IA] Contador de plataforma corregido desde el libro', {
    period,
    antes: { tokens: informe.tokens.stored, costUsd: informe.cost.stored },
    ahora: { tokens: informe.tokens.ledger, costUsd: informe.cost.ledger },
    nota: 'El libro no se tocó. Sólo se reescribió el agregado que se deriva de él.',
  })

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
