// 📁 src/test/tenantDomains.test.js
//
// El alta y la verificación de los dominios propios de un comercio.
//
// QUÉ SE PRUEBA
//
// Lo que hace que esto sea seguro no es el paso de verificar: es que el dominio
// nazca INERTE. Entra en `status: 'pending'`, y findTenantByDomainCandidates
// exige 'active', así que hasta que alguien pruebe que el dominio es suyo no
// resuelve a nada. Si esa propiedad se rompe, cualquier comercio podría
// reclamar el dominio de otro y la plataforma se lo serviría.
//
// EL DNS VA MOCKEADO, EL RESTO NO
//
// dns.resolveTxt es lo único simulado: depende de internet y de propagación, y
// no es lo que se está midiendo. Las transiciones de estado, la unicidad y las
// guardas corren contra base real, porque la unicidad global entre comercios la
// resuelve un índice único de Mongo y con un mock se probaría el mock.

import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')
// El dominio de la plataforma, para poder probar que no se puede reclamar.
process.env.ROOT_DOMAIN = 'henkart.com.ar'
process.env.PUBLIC_BASE_DOMAIN = 'henkart.com.ar'

const resolveTxtMock = jest.fn()

jest.unstable_mockModule('node:dns', () => ({
  promises: { resolveTxt: resolveTxtMock },
  default: { promises: { resolveTxt: resolveTxtMock } },
}))

const { default: Tenant } = await import('../models/tenantModel.js')
const {
  registerTenantDomain,
  verifyTenantDomain,
  listTenantDomains,
  removeTenantDomain,
  VERIFICATION_PREFIX,
} = await import('../services/tenant/tenantDomainService.js')

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } })
  await mongoose.connect(mongod.getUri())
  await Tenant.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  await Tenant.collection.deleteMany({})
  resolveTxtMock.mockReset()
  // Lo normal al cargar un dominio recién creado: todavía no hay nada.
  resolveTxtMock.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
})

const crearComercio = async (slug = `c-${Math.random().toString(36).slice(2, 8)}`) =>
  Tenant.create({
    name: 'Comercio',
    slug,
    status: 'active',
    domains: [
      {
        hostname: `${slug}.henkart.com.ar`,
        normalizedHostname: `${slug}.henkart.com.ar`,
        type: 'platform_subdomain',
        context: 'storefront',
        status: 'active',
        isPrimary: true,
      },
    ],
  })

describe('alta de un dominio propio', () => {
  test('nace INERTE y con instrucciones', async () => {
    // ESTA ES LA PROPIEDAD DE SEGURIDAD. Pendiente no es cosmético: el
    // resolvedor exige 'active', así que un dominio sin verificar no resuelve a
    // ningún comercio.
    const tenant = await crearComercio()

    const { domain, instructions } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(domain.status).toBe('pending')
    expect(domain.type).toBe('custom_domain')
    // Tienda por defecto, que es lo que pide casi toda alta. Antes nacía
    // 'both' y eso dejaba el dominio de la tienda contando como superficie de
    // panel sin que nada sirviera un panel ahí.
    expect(domain.context).toBe('storefront')
    // Y sin certificado propio todavía.
    expect(domain.sslStatus).toBe('pending')

    expect(instructions.verification.type).toBe('TXT')
    expect(instructions.verification.name).toBe(`${VERIFICATION_PREFIX}.mitienda.com.ar`)
    expect(instructions.verification.value).toMatch(/^henko-verify=[a-f0-9]{32}$/)
  })

  test('el token de verificación no viaja en el listado', async () => {
    // Es `select: false` en el modelo. Filtrarlo en el serializador además es
    // redundante a propósito: el día que alguien agregue un `.select('+...')`
    // por otro motivo, el token no se escapa igual.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const listado = await listTenantDomains(tenant._id)

    expect(listado.every(d => !('verificationToken' in d))).toBe(true)
  })

  test('normaliza lo que pega el comercio', async () => {
    // La gente copia la URL del navegador. Rechazarlo sería correcto y molesto.
    const tenant = await crearComercio()

    const { domain } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: '  HTTPS://MiTienda.com.ar/  ',
    })

    expect(domain.hostname).toBe('mitienda.com.ar')
  })

  test('rechaza un valor que no es un dominio', async () => {
    const tenant = await crearComercio()

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'localhost' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  test('NO se puede reclamar un dominio de la plataforma', async () => {
    // Sin esta guarda, un comercio podría cargar el subdominio de otro. El
    // índice único no alcanza: protege de reclamar un dominio YA cargado, no
    // uno que todavía no existe en la base.
    const tenant = await crearComercio()

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'otra-tienda.henkart.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  test('y el mensaje dice qué cargar en su lugar', async () => {
    // Rechazar bien y explicar mal deja al comercio en un callejón: el mensaje
    // anterior —"pertenece a la plataforma y no se puede reclamar"— es cierto y
    // no lo saca del error. Medido en producción: dos intentos seguidos del
    // mismo usuario contra el mismo 400, sin cambiar de idea entre uno y otro.
    //
    // La propiedad: el mensaje nombra el dominio rechazado Y da un ejemplo de
    // lo que sí va. Sin el ejemplo no hay hacia dónde corregir.
    const tenant = await crearComercio()

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'otra-tienda.henkart.com.ar' }),
    ).rejects.toThrow(/otra-tienda\.henkart\.com\.ar/)

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'otra-tienda.henkart.com.ar' }),
    ).rejects.toThrow(/mitienda\.com\.ar/)
  })

  test('NO se puede reclamar el dominio de otro comercio', async () => {
    // Lo resuelve el índice único sobre domainKeys: la base, no una
    // comprobación previa que pueda perder la carrera.
    const primero = await crearComercio()
    const segundo = await crearComercio()

    await registerTenantDomain({ tenantId: primero._id, hostname: 'disputado.com.ar' })

    await expect(
      registerTenantDomain({ tenantId: segundo._id, hostname: 'disputado.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  test('no se puede cargar dos veces el mismo en el propio comercio', async () => {
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('verificación de propiedad', () => {
  test('sin el TXT sigue pendiente, y no es un error', async () => {
    // Es el caso normal: el comercio acaba de cargar el dominio y todavía no
    // tocó su DNS. Tratarlo como falla haría que el panel muestre un error por
    // algo que está saliendo bien.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(false)
    expect(res.domain.status).toBe('pending')
    // Y se le vuelve a decir qué cargar, para no tener que buscarlo.
    expect(res.instructions.verification.name).toContain(VERIFICATION_PREFIX)
  })

  test('con el TXT correcto queda ACTIVO', async () => {
    const tenant = await crearComercio()
    const { instructions } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    resolveTxtMock.mockResolvedValue([[instructions.verification.value]])

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(true)
    expect(res.domain.status).toBe('active')
    expect(res.domain.verifiedAt).toBeInstanceOf(Date)
  })

  test('un TXT de otro NO alcanza', async () => {
    // ESTA ES LA PROPIEDAD. Que exista un TXT en ese nombre no prueba nada: lo
    // que prueba la propiedad es que sea EL token que emitimos para ESTE
    // comercio.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    resolveTxtMock.mockResolvedValue([['henko-verify=' + 'f'.repeat(32)]])

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(false)
    expect(res.domain.status).toBe('pending')
  })

  test('un TXT partido en fragmentos se une antes de comparar', async () => {
    // resolveTxt devuelve arrays de fragmentos: un TXT largo llega partido y
    // comparar fragmento por fragmento nunca daría verdadero.
    const tenant = await crearComercio()
    const { instructions } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    const token = instructions.verification.value
    const mitad = Math.floor(token.length / 2)
    resolveTxtMock.mockResolvedValue([[token.slice(0, mitad), token.slice(mitad)]])

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(true)
  })

  test('deja registrado cuándo se miró', async () => {
    // lastCheckedAt existía en el modelo y no lo escribía nadie. Sin él no se
    // puede saber si un dominio lleva pendiente cinco minutos o cinco días.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.domain.lastCheckedAt).toBeInstanceOf(Date)
  })

  test('no se puede verificar un dominio que no es del comercio', async () => {
    const tenant = await crearComercio()

    await expect(
      verifyTenantDomain({ tenantId: tenant._id, hostname: 'ajeno.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  test('un dominio de la plataforma YA cargado se puede verificar igual', async () => {
    // ESTA ES LA QUE COSTÓ UN INCIDENTE.
    //
    // La guarda de "dominio de la plataforma" corría dentro de parseHostname, o
    // sea también al verificar. Se dio de alta henkart.com.ar cuando ROOT_DOMAIN
    // todavía no estaba configurado; al configurarlo, ese mismo dominio pasó a
    // ser de la plataforma, la verificación empezó a rechazarlo, y la tienda
    // quedó devolviendo 404 sin forma de destrabarla desde el panel.
    //
    // La regla de reclamo pertenece al momento del reclamo. Verificar opera
    // sobre algo que YA está en el comercio.
    //
    // El dominio se inserta directo en vez de darlo de alta por el servicio,
    // porque el alta lo rechazaría —correctamente— y lo que se quiere reproducir
    // es justamente el estado de algo que entró cuando la regla no aplicaba.
    const token = 'henko-verify=' + 'a'.repeat(32)

    const tenant = await crearComercio()
    tenant.domains.push({
      hostname: 'tienda.henkart.com.ar',
      normalizedHostname: 'tienda.henkart.com.ar',
      type: 'custom_domain',
      context: 'both',
      status: 'pending',
      verificationToken: token,
    })
    await tenant.save()

    resolveTxtMock.mockResolvedValue([[token]])

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'tienda.henkart.com.ar',
    })

    expect(res.verified).toBe(true)
    expect(res.domain.status).toBe('active')
  })

  test('pero seguir sin poder RECLAMAR uno de la plataforma', async () => {
    // El arreglo de arriba no puede aflojar el alta: ahí la regla sigue
    // valiendo, porque es el momento en que alguien pide quedarse con algo.
    const tenant = await crearComercio()

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'otra.henkart.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('baja', () => {
  test('se puede dar de baja el dominio propio', async () => {
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    await removeTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const listado = await listTenantDomains(tenant._id)
    expect(listado.some(d => d.hostname === 'mitienda.com.ar')).toBe(false)
  })

  test('el subdominio de la plataforma NO se puede borrar', async () => {
    // Es la dirección que siempre funciona. Borrarla dejaría al comercio sin
    // ninguna forma de entrar si su dominio propio falla — y el momento en que
    // eso pasa es justo el momento en que necesita entrar.
    const tenant = await crearComercio('fijo')

    await expect(
      removeTenantDomain({ tenantId: tenant._id, hostname: 'fijo.henkart.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// Panel propio: el comercio declara para qué es cada dominio.
//
// Un hostname sirve UNA aplicación. La tienda y el panel son dos proyectos
// distintos, así que un comercio que quiere su propio panel necesita un
// segundo hostname —admin.sutienda.com— declarado como panel.
//
// Lo que estas pruebas fijan es que la declaración se respete de punta a
// punta: al dar de alta, y después al resolver qué superficie es ese host.
describe('panel propio · la superficie se declara al dar de alta', () => {
  test('por defecto un dominio propio es SOLO tienda', async () => {
    const tenant = await crearComercio()

    const { domain } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(domain.context).toBe('storefront')
  })

  test('se puede dar de alta un dominio SOLO para el panel', async () => {
    const tenant = await crearComercio()

    const { domain } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'admin.mitienda.com.ar',
      surface: 'admin',
    })

    expect(domain.context).toBe('admin')
    // Nace inerte igual que cualquier otro: sin verificar no resuelve a nada.
    expect(domain.status).toBe('pending')
  })

  test('los dos conviven en el mismo comercio', async () => {
    // Es el caso real: la tienda en el dominio propio y el panel en un
    // subdominio del mismo dominio.
    const tenant = await crearComercio()

    await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })
    await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'admin.mitienda.com.ar',
      surface: 'admin',
    })

    const lista = await listTenantDomains(tenant._id)
    const porHost = Object.fromEntries(lista.map(d => [d.hostname, d.context]))

    expect(porHost['mitienda.com.ar']).toBe('storefront')
    expect(porHost['admin.mitienda.com.ar']).toBe('admin')
  })

  test('una superficie inventada se rechaza, no se asume', async () => {
    // Asumir tienda ante un valor desconocido dejaría un panel servido como
    // tienda sin que nadie se entere.
    const tenant = await crearComercio()

    await expect(
      registerTenantDomain({
        tenantId: tenant._id,
        hostname: 'otra.com.ar',
        surface: 'cualquier-cosa',
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
