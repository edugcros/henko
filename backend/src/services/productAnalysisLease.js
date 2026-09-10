// 📁 src/services/productAnalysisLease.js
//
// Los filtros que deciden qué job de análisis se puede tomar.
//
// Viven acá y no dentro de productAnalysisController porque ese archivo tiene
// más de dos mil líneas y arrastra Cloudinary, el servicio de visión y medio
// backend al importarlo: la regla que decide si HENKO le paga a Google dos
// veces la misma imagen no puede ser intesteable por el peso de sus vecinos.
//
// EL PERMISO
//
// El modelo declaraba `processingLeaseExpiresAt` y un índice compuesto para
// usarlo desde hacía tiempo, y no lo escribía ni lo leía nadie. La consecuencia
// era concreta: un proceso que muere entre reclamar el job y terminarlo dejaba
// el job en PROCESSING para siempre, porque el barrido solo miraba SCHEDULED.
// En el plan free de Render, que apaga el servicio por inactividad, eso no es
// hipotético.
//
// El patrón está copiado de aiCartRecoveryWorkerService, que ya lo tenía
// resuelto para los mensajes de recuperación de carrito.

/** Cuánto vale un permiso antes de que se asuma que quien lo tomó ya no está. */
export const getProcessingLeaseMs = () =>
  Math.max(60_000, Number(process.env.PRODUCT_ANALYSIS_LEASE_MS) || 10 * 60_000)

const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  FAILED: 'failed',
})

const notDeleted = [
  { deletedAt: { $exists: false } },
  { deletedAt: null },
]

/**
 * Filtro para RECLAMAR un job concreto.
 *
 * Se usa dentro de un findOneAndUpdate, así que el reclamo es atómico: entre
 * varias instancias mirando el mismo job, gana una sola y el resto no llega a
 * llamar al proveedor.
 *
 * Incluye los que quedaron en PROCESSING con el permiso vencido. Volver a
 * tomarlos implica volver a reservar cuota — la reserva de la corrida que murió
 * no se recupera, porque el catch que la devuelve nunca corrió. Cerrar eso es
 * trabajo de la idempotencia; acá lo que se resuelve es que el job no quede
 * trabado.
 */
export const buildClaimFilter = ({ jobId, tenantId, now = new Date() }) => ({
  _id: jobId,
  tenantId,
  $or: [
    {
      status: {
        $in: [JOB_STATUS.PENDING, JOB_STATUS.SCHEDULED, JOB_STATUS.FAILED],
      },
    },
    {
      status: JOB_STATUS.PROCESSING,
      processingLeaseExpiresAt: { $lte: now },
    },
  ],
  $and: [{ $or: notDeleted }],
})

/**
 * Filtro para BUSCAR los jobs que le toca correr al barrido.
 *
 * Trae de más a propósito: el reclamo de arriba es el que decide, así que dos
 * instancias que seleccionen el mismo job no duplican trabajo — la que pierde
 * se retira sin gastar. Sin la segunda rama, un job trabado no volvía nunca.
 */
export const buildDueFilter = ({ tenantId = null, now = new Date() } = {}) => ({
  ...(tenantId ? { tenantId } : {}),
  $or: [
    { status: JOB_STATUS.SCHEDULED, scheduledAt: { $lte: now } },
    {
      status: JOB_STATUS.PROCESSING,
      processingLeaseExpiresAt: { $lte: now },
    },
  ],
  $and: [{ $or: notDeleted }],
})

export default { buildClaimFilter, buildDueFilter, getProcessingLeaseMs }
