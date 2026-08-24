// 📁 src/middlewares/platformOwnerMiddleware.js
//
// Gate para endpoints de plataforma (cruzan todos los comercios, no uno
// solo) — no existe un rol "dueño de la plataforma" en este sistema, los
// roles (user/admin/moderator) están todos acotados a un tenant. Este
// middleware es esa distinción, resuelta con la lista mínima posible: un
// email allowlisteado por variable de entorno.
//
// Corre después de authMiddleware (necesita req.user.email, ya resuelto
// ahí). Falla cerrado: sin PLATFORM_OWNER_EMAILS configurada, deniega — un
// reporte con datos financieros de todos los comercios nunca debe quedar
// abierto por default.

const clean = value => String(value || '').trim().toLowerCase()

export const requirePlatformOwner = (req, res, next) => {
  const allowedEmails = clean(process.env.PLATFORM_OWNER_EMAILS)
    .split(',')
    .map(email => email.trim())
    .filter(Boolean)

  if (!allowedEmails.length) {
    return res.status(403).json({
      success: false,
      message: 'PLATFORM_OWNER_EMAILS no está configurado — este reporte no tiene dueño asignado.',
    })
  }

  const requesterEmail = clean(req.user?.email)

  if (!requesterEmail || !allowedEmails.includes(requesterEmail)) {
    return res.status(403).json({ success: false, message: 'No autorizado' })
  }

  next()
}

export default { requirePlatformOwner }
