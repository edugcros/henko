// 📁 src/test/sessionRevocation.test.js
//
// Cambiar la contraseña cierra todas las sesiones abiertas, y un comprador no
// impide abrir una tienda con su email.
//
// EL AGUJERO
//
// passwordChangedAt invalida los ACCESS tokens emitidos antes del cambio
// (authMiddleware). Pero el refresco no lo mira: busca la sesión por su hash en
// `refreshSessions` y emite un access token NUEVO, con iat posterior, que pasa
// esa comprobación. updatePassword y resetPassword solo limpiaban `refreshToken`
// —el casillero viejo, anterior a las sesiones por origen—, así que las
// sesiones seguían vivas: quien tuviera una cookie de refresco robada seguía
// entrando después de que la víctima cambiara la contraseña, que es justo lo que
// se hace al sospechar un robo.
//
// Contra base real: lo que se prueba es lo que el hook de Mongoose escribe y lo
// que los filtros de Mongo encuentran. Con mocks se probaría el mock.

import crypto from 'node:crypto'

import mongoose from 'mongoose'

import { crearMongoEnMemoria } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')
process.env.JWT_SECRET = 'test-access-secret-para-las-sesiones'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-para-las-sesiones'

const { default: User } = await import('../models/userModel.js')
const { hashRefreshJti } = await import('../../config/generateRefreshToken.js')
const { resetPassword } = await import('../controller/userCtrl.js')
const { adminEmailExists } = await import('../services/adminIdentityService.js')

let mongod
const TENANT = new mongoose.Types.ObjectId()
const OTRO_TENANT = new mongoose.Types.ObjectId()

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

const opciones = { ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' }

const unico = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

const movil = () => `11${Math.floor(10000000 + Math.random() * 89999999)}`

const sesion = jti => ({
  tokenHash: hashRefreshJti(jti),
  previousTokenHash: null,
  rotatedAt: null,
  createdAt: new Date(),
  lastUsedAt: new Date(),
  userAgent: 'test',
})

const crearUsuario = (extra = {}) =>
  User.create({
    firstname: 'Sesiones',
    lastname: 'Multiples',
    mobile: movil(),
    email: `usuario-${unico()}@test.com`,
    password: 'Secreta123!',
    tenantId: TENANT,
    role: 'user',
    ...extra,
  })

const usuarioConSesiones = (jtis, { legacy = null, ...extra } = {}) =>
  crearUsuario({
    refreshSessions: jtis.map(sesion),
    refreshToken: legacy ? hashRefreshJti(legacy) : null,
    ...extra,
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

/** La ventana de gracia, tal como la consulta handleRefreshToken. */
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

const leer = userId =>
  User.findById(userId).select('+refreshSessions +refreshToken').setOptions(opciones)

/**
 * Cargado como lo cargan updatePassword y resetPassword: con la contraseña y
 * SIN las sesiones, que tienen select:false. Es el caso difícil: el hook tiene
 * que vaciar un campo que el documento ni siquiera trajo.
 */
const cargarComoLosControladores = userId =>
  User.findById(userId).select('+password').setOptions(opciones)

describe('cambiar la contraseña cierra las sesiones abiertas', () => {
  test('vacía las sesiones y el casillero viejo, aunque no se hayan cargado', async () => {
    const user = await usuarioConSesiones(['jti-panel', 'jti-tienda'], { legacy: 'jti-viejo' })

    const cargado = await cargarComoLosControladores(user._id)
    cargado.password = 'Nueva123!xyz'
    await cargado.save()

    const despues = await leer(user._id)
    expect(despues.refreshSessions).toHaveLength(0)
    expect(despues.refreshToken).toBeNull()
  })

  test('también cuando las sesiones sí estaban cargadas', async () => {
    const user = await usuarioConSesiones(['jti-a', 'jti-b'])

    const cargado = await leer(user._id)
    cargado.password = 'Nueva123!xyz'
    await cargado.save()

    expect((await leer(user._id)).refreshSessions).toHaveLength(0)
  })

  test('fija passwordChangedAt y guarda la contraseña nueva', async () => {
    const user = await usuarioConSesiones(['jti-a'])

    const cargado = await cargarComoLosControladores(user._id)
    cargado.password = 'Nueva123!xyz'
    await cargado.save()

    const despues = await User.findById(user._id).select('+password').setOptions(opciones)

    expect(despues.passwordChangedAt).toBeInstanceOf(Date)
    expect(await despues.isPasswordMatched('Nueva123!xyz')).toBe(true)
    expect(await despues.isPasswordMatched('Secreta123!')).toBe(false)
  })

  test('la cookie de refresco robada YA NO rota después del cambio', async () => {
    // El caso del ataque: la víctima cambia la contraseña y el ladrón intenta
    // refrescar con la cookie que se llevó.
    const user = await usuarioConSesiones(['jti-robado'])

    const cargado = await cargarComoLosControladores(user._id)
    cargado.password = 'Nueva123!xyz'
    await cargado.save()

    expect(await rotar(user._id, 'jti-robado', 'jti-del-ladron')).toBeNull()
    // Y tampoco por la ventana de gracia.
    expect(await dentroDeGracia(user._id, 'jti-robado')).toBeNull()
  })

  test('una cookie que ya había rotado tampoco sobrevive (ventana de gracia)', async () => {
    const user = await usuarioConSesiones(['jti-1'])
    await rotar(user._id, 'jti-1', 'jti-2')
    // Antes del cambio, jti-1 todavía estaría dentro de la gracia.
    expect(await dentroDeGracia(user._id, 'jti-1')).not.toBeNull()

    const cargado = await cargarComoLosControladores(user._id)
    cargado.password = 'Nueva123!xyz'
    await cargado.save()

    expect(await dentroDeGracia(user._id, 'jti-1')).toBeNull()
    expect(await rotar(user._id, 'jti-2', 'jti-3')).toBeNull()
  })

  test('el dueño puede volver a iniciar sesión y esa sesión nueva sí rota', async () => {
    const user = await usuarioConSesiones(['jti-viejo'])

    const cargado = await cargarComoLosControladores(user._id)
    cargado.password = 'Nueva123!xyz'
    await cargado.save()

    // Un login nuevo agrega una sesión, tal como hace loginHandler.
    await User.findByIdAndUpdate(user._id, {
      $push: { refreshSessions: { $each: [sesion('jti-login-nuevo')], $slice: -10 } },
    }).setOptions(opciones)

    expect(await rotar(user._id, 'jti-login-nuevo', 'jti-login-nuevo-2')).not.toBeNull()
    expect(await rotar(user._id, 'jti-viejo', 'jti-x')).toBeNull()
  })

  test('guardar otros campos NO toca las sesiones', async () => {
    const user = await usuarioConSesiones(['jti-a', 'jti-b'], { legacy: 'jti-viejo' })

    const cargado = await leer(user._id)
    cargado.firstname = 'Otro'
    await cargado.save()

    const despues = await leer(user._id)
    expect(despues.refreshSessions).toHaveLength(2)
    expect(despues.refreshToken).not.toBeNull()
  })

  test('crear un usuario con contraseña no se ve afectado', async () => {
    const user = await crearUsuario()

    const despues = await leer(user._id)
    expect(despues.refreshSessions).toHaveLength(0)
    expect(despues.passwordChangedAt).toBeInstanceOf(Date)
  })

  test('las sesiones de OTRO usuario no se tocan', async () => {
    const victima = await usuarioConSesiones(['jti-victima'])
    const otro = await usuarioConSesiones(['jti-otro'])

    const cargado = await cargarComoLosControladores(victima._id)
    cargado.password = 'Nueva123!xyz'
    await cargado.save()

    expect((await leer(otro._id)).refreshSessions).toHaveLength(1)
  })
})

describe('resetPassword · el handler real', () => {
  const respuesta = () => ({
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  })

  const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex')

  test('restablecer la contraseña cierra las sesiones del usuario', async () => {
    const crudo = `reset-${unico()}`

    const user = await usuarioConSesiones(['jti-robado', 'jti-legitimo'], {
      passwordResetToken: hashToken(crudo),
      passwordResetExpires: new Date(Date.now() + 10 * 60 * 1000),
    })

    const res = respuesta()
    await resetPassword({ body: { token: crudo, password: 'Restablecida123!' } }, res, error => {
      throw error
    })

    expect(res.statusCode).toBe(200)

    const despues = await leer(user._id)
    expect(despues.refreshSessions).toHaveLength(0)

    // La cookie robada no puede refrescar.
    expect(await rotar(user._id, 'jti-robado', 'jti-ladron')).toBeNull()

    // Y la contraseña quedó cambiada de verdad.
    const conClave = await User.findById(user._id).select('+password').setOptions(opciones)
    expect(await conClave.isPasswordMatched('Restablecida123!')).toBe(true)
  })

  test('un token de reseteo inválido no cierra nada', async () => {
    const user = await usuarioConSesiones(['jti-a'])

    const res = respuesta()
    await resetPassword(
      { body: { token: 'no-existe', password: 'Restablecida123!' } },
      res,
      error => {
        throw error
      },
    )

    expect(res.statusCode).toBe(400)
    expect((await leer(user._id)).refreshSessions).toHaveLength(1)
  })
})

describe('adminEmailExists · un comprador no impide abrir una tienda', () => {
  test('el email de un COMPRADOR de otra tienda no cuenta', async () => {
    const email = `comprador-${unico()}@test.com`
    await crearUsuario({ email, tenantId: OTRO_TENANT, role: 'user' })

    expect(await adminEmailExists(email)).toBe(false)
  })

  test('el email de un ADMIN de cualquier tienda sí cuenta', async () => {
    const email = `admin-${unico()}@test.com`
    await crearUsuario({ email, tenantId: OTRO_TENANT, role: 'admin' })

    expect(await adminEmailExists(email)).toBe(true)
  })

  test('un email que no existe no cuenta', async () => {
    expect(await adminEmailExists(`nadie-${unico()}@test.com`)).toBe(false)
  })

  test('alguien que compró en una tienda puede ser admin de la suya', async () => {
    // El caso real: el índice es {email, tenantId}, así que el mismo email
    // convive como comprador en una tienda y como admin en otra.
    const email = `ambos-${unico()}@test.com`

    await crearUsuario({ email, tenantId: OTRO_TENANT, role: 'user' })
    expect(await adminEmailExists(email)).toBe(false)

    await expect(crearUsuario({ email, tenantId: TENANT, role: 'admin' })).resolves.toBeTruthy()

    // Y a partir de ahí ya es admin de una tienda: no puede serlo de otra.
    expect(await adminEmailExists(email)).toBe(true)
  })

  test('acepta una sesión de transacción nula', async () => {
    await expect(adminEmailExists(`x-${unico()}@test.com`, null)).resolves.toBe(false)
  })
})
