import { getCookieDomain } from '../utils/cookieHelper.js'

// getCookieDomain fija a propósito el scope host-only para las 3 cookies
// de sesión (token/refreshToken/_csrf) — sin esto, admin.<tenant>.<root> y
// shop.<tenant>.<root> comparten la misma cookie en el mismo navegador y
// una sesión pisa a la otra. Este test existe para que un cambio futuro
// no reintroduzca el scope de dominio compartido sin querer.
describe('getCookieDomain', () => {
  const hosts = [
    'localhost',
    '127.0.0.1',
    'henkoapp.com',
    'admin.henkoapp.com',
    'shop.tienda-pepe.com',
    'tienda-pepe.com',
    'admin.tienda-pepe.co.uk',
  ]

  test.each(hosts)('devuelve undefined para %s (host-only, siempre)', host => {
    const req = {
      hostname: host,
      get: header => (header === 'host' ? host : undefined),
    }

    expect(getCookieDomain(req)).toBeUndefined()
  })

  test('no depende del objeto request en absoluto', () => {
    expect(getCookieDomain()).toBeUndefined()
    expect(getCookieDomain(null)).toBeUndefined()
    expect(getCookieDomain({})).toBeUndefined()
  })
})
