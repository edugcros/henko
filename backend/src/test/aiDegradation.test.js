// 📁 src/test/aiDegradation.test.js
//
// La degradación progresiva: entre "todo normal" y "nada" hay dos escalones.
//
// QUÉ PROBLEMA RESUELVE
//
// El disyuntor es binario. Hasta el 99,9% del techo todo funciona igual, y en
// el 100% la IA se apaga para TODOS los comercios que comparten la key. El
// primer síntoma de esa transición es un cliente escribiéndole a una tienda que
// no contesta.
//
// Los dos escalones cambian eso por una pendiente:
//
//   80%  se fuerza el modelo más barato (0,25/1,50 contra 0,75/3,75 por millón)
//   90%  además se posponen las funciones caras que NO ve un cliente
//
// LAS DOS PROPIEDADES QUE IMPORTAN
//
// La primera es que degrade: que a partir del 80% la cadena entregue el barato
// aunque quien llama pida otro. La segunda, y más importante, es que NO degrade
// de más: lo que toca un cliente —el asistente— tiene que seguir andando hasta
// el disyuntor, porque apagarlo es apagar la tienda.

import { jest } from '@jest/globals'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')

const {
  DEGRADATION,
  DEGRADATION_ECONOMY_PERCENT,
  DEGRADATION_ESSENTIAL_PERCENT,
  DEFERRABLE_METRICS,
  degradationLevelFor,
  AI_METRICS,
} = await import('../services/ai/aiPlanPolicy.js')

const { getModelChain, setEconomyMode, getEconomyMode, resetDeadModels, getModelHealth } =
  await import('../services/ai/geminiModels.js')

const { buildBudgetDenialMessage, DENY_REASONS } = await import(
  '../services/ai/aiBudgetService.js'
)

beforeEach(() => {
  resetDeadModels()
})

afterAll(() => {
  resetDeadModels()
  jest.restoreAllMocks()
})

describe('en qué escalón está la plataforma', () => {
  test('debajo del 80% no se degrada nada', () => {
    // Degradar antes de tiempo es empeorar el servicio sin motivo: el techo
    // está para usarlo.
    expect(degradationLevelFor(0)).toBe(DEGRADATION.NORMAL)
    expect(degradationLevelFor(79.9)).toBe(DEGRADATION.NORMAL)
  })

  test('en el 80% entra el modo economía', () => {
    expect(degradationLevelFor(DEGRADATION_ECONOMY_PERCENT)).toBe(DEGRADATION.ECONOMY)
    expect(degradationLevelFor(89.9)).toBe(DEGRADATION.ECONOMY)
  })

  test('en el 90% se posponen además las funciones caras', () => {
    expect(degradationLevelFor(DEGRADATION_ESSENTIAL_PERCENT)).toBe(DEGRADATION.ESSENTIAL)
    expect(degradationLevelFor(150)).toBe(DEGRADATION.ESSENTIAL)
  })

  test('el primer escalón está DEBAJO del aviso por email', () => {
    // El aviso le pide a una persona que haga algo; la degradación lo hace sola
    // mientras esa persona se entera. Si entrara después del aviso, no daría
    // ningún margen extra: es todo el punto de que exista.
    expect(DEGRADATION_ECONOMY_PERCENT).toBeLessThan(DEGRADATION_ESSENTIAL_PERCENT)
    expect(DEGRADATION_ESSENTIAL_PERCENT).toBeLessThan(100)
  })
})

describe('el primer escalón: el modelo barato', () => {
  test('en modo normal manda el modelo que pidió quien llama', () => {
    const chain = getModelChain('gemini-3.7-flash')

    expect(chain[0]).toBe('gemini-3.7-flash')
  })

  test('en modo economía se IGNORA el preferido', () => {
    // ESTA ES LA PROPIEDAD. El preferido es justamente el modelo caro que
    // eligió quien llama. Respetarlo y poner los baratos detrás no ahorraría
    // nada: el primero de la cadena es el que contesta casi siempre.
    setEconomyMode('economy')

    const chain = getModelChain('gemini-3.7-flash')

    expect(chain[0]).toBe('gemini-3.1-flash-lite')
    expect(chain).not.toContain('gemini-3.7-flash')
  })

  test('el primero de la cadena económica es el más barato del catálogo', () => {
    // 3.1-flash-lite: 0,25/1,50 por millón. 3.5-flash-lite: 0,30/2,50. El
    // orden es por TARIFA, no por calidad, que es lo que distingue este modo.
    setEconomyMode('economy')

    expect(getModelChain()[0]).toBe('gemini-3.1-flash-lite')
  })

  test('los modelos caros NO quedan de respaldo al final', () => {
    // Si estuvieran, una racha de 429 en los dos lite terminaría cayendo justo
    // en el modelo que este modo vino a evitar — y gastando al triple en
    // silencio, que es el modo de falla que no se nota hasta la factura.
    setEconomyMode('economy')

    expect(getModelChain('gemini-3.7-flash')).toEqual([
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
    ])
  })

  test('el escalón esencial también usa la cadena barata', () => {
    // El segundo escalón SUMA al primero, no lo reemplaza: seguir gastando al
    // triple mientras se apagan funciones sería apagar de más y ahorrar de
    // menos.
    setEconomyMode('essential')

    expect(getModelChain('gemini-3.7-flash')[0]).toBe('gemini-3.1-flash-lite')
  })

  test('volver a normal devuelve la cadena completa', () => {
    // El modo se levanta solo cuando baja el consumo o arranca el mes. Si no
    // volviera, el servicio quedaría degradado para siempre después del primer
    // mes ajustado.
    setEconomyMode('economy')
    setEconomyMode('normal')

    expect(getModelChain('gemini-3.7-flash')[0]).toBe('gemini-3.7-flash')
  })

  test('un valor desconocido no degrada', () => {
    // Ante un valor que no se entiende, el servicio completo. Degradar por las
    // dudas es empeorarlo sin haber medido nada.
    setEconomyMode('cualquier-cosa')

    expect(getEconomyMode()).toBe('normal')
    expect(getModelChain('gemini-3.7-flash')[0]).toBe('gemini-3.7-flash')
  })

  test('el healthcheck informa la cadena que rige AHORA', () => {
    // Informar la lista normal mientras responde la barata manda a buscar el
    // problema al lugar equivocado.
    setEconomyMode('economy')

    const health = getModelHealth()

    expect(health.economyMode).toBe('economy')
    expect(health.chain).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'])
  })

  test('reiniciar el estado de modelos también levanta el modo', () => {
    // Es estado de módulo: un test que degrada dejaría a los siguientes
    // eligiendo modelos distintos según el orden en que corran.
    setEconomyMode('essential')
    resetDeadModels()

    expect(getEconomyMode()).toBe('normal')
  })
})

describe('el segundo escalón: qué se pospone', () => {
  test('lo que ve un CLIENTE no se pospone nunca', () => {
    // ESTA ES LA PROPIEDAD QUE MÁS IMPORTA. El asistente contestando en
    // WhatsApp es la tienda: apagarlo es apagar aquello por lo que el comercio
    // paga. Solo lo apaga el disyuntor, y recién en el 100%.
    expect(DEFERRABLE_METRICS).not.toContain(AI_METRICS.AGENT_MESSAGES)
    expect(DEFERRABLE_METRICS).not.toContain(AI_METRICS.AGENT_TOKENS)
  })

  test('visión queda adentro del servicio aunque no la vea un cliente', () => {
    // Es el paso obligado para cargar un producto: apagarla bloquea el alta. Y
    // su costo ya está acotado por la cuota del plan (300 y 1.500 al mes), así
    // que no es de donde viene un desborde.
    expect(DEFERRABLE_METRICS).not.toContain(AI_METRICS.VISION)
  })

  test('el análisis de mercado sí se pospone', () => {
    // Es el único que además de tokens gasta herramientas —tres búsquedas de
    // Tavily por corrida más grounding— así que es el que más baja el gasto por
    // función apagada.
    expect(DEFERRABLE_METRICS).toContain(AI_METRICS.MARKET_ANALYSES)
    expect(DEFERRABLE_METRICS).toContain(AI_METRICS.MARKET_TOKENS)
  })

  test('las ediciones de imagen también', () => {
    expect(DEFERRABLE_METRICS).toContain(AI_METRICS.IMAGE_EDITS)
  })
})

describe('lo que ve el comercio', () => {
  test('el mensaje dice que es temporal y que el asistente sigue andando', () => {
    // Sin eso, el comercio asume que se quedó sin plan y abre un ticket por
    // algo que se resuelve solo cuando baja el consumo.
    const mensaje = buildBudgetDenialMessage({
      reason: DENY_REASONS.DEGRADED,
      metric: AI_METRICS.MARKET_ANALYSES,
    })

    expect(mensaje).toMatch(/temporal/i)
    expect(mensaje).toMatch(/asistente/i)
  })

  test('no se confunde con haber llegado al límite del plan', () => {
    // Antes este motivo caía en el mensaje por defecto, que dice "se alcanzó el
    // límite mensual de tu plan" y manda a subir de plan: falso, y la acción
    // equivocada.
    const degradado = buildBudgetDenialMessage({
      reason: DENY_REASONS.DEGRADED,
      metric: AI_METRICS.MARKET_ANALYSES,
    })
    const porPlan = buildBudgetDenialMessage({
      reason: DENY_REASONS.METRIC_LIMIT,
      metric: AI_METRICS.MARKET_ANALYSES,
      limit: 50,
    })

    expect(degradado).not.toBe(porPlan)
    expect(degradado).not.toMatch(/subir de plan/i)
  })
})
