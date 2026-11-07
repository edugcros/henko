// 📁 src/test/aiBudgetNotifier.test.js
//
// El mail del corte mostraba solo tokens. Si cortaba por dólares decía "50 de 1.000
// tokens": parecía que sobraba margen, y el número que cortó no aparecía.

import { jest } from '@jest/globals'

const sendEmail = jest.fn(async () => ({ success: true }))

jest.unstable_mockModule('../services/emailService.js', () => ({ sendEmail }))

const { notifyBudgetPressure } = await import('../services/ai/aiBudgetNotifier.js')

const avisar = async datos => {
  await notifyBudgetPressure({
    period: '2026-11',
    percent: '100',
    tokens: 50,
    budget: 1000,
    usdBudget: 25,
    estimatedCostUsd: 25.5,
    ...datos,
  })

  return sendEmail.mock.calls.at(-1)[0]
}

beforeEach(() => {
  sendEmail.mockClear()
  process.env.PLATFORM_OWNER_EMAILS = 'dueno@henko.test'
})

afterEach(() => {
  delete process.env.PLATFORM_OWNER_EMAILS
})

describe('aviso de presupuesto de IA', () => {
  test('un corte por dólares muestra el gasto contra su techo, antes que los tokens', async () => {
    const { html, text } = await avisar({ control: 'usd', tripped: true })

    expect(html).toContain('cortó por el gasto en dólares')
    expect(html).toContain('USD 25.50 de USD 25.00 &middot; 50 de 1.000 tokens en 2026-11.')
    expect(text).toContain('cortó por el gasto en dólares')
    expect(text).toContain('USD 25.50 de USD 25.00. 50 de 1.000 tokens en 2026-11.')
  })

  test('un corte por tokens lo dice, y los tokens van primero', async () => {
    const { html, text } = await avisar({ control: 'tokens', tripped: true, tokens: 1200 })

    expect(html).toContain('cortó por el volumen de tokens')
    expect(html).toContain('1.200 de 1.000 tokens &middot; USD 25.50 de USD 25.00 en 2026-11.')
    expect(text).toContain('1.200 de 1.000 tokens. USD 25.50 de USD 25.00 en 2026-11.')
  })

  test('el aviso previo aclara de qué techo es el porcentaje', async () => {
    const enDolares = await avisar({ control: 'usd', percent: '85.0', estimatedCostUsd: 21.25 })
    const enTokens = await avisar({ control: 'tokens', percent: '85.0', tokens: 850 })

    expect(enDolares.html).toContain('va por el 85.0% del techo en dólares')
    expect(enDolares.html).toContain('USD 21.25 de USD 25.00 &middot; 50 de 1.000 tokens')
    expect(enTokens.html).toContain('va por el 85.0% del techo de tokens')
    expect(enTokens.html).toContain('850 de 1.000 tokens &middot; USD 25.50 de USD 25.00')
  })

  test('un techo sin límite no se muestra como cero', async () => {
    const sinTechoEnDolares = await avisar({ control: 'tokens', usdBudget: 0 })
    const sinTechoDeTokens = await avisar({ control: 'usd', budget: 0 })

    expect(sinTechoEnDolares.html).toContain(
      '50 de 1.000 tokens &middot; USD 25.50 gastados en 2026-11.',
    )
    expect(sinTechoEnDolares.text).not.toContain('de USD 0.00')
    expect(sinTechoDeTokens.html).toContain('USD 25.50 de USD 25.00 &middot; 50 tokens en 2026-11.')
    expect(sinTechoDeTokens.text).not.toContain('de 0 tokens')
  })

  test('sin el dato del techo en dólares, no inventa uno', async () => {
    const { html } = await avisar({ control: 'tokens', usdBudget: undefined })

    expect(html).toContain('USD 25.50 gastados')
  })
})
