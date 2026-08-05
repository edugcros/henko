// 📁 src/utils/dateFormat.js
// Compartido entre AddProduct.js y ProductAnalysisPage.jsx — antes cada
// uno tenía su propia copia idéntica de estas dos funciones.

export const formatDate = value => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export const formatRelativeTime = value => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (diffSeconds < 45) return 'hace un momento'

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `hace ${diffMinutes} min`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `hace ${diffHours} h`

  const diffDays = Math.round(diffHours / 24)
  return `hace ${diffDays} d`
}
