// Qué recibe el comercio cuando Gemini no genera un fondo.
//
// Medido en producción el 31/10/2026: la key de plataforma estaba en el plan
// gratuito (limit: 0 para los modelos de imagen) y cada intento devolvía 429.
// El comerciante leía "Revisá la facturación y los límites de la API", un
// problema de HENKO que él no puede resolver.

import { jest } from '@jest/globals'

jest.unstable_mockModule('../services/ai/backgroundRemoval.js', () => ({
  removeBackgroundLocal: jest.fn(),
  isLocalBackgroundRemovalEnabled: () => false,
}))

const { describeGeminiImageFailure } = await import('../services/imageAiService.js')

describe('imageAiService · fallas de la key de plataforma', () => {
  test.each([429, 401, 403])('un %i no le pide al comercio que revise la facturación', status => {
    const failure = describeGeminiImageFailure(status)

    expect(failure.statusCode).toBe(503)
    expect(failure.message).toMatch(/no está disponible/)
    expect(failure.message).toMatch(/No se descontó de tu cupo/)
    expect(failure.message).not.toMatch(/facturaci|API|credencial|GEMINI/i)
  })

  test('la acción para resolverlo queda para el log de la plataforma', () => {
    expect(describeGeminiImageFailure(429).platformAction).toMatch(/facturación/)
    expect(describeGeminiImageFailure(403).platformAction).toMatch(/GEMINI_API_KEY/)
  })

  test('otro error del proveedor dice que no se cobró y no pide acción de plataforma', () => {
    const failure = describeGeminiImageFailure(500)

    expect(failure.statusCode).toBe(502)
    expect(failure.message).toMatch(/No se descontó de tu cupo/)
    expect(failure.platformAction).toBeNull()
  })
})
