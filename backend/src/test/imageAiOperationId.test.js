import { jest } from '@jest/globals'

const OPERATION_ID = 'op-de-la-reserva-123'
const TENANT_ID = '64b7f0000000000000000001'

const mockReserve = jest.fn()
const mockRefund = jest.fn()
const mockGenerate = jest.fn()

jest.unstable_mockModule('../services/ai/aiBudgetService.js', () => ({
  AI_METRICS: { IMAGE_EDITS: 'imageEdits' },
  AI_FEATURES: { IMAGE_AI: 'imageAi' },
  AI_PROVIDERS: { GEMINI: 'gemini' },
  buildBudgetDenialMessage: () => 'sin cupo',
  refundAiBudget: mockRefund,
  reserveAiBudget: mockReserve,
}))

jest.unstable_mockModule('../services/imageAiService.js', () => ({
  generateVariation: mockGenerate,
  removeBackground: jest.fn(),
}))

jest.unstable_mockModule('../services/ai/backgroundRemoval.js', () => ({
  getBackgroundRemovalStatus: () => ({}),
}))

jest.unstable_mockModule('../services/ai/aiCredentialsService.js', () => ({
  resolveTenantAiCredentials: async () => ({ apiKey: 'AIzaTEST' }),
}))

const { handleGenerateVariation } = await import('../controller/imageAiCtrl.js')

const pedido = () => ({
  file: { buffer: Buffer.from('imagen'), mimetype: 'image/png' },
  body: { prompt: 'fondo blanco' },
  user: { tenantId: TENANT_ID },
})

const respuesta = () => ({
  statusCode: 200,
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

const correr = async () => {
  const res = respuesta()
  await handleGenerateVariation(pedido(), res, err => {
    if (err) throw err
  })
  return res
}

beforeEach(() => {
  jest.clearAllMocks()

  mockReserve.mockResolvedValue({
    allowed: true,
    operationId: OPERATION_ID,
    metric: 'imageEdits',
  })
})

describe('imageAiCtrl · cobro de la edición', () => {
  test('una generación exitosa cobra en un solo movimiento', async () => {
    mockGenerate.mockResolvedValue({
      buffer: Buffer.from('resultado'),
      contentType: 'image/png',
    })

    const res = await correr()

    expect(res.body.success).toBe(true)
    // La reserva registra el costo. No debe existir un segundo cobro.
    expect(mockReserve).toHaveBeenCalledTimes(1)
    expect(mockRefund).not.toHaveBeenCalled()
  })

  test('si Gemini falla se devuelve con la clave de la reserva', async () => {
    mockGenerate.mockRejectedValue(new Error('Gemini caído'))

    await expect(correr()).rejects.toThrow('Gemini caído')

    expect(mockRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: 'imageEdits',
        operationId: OPERATION_ID,
      }),
    )
  })

  test('un mensaje escrito para el comercio se responde acá, con el cupo devuelto', async () => {
    // errorHandler tapa todo 5xx en producción con "Ocurrió un error
    // interno". Si este error siguiera viaje, el comercio no leería que no se
    // le cobró ni la alternativa.
    const sinCuota = new Error('La generación de fondos no está disponible en este momento.')
    sinCuota.statusCode = 503
    sinCuota.expose = true
    sinCuota.code = 'IMAGE_GENERATION_UNAVAILABLE'
    mockGenerate.mockRejectedValue(sinCuota)

    const res = await correr()

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({
      success: false,
      code: 'IMAGE_GENERATION_UNAVAILABLE',
      message: 'La generación de fondos no está disponible en este momento.',
    })
    expect(mockRefund).toHaveBeenCalledWith(expect.objectContaining({ operationId: OPERATION_ID }))
  })

  test('el controlador usa la clave que devuelve la reserva', async () => {
    mockGenerate.mockRejectedValue(new Error('Gemini caído'))

    await expect(correr()).rejects.toThrow('Gemini caído')

    const [[reserva]] = mockReserve.mock.calls
    const [[devolucion]] = mockRefund.mock.calls

    expect(reserva.operationId).toBeUndefined()
    expect(devolucion.operationId).toBe(OPERATION_ID)
  })

  test('sin cupo no se llama al proveedor ni se devuelve nada', async () => {
    mockReserve.mockResolvedValue({
      allowed: false,
      reason: 'limit_reached',
      metric: 'imageEdits',
    })

    const res = await correr()

    expect(res.statusCode).toBe(402)
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockRefund).not.toHaveBeenCalled()
  })
})

test('declara la función y el proveedor contra los que presupuesta', async () => {
  mockGenerate.mockResolvedValue({
    buffer: Buffer.from('resultado'),
    contentType: 'image/png',
  })

  await correr()

  expect(mockReserve).toHaveBeenCalledWith(
    expect.objectContaining({
      feature: 'imageAi',
      provider: 'gemini',
      forcePlatformBilling: true,
    }),
  )
})
