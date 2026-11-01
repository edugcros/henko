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
  isCloudflareDailyLimit,
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
  // Cloudflare solo se activa en los tests que lo configuran.
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  delete process.env.CLOUDFLARE_AI_API_TOKEN
  delete process.env.IMAGE_AI_PROVIDERS
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
      expect(getGenerativeBackgroundStatus()).toEqual({
        available: true,
        retryAt: null,
        provider: 'gemini',
      })
    })
  })

  test('después de un 429 no está disponible y dice cuándo se reintenta', () => {
    conClave(() => {
      const ahora = Date.parse('2026-11-01T12:00:00Z')
      markGenerativeBackgroundUnavailable('gemini', ahora)

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

// ─── Cloudflare Workers AI ───────────────────────────────────────────────
//
// FLUX.1 schnell entra en el cupo diario gratuito de Workers AI (~170
// imágenes por día). Contrato verificado en la documentación de Cloudflare:
// POST /accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell con
// { prompt, steps } → { result: { image: <JPEG en base64> } }.

const CUENTA = '0123456789abcdef0123456789abcdef'

const jpegBase64 = async () =>
  (
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c8a27a' } })
      .jpeg()
      .toBuffer()
  ).toString('base64')

const conCloudflare = async (fetchImpl, fn, { gemini = '' } = {}) => {
  const originalFetch = global.fetch
  const originalKey = env.ai.geminiApiKey
  process.env.CLOUDFLARE_ACCOUNT_ID = CUENTA
  process.env.CLOUDFLARE_AI_API_TOKEN = 'cf-token-de-prueba'
  env.ai.geminiApiKey = gemini
  global.fetch = fetchImpl
  try {
    return await fn()
  } finally {
    global.fetch = originalFetch
    env.ai.geminiApiKey = originalKey
  }
}

describe('IA generativa · Cloudflare Workers AI', () => {
  test('genera el fondo con FLUX.1 schnell y lo compone con el producto', async () => {
    const imagen = await jpegBase64()
    const llamadas = []

    await conCloudflare(
      async (url, options) => {
        llamadas.push({ url, options })
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: { image: imagen } }),
        }
      },
      async () => {
        expect(getGenerativeBackgroundStatus().provider).toBe('cloudflare')

        const { buffer, contentType } = await generateVariation(
          await recorte(),
          'sobre una mesa de madera',
          'image/png',
          { purpose: 'social' },
        )
        const meta = await sharp(buffer).metadata()

        expect(contentType).toBe('image/png')
        expect(meta.width).toBe(meta.height)
      },
    )

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${CUENTA}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    )
    expect(llamadas[0].options.headers.Authorization).toBe('Bearer cf-token-de-prueba')
    expect(JSON.parse(llamadas[0].options.body)).toEqual({
      prompt: 'sobre una mesa de madera',
      steps: 4,
    })
    expect(mockRemoveLocal).not.toHaveBeenCalled()
  })

  test('sin cupo diario pasa a Gemini y Cloudflare queda en pausa hasta las 00:00 UTC', async () => {
    const imagen = await jpegBase64()

    await conCloudflare(
      async url => {
        const destino = new URL(url)
        if (destino.hostname === 'api.cloudflare.com') {
          return {
            ok: false,
            status: 429,
            text: async () =>
              JSON.stringify({
                success: false,
                errors: [{ code: 3036, message: 'You have used up your daily free allocation' }],
              }),
          }
        }
        // Gemini: optimizador de prompt (texto) y generación (imagen).
        if (destino.searchParams.has('key')) {
          return { ok: false, status: 500, text: async () => 'sin optimizar' }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ inlineData: { data: imagen } }] } }],
          }),
        }
      },
      async () => {
        const { buffer } = await generateVariation(await recorte(), 'fondo de mármol', 'image/png')
        expect((await sharp(buffer).metadata()).format).toBe('png')

        const estado = getGenerativeBackgroundStatus()
        expect(estado.available).toBe(true)
        expect(estado.provider).toBe('gemini')

        // Cloudflare sigue en pausa aunque Gemini esté disponible.
        const soloCloudflare = process.env.IMAGE_AI_PROVIDERS
        process.env.IMAGE_AI_PROVIDERS = 'cloudflare'
        const pausa = getGenerativeBackgroundStatus()
        process.env.IMAGE_AI_PROVIDERS = soloCloudflare ?? ''
        if (!soloCloudflare) delete process.env.IMAGE_AI_PROVIDERS

        expect(pausa.available).toBe(false)
        expect(new Date(pausa.retryAt).getUTCHours()).toBe(0)
        expect(new Date(pausa.retryAt).getUTCMinutes()).toBe(0)
      },
      { gemini: 'AIzaTEST' },
    )
  })

  test('un token rechazado sin otro proveedor deja la IA no disponible, con mensaje para el comercio', async () => {
    await conCloudflare(
      async () => ({ ok: false, status: 401, text: async () => 'Authentication error' }),
      async () => {
        const error = await generateVariation(await recorte(), 'fondo blanco', 'image/png').catch(
          e => e,
        )

        expect(error.expose).toBe(true)
        expect(error.statusCode).toBe(503)
        expect(error.message).not.toMatch(/token|cloudflare/i)

        const estado = getGenerativeBackgroundStatus()
        expect(estado.available).toBe(false)
        expect(estado.retryAt).not.toBeNull()
      },
    )
  })

  test('sin cuenta válida o sin token, Cloudflare no cuenta como configurado', async () => {
    const originalKey = env.ai.geminiApiKey
    env.ai.geminiApiKey = ''
    try {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'no-es-un-id'
      process.env.CLOUDFLARE_AI_API_TOKEN = 'x'
      expect(getGenerativeBackgroundStatus()).toEqual({
        available: false,
        retryAt: null,
        provider: null,
      })

      process.env.CLOUDFLARE_ACCOUNT_ID = CUENTA
      process.env.CLOUDFLARE_AI_API_TOKEN = ''
      expect(getGenerativeBackgroundStatus().available).toBe(false)
    } finally {
      env.ai.geminiApiKey = originalKey
    }
  })
})

describe('IA generativa · revisión de la cadena', () => {
  test('isCloudflareDailyLimit distingue cupo diario (3036) de capacidad (3040)', () => {
    const cuerpo = code => JSON.stringify({ success: false, errors: [{ code }] })

    expect(isCloudflareDailyLimit(cuerpo(3036))).toBe(true)
    expect(isCloudflareDailyLimit(cuerpo(3040))).toBe(false)
    expect(isCloudflareDailyLimit('You have used up your daily free allocation')).toBe(true)
    expect(isCloudflareDailyLimit('Capacity temporarily exceeded')).toBe(false)
  })

  test('un 429 por capacidad (3040) no pausa Cloudflare: es transitorio', async () => {
    await conCloudflare(
      async () => ({
        ok: false,
        status: 429,
        text: async () =>
          JSON.stringify({ success: false, errors: [{ code: 3040, message: 'Capacity' }] }),
      }),
      async () => {
        const error = await generateVariation(await recorte(), 'fondo', 'image/png').catch(e => e)

        expect(error.expose).toBe(true)
        // Sigue disponible: el próximo pedido lo vuelve a intentar.
        expect(getGenerativeBackgroundStatus()).toEqual({
          available: true,
          retryAt: null,
          provider: 'cloudflare',
        })
      },
    )
  })

  test('un éxito que termina tarde no borra una pausa marcada después de empezar', async () => {
    const imagen = await jpegBase64()
    let responder

    await conCloudflare(
      () =>
        new Promise(resolve => {
          responder = () =>
            resolve({ ok: true, status: 200, json: async () => ({ result: { image: imagen } }) })
        }),
      async () => {
        const enCurso = generateVariation(await recorte(), 'fondo', 'image/png')
        await new Promise(r => setTimeout(r, 50))

        // Mientras tanto, otro pedido agotó el cupo diario.
        markGenerativeBackgroundUnavailable('cloudflare', Date.now(), Date.now() + 3600_000)
        responder()
        await enCurso

        expect(getGenerativeBackgroundStatus().available).toBe(false)
      },
    )
  })

  test('sin tiempo dentro del plazo no se llama a ningún proveedor y el error es para el comercio', async () => {
    process.env.IMAGE_AI_GENERATION_BUDGET_MS = '1000'
    const llamadas = []
    try {
      await conCloudflare(
        async url => {
          llamadas.push(url)
          return { ok: true, status: 200, json: async () => ({ result: { image: 'x' } }) }
        },
        async () => {
          const error = await generateVariation(await recorte(), 'fondo', 'image/png').catch(e => e)

          expect(error.expose).toBe(true)
          expect(error.statusCode).toBe(503)
          expect(llamadas).toHaveLength(0)
        },
      )
    } finally {
      delete process.env.IMAGE_AI_GENERATION_BUDGET_MS
    }
  })

  test('un timeout crudo de un proveedor sale como mensaje para el comercio, no como 500', async () => {
    await conCloudflare(
      async () => {
        const error = new Error('The operation was aborted due to timeout')
        error.name = 'TimeoutError'
        throw error
      },
      async () => {
        const error = await generateVariation(await recorte(), 'fondo', 'image/png').catch(e => e)

        expect(error.expose).toBe(true)
        expect(error.message).toMatch(/No se descontó de tu cupo/)
        expect(error.message).not.toMatch(/timeout|aborted/i)
      },
    )
  })
})
