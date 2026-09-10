
import { buildFrontendUrl } from '../utils/frontendUrl.js'
import logger from '../../config/logger.js'

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

  // Único punto que ve todos los errores de la app — sin esto, un incidente
  // real en producción no deja ningún rastro server-side, solo lo que el
  // cliente reporte. Siempre corre, independiente de NODE_ENV.
  logger.error(err.message || 'Error sin mensaje', {
    requestId: req.id,
    stack: err.stack,
    name: err.name,
    code: err.code,
    statusCode,
    method: req.method,
    path: req.originalUrl,
    tenantId: req.tenantId ? String(req.tenantId) : undefined,
    userId: req.user?._id ? String(req.user._id) : undefined,
  })

  // El identificador va en TODA respuesta de error, no solo en las genéricas:
  // es lo que le permite a un comercio reportar "me falló esto" con algo que
  // se puede buscar en el log.
  const conTraza = payload => ({ ...payload, requestId: req.id })

  // 1. Mongoose Validation
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message)
    return res.status(400).json(
      conTraza({
        success: false,
        error: 'Error de validación',
        messages,
      }),
    )
  }

  // 2. Mongoose CastError (ID inválido)
  if (err.name === 'CastError') {
    return res.status(400).json(
      conTraza({
        success: false,
        error: 'ID inválido',
        // err.value es lo que mandó el propio cliente: devolvérselo no revela
        // nada que no supiera.
        message: `El recurso con id '${err.value}' no es válido.`,
      }),
    )
  }

  // 3. Conflicto por índice único
  if (err.code === 11000) {
    return res.status(409).json(
      conTraza({
        success: false,
        error: 'Recurso duplicado',
        message: 'Ya existe un recurso con esos datos únicos.',
      }),
    )
  }

  // 4. CSRF (EBADCSRFTOKEN)
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json(
      conTraza({
        success: false,
        error: 'Token CSRF inválido',
        message: 'La sesión de seguridad es inválida. Recarga la página.',
      }),
    )
  }

  // 5. Todo lo demás.
  //
  // La distinción es 4xx contra 5xx, y no "producción contra desarrollo".
  //
  // Un 4xx lo lanza nuestro propio código con un mensaje escrito PARA el
  // cliente: "el plan no tiene precio definido", "el email no es válido". Taparlo
  // convertiría la API en inusable y no protege nada — el que lo escribió ya
  // decidió que era publicable.
  //
  // Un 5xx es un fallo que nadie redactó: llega el `err.message` de Mongo, del
  // driver o del sistema de archivos, con el host del clúster, una ruta interna
  // o un fragmento de consulta adentro. Eso no sale nunca en producción. Y
  // tampoco sale `err.name`, que dice qué biblioteca falló.
  const esFalloInterno = statusCode >= 500
  const ocultar = esFalloInterno && process.env.NODE_ENV === 'production'

  return res.status(statusCode).json(
    conTraza({
      success: false,
      code: esFalloInterno ? 'INTERNAL_SERVER_ERROR' : err.code || undefined,
      error: ocultar ? 'Error del servidor' : err.name || 'Error del servidor',
      message: ocultar
        ? 'Ocurrió un error interno. Si vuelve a pasar, pasanos el identificador de esta respuesta.'
        : err.message || 'Algo salió mal',
      stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    }),
  )
}
