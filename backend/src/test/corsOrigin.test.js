// Qué error produce la política de CORS cuando bloquea.
//
// No prueba QUÉ orígenes se permiten —eso depende de la base y del entorno de
// cada instalación— sino cómo se reporta el rechazo, que es lo que estaba mal:
// el Error salía sin `statusCode`, y el manejador global clasifica como 500
// todo lo que no declare uno. La política haciendo exactamente su trabajo se
// contaba como falla del servidor.
//
// La distinción importa en operación: los 5xx son la señal que se mira para
// encontrar incidentes, y cada escáner que pasaba por ahí la ensuciaba.
//
// POR QUE SE SIMULA EL MODELO
//
// `corsOptions.origin` consulta `Tenant` para resolver los dominios propios de
// los comercios. Sin simularlo, la prueba sale a buscar una base: mongoose
// encola la consulta y la suelta recién a los 10 segundos con un error de
// buffering, que no es lo que se quiere medir acá.
//
// (Que ese mismo camino exista en producción —10 segundos colgado en el
// preflight cuando la base no responde— es un problema aparte, y está anotado
// como tal.)

import { jest } from '@jest/globals'

const tenantFindOne = jest.fn()

jest.unstable_mockModule('../models/tenantModel.js', () => ({
  default: {
    findOne: (...args) => tenantFindOne(...args),
  },
}))

const { default: corsOptions } = await import('../../config/corsOptions.js')

const pedirOrigen = origin =>
  new Promise(resolve => {
    corsOptions.origin(origin, (error, permitido) =>
      resolve({ error, permitido }),
    )
  })

beforeEach(() => {
  // Ningún comercio reclama estos dominios: es el camino de rechazo.
  tenantFindOne.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(null) }),
    lean: () => Promise.resolve(null),
  })
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

  test('si la consulta de comercios falla, eso SÍ es 500 — no es lo mismo que un origen bloqueado', async () => {
    tenantFindOne.mockImplementation(() => {
      throw new Error('la base no responde')
    })

    // Un dominio que no usó ningún otro caso. `isTenantOriginAllowed` cachea
    // el resultado 5 minutos, así que reusar uno ya consultado devolvería el
    // valor guardado sin tocar la base, y esta prueba mediría la caché en
    // lugar del manejo del fallo.
    const { error } = await pedirOrigen('https://base-caida.example')

    expect(error).toBeInstanceOf(Error)
    expect(error.statusCode).toBeUndefined()
    expect(error.code).not.toBe('CORS_ORIGIN_BLOCKED')
  })
})
