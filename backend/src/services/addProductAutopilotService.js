// 📁 src/services/addProductAutopilotService.js
//
// Este es el módulo "AddProduct" del lado del servidor: acá, y solo acá,
// es donde la IA analiza la imagen y arma la información completa del
// producto (título, precio, categoría, atributos, variantes, ficha
// técnica, SEO, logística).
//
// El agente (la cola en productAnalysisController.js) NO analiza nada por
// su cuenta — su único trabajo es vigilar la hora programada de cada job
// y, apenas se cumple el plazo, "enviar" ese job acá. Este servicio es el
// que arranca el análisis IA de forma automática, sin esperar a que haya
// un administrador con AddProduct abierto en el navegador.
//
// Importante: este módulo NO crea el producto en la base de datos. Deja
// el job en estado "completed" con el análisis completo adjunto, listo
// para que un humano lo apruebe desde el panel — recién ahí
// (approveAnalysisJob en productAnalysisController.js) se crea el
// producto, usando ese mismo análisis rico para no perder variantes ni
// ficha técnica.

import ProductAnalysisJob from '../models/productAnalysisJobModel.js'
import { PRODUCT_ANALYSIS_JOB_STATUS as JOB_STATUS } from '../models/productAnalysisJobModel.js'
import logger from '../../config/logger.js'
import {
  sanitizeAnalysis,
  readJobImageBuffer,
  runVisualAnalysis,
} from '../controller/productAnalysisController.js'

/**
 * Punto de entrada del módulo AddProduct autónomo.
 *
 * Reclama el job (mismo patrón de lease que el resto de la cola para
 * evitar procesarlo dos veces) y corre el análisis visual completo con
 * la IA. Guarda tanto la versión resumida (job.analysis) como la cruda y
 * completa (job.analysisRaw, con variantes/ficha técnica/SEO/logística)
 * y deja el job en "completed", a la espera de que un humano lo apruebe.
 */
export const runAddProductAutopilot = async ({
  jobId,
  tenantId,
  file = null,
  originalFilename = '',
}) => {
  let job = await ProductAnalysisJob.findOneAndUpdate(
    {
      _id: jobId,
      tenantId,
      status: { $in: [JOB_STATUS.PENDING, JOB_STATUS.SCHEDULED, JOB_STATUS.FAILED] },
      $or: [
        { deletedAt: { $exists: false } },
        { deletedAt: null },
      ],
    },
    {
      $set: {
        status: JOB_STATUS.PROCESSING,
        startedAt: new Date(),
      },
      $unset: {
        error: 1,
        failedAt: 1,
      },
    },
    { new: true },
  )

  if (!job) {
    job = await ProductAnalysisJob.findOne({ _id: jobId, tenantId })
    if (!job) {
      throw new Error('Job de análisis no encontrado')
    }
    return job
  }

  try {
    let rawAnalysis

    if (file?.buffer) {
      rawAnalysis = await runVisualAnalysis({
        tenantId,
        file,
        originalFilename: originalFilename || job.originalFilename,
      })
    } else {
      const imageBuffer = await readJobImageBuffer(job)
      rawAnalysis = await runVisualAnalysis({
        tenantId,
        file: { buffer: imageBuffer, mimetype: job.metadata?.mimeType || 'image/jpeg' },
        originalFilename: originalFilename || job.originalFilename,
      })
    }

    if (!rawAnalysis || rawAnalysis.aiProcessed === false) {
      const error = new Error('El proveedor de IA no produjo un análisis válido')
      error.code = 'AI_ANALYSIS_FAILED'
      throw error
    }

    const analysis = sanitizeAnalysis(rawAnalysis)

    job.status = JOB_STATUS.COMPLETED
    job.analysis = analysis
    job.analysisRaw = rawAnalysis
    job.processedAt = new Date()
    job.failedAt = undefined
    job.error = undefined

    await job.save()

    logger.info('[AddProductAutopilot] Análisis completado automáticamente, esperando aprobación', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      confidence: analysis.confidence,
      hasVariants: Boolean(rawAnalysis?.hasVariants),
    })

    return job
  } catch (error) {
    job.status = JOB_STATUS.FAILED
    job.error = {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      code: error.code || 'ADD_PRODUCT_AUTOPILOT_FAILED',
      retryable: error.retryable === true,
    }
    job.failedAt = new Date()

    await job.save()

    logger.error('[AddProductAutopilot] Error analizando la imagen', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      error: error.message,
    })

    return job
  }
}
