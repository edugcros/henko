// 📁 src/services/jobAnalysisService.js
//
// Interfaz pública para que AddProduct acceda a jobs encolados
// y mantenga sincronización con ProductAnalysisPage
//
// RESPONSABILIDADES:
//   • Recuperar jobs encolados
//   • Obtener análisis guardados
//   • Actualizar status de jobs
//   • Mantener trazabilidad job ↔ producto

import api from '@utils/axiosConfig'

// Recupera un job específico de ProductAnalysisPage
// Usado por AddProduct cuando quiere saber si la imagen ya existe encolada
export const getJobById = async (jobId) => {
  try {
    const response = await api.get(`/product/analysis/${jobId}`)
    return response.data?.data || null
  } catch (error) {
    console.error(`Error fetching job ${jobId}:`, error)
    return null
  }
}

// Obtiene el status actual de un job sin descargar todo el objeto
// Útil para polling en AddProduct mientras se procesa
export const getJobStatus = async (jobId) => {
  try {
    const job = await getJobById(jobId)
    return {
      status: job?.status || null,
      isProcessing: ['imported', 'processing'].includes(job?.status),
      isCompleted: ['completed', 'failed', 'approved', 'rejected'].includes(
        job?.status,
      ),
      error: job?.error || null,
    }
  } catch (error) {
    console.error(`Error fetching status for ${jobId}:`, error)
    return null
  }
}

// Recupera solo el análisis de IA para un job, sin crear uno nuevo
// Usado cuando AddProduct abre una imagen que ya fue analizada
export const fetchAnalysisForJob = async (jobId) => {
  try {
    const job = await getJobById(jobId)
    if (!job) return null

    // El análisis puede estar guardado directamente en job.analysis
    // o dentro de job.metadata.analysis (depende de cómo el backend lo guarda)
    return job.analysis || job.metadata?.analysis || null
  } catch (error) {
    console.error(`Error fetching analysis for ${jobId}:`, error)
    return null
  }
}

// Actualiza el status de un job (ej: pending → imported cuando AddProduct lo abre)
// El backend es responsable de validar transiciones válidas
export const updateJobStatus = async (jobId, newStatus) => {
  try {
    const response = await api.patch(`/product/analysis/${jobId}`, {
      status: newStatus,
    })
    return response.data?.data || null
  } catch (error) {
    console.error(`Error updating job ${jobId} to ${newStatus}:`, error)
    throw error
  }
}

// Marca un job como "imported" (admin acaba de abrirlo en AddProduct)
// Esto avisa a ProductAnalysisPage que el job está siendo procesado
export const markJobAsImported = async (jobId) => {
  return updateJobStatus(jobId, 'imported')
}

// Recupera múltiples jobs en un lote (útil para ProductAnalysisPage)
export const getJobsByStatus = async (status = null, limit = 50, offset = 0) => {
  try {
    const params = new URLSearchParams()
    if (status) params.append('status', status)
    params.append('limit', limit)
    params.append('offset', offset)

    const response = await api.get(`/product/analysis?${params}`)
    return {
      jobs: response.data?.data || [],
      total: response.data?.total || 0,
    }
  } catch (error) {
    console.error('Error fetching jobs:', error)
    return { jobs: [], total: 0 }
  }
}

// Cancela un job (lo marca como rechazado o lo elimina)
// Usado desde ProductAnalysisPage para limpiar imágenes sin usar
export const cancelJob = async (jobId) => {
  try {
    const response = await api.delete(`/product/analysis/${jobId}`)
    return response.data?.success || false
  } catch (error) {
    console.error(`Error canceling job ${jobId}:`, error)
    throw error
  }
}

export default {
  getJobById,
  getJobStatus,
  fetchAnalysisForJob,
  updateJobStatus,
  markJobAsImported,
  getJobsByStatus,
  cancelJob,
}
