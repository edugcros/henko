/* eslint-env jest */

// Qué sale del navegador cuando el frontend se rompe.
//
// El ErrorBoundary reporta el crash al backend y el backend lo escribe en los
// logs del hosting, que son durables. La ruta del crash va en ese reporte, y
// hay rutas que llevan credenciales usables en la URL:
//
//   /reset-password/:token      → token de reseteo de contraseña en el path
//   /verify-email?token=...     → token de verificación en la consulta
//
// La primera versión mandaba `pathname + search` crudo, así que un crash en
// cualquiera de esas dos pantallas copiaba una credencial viva al log, donde la
// ve cualquiera con acceso al panel del hosting. Estas pruebas son la guarda:
// lo que se reporta tiene que servir para depurar sin llevarse el secreto.

import { rutaSegura } from '@components/ErrorBoundary/ErrorBoundary.js'

// jsdom no deja reasignar window.location, así que la URL se mueve con
// history.pushState, que es lo que actualiza pathname y search de verdad.
const enLaUrl = (pathname, search = '') => {
  window.history.pushState({}, '', `${pathname}${search}`)
}

describe('ErrorBoundary · recorte de la ruta reportada', () => {
  test('tapa el token de reseteo que viaja en el path', () => {
    enLaUrl('/reset-password/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')

    const ruta = rutaSegura()

    expect(ruta).toBe('/reset-password/***')
    expect(ruta).not.toContain('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
  })

  test('tapa el token de verificación que viaja en la consulta', () => {
    enLaUrl('/verify-email', '?token=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')

    const ruta = rutaSegura()

    // El nombre del parámetro queda —es la pista útil—, el valor no.
    expect(ruta).toBe('/verify-email?token=***')
    expect(ruta).not.toContain('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')
  })

  test('descarta el valor de CUALQUIER parámetro, no de una lista conocida', () => {
    // Una lista de claves sensibles se queda corta con el próximo parámetro
    // que alguien agregue.
    enLaUrl('/checkout', '?email=persona@ejemplo.com&cupon=SECRETO&pagina=2')

    const ruta = rutaSegura()

    expect(ruta).toBe('/checkout?email=***&cupon=***&pagina=***')
    expect(ruta).not.toContain('persona@ejemplo.com')
    expect(ruta).not.toContain('SECRETO')
  })

  test('deja intacta una ruta que no lleva nada opaco', () => {
    // Si recortara de más, el reporte dejaría de servir para depurar.
    enLaUrl('/product/zapatillas-running-azules')

    expect(rutaSegura()).toBe('/product/zapatillas-running-azules')
  })

  test('tapa un token con guiones, que un slug corto no alcanza a parecer', () => {
    // base64url y los JWT llevan guiones, así que la regla del guión sola los
    // dejaría pasar: por eso además se corta por largo.
    enLaUrl('/reset-password/aB3-dEf_gH1-jKl2mN3-pQr4sT5-uVw6xY7-zA8bC9d')

    expect(rutaSegura()).toBe('/reset-password/***')
  })

  test('recorta un id largo de producto pero conserva la forma de la ruta', () => {
    enLaUrl('/product/6a4dcc911161615f76a8131f0000ffff')

    // Saber que se rompió en /product/algo es lo que importa; el id puntual se
    // puede sacar del stack si hace falta.
    expect(rutaSegura()).toBe('/product/***')
  })

  test('no explota ni devuelve la URL cruda si la lectura falla', () => {
    enLaUrl('/verify-email', '?token=secreto')

    const original = global.URLSearchParams

    global.URLSearchParams = function () {
      throw new Error('bloqueado')
    }

    try {
      // Ante la duda, nada: reportar no puede ser la causa de un segundo error,
      // y tampoco puede caer en mandar la URL sin recortar.
      const ruta = rutaSegura()

      expect(ruta).toBe('(ruta no disponible)')
      expect(ruta).not.toContain('secreto')
    } finally {
      global.URLSearchParams = original
    }
  })
})
