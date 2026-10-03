// Qué identificadores de tienda no se pueden tomar al registrarse.
//
// El identificador que elige quien se registra se convierte DIRECTAMENTE en su
// dirección: `buildPlatformTenantDomains` arma `<slug>.<dominio público>`. Por
// eso la lista de reservados no es cosmética — es lo único entre un registro
// cualquiera y los hostnames de la propia plataforma.
//
// EL HUECO QUE SE CIERRA ACÁ
//
// La lista y la protección por distancia de edición estaban atadas al nombre de
// la MARCA ('henko'), y el dominio que la plataforma usa es otro. Medido antes
// del arreglo:
//
//     slug "henko"    -> bloqueado     -> henko.henkart.com.ar
//     slug "henkart"  -> NO bloqueado  -> henkart.com.ar
//
// El segundo no da un subdominio: da el dominio raíz pelado, por la rama de
// `buildPlatformTenantDomains` que existe para el comercio que ES la
// plataforma. Entre 'henko' y 'henkart' hay distancia 3 y el umbral es 1, así
// que la protección por typos tampoco lo agarraba.

import { isReservedSlug, buildPlatformTenantDomains } from '../utils/domainUtils.js'

const PUBLICO = 'henkart.com.ar'
const conDominio = slug => isReservedSlug(slug, { publicBaseDomain: PUBLICO })

describe('identificadores de tienda reservados', () => {
  test('el identificador que daría el dominio raíz queda bloqueado', () => {
    // Que es lo que daría, si lo dejáramos pasar.
    const { shopDomain } = buildPlatformTenantDomains({
      slug: 'henkart',
      publicBaseDomain: PUBLICO,
    })
    expect(shopDomain).toBe(PUBLICO)

    expect(conDominio('henkart')).toBe(true)
  })

  test.each(['admin', 'api', 'www', 'henko'])('sigue bloqueado el de siempre: %s', slug => {
    expect(conDominio(slug)).toBe(true)
  })

  test('un nombre de comercio normal pasa', () => {
    expect(conDominio('mitienda')).toBe(false)
    expect(conDominio('zapatos-del-sur')).toBe(false)
  })

  test('sin el dominio público se comporta como antes', () => {
    // El segundo argumento es opcional: los llamadores viejos no cambian de
    // comportamiento, solo pierden la comprobación extra.
    expect(isReservedSlug('admin')).toBe(true)
    expect(isReservedSlug('henkart')).toBe(false)
    expect(isReservedSlug('mitienda')).toBe(false)
  })

  test('la protección se mueve sola si cambia el dominio', () => {
    // No hay nada hardcodeado: con otro dominio base, el reservado es otro.
    expect(isReservedSlug('ejemplo', { publicBaseDomain: 'ejemplo.com' })).toBe(true)
    expect(isReservedSlug('henkart', { publicBaseDomain: 'ejemplo.com' })).toBe(false)
  })
})
