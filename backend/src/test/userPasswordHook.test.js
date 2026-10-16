// 📁 src/test/userPasswordHook.test.js
//
// El hook pre('save') de User cierra las sesiones cuando cambia la contraseña.
//
// Sin base de datos, a propósito: complementa sessionRevocation.test.js (que
// prueba lo mismo contra Mongo real) con algo que corre en cualquier entorno.
// Ejecuta los hooks REALES del schema sobre un documento cargado como lo cargan
// updatePassword y resetPassword —con la contraseña y SIN las sesiones, que
// tienen select:false— y mira qué actualización se mandaría a la base.
//
// Usa `schema.s.hooks.execPre`, que es interno de Mongoose 6: si una
// actualización mayor lo mueve, esta prueba falla de forma evidente y la
// cobertura contra base real de sessionRevocation.test.js sigue ahí.

import mongoose from 'mongoose'

process.env.JWT_SECRET = 'test-access-secret-para-las-sesiones'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-para-las-sesiones'

const { default: User } = await import('../models/userModel.js')

const datosBase = () => ({
  _id: new mongoose.Types.ObjectId(),
  tenantId: new mongoose.Types.ObjectId(),
  email: 'ana@test.com',
  firstname: 'Ana',
  lastname: 'Perez',
  mobile: '1155551234',
  role: 'user',
})

const correrPreSave = doc =>
  new Promise((resolve, reject) => {
    User.schema.s.hooks.execPre('save', doc, [], error => (error ? reject(error) : resolve()))
  })

/** Como lo cargan los controladores: contraseña sí, sesiones y casillero no. */
const cargarComoLosControladores = () =>
  User.hydrate({ ...datosBase(), password: 'Vieja123!x' }, { refreshSessions: 0, refreshToken: 0 })

const actualizacionDe = doc => doc.$__delta()?.[1]?.$set || {}

describe('User · pre(save) y las sesiones', () => {
  test('cambiar la contraseña vacía las sesiones y el casillero viejo', async () => {
    const doc = cargarComoLosControladores()
    doc.password = 'Nueva123!xyz'

    await correrPreSave(doc)

    const set = actualizacionDe(doc)
    expect(set.refreshSessions).toEqual([])
    expect(set.refreshToken).toBeNull()
  })

  test('fija passwordChangedAt y guarda la contraseña hasheada', async () => {
    const doc = cargarComoLosControladores()
    doc.password = 'Nueva123!xyz'

    await correrPreSave(doc)

    const set = actualizacionDe(doc)
    expect(set.passwordChangedAt).toBeTruthy()
    expect(set.password).toMatch(/^\$2[aby]\$/)
    expect(set.password).not.toContain('Nueva123!xyz')
  })

  test('guardar otros campos NO toca las sesiones', async () => {
    const doc = cargarComoLosControladores()
    doc.firstname = 'Otro'

    await correrPreSave(doc)

    const set = actualizacionDe(doc)
    expect('refreshSessions' in set).toBe(false)
    expect('refreshToken' in set).toBe(false)
    expect('passwordChangedAt' in set).toBe(false)
  })

  test('un usuario nuevo con contraseña no pasa por la revocación', async () => {
    const { _id, ...resto } = datosBase()
    const doc = new User({ ...resto, password: 'Secreta123!' })

    expect(doc.isNew).toBe(true)

    await correrPreSave(doc)

    expect(doc.refreshToken ?? null).toBeNull()
    expect(doc.passwordChangedAt).toBeInstanceOf(Date)
  })
})
