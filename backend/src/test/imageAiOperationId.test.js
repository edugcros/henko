import { jest } from '@jest/globals'

const OPERATION_ID = 'op-de-la-reserva-123'
const TENANT_ID = '64b7f0000000000000000001'

const mockReserve = jest.fn()
const mockRefund = jest.fn()
const mockGenerate = jest.fn()
const mockStudio = jest.fn()
const mockGenerativeStatus = jest.fn()

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
  createStudioImage: mockStudio,
  getGenerativeBackgroundStatus: mockGenerativeStatus,
  describeGeminiImageFailure: () => ({
    statusCode: 503,
    message: 'La generación de fondos no está disponible en este momento.',
  }),
  STUDIO_STYLES: { blanco: { label: 'Blanco de estudio' } },
}))

jest.unstable_mockModule('../services/ai/backgroundRemoval.js', () => ({
  getBackgroundRemovalStatus: () => ({}),
}))

jest.unstable_mockModule('../services/ai/aiCredentialsService.js', () => ({
  resolveTenantAiCredentials: async () => ({ apiKey: 'AIzaTEST' }),
}))

const { handleGenerateVariation, handleStudioBackground } =
  await import('../controller/imageAiCtrl.js')

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
  mockGenerativeStatus.mockReturnValue({ available: true, retryAt: null })

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

describe('imageAiCtrl · la IA generativa sabida no disponible', () => {
  test('corta antes de reservar cupo y de recortar el producto', async () => {
    // Medido el 31/10/2026: cada intento recortaba 8–13 s para un 429 seguro.
    mockGenerativeStatus.mockReturnValue({
      available: false,
      retryAt: '2026-11-01T12:30:00.000Z',
    })

    const res = await correr()

    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('IMAGE_GENERATION_UNAVAILABLE')
    expect(res.body.retryAt).toBe('2026-11-01T12:30:00.000Z')
    expect(mockReserve).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})

describe('imageAiCtrl · fondo de estudio', () => {
  test('devuelve la imagen y no toca el cupo de IA', async () => {
    mockStudio.mockResolvedValue({ buffer: Buffer.from('jpg'), contentType: 'image/jpeg' })
    const res = respuesta()

    await handleStudioBackground(
      {
        file: { buffer: Buffer.from('foto'), mimetype: 'image/jpeg' },
        body: { style: 'blanco', purpose: 'social', color: '' },
        user: { tenantId: TENANT_ID },
      },
      res,
      err => {
        if (err) throw err
      },
    )

    expect(mockStudio).toHaveBeenCalledWith(expect.any(Buffer), {
      style: 'blanco',
      color: '',
      purpose: 'social',
    })
    expect(res.body.data.image).toMatch(/^data:image\/jpeg;base64,/)
    expect(mockReserve).not.toHaveBeenCalled()
  })

  test('sin imagen es un 400', async () => {
    const res = respuesta()

    await handleStudioBackground({ body: { style: 'blanco' } }, res, err => {
      if (err) throw err
    })

    expect(res.statusCode).toBe(400)
    expect(mockStudio).not.toHaveBeenCalled()
  })
})
