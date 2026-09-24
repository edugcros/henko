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
  delete process.env.VERCEL_ADMIN_PROJECT_ID
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

describe('la verificación que pide el BORDE, además de la nuestra', () => {
  test('cuando el dominio ya está en otra cuenta, se devuelve qué falta', async () => {
    // EL CASO QUE ESTO CIERRA.
    //
    // Nuestro TXT prueba que el dominio es del comercio. Si ese hostname ya
    // está dado de alta en otra cuenta del proveedor —una landing vieja, un
    // sitio anterior— el borde exige su propia prueba antes de servirlo.
    //
    // Descartarla era el peor de los casos: el comercio veía "verificado" en
    // HENKO y su tienda no funcionaba, sin nada en pantalla que lo explicara.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'mitienda.com.ar',
        verification: [
          {
            type: 'TXT',
            domain: '_vercel.mitienda.com.ar',
            value: 'vc-domain-verify=mitienda.com.ar,0217cb2e14',
            reason: 'pending_domain_verification',
          },
        ],
      }),
    })

    const res = await registrarDominioEnBorde('mitienda.com.ar')

    expect(res.ok).toBe(true)
    expect(res.verificacionPendiente).toEqual([
      {
        type: 'TXT',
        name: '_vercel.mitienda.com.ar',
        value: 'vc-domain-verify=mitienda.com.ar,0217cb2e14',
        motivo: 'pending_domain_verification',
      },
    ])
  })

  test('el caso normal no pide nada extra', async () => {
    // Un dominio que no está en ninguna otra cuenta se registra y listo. Si
    // esto devolviera algo, el panel le mostraría al comercio un paso
    // inventado.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    const res = await registrarDominioEnBorde('mitienda.com.ar')

    expect(res.ok).toBe(true)
    expect(res.verificacionPendiente).toEqual([])
  })

  test('una entrada incompleta del proveedor se descarta', async () => {
    // Sin nombre no hay registro que cargar. Mostrarle al comercio una fila
    // vacía sería peor que no mostrar nada.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_123'

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        verification: [
          { type: 'TXT', value: 'algo' },
          { type: 'TXT', domain: '_vercel.ok.com', value: 'v' },
        ],
      }),
    })

    const res = await registrarDominioEnBorde('ok.com')

    expect(res.verificacionPendiente).toHaveLength(1)
    expect(res.verificacionPendiente[0].name).toBe('_vercel.ok.com')
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

// El panel y la tienda son DOS proyectos del borde.
//
// Un hostname sirve UNA aplicación. Dar de alta admin.sutienda.com en el
// proyecto del storefront lo deja sirviendo la tienda: el comercio apunta su
// DNS, ve que "funciona", y lo que carga es su propia tienda otra vez. Eso no
// se lee como un error de configuración, se lee como que HENKO no anda.
describe('alta en el borde · la superficie elige el proyecto', () => {
  test('un dominio de tienda va al proyecto de la tienda', async () => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_tienda'
    process.env.VERCEL_ADMIN_PROJECT_ID = 'prj_panel'

    await registrarDominioEnBorde('mitienda.com.ar')

    expect(llamadas[0].url).toContain('/projects/prj_tienda/domains')
  })

  test('un dominio de panel va al proyecto del PANEL', async () => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_tienda'
    process.env.VERCEL_ADMIN_PROJECT_ID = 'prj_panel'

    await registrarDominioEnBorde('admin.mitienda.com.ar', { surface: 'admin' })

    expect(llamadas[0].url).toContain('/projects/prj_panel/domains')
    expect(llamadas[0].url).not.toContain('prj_tienda')
  })

  // LA DECISIÓN QUE IMPORTA. Sin proyecto de panel configurado NO se cae al de
  // la tienda: es preferible un paso manual a un alta silenciosa en el lugar
  // equivocado, que además sería dificilísima de diagnosticar.
  test('sin proyecto de panel NO se da de alta en el de la tienda', async () => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_tienda'
    delete process.env.VERCEL_ADMIN_PROJECT_ID

    const res = await registrarDominioEnBorde('admin.mitienda.com.ar', {
      surface: 'admin',
    })

    expect(res.ok).toBe(false)
    expect(res.motivo).toBe('sin_proyecto_de_panel')
    // Y sobre todo: no se llamó a nadie.
    expect(llamadas).toHaveLength(0)
  })

  test('la baja también busca en el proyecto que corresponde', async () => {
    // Buscarlo en el proyecto equivocado devolvería 404, que este servicio
    // trata como éxito, y el hostname quedaría vivo en el otro para siempre.
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_tienda'
    process.env.VERCEL_ADMIN_PROJECT_ID = 'prj_panel'

    await quitarDominioDelBorde('admin.mitienda.com.ar', { surface: 'admin' })

    expect(llamadas[0].url).toContain('/projects/prj_panel/domains')
  })

  test('isEdgeProvisioningEnabled se pregunta por superficie', async () => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = 'prj_tienda'
    delete process.env.VERCEL_ADMIN_PROJECT_ID

    expect(isEdgeProvisioningEnabled()).toBe(true)
    expect(isEdgeProvisioningEnabled('admin')).toBe(false)
  })
})
