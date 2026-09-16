// 📁 src/test/platformOwner.test.js
//
// El menú del panel y el permiso real tienen que dar lo mismo.
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// No hay un rol "dueño de la plataforma": los roles del sistema
// (user/admin/moderator) están todos acotados a un tenant. La distinción es
// una allowlist de emails en PLATFORM_OWNER_EMAILS, y hasta ahora vivía
// SOLO dentro del middleware.
//
// Desde que el panel dibuja el grupo "Plataforma" según isPlatformOwner, esa
// lista la consultan dos lugares. Si se parsearan por separado, la primera
// vez que alguien toque uno y no el otro empiezan a discrepar en silencio, y
// la discrepancia se ve de dos formas igual de malas: un comercio con un ítem
// de menú que le devuelve 403, o el dueño sin acceso a un reporte al que sí
// tiene derecho.
//
// Lo que se fija acá es que sea UN SOLO predicado y que falle cerrado.

import { jest } from '@jest/globals'

const { isPlatformOwner, requirePlatformOwner } = await import(
  '../middlewares/platformOwnerMiddleware.js'
)

const original = process.env.PLATFORM_OWNER_EMAILS

const responder = () => {
  const res = { statusCode: null, body: null }
  res.status = code => {
    res.statusCode = code
    return res
  }
  res.json = body => {
    res.body = body
    return res
  }
  return res
}

afterEach(() => {
  if (original === undefined) delete process.env.PLATFORM_OWNER_EMAILS
  else process.env.PLATFORM_OWNER_EMAILS = original
})

describe('isPlatformOwner · el predicado', () => {
  test('reconoce un email de la lista', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'duenio@henko.com'

    expect(isPlatformOwner('duenio@henko.com')).toBe(true)
  })

  test('no le importan mayúsculas ni espacios de más', () => {
    // La lista la escribe una persona en el panel de Render, a mano.
    process.env.PLATFORM_OWNER_EMAILS = '  Duenio@Henko.com , otro@henko.com  '

    expect(isPlatformOwner('DUENIO@henko.com')).toBe(true)
    expect(isPlatformOwner(' otro@henko.com ')).toBe(true)
  })

  test('un email que no está en la lista, no', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'duenio@henko.com'

    expect(isPlatformOwner('admin-de-un-comercio@ejemplo.com')).toBe(false)
  })

  test('FALLA CERRADO: sin lista configurada, nadie es dueño', () => {
    // Un reporte con datos financieros de todos los comercios no puede quedar
    // abierto por default. Y el panel, que pregunta lo mismo, tampoco debe
    // dibujar el grupo cuando no hay dueño asignado.
    delete process.env.PLATFORM_OWNER_EMAILS
    expect(isPlatformOwner('cualquiera@henko.com')).toBe(false)

    process.env.PLATFORM_OWNER_EMAILS = '   '
    expect(isPlatformOwner('cualquiera@henko.com')).toBe(false)

    process.env.PLATFORM_OWNER_EMAILS = ',,,'
    expect(isPlatformOwner('cualquiera@henko.com')).toBe(false)
  })

  test('sin email tampoco', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'duenio@henko.com'

    expect(isPlatformOwner(null)).toBe(false)
    expect(isPlatformOwner(undefined)).toBe(false)
    expect(isPlatformOwner('')).toBe(false)
    expect(isPlatformOwner('   ')).toBe(false)
  })
})

describe('el gate y el menú no pueden discrepar', () => {
  // Esta es LA propiedad del archivo: lo que el panel usa para mostrar el
  // ítem y lo que el servidor usa para dejar pasar salen de la misma función.
  const casos = [
    ['duenio@henko.com', 'duenio@henko.com', true],
    ['duenio@henko.com', 'otro@ejemplo.com', false],
    ['a@henko.com,b@henko.com', 'b@henko.com', true],
    ['A@HENKO.COM', 'a@henko.com', true],
    ['', 'duenio@henko.com', false],
  ]

  test.each(casos)(
    'lista "%s" + email "%s" → menú y gate coinciden en %s',
    (lista, email, esperado) => {
      process.env.PLATFORM_OWNER_EMAILS = lista

      // Lo que decide el MENÚ.
      expect(isPlatformOwner(email)).toBe(esperado)

      // Lo que decide el ACCESO.
      const res = responder()
      const next = jest.fn()
      requirePlatformOwner({ user: { email } }, res, next)

      const dejoPasar = next.mock.calls.length === 1
      expect(dejoPasar).toBe(esperado)
      if (!esperado) expect(res.statusCode).toBe(403)
    },
  )
})

describe('requirePlatformOwner · los dos rechazos son distintos', () => {
  test('sin lista configurada dice QUÉ hay que configurar', () => {
    // "No autorizado" a secas mandaría a buscar el problema en el usuario,
    // cuando lo que falta es una variable de entorno.
    delete process.env.PLATFORM_OWNER_EMAILS

    const res = responder()
    requirePlatformOwner({ user: { email: 'duenio@henko.com' } }, res, jest.fn())

    expect(res.statusCode).toBe(403)
    expect(res.body.message).toMatch(/PLATFORM_OWNER_EMAILS/)
  })

  test('con lista configurada y email ajeno, es un no autorizado común', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'duenio@henko.com'

    const res = responder()
    requirePlatformOwner({ user: { email: 'ajeno@ejemplo.com' } }, res, jest.fn())

    expect(res.statusCode).toBe(403)
    expect(res.body.message).toBe('No autorizado')
    // Y no filtra quién sí tiene acceso.
    expect(res.body.message).not.toMatch(/henko\.com/)
  })

  test('una request sin usuario no pasa', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'duenio@henko.com'

    const res = responder()
    const next = jest.fn()
    requirePlatformOwner({}, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })
})
