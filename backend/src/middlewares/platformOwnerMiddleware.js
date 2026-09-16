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

/** Los emails habilitados, ya normalizados. Vacío = nadie. */
const allowlist = () =>
  clean(process.env.PLATFORM_OWNER_EMAILS)
    .split(',')
    .map(email => email.trim())
    .filter(Boolean)

/**
 * ¿Este email es dueño de la plataforma?
 *
 * SE EXPORTA PARA QUE HAYA UNA SOLA DEFINICIÓN.
 *
 * El panel necesita saberlo para decidir si muestra el grupo "Plataforma" en
 * el menú, y esa decisión TIENE que dar lo mismo que el gate o el usuario ve
 * un ítem que le devuelve 403 (o, peor, no ve uno al que sí tiene derecho).
 * Con la lista parseada en dos lugares, la primera vez que alguien toque uno
 * y no el otro empiezan a discrepar en silencio.
 *
 * Que el panel lo sepa NO debilita nada: lo que decide el acceso sigue siendo
 * el middleware de abajo, en cada request. Esto solo evita dibujar un ítem
 * que no lleva a ningún lado.
 *
 * No se lee del env en el módulo sino en cada llamada, a propósito: los tests
 * cambian la variable entre casos, y un valor congelado al importar los
 * obligaría a reimportar el módulo para cada uno.
 */
export const isPlatformOwner = email => {
  const emails = allowlist()
  if (!emails.length) return false

  const requester = clean(email)
  return Boolean(requester) && emails.includes(requester)
}

export const requirePlatformOwner = (req, res, next) => {
  // Este caso se distingue del "no autorizado" común a propósito: no es que
  // el usuario no tenga permiso, es que el reporte no tiene dueño asignado y
  // el mensaje tiene que decir qué hay que configurar.
  if (!allowlist().length) {
    return res.status(403).json({
      success: false,
      message: 'PLATFORM_OWNER_EMAILS no está configurado — este reporte no tiene dueño asignado.',
    })
  }

  if (!isPlatformOwner(req.user?.email)) {
    return res.status(403).json({ success: false, message: 'No autorizado' })
  }

  next()
}

export default { requirePlatformOwner, isPlatformOwner }
