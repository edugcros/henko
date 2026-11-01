// Fondos de estudio y disponibilidad de la IA generativa.
//
// Medido en producción el 31/10/2026: "Generar variación" fallaba en el 100%
// de los intentos (key de plataforma en el plan gratuito de Gemini, límite 0
// para imágenes), y cada intento recortaba el producto antes —8 a 13 s de CPU—
// para terminar en un 429. Los fondos de estudio se arman en el servidor sin
// proveedor externo; acá se prueban con sharp de verdad, no con mocks.

import { jest } from '@jest/globals'
import sharp from 'sharp'

const mockRemoveLocal = jest.fn()

jest.unstable_mockModule('../services/ai/backgroundRemoval.js', () => ({
  removeBackgroundLocal: mockRemoveLocal,
  isLocalBackgroundRemovalEnabled: () => true,
}))

const {
  createStudioImage,
  generateVariation,
  getGenerativeBackgroundStatus,
  markGenerativeBackgroundUnavailable,
  resetGenerativeBackgroundStatus,
  resolveStudioStyle,
} = await import('../services/imageAiService.js')
const { env } = await import('../../config/env.js')

// Un "producto" ya recortado: una forma oscura sobre transparente.
const recorte = () =>
  sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect x="150" y="150" width="300" height="250" rx="40" fill="#111827"/></svg>',
    ),
  )
    .png()
    .toBuffer()

// La misma forma sobre fondo blanco opaco: una foto común sin recortar.
const fotoOpaca = () =>
  sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="100%" height="100%" fill="#ffffff"/><rect x="150" y="150" width="300" height="250" rx="40" fill="#111827"/></svg>',
    ),
  )
    .jpeg()
    .toBuffer()

const pixel = async (buffer, x, y) => {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}

beforeEach(() => {
  jest.clearAllMocks()
  resetGenerativeBackgroundStatus()
})

describe('fondos de estudio · el resultado', () => {
  test('sale un JPEG opaco del tamaño de la foto', async () => {
    const { buffer, contentType } = await createStudioImage(await recorte(), { style: 'blanco' })
    const meta = await sharp(buffer).metadata()

    expect(contentType).toBe('image/jpeg')
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(600)
    expect(meta.height).toBe(500)
    expect(meta.hasAlpha).toBe(false)
  })

  test('el propósito fija la proporción (publicidad 16:9)', async () => {
    const { buffer } = await createStudioImage(await recorte(), {
      style: 'gris',
      purpose: 'ad',
    })
    const meta = await sharp(buffer).metadata()

    expect(meta.width / meta.height).toBeCloseTo(16 / 9, 1)
  })

  test('el fondo es el elegido y el producto queda en el centro', async () => {
    const { buffer } = await createStudioImage(await recorte(), {
      style: 'color',
      color: '#0b6bff',
    })

    const [r, g, b] = await pixel(buffer, 5, 5)
    expect(b).toBeGreaterThan(150)
    expect(r).toBeLessThan(60)

    const centro = await pixel(buffer, 300, 230)
    expect(Math.max(...centro)).toBeLessThan(60)
  })

  test('el fondo oscuro es oscuro y el blanco es claro', async () => {
    const oscuro = await createStudioImage(await recorte(), { style: 'oscuro' })
    const blanco = await createStudioImage(await recorte(), { style: 'blanco' })

    expect(Math.max(...(await pixel(oscuro.buffer, 300, 20)))).toBeLessThan(90)
    expect(Math.min(...(await pixel(blanco.buffer, 300, 20)))).toBeGreaterThan(220)
  })
})

describe('fondos de estudio · el recorte', () => {
  test('una foto ya recortada no se vuelve a recortar', async () => {
    // En producción el resultado de "Quitar fondo" se volvía a recortar:
    // 8 a 13 segundos de CPU para la misma imagen.
    await createStudioImage(await recorte(), { style: 'blanco' })

    expect(mockRemoveLocal).not.toHaveBeenCalled()
  })

  test('una foto opaca sí se recorta primero', async () => {
    mockRemoveLocal.mockResolvedValue(await recorte())

    await createStudioImage(await fotoOpaca(), { style: 'beige' })

    expect(mockRemoveLocal).toHaveBeenCalledTimes(1)
  })
})

describe('fondos de estudio · pedidos inválidos', () => {
  test('un estilo que no existe es un 400 y no gasta un recorte', async () => {
    const error = await createStudioImage(await fotoOpaca(), { style: 'neon' }).catch(e => e)

    expect(error.statusCode).toBe(400)
    expect(mockRemoveLocal).not.toHaveBeenCalled()
  })

  test('el color de marca exige un hex válido', () => {
    expect(() => resolveStudioStyle('color', 'azul')).toThrow(/#0b6bff/)
    expect(() => resolveStudioStyle('color', '#12345')).toThrow()
    expect(resolveStudioStyle('color', '#0B6BFF').from).toBe('#0B6BFF')
  })
})

describe('IA generativa · disponibilidad', () => {
  const conClave = fn => {
    const original = env.ai.geminiApiKey
    env.ai.geminiApiKey = 'AIzaTEST'
    try {
      return fn()
    } finally {
      env.ai.geminiApiKey = original
    }
  }

  test('con clave y sin fallas recientes está disponible', () => {
    conClave(() => {
      expect(getGenerativeBackgroundStatus()).toEqual({ available: true, retryAt: null })
    })
  })

  test('después de un 429 no está disponible y dice cuándo se reintenta', () => {
    conClave(() => {
      const ahora = Date.parse('2026-11-01T12:00:00Z')
      markGenerativeBackgroundUnavailable(ahora)

      const estado = getGenerativeBackgroundStatus(ahora + 60_000)
      expect(estado.available).toBe(false)
      expect(Date.parse(estado.retryAt)).toBeGreaterThan(ahora)

      // Pasado el cooldown se vuelve a probar sola.
      expect(getGenerativeBackgroundStatus(ahora + 31 * 60_000).available).toBe(true)
    })
  })

  test('sin clave configurada no está disponible', () => {
    const original = env.ai.geminiApiKey
    env.ai.geminiApiKey = ''
    try {
      expect(getGenerativeBackgroundStatus().available).toBe(false)
    } finally {
      env.ai.geminiApiKey = original
    }
  })
})

describe('IA generativa · un 429 real la marca como no disponible', () => {
  test('después del 429 de Gemini, el estado dice que no está disponible', async () => {
    const originalFetch = global.fetch
    const originalKey = env.ai.geminiApiKey
    env.ai.geminiApiKey = 'AIzaTEST'
    // Todo lo de Gemini responde 429 por plan gratuito, como en producción.
    global.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'You exceeded your current quota (free tier, limit: 0)',
    })

    try {
      expect(getGenerativeBackgroundStatus().available).toBe(true)

      // Ya recortada: no pasa por el recorte local, va directo a Gemini.
      const error = await generateVariation(await recorte(), 'fondo blanco', 'image/png', {
        apiKey: 'AIzaTEST',
      }).catch(e => e)

      expect(error.expose).toBe(true)
      expect(error.statusCode).toBe(503)
      expect(getGenerativeBackgroundStatus().available).toBe(false)
      expect(mockRemoveLocal).not.toHaveBeenCalled()
    } finally {
      global.fetch = originalFetch
      env.ai.geminiApiKey = originalKey
    }
  })
})
