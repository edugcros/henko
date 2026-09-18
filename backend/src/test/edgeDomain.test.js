// 📁 src/test/edgeDomain.test.js
//
// El dominio propio de un comercio tiene que llegar al BORDE que sirve la
// tienda, no al backend.
//
// EL BUG
//
// Las instrucciones que el panel le daba al comercio decían: "apuntá tu CNAME a
// env.apiDomain". Eso es api.henkart.com.ar — la API. Un comercio que siguiera
// esa instrucción apuntaba su dominio al backend y recibía JSON en vez de su
// tienda. El flujo nunca se había probado de punta a punta.
//
// Y FALTABA UN PASO ENTERO
//
// Verificar prueba quién es el DUEÑO del dominio. No dice quién lo ATIENDE:
// mientras el borde no lo conozca, el hostname no tiene a dónde ir ni
// certificado que presentar. Son dos cosas distintas y solo se hacía la primera.

import { jest } from '@jest/globals'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64url')

const llamadas = []

const fetchMock = jest.fn(async (url, opciones) => {
  llamadas.push({ url: String(url), metodo: opciones?.metodo || opciones?.method })

  return {
    ok: true,
    status: 200,
    json: async () => ({}),
  }
})

global.fetch = fetchMock

const {
  obtenerDestinoDelBorde,
  registrarDominioEnBorde,
  quitarDominioDelBorde,
  isEdgeProvisioningEnabled,
} = await import('../services/tenant/edgeDomainService.js')

beforeEach(() => {
  llamadas.length = 0
  fetchMock.mockClear()
  delete process.env.PLATFORM_EDGE_CNAME
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_PROJECT_ID
  delete process.env.VERCEL_TEAM_ID
})

describe('a dónde se manda al comercio', () => {
  test('al borde de la tienda, no a la API', () => {
    // ESTE ES EL BUG. El valor salía de apiDomain, que es el backend.
    process.env.PLATFORM_EDGE_CNAME = 'cname.vercel-dns.com'

    expect(obtenerDestinoDelBorde()).toBe('cname.vercel-dns.com')
  })

  test('sin destino configurado devuelve null, no un valor cualquiera', () => {
    // Que el panel muestre el paso como pendiente es mejor que darle al
    // comercio una instrucción equivocada con aire de correcta: si la sigue,
    // apunta su dominio a un lugar que no sirve su tienda y el error es suyo
    // de arreglar.
    expect(obtenerDestinoDelBorde()).toBeNull()
  })
})

describe('alta en el borde', () => {
  test('sin credenciales no se intenta nada', async () => {
    // El alta de dominio ya hizo su parte importante —verificar la propiedad—.
    // Acoplarla a un token del dashboard haría que un secreto sin cargar
    // bloqueara el flujo entero.
    const res = await registrarDominioEnBorde('mitienda.com.ar')

    expect(res.ok).toBe(false)
    expect(res.motivo).toBe('sin_credenciales')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('con credenciales registra el dominio en el proyecto', async () => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    const res = await registrarDominioEnBorde('mitienda.com.ar')

    expect(res.ok).toBe(true)
    expect(llamadas[0].url).toContain('/projects/prj_123/domains')
  })

  test('el equipo viaja en la URL cuando está configurado', async () => {
    // Sin teamId, la API de Vercel responde sobre la cuenta personal y el
    // proyecto "no existe" — un 404 que no dice nada sobre la causa real.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'
    process.env.VERCEL_TEAM_ID = 'team_abc'

    await registrarDominioEnBorde('mitienda.com.ar')

    expect(llamadas[0].url).toContain('teamId=team_abc')
  })

  test('que ya esté dado de alta cuenta como éxito', async () => {
    // Pasa al reintentar una verificación. Tratarlo como error dejaría al
    // comercio viendo un fallo sobre algo que ya está bien.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'domain_already_in_use' } }),
    })

    const res = await registrarDominioEnBorde('mitienda.com.ar')

    expect(res.ok).toBe(true)
    expect(res.yaExistia).toBe(true)
  })

  test('un fallo del proveedor se informa, no se lanza', async () => {
    // Si lanzara, tiraría abajo la verificación que YA fue exitosa y el
    // comercio quedaría sin su dominio verificado por un problema ajeno.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({
        error: { code: 'custom_domain_needs_upgrade', message: 'requires premium' },
      }),
    })

    const res = await registrarDominioEnBorde('mitienda.com.ar')

    expect(res.ok).toBe(false)
    expect(res.motivo).toBe('custom_domain_needs_upgrade')
  })
})

describe('baja en el borde', () => {
  test('quitar un dominio también lo saca del proyecto', async () => {
    // Si no, el hostname sigue ocupando cupo con su certificado renovándose
    // para siempre, y ningún comercio lo reclama.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    const res = await quitarDominioDelBorde('mitienda.com.ar')

    expect(res.ok).toBe(true)
    expect(llamadas[0].url).toContain('mitienda.com.ar')
  })

  test('que no exista es el resultado deseado', async () => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })

    expect((await quitarDominioDelBorde('mitienda.com.ar')).ok).toBe(true)
  })
})

describe('si el alta automática está disponible', () => {
  test('hacen falta las dos credenciales', () => {
    expect(isEdgeProvisioningEnabled()).toBe(false)

    process.env.VERCEL_TOKEN = 'tok'
    expect(isEdgeProvisioningEnabled()).toBe(false)

    process.env.VERCEL_PROJECT_ID = 'prj_123'
    expect(isEdgeProvisioningEnabled()).toBe(true)
  })
})
