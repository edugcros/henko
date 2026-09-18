// 📁 src/test/mpTestAccountGuard.test.js
//
// UNA CUENTA DE PRUEBA EMITE CREDENCIALES QUE PARECEN REALES
//
// Todo lo que el backend miraba de un access token era el prefijo: TEST- es de
// prueba, APP_USR- es productivo. Medido contra /users/me, eso es falso. El
// token de .env.development empieza con APP_USR- y pertenece a
// TESTUSER1577837093912844460, con tags ["test_user","normal"].
//
// POR QUÉ IMPORTA
//
// Es el único fallo de esta clase que no se nota. Una credencial rota da un
// error y alguien lo arregla. Una credencial de cuenta de prueba en producción
// hace que TODO funcione: el checkout abre, la tarjeta se aprueba, el
// comprobante sale. Lo único que no pasa es que exista la plata, y eso se
// descubre cuando alguien va a buscarla.
//
// Offline no hay nada que mirar. El último segmento del token es el id de la
// cuenta —comprobado: coincide con el id que devuelve /users/me— pero un id de
// prueba no se ve distinto de uno real. La única fuente es Mercado Pago.

import { jest } from '@jest/globals'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')

// Un token con la forma real: APP_USR-<clientId>-<MMDDHH>-<hash>-<userId>.
const TOKEN_APP_USR = 'APP_USR-1234567890123456-091801-abcdef0123456789abcdef0123456789-3458885025'
const TOKEN_TEST = 'TEST-1234567890123456-091801-abcdef0123456789abcdef0123456789-3458885025'

const respuestaDe = cuenta => ({
  ok: true,
  status: 200,
  json: async () => cuenta,
})

const CUENTA_DE_PRUEBA = {
  id: 3458885025,
  nickname: 'TESTUSER1577837093912844460',
  tags: ['test_user', 'normal'],
}

const CUENTA_REAL = {
  id: 987654321,
  nickname: 'HENKOAR',
  tags: ['normal'],
}

describe('describeMpAccount: preguntarle a Mercado Pago de quién es', () => {
  let describeMpAccount
  let extractMpAccountId
  let fetchMock

  beforeAll(async () => {
    ;({ describeMpAccount, extractMpAccountId } = await import(
      '../services/paymentTenantConfigService.js'
    ))
  })

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock
  })

  test('marca la cuenta de prueba aunque el token sea APP_USR-', async () => {
    // ESTA ES LA PROPIEDAD. El prefijo dice "productivo" y la cuenta es de
    // prueba. Si esto devolviera false, la guarda entera no existe.
    fetchMock.mockResolvedValue(respuestaDe(CUENTA_DE_PRUEBA))

    const cuenta = await describeMpAccount(TOKEN_APP_USR)

    expect(cuenta.isTestAccount).toBe(true)
    expect(cuenta.nickname).toBe('TESTUSER1577837093912844460')
    expect(cuenta.id).toBe('3458885025')
  })

  test('no marca una cuenta real', async () => {
    // El caso normal. Marcarlo acá sería peor que no mirar: dejaría a un
    // comercio legítimo sin poder cobrar.
    fetchMock.mockResolvedValue(respuestaDe(CUENTA_REAL))

    expect((await describeMpAccount(TOKEN_APP_USR)).isTestAccount).toBe(false)
  })

  test('sin campo tags no inventa un veredicto', async () => {
    // Si Mercado Pago dejara de mandar tags, la respuesta honesta es "no sé",
    // que acá se representa como false. Inventar true bloquearía a todos.
    fetchMock.mockResolvedValue(respuestaDe({ id: 1, nickname: 'X' }))

    expect((await describeMpAccount(TOKEN_APP_USR)).isTestAccount).toBe(false)
  })

  test('manda el token como Bearer al endpoint de cuenta', async () => {
    fetchMock.mockResolvedValue(respuestaDe(CUENTA_REAL))

    await describeMpAccount(TOKEN_APP_USR)

    const [url, opciones] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.mercadopago.com/users/me')
    expect(opciones.headers.Authorization).toBe(`Bearer ${TOKEN_APP_USR}`)
  })

  test('un HTTP de error no se confunde con "cuenta real"', async () => {
    // Devolver isTestAccount:false ante un 401 dejaría pasar cualquier
    // credencial que Mercado Pago rechace. Tiene que romper.
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })

    await expect(describeMpAccount(TOKEN_APP_USR)).rejects.toThrow(
      'MP_ACCOUNT_LOOKUP_FAILED',
    )
  })

  test('no sale a la red con un token que ni siquiera tiene forma válida', async () => {
    await expect(describeMpAccount('pegar_aca')).rejects.toThrow(
      'MP_ACCESS_TOKEN_INVALID_FORMAT',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('el id de cuenta sale del último segmento del token', () => {
    // Comprobado contra la cuenta real: /users/me devolvió 3458885025 y el
    // token terminaba en 3458885025. Sirve para registrar de qué cuenta se
    // trata sin salir a la red — no para distinguir prueba de real.
    expect(extractMpAccountId(TOKEN_APP_USR)).toBe('3458885025')
    expect(extractMpAccountId(TOKEN_TEST)).toBe('3458885025')
    expect(extractMpAccountId('APP_USR-sin-numero-final')).toBeNull()
  })
})

// ==========================================================================
// LA DECISIÓN DEL CONTROLADOR
// ==========================================================================
//
// Acá se prueba qué hace el panel con la respuesta, no cómo se obtiene.

describe('guardar credenciales en el panel del comercio', () => {
  const mockDescribeMpAccount = jest.fn()
  const mockFindById = jest.fn()
  const mockFindByIdAndUpdate = jest.fn()

  let updatePaymentConfig

  beforeAll(async () => {
    jest.unstable_mockModule('../services/paymentTenantConfigService.js', () => ({
      describeMpAccount: mockDescribeMpAccount,
    }))

    jest.unstable_mockModule('../models/tenantModel.js', () => ({
      default: {
        findById: mockFindById,
        findByIdAndUpdate: mockFindByIdAndUpdate,
      },
    }))

    jest.unstable_mockModule('../utils/requestContext.js', () => ({
      resolveAuthorizedTenantFromRequest: () => ({ tenantId: 'tenant-1' }),
    }))

    ;({ updatePaymentConfig } = await import('../controller/paymentConfigCtrl.js'))
  })

  const guardado = { integrations: { mercadopago: { mode: 'production' } } }

  beforeEach(() => {
    jest.clearAllMocks()

    mockFindById.mockReturnValue({
      select: () => Promise.resolve({ integrations: { mercadopago: {} } }),
    })
    mockFindByIdAndUpdate.mockReturnValue({
      select: () => Promise.resolve(guardado),
    })
  })

  const pedir = async cuerpo => {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        this.body = payload
        return this
      },
    }

    await updatePaymentConfig({ body: { mercadopago: cuerpo } }, res, err => {
      if (err) throw err
    })

    return res
  }

  test('rechaza una cuenta de prueba declarada como productiva', async () => {
    // ESTA ES LA PROPIEDAD. Sin esto, se guarda, el comercio queda "cobrando"
    // y no recauda nada.
    mockDescribeMpAccount.mockResolvedValue({
      id: '3458885025',
      nickname: 'TESTUSER1577837093912844460',
      isTestAccount: true,
    })

    const res = await pedir({
      mode: 'production',
      publicKey: 'APP_USR-abc',
      accessToken: TOKEN_APP_USR,
      isEnabled: true,
    })

    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('MP_TEST_ACCOUNT_IN_PRODUCTION')
    // El mensaje tiene que nombrar la cuenta: sin eso el comercio no sabe cuál
    // de sus credenciales pegó.
    expect(res.body.message).toContain('TESTUSER1577837093912844460')
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled()
  })

  test('deja guardar una cuenta real', async () => {
    mockDescribeMpAccount.mockResolvedValue({
      id: '987654321',
      nickname: 'HENKOAR',
      isTestAccount: false,
    })

    const res = await pedir({
      mode: 'production',
      publicKey: 'APP_USR-abc',
      accessToken: TOKEN_APP_USR,
      isEnabled: true,
    })

    expect(res.statusCode).toBe(200)
    expect(mockFindByIdAndUpdate).toHaveBeenCalled()
  })

  test('si no se puede preguntar, no guarda', async () => {
    // Guardar lo que no se pudo verificar es exactamente el agujero que esto
    // viene a tapar. Reintentar cuesta un click.
    mockDescribeMpAccount.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'MP_ACCOUNT_LOOKUP_FAILED' }),
    )

    const res = await pedir({
      mode: 'production',
      publicKey: 'APP_USR-abc',
      accessToken: TOKEN_APP_USR,
      isEnabled: true,
    })

    expect(res.statusCode).toBe(503)
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled()
  })

  test('en modo test no le pregunta a Mercado Pago', async () => {
    // Con modo "test" la cuenta de prueba es lo correcto. Preguntar sería
    // gastar una llamada para no hacer nada con la respuesta.
    const res = await pedir({
      mode: 'test',
      publicKey: 'TEST-abc',
      accessToken: TOKEN_TEST,
      isEnabled: true,
    })

    expect(mockDescribeMpAccount).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  test('el modo ya guardado cuenta aunque no venga en el pedido', async () => {
    // El panel puede mandar solo el token. Si se mirara únicamente el modo del
    // cuerpo, un comercio ya en "production" podría cambiar su credencial por
    // una de prueba sin que nadie la revisara.
    mockFindById.mockReturnValue({
      select: () =>
        Promise.resolve({ integrations: { mercadopago: { mode: 'production' } } }),
    })
    mockDescribeMpAccount.mockResolvedValue({
      id: '3458885025',
      nickname: 'TESTUSER1577837093912844460',
      isTestAccount: true,
    })

    const res = await pedir({
      publicKey: 'APP_USR-abc',
      accessToken: TOKEN_APP_USR,
      isEnabled: true,
    })

    expect(res.statusCode).toBe(400)
    expect(res.body.code).toBe('MP_TEST_ACCOUNT_IN_PRODUCTION')
  })
})
