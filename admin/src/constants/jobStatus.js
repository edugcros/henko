// 📁 src/constants/jobStatus.js
//
// Single source of truth for job status definitions
// Compartido entre ProductAnalysisPage y AddProduct
// No duplicar estas definiciones en múltiples archivos

// Una sola fuente de verdad por estado
// Cada estado tiene: label (UI), color (MUI), y descripción
export const STATUS_META = {
  pending: {
    label: 'Pendiente',
    color: 'default',
    description: 'Imagen en cola. Esperando que el admin abra AddProduct.',
  },
  scheduled: {
    label: 'Programado',
    color: 'info',
    description: 'Imagen programada para una hora específica. Aún no en análisis.',
  },
  imported: {
    label: 'En AddProduct',
    color: 'primary',
    description: 'Admin abrió AddProduct con esta imagen. Preparando análisis IA.',
  },
  processing: {
    label: 'Procesando',
    color: 'warning',
    description: 'Análisis IA en progreso. No cerrar AddProduct.',
  },
  completed: {
    label: 'Analizado',
    color: 'success',
    description: 'IA terminó análisis. Datos listos. Pendiente aprobación del admin.',
  },
  failed: {
    label: 'Fallido',
    color: 'error',
    description: 'Error en análisis IA. Revisar logs o reintentar.',
  },
  approved: {
    label: 'Aprobado',
    color: 'success',
    description: 'Admin aprobó el análisis. Producto creado.',
  },
  rejected: {
    label: 'Rechazado',
    color: 'error',
    description: 'Admin rechazó el análisis. Puede reintentar o descartar.',
  },
}

// Opciones para filtros de estado
export const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  ...Object.entries(STATUS_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
]

// Estados agrupados por etapa del ciclo de vida
export const STATUS_GROUPS = {
  queued: ['pending', 'scheduled'], // Esperando ser procesadas
  processing: ['imported', 'processing'], // En progreso
  completed: ['completed', 'approved', 'rejected'], // Terminadas (éxito o rechazo)
  failed: ['failed'], // Error
}

// Transiciones válidas de estado
export const STATE_TRANSITIONS = {
  pending: ['scheduled', 'imported', 'processing', 'completed', 'failed'],
  scheduled: ['pending', 'imported', 'processing', 'completed', 'failed'],
  imported: ['processing', 'failed'],
  processing: ['completed', 'failed'],
  completed: ['approved', 'rejected'],
  failed: ['pending', 'processing'],
  approved: [],
  rejected: ['pending'],
}

export default STATUS_META
