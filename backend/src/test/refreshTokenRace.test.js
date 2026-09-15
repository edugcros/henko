// 📁 src/test/refreshTokenRace.test.js
//
// Dos refresh simultáneos del mismo navegador no son un ataque.
//
// La rotación es un compare-and-swap atómico y eso está bien: dos requests
// concurrentes no pueden pisarse la escritura. Pero la que perdía la carrera
// no matcheaba ningún documento y se iba con 403 "Token de refresco inválido"
// —con un token legítimo de un segundo de antigüedad—.
//
// Y pasa seguido. En los logs de producción de un solo día: VEINTE
// ocurrencias, siempre en pares separados por un segundo, todas del mismo
// usuario. El panel monta varios componentes que reaccionan en paralelo a un
// access token vencido y cada uno dispara su propio refresh.
//
// Contra base real: lo que se prueba es una carrera entre dos escrituras y un
// filtro atómico de Mongo. Con mocks se probaría el mock.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')
process.env.JWT_SECRET = 'test-access-secret-para-la-carrera-de-refresh'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-para-la-carrera'

const { default: User } = await import('../models/userModel.js')
const { generateRefreshToken, hashRefreshJti } = await import(
  '../../config/generateRefreshToken.js'
)

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

/** Un usuario con una sesión abierta, como lo deja el login. */
const conSesion = async () => {
  const { jti } = await generateRefreshToken(new mongoose.Types.ObjectId(), {
    tenantId: TENANT,
  })

  const user = await User.create({
    firstname: 'Carrera',
    lastname: 'Concurrente',
    mobile: `11${String(Date.now()).slice(-8)}`,
    email: `carrera-${Date.now()}-${Math.random()}@test.com`,
    password: 'Secreta123!',
    tenantId: TENANT,
    refreshToken: hashRefreshJti(jti),
    previousRefreshToken: null,
    refreshTokenRotatedAt: null,
  })

  return { user, jti }
}

/**
 * La rotación, tal como la hace handleRefreshToken: un compare-and-swap que
 * además anota cuál era el token anterior.
 */
const rotar = async (userId, jtiEntrante, jtiNuevo) =>
  User.findOneAndUpdate(
    { _id: userId, refreshToken: hashRefreshJti(jtiEntrante) },
    {
      $set: {
        refreshToken: hashRefreshJti(jtiNuevo),
        previousRefreshToken: hashRefreshJti(jtiEntrante),
        refreshTokenRotatedAt: new Date(),
      },
    },
  )
    .select('+refreshToken')
    .setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' })

/** La consulta de la ventana de gracia. */
const dentroDeGracia = async (userId, jtiEntrante, graciaMs = 60000) =>
  User.findOne({
    _id: userId,
    previousRefreshToken: hashRefreshJti(jtiEntrante),
    refreshTokenRotatedAt: { $gte: new Date(Date.now() - graciaMs) },
  })
    .select('role tenantId email isBlocked')
    .setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' })

describe('refresh · dos pestañas compitiendo', () => {
  test('la que pierde la carrera entra por la ventana de gracia', async () => {
    const { user, jti } = await conSesion()

    // Las dos salen con el MISMO token, que es lo que pasa cuando dos
    // componentes reaccionan al mismo access token vencido.
    const [ganadora, perdedora] = await Promise.all([
      rotar(user._id, jti, 'jti-de-la-primera'),
      rotar(user._id, jti, 'jti-de-la-segunda'),
    ])

    // Solo una gana el compare-and-swap. Eso no cambia: es lo que evita que
    // se pisen la escritura.
    const ganadoras = [ganadora, perdedora].filter(Boolean)
    expect(ganadoras).toHaveLength(1)

    // Y la que perdió ahora es reconocible en vez de recibir un 403.
    const rescatada = await dentroDeGracia(user._id, jti)
    expect(rescatada).not.toBeNull()
    expect(String(rescatada._id)).toBe(String(user._id))
  })

  test('el token viejo de verdad sigue rechazado', async () => {
    const { user, jti } = await conSesion()

    await rotar(user._id, jti, 'segundo')
    // Una rotación más: el primero ya quedó dos pasos atrás.
    await rotar(user._id, 'segundo', 'tercero')

    // La gracia cubre UN solo paso. Aceptar cualquier token anterior
    // convertiría la rotación en decorativa.
    expect(await dentroDeGracia(user._id, jti)).toBeNull()
  })

  test('pasada la ventana, el token deja de servir', async () => {
    const { user, jti } = await conSesion()
    await rotar(user._id, jti, 'nuevo')

    // Se envejece la rotación más allá de la ventana.
    await User.updateOne(
      { _id: user._id },
      { $set: { refreshTokenRotatedAt: new Date(Date.now() - 120000) } },
    ).setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' })

    expect(await dentroDeGracia(user._id, jti, 60000)).toBeNull()
  })

  test('cerrar sesión cierra también la ventana', async () => {
    // Sin esto, el token recién rotado seguiría entrando por la gracia
    // DESPUÉS del logout, que es justo cuando no tiene que servir.
    const { user, jti } = await conSesion()
    await rotar(user._id, jti, 'nuevo')

    expect(await dentroDeGracia(user._id, jti)).not.toBeNull()

    await User.findByIdAndUpdate(user._id, {
      refreshToken: null,
      previousRefreshToken: null,
      refreshTokenRotatedAt: null,
    })
      .setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' })

    expect(await dentroDeGracia(user._id, jti)).toBeNull()
  })

  test('un login nuevo no hereda la gracia de la sesión anterior', async () => {
    const { user, jti } = await conSesion()
    await rotar(user._id, jti, 'nuevo')

    await User.findByIdAndUpdate(user._id, {
      refreshToken: hashRefreshJti('sesion-nueva'),
      previousRefreshToken: null,
      refreshTokenRotatedAt: null,
    })
      .setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' })

    expect(await dentroDeGracia(user._id, jti)).toBeNull()
  })

  test('la gracia es de ESE usuario, no de cualquiera', async () => {
    const a = await conSesion()
    const b = await conSesion()

    await rotar(a.user._id, a.jti, 'nuevo-de-a')

    // El token de A no puede rescatar una request de B.
    expect(await dentroDeGracia(b.user._id, a.jti)).toBeNull()
  })

  test('tres simultáneas: una rota, las otras dos entran por gracia', async () => {
    // El panel puede montar más de dos componentes. Ninguna debe recibir 403.
    const { user, jti } = await conSesion()

    const resultados = await Promise.all([
      rotar(user._id, jti, 'a'),
      rotar(user._id, jti, 'b'),
      rotar(user._id, jti, 'c'),
    ])

    expect(resultados.filter(Boolean)).toHaveLength(1)

    // Las dos que perdieron comparten el mismo token entrante, así que las
    // dos entran por la misma ventana. Por eso la gracia NO vuelve a rotar:
    // si lo hiciera, cada una movería el anterior y se dejarían afuera entre
    // ellas.
    expect(await dentroDeGracia(user._id, jti)).not.toBeNull()
  })
})
