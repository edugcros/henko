// 📁 src/services/AddProductAutopilotService.js
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
// Autoguardado (opcional, se define en ProductAnalysisPage al programar
// la imagen — metadata.autoSaveProduct):
// - true  → además de analizar, crea el producto ya mismo (como borrador,
//           o publicado si autoPublishProduct y la confianza alcanza el
//           umbral configurado) — exactamente como si el dueño hubiera
//           soltado la imagen en AddProduct y apretado guardar.
// - false → analiza y deja el job en "completed" con el análisis
//           adjunto, esperando que un humano lo apruebe desde el panel.

import ProductAnalysisJob from '../models/productAnalysisJobModel.js'
import { PRODUCT_ANALYSIS_JOB_STATUS as JOB_STATUS } from '../models/productAnalysisJobModel.js'
import Product from '../models/productModel.js'
import logger from '../../config/logger.js'
import { buildAutonomousProductPayload } from './autonomousProductBuilder.js'
import {
  sanitizeAnalysis,
  readJobImageBuffer,
  runVisualAnalysis,
  canAutoPublishAnalysis,
  markJobAsHidden,
  AUTO_PUBLISH_MIN_CONFIDENCE,
} from '../controller/productAnalysisController.js'

/**
 * Punto de entrada del módulo AddProduct autónomo.
 *
 * Reclama el job (mismo patrón de lease que el resto de la cola para
 * evitar procesarlo dos veces), corre el análisis visual completo con la
 * IA, y según metadata.autoSaveProduct, o bien crea el producto ya mismo
 * o bien deja el análisis listo para aprobación humana.
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

    job.analysis = analysis
    job.analysisRaw = rawAnalysis
    job.processedAt = new Date()
    job.failedAt = undefined
    job.error = undefined

    const shouldAutoSave = job.metadata?.autoSaveProduct === true

    if (!shouldAutoSave) {
      job.status = JOB_STATUS.COMPLETED
      await job.save()

      logger.info('[AddProductAutopilot] Análisis completado automáticamente, esperando aprobación', {
        tenantId: tenantId.toString(),
        jobId: job._id.toString(),
        confidence: analysis.confidence,
        hasVariants: Boolean(rawAnalysis?.hasVariants),
      })

      return job
    }

    const productPayload = buildAutonomousProductPayload({
      analysis: rawAnalysis,
      job,
      tenantId,
    })

    const mergedAnalysis = { ...rawAnalysis, ...analysis }
    const publish = job.autoPublishProduct && canAutoPublishAnalysis(mergedAnalysis)

    if (job.autoPublishProduct && !publish) {
      logger.warn('[AddProductAutopilot] Auto-publicación bloqueada por calidad insuficiente', {
        tenantId: tenantId.toString(),
        jobId: job._id.toString(),
        confidence: analysis.confidence,
        minimumConfidence: AUTO_PUBLISH_MIN_CONFIDENCE,
      })
    }

    if (publish) {
      productPayload.status = 'active'
      productPayload.visibility = 'visible'
      productPayload.aiNeedsReview = false
    }

    const product = await Product.create(productPayload)

    job.status = JOB_STATUS.APPROVED
    job.createdProductId = product._id
    job.approvedAt = new Date()
    job.approvedBy = null

    markJobAsHidden({
      job,
      userId: null,
      reason: publish
        ? 'Producto auto-publicado por AddProduct (autoguardado, sin intervención humana).'
        : 'Producto auto-creado como borrador por AddProduct (autoguardado, sin intervención humana).',
    })

    await job.save()

    logger.info('[AddProductAutopilot] Producto autoguardado de forma 100% autónoma', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      productId: product._id.toString(),
      published: publish,
      hasVariants: productPayload.hasVariants,
      confidence: analysis.confidence,
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

    logger.error('[AddProductAutopilot] Error en el pipeline de AddProduct', {
      tenantId: tenantId.toString(),
      jobId: job._id.toString(),
      error: error.message,
    })

    return job
  }
}
