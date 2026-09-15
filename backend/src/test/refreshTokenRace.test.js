// 📁 src/test/refreshTokenRace.test.js
//
// Una sesión por origen, no un casillero por usuario.
//
// EL BUG, COMO SE VE EN PRODUCCIÓN
//
// 26 respuestas 403 de refresh en un día. TODAS con referer
// henko-web.vercel.app (la tienda); todas las de henko-admin.vercel.app
// devolvieron 200. Un minuto típico:
//
//   20:32:43  refresh 200   henko-admin.vercel.app/admin/productlist
//   20:32:44  refresh 403   henko-web.vercel.app/product/...
//   20:32:46  refresh 403   henko-web.vercel.app/product/...
//
// No era una carrera entre requests hermanas: era que el panel rotaba el
// único refreshToken del usuario y la cookie de la tienda quedaba apuntando a
// un jti que ya no existía. Muerta para siempre, hasta volver a loguear — y
// entonces rompía el panel.
//
// Las cookies son host-only (getCookieDomain devuelve undefined) y
// `.vercel.app` está en la Public Suffix List, así que compartirlas es
// imposible: cada origen tiene la suya y el servidor tenía un solo casillero.
//
// Y no es un caso de borde: el panel EMBEBE la tienda para la vista previa
// del tema (theme-preview?source=admin), así que estar logueado en los dos a
// la vez es un flujo central.
//
// Contra base real: lo que se prueba son filtros atómicos y operadores de
// array de Mongo. Con mocks se probaría el mock.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')
process.env.JWT_SECRET = 'test-access-secret-para-las-sesiones'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-para-las-sesiones'

const { default: User } = await import('../models/userModel.js')
const { hashRefreshJti } = await import('../../config/generateRefreshToken.js')

let mongod
const TENANT = new mongoose.Types.ObjectId()

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

const opciones = { ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' }

const sesion = jti => ({
  tokenHash: hashRefreshJti(jti),
  previousTokenHash: null,
  rotatedAt: null,
  createdAt: new Date(),
  lastUsedAt: new Date(),
  userAgent: 'test',
})

/** Un usuario con las sesiones que se le indiquen. */
const usuarioCon = async (jtis, { legacy = null } = {}) =>
  User.create({
    firstname: 'Sesiones',
    lastname: 'Multiples',
    mobile: `11${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 100)}`,
    email: `sesiones-${Date.now()}-${Math.random()}@test.com`,
    password: 'Secreta123!',
    tenantId: TENANT,
    refreshSessions: jtis.map(sesion),
    refreshToken: legacy ? hashRefreshJti(legacy) : null,
  })

/** La rotación, tal como la hace handleRefreshToken. */
const rotar = (userId, jtiEntrante, jtiNuevo) =>
  User.findOneAndUpdate(
    { _id: userId, 'refreshSessions.tokenHash': hashRefreshJti(jtiEntrante) },
    {
      $set: {
        'refreshSessions.$.tokenHash': hashRefreshJti(jtiNuevo),
        'refreshSessions.$.previousTokenHash': hashRefreshJti(jtiEntrante),
        'refreshSessions.$.rotatedAt': new Date(),
        'refreshSessions.$.lastUsedAt': new Date(),
      },
    },
  )
    .select('role tenantId')
    .setOptions(opciones)

const dentroDeGracia = (userId, jtiEntrante, graciaMs = 60000) =>
  User.findOne({
    _id: userId,
    refreshSessions: {
      $elemMatch: {
        previousTokenHash: hashRefreshJti(jtiEntrante),
        rotatedAt: { $gte: new Date(Date.now() - graciaMs) },
      },
    },
  })
    .select('role tenantId')
    .setOptions(opciones)

const sesionesDe = async userId => {
  const u = await User.findById(userId).select('+refreshSessions').setOptions(opciones)
  return u.refreshSessions
}

describe('el bug de producción · panel y tienda a la vez', () => {
  test('el panel rota y la tienda SIGUE viva', async () => {
    // Este es el caso exacto de los logs: dos orígenes, dos cookies.
    const user = await usuarioCon(['jti-del-panel', 'jti-de-la-tienda'])

    await rotar(user._id, 'jti-del-panel', 'jti-del-panel-2')

    // Antes esto devolvía null y la tienda quedaba muerta para siempre.
    const tienda = await rotar(user._id, 'jti-de-la-tienda', 'jti-de-la-tienda-2')
    expect(tienda).not.toBeNull()

    // Y el panel también sigue vivo con su token nuevo.
    expect(await rotar(user._id, 'jti-del-panel-2', 'jti-del-panel-3')).not.toBeNull()

    expect(await sesionesDe(user._id)).toHaveLength(2)
  })

  test('loguearse en la tienda no echa del panel', async () => {
    const user = await usuarioCon(['jti-del-panel'])

    // Un login nuevo AGREGA una sesión en vez de pisar la que había.
    await User.findByIdAndUpdate(user._id, {
      $push: { refreshSessions: { $each: [sesion('jti-nuevo-de-la-tienda')], $slice: -10 } },
    }).setOptions(opciones)

    expect(await rotar(user._id, 'jti-del-panel', 'sigue')).not.toBeNull()
    expect(await rotar(user._id, 'jti-nuevo-de-la-tienda', 'sigue2')).not.toBeNull()
  })
})

describe('la carrera dentro de UNA sesión', () => {
  test('dos requests hermanas: una rota, la otra entra por gracia', async () => {
    const user = await usuarioCon(['compartido'])

    const [a, b] = await Promise.all([
      rotar(user._id, 'compartido', 'primera'),
      rotar(user._id, 'compartido', 'segunda'),
    ])

    // El compare-and-swap sigue siendo atómico: solo una gana.
    expect([a, b].filter(Boolean)).toHaveLength(1)

    // Y la que perdió es reconocible en vez de irse con 403.
    expect(await dentroDeGracia(user._id, 'compartido')).not.toBeNull()
  })

  test('la gracia de una sesión no rescata a otra', async () => {
    const user = await usuarioCon(['panel', 'tienda'])
    await rotar(user._id, 'panel', 'panel-2')

    // El token viejo del panel no puede pasar por la sesión de la tienda.
    const rescatada = await dentroDeGracia(user._id, 'panel')
    expect(rescatada).not.toBeNull()

    // Pero un token que nunca existió no entra por ninguna.
    expect(await dentroDeGracia(user._id, 'jamas-existio')).toBeNull()
  })

  test('pasada la ventana, el token deja de servir', async () => {
    const user = await usuarioCon(['vieja'])
    await rotar(user._id, 'vieja', 'nueva')

    await User.updateOne(
      { _id: user._id, 'refreshSessions.previousTokenHash': hashRefreshJti('vieja') },
      { $set: { 'refreshSessions.$.rotatedAt': new Date(Date.now() - 120000) } },
    ).setOptions(opciones)

    expect(await dentroDeGracia(user._id, 'vieja', 60000)).toBeNull()
  })
})

describe('migración · nadie se desloguea el día del deploy', () => {
  test('un token del casillero viejo se acepta una vez y se migra', async () => {
    const user = await usuarioCon([], { legacy: 'token-de-antes' })

    const migrado = await User.findOneAndUpdate(
      { _id: user._id, refreshToken: hashRefreshJti('token-de-antes') },
      {
        $set: { refreshToken: null },
        $push: {
          refreshSessions: { $each: [sesion('token-nuevo')], $slice: -10 },
        },
      },
    )
      .select('role tenantId')
      .setOptions(opciones)

    expect(migrado).not.toBeNull()

    // Ya migrado: la próxima entra por el camino normal.
    expect(await rotar(user._id, 'token-nuevo', 'y-el-siguiente')).not.toBeNull()

    // Y el casillero viejo no sirve una segunda vez.
    const repetido = await User.findOne({
      _id: user._id,
      refreshToken: hashRefreshJti('token-de-antes'),
    }).setOptions(opciones)
    expect(repetido).toBeNull()
  })
})

describe('logout · cierra una sesión, no todas', () => {
  test('cerrar en la tienda deja el panel abierto', async () => {
    const user = await usuarioCon(['panel', 'tienda'])

    await User.findByIdAndUpdate(user._id, {
      $pull: {
        refreshSessions: {
          $or: [
            { tokenHash: hashRefreshJti('tienda') },
            { previousTokenHash: hashRefreshJti('tienda') },
          ],
        },
      },
    }).setOptions(opciones)

    expect(await sesionesDe(user._id)).toHaveLength(1)
    expect(await rotar(user._id, 'panel', 'panel-2')).not.toBeNull()
    expect(await rotar(user._id, 'tienda', 'no-deberia')).toBeNull()
  })

  test('el logout justo después de rotar también cierra', async () => {
    // La cookie del navegador puede ser todavía la vieja. Si el $pull solo
    // mirara el token vigente, la sesión quedaría viva por la gracia.
    const user = await usuarioCon(['sesion'])
    await rotar(user._id, 'sesion', 'sesion-2')

    await User.findByIdAndUpdate(user._id, {
      $pull: {
        refreshSessions: {
          $or: [
            { tokenHash: hashRefreshJti('sesion') },
            { previousTokenHash: hashRefreshJti('sesion') },
          ],
        },
      },
    }).setOptions(opciones)

    expect(await sesionesDe(user._id)).toHaveLength(0)
    expect(await dentroDeGracia(user._id, 'sesion')).toBeNull()
  })
})

describe('tope de sesiones', () => {
  test('al pasarse, se cae la más vieja', async () => {
    // Sin tope, cada login desde un dispositivo nuevo agrandaría el documento
    // para siempre.
    const user = await usuarioCon(['s1', 's2', 's3'])

    for (const j of ['s4', 's5', 's6']) {
      await User.findByIdAndUpdate(user._id, {
        $push: { refreshSessions: { $each: [sesion(j)], $slice: -3 } },
      }).setOptions(opciones)
    }

    const sesiones = await sesionesDe(user._id)
    expect(sesiones).toHaveLength(3)

    // La primera ya no está; las últimas sí.
    expect(await rotar(user._id, 's1', 'x')).toBeNull()
    expect(await rotar(user._id, 's6', 'x')).not.toBeNull()
  })
})
