// 📁 src/test/authCookiePartitioned.test.js
//
// Cuándo la cookie de auth es de TERCEROS, y qué se hace al respecto.
//
// Cuando la API vivía en henko.onrender.com y los frontends en *.vercel.app
// eran sitios distintos. Medido sobre un día entero de logs de producción,
// CADA refresh desde la tienda devolvió "no hay token de refresco" —ni uno
// solo exitoso— con el frontend mandando withCredentials correctamente y el
// backend emitiendo SameSite=None; Secure. La cookie no llegaba porque nunca
// se guardó: Chrome la bloquea por ser de terceros.
//
// `Partitioned` (CHIPS) es la vía que Chrome dejó abierta. La cookie se guarda
// con clave (sitio de arriba, origen de la cookie), así que cada pantalla
// queda en su propia partición — que es exactamente lo que refreshSessions ya
// sabe manejar.
//
// Hoy todo vive bajo henkart.com.ar y comparte sitio, así que corre apagado.
// Vuelve a hacer falta con el primer comercio de dominio propio: mitienda.com.ar
// pidiéndole a api.henkart.com.ar es sitio cruzado otra vez.

import cookie from 'cookie'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')
process.env.JWT_SECRET = 'test-secret-para-cookies'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-para-cookies'

const { usePartitionedCookies } = await import('../controller/userCtrl.js')
const { crossSiteReasons } = await import('../../config/env.js')

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

// POR QUÉ HACE FALTA SameSite=None, ENUMERADO
//
// La validación de arranque exigía 'None' en producción SIEMPRE, con un mensaje
// que hablaba de "dominios cruzados" — la condición que no comprobaba. Se cobró
// una caída de arranque el día que se puso 'Lax' a mano: el proceso murió en el
// import de config/env.js, antes de que hubiera servidor para explicarlo.
//
// El arreglo no es permitir 'Lax': con dominios propios de comercios habilitados
// SIEMPRE hay un motivo para 'None'. Es que el motivo se pueda leer.
describe('qué obliga a SameSite=None', () => {
  const raiz = 'henkart.com.ar'

  test('la raíz y sus subdominios no son motivo', () => {
    // henkart.com.ar y api.henkart.com.ar comparten sitio: una cookie 'Lax'
    // viaja entre ellos sin problema.
    expect(
      crossSiteReasons({
        rootDomain: raiz,
        allowedOrigins: [
          'https://henkart.com.ar',
          'https://admin.henkart.com.ar',
          'https://api.henkart.com.ar',
        ],
      }),
    ).toEqual([])
  })

  test('los dominios propios de los comercios son motivo por sí solos', () => {
    // ESTA ES LA IMPORTANTE. Un comercio en mitienda.com.ar pegándole a
    // api.henkart.com.ar es sitio cruzado y no hay forma de que deje de serlo.
    // Mientras la plataforma venda dominios propios, 'None' es el requisito.
    const razones = crossSiteReasons({
      rootDomain: raiz,
      allowedOrigins: ['https://henkart.com.ar'],
      allowCustomDomains: true,
    })

    expect(razones).toEqual([
      'ALLOW_CUSTOM_DOMAINS: los dominios propios de los comercios',
    ])
  })

  test('un origen de otro sitio es motivo', () => {
    // Mientras *.vercel.app siga permitido, quien entre por ahí pierde la
    // sesión con 'Lax'. El arranque tiene que nombrarlo, no adivinarlo.
    expect(
      crossSiteReasons({
        rootDomain: raiz,
        allowedOrigins: ['https://henkart.com.ar', 'https://henko-web.vercel.app'],
      }),
    ).toEqual(['ALLOWED_ORIGINS: https://henko-web.vercel.app'])
  })

  test('también mira ALLOWED_ROOT_DOMAINS, no solo la lista de orígenes', () => {
    // corsOptions deja entrar por las dos vías. Mirar una sola daría vía libre
    // a 'Lax' con orígenes cruzados entrando por la otra.
    expect(
      crossSiteReasons({ rootDomain: raiz, allowedRootDomains: ['otracosa.com'] }),
    ).toEqual(['ALLOWED_ROOT_DOMAINS: otracosa.com'])
  })

  test('un dominio que solo EMPIEZA parecido es ajeno', () => {
    // 'malhenkart.com.ar'.endsWith('henkart.com.ar') es true. Sin el punto,
    // cualquiera registra un dominio con ese sufijo y la validación lo trata
    // como si fuera de casa.
    expect(
      crossSiteReasons({
        rootDomain: raiz,
        allowedOrigins: ['https://malhenkart.com.ar'],
      }),
    ).toEqual(['ALLOWED_ORIGINS: https://malhenkart.com.ar'])
  })

  test('un origen ilegible cuenta como cruzado', () => {
    // Ante la duda, la opción que no deja a nadie sin sesión es exigir None.
    expect(
      crossSiteReasons({ rootDomain: raiz, allowedOrigins: ['no-es-una-url'] }),
    ).toEqual(['ALLOWED_ORIGINS: no-es-una-url (no se puede leer como URL)'])
  })

  test('sin raíz configurada, todo es cruzado', () => {
    // Sin ROOT_DOMAIN no hay con qué comparar. Declarar same-site ahí sería
    // afirmar algo que no se sabe.
    expect(
      crossSiteReasons({ rootDomain: '', allowedOrigins: ['https://henkart.com.ar'] }),
    ).toEqual(['ALLOWED_ORIGINS: https://henkart.com.ar'])
  })
})
