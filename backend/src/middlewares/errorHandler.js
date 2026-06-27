
import { buildFrontendUrl } from '../utils/frontendUrl.js'

export const notFound = (req, res) => {
  // Si alguien abre el link de reset contra la API, redirigimos al storefront.
  if (req.originalUrl.includes('/reset-password/')) {
    const token = encodeURIComponent(req.originalUrl.split('/reset-password/')[1] || '')
    const resetUrl = buildFrontendUrl(`/reset-password/${token}`, req)

    return res.redirect(302, resetUrl)
  }

  // Para cualquier otra ruta, devolver JSON
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.originalUrl}`,
  })
}

export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err)

  const declaredStatus = Number(err.statusCode || err.status)
  const safeDeclaredStatus =
    Number.isInteger(declaredStatus) &&
    declaredStatus >= 400 &&
    declaredStatus <= 599
      ? declaredStatus
      : 500
  const statusCode =
    res.statusCode >= 400 && res.statusCode <= 599
      ? res.statusCode
      : safeDeclaredStatus

  // 1. Mongoose Validation
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message)
    return res.status(400).json({
      success: false,
      error: 'Error de validación',
      messages,
    })
  }

  // 2. Mongoose CastError (ID inválido)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'ID inválido',
      message: `El recurso con id '${err.value}' no es válido.`,
    })
  }

  // 3. Conflicto por índice único
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: 'Recurso duplicado',
      message: 'Ya existe un recurso con esos datos únicos.',
    })
  }

  // 4. CSRF (EBADCSRFTOKEN)
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      success: false,
      error: 'Token CSRF inválido',
      message: 'La sesión de seguridad es inválida. Recarga la página.',
    })
  }

  res.status(statusCode).json({
    success: false,
    error: err.name || 'Error del servidor',
    message: err.message || 'Algo salió mal',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  })
}
