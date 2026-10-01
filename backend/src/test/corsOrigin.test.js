// La política de CORS: cómo reporta un rechazo, y qué hace cuando no puede
// averiguar nada porque la base no responde.
//
// No prueba QUÉ orígenes se permiten —eso depende de la base y del entorno de
// cada instalación— sino las dos cosas que estaban mal:
//
//  1. El Error de rechazo salía sin `statusCode`, y el manejador global
//     clasifica como 500 todo lo que no declare uno. La política haciendo
//     exactamente su trabajo se contaba como falla del servidor, y ensuciaba
//     la señal que se mira para encontrar incidentes de verdad.
//
//  2. Con la base caída, la verificación se colgaba 10 segundos. El preflight
//     de CORS es lo PRIMERO que hace el navegador, antes de llegar a ninguna
//     ruta, así que eso era 10 segundos en cada pedido de cada comercio con
//     dominio propio.
//
// POR QUE SE SIMULAN EL MODELO Y EL ESTADO DE LA CONEXIÓN
//
// Sin simularlos, la prueba sale a buscar una base de verdad: mongoose encola
// la consulta y la suelta recién a los 10 segundos. Simulándolos se puede
// recorrer a voluntad lo que en producción es un incidente.

import { jest } from '@jest/globals'

const tenantFindOne = jest.fn()
const estadoDeBase = jest.fn()

jest.unstable_mockModule('../models/tenantModel.js', () => ({
  default: { findOne: (...args) => tenantFindOne(...args) },
}))

jest.unstable_mockModule('../../config/connectDB.js', () => ({
  default: jest.fn(),
  closeDB: jest.fn(),
  estadoDeBase,
}))

const { default: corsOptions } = await import('../../config/corsOptions.js')

const pedirOrigen = origin =>
  new Promise(resolve => {
    corsOptions.origin(origin, (error, permitido) =>
      resolve({ error, permitido }),
    )
  })

// La cadena real es .select().maxTimeMS().lean()
const consultaQueDevuelve = tenant => ({
  select: () => ({ maxTimeMS: () => ({ lean: () => Promise.resolve(tenant) }) }),
})

const CONECTADO = { listo: true, conexion: 'conectado', readyState: 1 }
const SIN_CONEXION = { listo: false, conexion: 'desconectado', readyState: 0 }

beforeEach(() => {
  jest.clearAllMocks()
  estadoDeBase.mockReturnValue(CONECTADO)
  // Ningún comercio reclama el dominio: es el camino de rechazo.
  tenantFindOne.mockReturnValue(consultaQueDevuelve(null))
})

describe('política de CORS · cómo reporta un rechazo', () => {
  test('un origen desconocido produce 403, no 500', async () => {
    const { error } = await pedirOrigen('https://dominio-ajeno.example')

    expect(error).toBeInstanceOf(Error)
    expect(error.statusCode).toBe(403)
    expect(error.code).toBe('CORS_ORIGIN_BLOCKED')
  })

  test('el mensaje no le devuelve al que llama el origen que mandó', async () => {
    const origenHostil = 'https://<script>.example'

    const { error } = await pedirOrigen(origenHostil)

    // El origen queda en el error para el log, pero fuera del mensaje: el
    // manejador global devuelve `message` al cliente en los 4xx, y no hay
    // motivo para reflejarle un valor que él mismo controla.
    expect(error.message).not.toContain(origenHostil)
    expect(error.origin).toBe(origenHostil)
  })

  test('una petición sin Origin pasa — es server-to-server, curl o same-origin', async () => {
    const { error, permitido } = await pedirOrigen(undefined)

    expect(error).toBeNull()
    expect(permitido).toBe(true)
  })
})

describe('política de CORS · cuando la base no responde', () => {
  test('sin conexión no se encola la consulta: es lo que colgaba 10 segundos', async () => {
    estadoDeBase.mockReturnValue(SIN_CONEXION)

    const { error } = await pedirOrigen('https://nunca-visto.example')

    // Lo que importa no es el error, es que NO se haya tocado la base: una
    // consulta encolada es exactamente la que mongoose suelta a los 10s.
    expect(tenantFindOne).not.toHaveBeenCalled()
    expect(error).toBeInstanceOf(Error)
    // No es un origen bloqueado: es que no se pudo averiguar. Eso es 500.
    expect(error.statusCode).toBeUndefined()
  })

  test('un comercio que venía andando sobrevive la caída, con la caché vencida', async () => {
    const origen = 'https://comercio-conocido.example'

    // 1. Con la base sana queda cacheado como permitido.
    tenantFindOne.mockReturnValue(consultaQueDevuelve({ _id: 'tenant-1' }))
    const primera = await pedirOrigen(origen)
    expect(primera.permitido).toBe(true)

    // 2. Pasan más de los 5 minutos de la caché, y la base se cae.
    const ahora = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(ahora + 6 * 60 * 1000)
    estadoDeBase.mockReturnValue(SIN_CONEXION)
    tenantFindOne.mockClear()

    const segunda = await pedirOrigen(origen)

    // Sigue entrando: vencer por tiempo es una heurística de frescura, no un
    // cambio de dueño. Y sin tocar la base.
    expect(segunda.permitido).toBe(true)
    expect(segunda.error).toBeNull()
    expect(tenantFindOne).not.toHaveBeenCalled()

    Date.now.mockRestore()
  })

  test('si la consulta falla estando conectado, también cae a la caché vencida', async () => {
    const origen = 'https://otro-conocido.example'

    tenantFindOne.mockReturnValue(consultaQueDevuelve({ _id: 'tenant-2' }))
    expect((await pedirOrigen(origen)).permitido).toBe(true)

    const ahora = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(ahora + 6 * 60 * 1000)
    tenantFindOne.mockImplementation(() => {
      throw new Error('la base no responde')
    })

    const { error, permitido } = await pedirOrigen(origen)

    expect(permitido).toBe(true)
    expect(error).toBeNull()

    Date.now.mockRestore()
  })

  test('sin caché previa no se deja pasar a nadie — no se abre CORS por no poder verificar', async () => {
    estadoDeBase.mockReturnValue(SIN_CONEXION)

    const { error, permitido } = await pedirOrigen('https://desconocido-total.example')

    expect(permitido).toBe(false)
    expect(error.code).toBe('CORS_TENANT_LOOKUP_UNAVAILABLE')
  })
})
