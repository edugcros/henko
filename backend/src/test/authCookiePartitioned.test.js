// 📁 src/test/authCookiePartitioned.test.js
//
// La cookie de auth es de TERCEROS para las dos pantallas.
//
// La API vive en henko.onrender.com y los frontends en *.vercel.app: sitios
// distintos. Medido sobre un día entero de logs de producción, CADA refresh
// desde henko-web devolvió "no hay token de refresco" —ni uno solo exitoso—
// con el frontend mandando withCredentials correctamente y el backend
// emitiendo SameSite=None; Secure. La cookie no llegaba porque nunca se
// guardó: Chrome la bloquea por ser de terceros.
//
// `Partitioned` (CHIPS) es la vía que Chrome dejó abierta. La cookie se guarda
// con clave (sitio de arriba, origen de la cookie), así que la tienda y el
// panel quedan en particiones separadas — que es exactamente lo que
// refreshSessions ya sabe manejar.

import cookie from 'cookie'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')
process.env.JWT_SECRET = 'test-secret-para-cookies'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-para-cookies'

const { usePartitionedCookies } = await import('../controller/userCtrl.js')

const original = process.env.AUTH_COOKIE_PARTITIONED

afterEach(() => {
  if (original === undefined) delete process.env.AUTH_COOKIE_PARTITIONED
  else process.env.AUTH_COOKIE_PARTITIONED = original
})

describe('cookies de auth · particionadas solo donde hace falta', () => {
  test('con SameSite=None se particiona', () => {
    expect(usePartitionedCookies('None')).toBe(true)
    expect(usePartitionedCookies('none')).toBe(true)
  })

  test('con SameSite=Lax NO se particiona', () => {
    // Una cookie same-site no necesita partición, y agregársela en desarrollo
    // cambiaría el comportamiento local sin ningún motivo.
    expect(usePartitionedCookies('Lax')).toBe(false)
    expect(usePartitionedCookies('Strict')).toBe(false)
  })

  test('se puede apagar sin un revert', () => {
    // Si Partitioned resulta ser el problema en vez de la solución, se apaga
    // con una variable de entorno en vez de esperar un deploy.
    process.env.AUTH_COOKIE_PARTITIONED = 'false'
    expect(usePartitionedCookies('None')).toBe(false)
  })

  test('el header que sale es el correcto', () => {
    // Partitioned exige Secure, que es la misma condición que ya pide None.
    const header = cookie.serialize('refreshToken', 'jwt', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      partitioned: true,
    })

    expect(header).toContain('Partitioned')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=None')
  })
})
