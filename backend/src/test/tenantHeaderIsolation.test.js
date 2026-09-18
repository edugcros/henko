// 📁 src/test/tenantHeaderIsolation.test.js
//
// ¿Puede un admin de un comercio operar sobre otro cambiando un header?
//
// DE DÓNDE SALE LA SOSPECHA
//
// El contexto de comercio no lo decide el host real: lo decide
// `x-tenant-domain`, un header que manda el cliente. La cadena es:
//
//   getHostResolutionInput   prioriza x-tenant-domain sobre x-forwarded-host
//                            y sobre host
//   attachTenantToRequest    escribe ese comercio en req.tenantId y en el
//                            contexto de AsyncLocalStorage que usa tenantPlugin
//   authMiddleware           pone req.user.tenantId desde el JWT, y NO lo
//                            compara con el anterior
//   getTenantIdFromRequest   devuelve `req.tenantId || req.user?.tenantId`,
//                            o sea que gana el del header
//
// Existe una guarda que hace ese cruce —resolveAuthorizedTenantFromRequest—
// pero está aplicada en 17 de 32 controllers, uno por uno. colorCtrl es de los
// que no la tienen, y su cadena de ruta es la mínima posible:
//
//   resolveTenantByDomain → requireTenant → requireAdminDomain
//   → authMiddleware → isAdmin
//
// Ninguno de esos cinco compara el comercio del JWT contra el del header.
//
// QUÉ AFIRMA ESTA PRUEBA
//
// Lo que TIENE que ser verdad: un usuario de un comercio no puede escribir en
// otro. Si el código está bien, pasa. Si está mal, falla y tenemos la medición
// en vez de una sospecha leída.
//
// Va con un control al lado —el mismo admin operando sobre SU comercio— para
// que un fallo no se pueda confundir con un problema del armado de la prueba.

import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')

const { default: app } = await import('../../app.js')
const { default: Color } = await import('../models/colorModel.js')
const { createTestTenant, createTestUser, getCSRFToken } = await import('./testSetup.js')

let mongod

beforeAll(async () => {
  // launchTimeout explícito: el default son 10 s y con la máquina cargada
  // —varias suites levantando su propia base en secuencia— no alcanza. El
  // síntoma es "Instance failed to start within 10000ms", que se lee como si
  // fallara la prueba cuando en realidad no llegó a correr.
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } })
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  // Condicional: si el arranque falló, mongod quedó undefined y este hook
  // tiraba un TypeError que tapaba el error real.
  if (mongod) await mongod.stop()
})

/**
 * Crea los dos comercios y un admin en el primero.
 *
 * El admin es REAL y su token es válido: el escenario no es un atacante sin
 * credenciales, es un cliente legítimo de la plataforma usando las suyas
 * contra el comercio de al lado. Ese es el caso que importa en un SaaS
 * multi-tenant, y el que ninguna validación de JWT detecta por sí sola.
 */
const armarEscenario = async () => {
  const propio = await createTestTenant({ name: 'Comercio Propio' })
  const ajeno = await createTestTenant({ name: 'Comercio Ajeno' })

  const { token } = await createTestUser({
    tenantId: propio.tenant._id,
    role: 'admin',
  })

  return { propio, ajeno, token }
}

describe('aislamiento entre comercios cuando el header no coincide con el JWT', () => {
  test('CONTROL · el admin puede crear en SU propio comercio', async () => {
    // Sin esto, un fallo de la prueba de abajo podría ser un problema del
    // armado —CSRF, rol, dominio mal cargado— y no la propiedad que se mide.
    const { propio, token } = await armarEscenario()
    const { csrfToken, csrfCookie } = await getCSRFToken(propio.adminDomain)

    const res = await request(app)
      .post('/api/color')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-domain', propio.adminDomain)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'verde' })

    expect(res.status).toBe(201)

    const creado = await Color.findById(res.body.data._id)
      .setOptions({ tenantId: propio.tenant._id })
      .lean()

    expect(String(creado.tenantId)).toBe(String(propio.tenant._id))
  })

  test('un admin NO puede escribir en el comercio de otro cambiando el header', async () => {
    // ESTA ES LA PROPIEDAD.
    //
    // Token del comercio propio, header apuntando al ajeno. Las cinco guardas
    // de la ruta pasan: el comercio ajeno existe, el dominio es suyo y es
    // administrativo, el JWT es válido y el rol es admin. Ninguna mira que sean
    // comercios distintos.
    const { propio, ajeno, token } = await armarEscenario()
    const { csrfToken, csrfCookie } = await getCSRFToken(ajeno.adminDomain)

    const res = await request(app)
      .post('/api/color')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-domain', ajeno.adminDomain)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'rojo' })

    // 403 y no 500. La diferencia no es cosmética:
    //
    // Antes de la guarda en authMiddleware esto devolvía 500, porque lo cortaba
    // tenantPlugin al ver que el filtro no coincidía con el contexto. O sea que
    // la protección era una EXCEPCIÓN de la capa de datos: dependía de que el
    // controller consultara antes de escribir —un `Model.create()` directo no
    // la dispara— y dejaba un stack trace de nivel error por cada intento.
    //
    // Un 403 dice lo que realmente pasó: es un intento no autorizado, no una
    // falla del servidor.
    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  test('CONTROL · el panel compartido opera sobre el comercio del token', async () => {
    // EL PANEL COMPARTIDO.
    //
    // Cada comercio tenía su panel en admin.<slug>.<raíz>: dos niveles bajo la
    // raíz, y un certificado comodín cubre uno solo. Medido contra producción,
    // admin.mitienda.henkart.com.ar fallaba el handshake TLS mientras
    // mitienda.henkart.com.ar respondía 200 — el comercio tenía tienda y no
    // podía entrar a administrarla, ni suscribirse.
    //
    // Con panel único el host ya no dice a qué comercio se entra. Lo dice la
    // sesión. Esta prueba afirma que el panel efectivamente SIRVE: que el
    // admin entra por el host compartido y escribe en su propio comercio.
    const { propio, token } = await armarEscenario()
    const panel = 'admin.henko.local'
    const { csrfToken, csrfCookie } = await getCSRFToken(panel)

    const res = await request(app)
      .post('/api/color')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-domain', panel)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'compartido' })

    expect(res.status).toBe(201)

    const creado = await Color.findById(res.body.data._id)
      .setOptions({ tenantId: propio.tenant._id })
      .lean()

    expect(String(creado.tenantId)).toBe(String(propio.tenant._id))
  })

  test('por el panel compartido el host NO puede elegir comercio', async () => {
    // LA PROPIEDAD QUE EL PANEL COMPARTIDO TIENE QUE CONSERVAR.
    //
    // El host compartido está a nombre del comercio dueño de la plataforma en
    // sus adminDomains. Si el middleware lo resolviera por dominio como a
    // cualquier otro, TODOS los comercios entrarían como ese. Por eso el panel
    // compartido se atiende antes de la búsqueda por dominio y sale de la
    // sesión.
    //
    // Se verifica el efecto en la base, no el código de respuesta: lo que
    // importa es en qué comercio terminó el dato.
    const { propio, ajeno, token } = await armarEscenario()
    const panel = 'admin.henko.local'
    const { csrfToken, csrfCookie } = await getCSRFToken(panel)

    await request(app)
      .post('/api/color')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-domain', panel)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'del propio' })

    const enElAjeno = await Color.find({ tenantId: ajeno.tenant._id })
      .setOptions({ tenantId: ajeno.tenant._id })
      .lean()

    const enElPropio = await Color.find({ tenantId: propio.tenant._id })
      .setOptions({ tenantId: propio.tenant._id })
      .lean()

    expect(enElAjeno).toHaveLength(0)
    expect(enElPropio.map(c => c.title)).toContain('del propio')
  })

  test('sin sesión el panel compartido responde 401, no 400', async () => {
    // Sin comercio en el host y sin token no hay comercio posible. Un 400
    // "Tenant no identificado" mandaría al panel a mostrar un error de datos;
    // un 401 le dice lo que pasa —falta sesión— y puede renovar el token o
    // mandar a iniciar sesión de nuevo.
    const panel = 'admin.henko.local'
    const { csrfToken, csrfCookie } = await getCSRFToken(panel)

    const res = await request(app)
      .post('/api/color')
      .set('x-tenant-domain', panel)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'sin sesion' })

    expect(res.status).toBe(401)
  })

  test('el comercio con panel PROPIO sigue entrando por su dominio', async () => {
    // El panel compartido no reemplaza al propio: un comercio que cargó su
    // dominio administrativo tiene que seguir entrando por ahí, o el cambio
    // rompería a quien ya lo estaba usando.
    const { propio, token } = await armarEscenario()
    const { csrfToken, csrfCookie } = await getCSRFToken(propio.adminDomain)

    const res = await request(app)
      .post('/api/color')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-domain', propio.adminDomain)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'por dominio propio' })

    expect(res.status).toBe(201)
  })

  test('y sobre todo: no queda el dato escrito en el comercio ajeno', async () => {
    // El código de respuesta es una cosa y el efecto en la base es otra. Un
    // 500 después de haber escrito seguiría siendo una fuga: lo que importa es
    // que el comercio ajeno no termine con un dato que no puso.
    const { propio, ajeno, token } = await armarEscenario()
    const { csrfToken, csrfCookie } = await getCSRFToken(ajeno.adminDomain)

    await request(app)
      .post('/api/color')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-domain', ajeno.adminDomain)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'azul' })

    const enElAjeno = await Color.find({ tenantId: ajeno.tenant._id })
      .setOptions({ tenantId: ajeno.tenant._id })
      .lean()

    expect(enElAjeno).toHaveLength(0)
  })
})
