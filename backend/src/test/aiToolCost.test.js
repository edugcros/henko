// 📁 src/test/aiToolCost.test.js
//
// Lo que se paga POR LLAMADA, y no por token.
//
// EL AGUJERO QUE ESTE BLOQUE CIERRA, MEDIDO EN PRODUCCIÓN (2026-09)
//
//   tokens de mercado    48 llamadas · USD 0,0585
//   créditos de Tavily  192          · USD 1,5360   ← era invisible
//
// La herramienta cuesta 26 VECES lo que los tokens y no aparecía en ningún
// lado: ni en el ledger, ni en el disyuntor, ni en el reporte. Son 4,00
// créditos por análisis —3 de búsqueda, 1 de extracción— iguales en las tres
// primeras corridas con registro, y con eso ya se iba el 19% del cupo gratis
// mensual de 1.000.
//
// Contra base real donde se prueba el candado, porque la idempotencia ES un
// índice único de Mongo: con un mock se probaría el mock.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')

const { computeToolCostUsd, getToolPrice } = await import(
  '../services/ai/aiModelPricing.js'
)
const { default: AiProviderCall } = await import('../models/aiProviderCallModel.js')
const { default: AiConsumptionLedger } = await import(
  '../models/aiConsumptionLedgerModel.js'
)
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')
const { recordToolSpend, recordTokenSpend, recordAiConsumption, AI_METRICS } = await import(
  '../services/ai/aiBudgetService.js'
)

const TENANT = '64b7f0000000000000000077'

const PERFIL = {
  tenantId: TENANT,
  plan: 'starter',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  keySource: 'platform',
  apiKey: 'AIzaTEST',
}

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await AiProviderCall.init()
  await AiConsumptionLedger.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

const asentar = () => new Promise(r => setTimeout(r, 250))

describe('el precio de una herramienta', () => {
  test('sale de la tarifa publicada, no de un supuesto', () => {
    // docs.tavily.com/documentation/api-credits: pay-as-you-go USD 0,008 el
    // crédito. Se costea a ese precio a propósito: es el techo, y para un
    // disyuntor conviene el número que no subestima.
    expect(getToolPrice('tavily_search').unitCostUsd).toBe(0.008)
    expect(getToolPrice('tavily_extract').unitCostUsd).toBe(0.008)

    // Google Search grounding: USD 35 por 1.000 consultas.
    expect(getToolPrice('google_search').unitCostUsd).toBe(0.035)
  })

  test('una herramienta desconocida se cobra cara, no gratis', () => {
    // Mismo criterio que un modelo fuera del catálogo: sobreestimar hace que
    // el techo corte antes y se note; subestimar llega en la factura.
    const desconocida = getToolPrice('herramienta-que-no-existe')

    expect(desconocida.fallback).toBe(true)
    expect(desconocida.unitCostUsd).toBeGreaterThan(0.008)
  })

  test('cantidad por tarifa, y nada más', () => {
    expect(computeToolCostUsd({ tool: 'tavily_search', quantity: 1 })).toEqual({
      tool: 'tavily_search',
      // La familia permite preguntar "cuanto se fue en buscar" sin enumerar
      // que herramientas hacen eso.
      family: 'webSearch',
      quantity: 1,
      unitCostUsd: 0.008,
      costUsd: 0.008,
      fallback: false,
    })

    // Un análisis completo, medido: 3 créditos de búsqueda —shopping busca una
    // vez y reintenta con filtro de país cuando trae pocas ofertas, más la de
    // research— y 1 de extracción.
    expect(computeToolCostUsd({ tool: 'tavily_search', quantity: 4 }).costUsd).toBe(0.032)
  })

  test('cantidades que no son cantidades cuestan cero', () => {
    for (const q of [0, -3, 'tres', null, undefined, NaN]) {
      expect(computeToolCostUsd({ tool: 'tavily_search', quantity: q }).costUsd).toBe(0)
    }
  })

  test('google_search existe en el catálogo aunque hoy no se use', () => {
    // El grounding se probó y se abandonó: con `tools`, la API devuelve 429 en
    // todos los modelos de la cadena. La entrada queda lista para el día que
    // se reactive, con cantidad cero mientras tanto — que es distinto de no
    // tener precio.
    expect(computeToolCostUsd({ tool: 'google_search', quantity: 0 })).toEqual({
      tool: 'google_search',
      // Misma familia que Tavily: las dos buscan en la web. La familia dice
      // que HACE la herramienta, no quien la vende, asi que cambiar de
      // proveedor no parte la serie historica.
      family: 'webSearch',
      quantity: 0,
      unitCostUsd: 0.035,
      costUsd: 0,
      fallback: false,
    })
  })
})

describe('registrar el consumo de una herramienta', () => {
  test('deja su fila, con cantidad, tarifa y costo', async () => {
    const period = '2033-01'
    const operationId = 'analisis-con-tavily'

    await recordToolSpend({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_TOKENS,
      tool: 'tavily_search',
      quantity: 5,
      profile: PERFIL,
      period,
      operationId,
      provider: 'tavily',
    })
    await asentar()

    const fila = await AiProviderCall.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    // tool = google_search / quantity = N / unitCost = X / cost = N × X
    expect(fila.tool).toBe('tavily_search')
    expect(fila.toolQuantity).toBe(5)
    expect(fila.toolUnitCostUsd).toBe(0.008)
    expect(fila.toolCostUsd).toBe(0.04)
    expect(fila.provider).toBe('tavily')

    // La fila se verifica sola.
    expect(fila.toolCostUsd).toBeCloseTo(fila.toolQuantity * fila.toolUnitCostUsd, 8)
  })

  test('SEPARADO del costo por tokens, que es el punto del bloque', async () => {
    const period = '2033-02'
    const operationId = 'tokens-y-herramienta'

    // La misma operación gasta las dos cosas.
    await recordTokenSpend({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_TOKENS,
      model: 'gemini-3.1-flash-lite',
      inputTokens: 4000,
      outputTokens: 200,
      profile: PERFIL,
      period,
      operationId,
      provider: 'gemini',
    })

    await recordToolSpend({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_TOKENS,
      tool: 'tavily_search',
      quantity: 5,
      profile: PERFIL,
      period,
      operationId,
      provider: 'tavily',
    })
    await asentar()

    const filas = await AiProviderCall.find({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(filas).toHaveLength(2)

    const tokens = filas.find(f => f.provider === 'gemini')
    const herramienta = filas.find(f => f.provider === 'tavily')

    // La de tokens no inventa costo de herramienta...
    expect(tokens.costUsd).toBeGreaterThan(0)
    expect(tokens.toolCostUsd).toBe(0)
    expect(tokens.tool).toBeNull()

    // ...y la de herramienta no inventa tokens.
    expect(herramienta.toolCostUsd).toBe(0.04)
    expect(herramienta.costUsd).toBe(0)
    expect(herramienta.totalTokens).toBe(0)

    // Y el numero que importa: la herramienta cuesta mucho mas que el modelo.
    expect(herramienta.toolCostUsd / tokens.costUsd).toBeGreaterThan(30)
  })

  test('el reintento no cobra dos veces', async () => {
    const period = '2033-03'
    const operationId = 'herramienta-una-vez'

    for (let i = 0; i < 3; i += 1) {
      await recordToolSpend({
        tenantId: TENANT,
        metric: AI_METRICS.MARKET_TOKENS,
        tool: 'tavily_search',
        quantity: 5,
        profile: PERFIL,
        period,
        operationId,
        provider: 'tavily',
      })
    }
    await asentar()

    const filas = await AiProviderCall.countDocuments({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
    expect(filas).toBe(1)

    const plataforma = await AiPlatformUsage.findOne({ period }).lean()
    expect(plataforma.estimatedCostUsd).toBeCloseTo(0.04, 6)
  })

  test('dos herramientas distintas de la misma operacion conviven', async () => {
    // Una busqueda y una extraccion son dos llamadas al mismo analisis. Si el
    // candado las tomara por la misma, la segunda desapareceria de la cuenta.
    const period = '2033-04'
    const operationId = 'busqueda-y-extraccion'

    await recordToolSpend({
      tenantId: TENANT, metric: AI_METRICS.MARKET_TOKENS,
      tool: 'tavily_search', quantity: 2,
      profile: PERFIL, period, operationId, provider: 'tavily',
    })
    await recordToolSpend({
      tenantId: TENANT, metric: AI_METRICS.MARKET_TOKENS,
      tool: 'tavily_extract', quantity: 3,
      profile: PERFIL, period, operationId, provider: 'tavily',
    })
    await asentar()

    const filas = await AiProviderCall.find({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(filas).toHaveLength(2)
    expect(filas.map(f => f.tool).sort()).toEqual(['tavily_extract', 'tavily_search'])
    expect(filas.reduce((s, f) => s + f.toolCostUsd, 0)).toBeCloseTo(0.04, 6)
  })

  test('el disyuntor de VOLUMEN no se toca; el de PLATA si', async () => {
    // Una llamada a herramienta no gasta tokens. Sumarla al contador de
    // volumen dispararia el freno de emergencia por un consumo que no ocurrio.
    const period = '2033-05'

    await recordToolSpend({
      tenantId: TENANT, metric: AI_METRICS.MARKET_TOKENS,
      tool: 'tavily_extract', quantity: 10,
      profile: PERFIL, period, operationId: 'solo-plata', provider: 'tavily',
    })
    await asentar()

    const plataforma = await AiPlatformUsage.findOne({ period }).lean()

    expect(plataforma.tokens).toBe(0)
    expect(plataforma.estimatedCostUsd).toBeCloseTo(0.08, 6)
  })

  test('el ledger lo anota con su propia unidad', async () => {
    // 'toolCalls' y no 'tokens' ni 'units': mezclarlas haria que el reporte
    // sume creditos de Tavily con analisis de mercado.
    const period = '2033-06'

    await recordToolSpend({
      tenantId: TENANT, metric: AI_METRICS.MARKET_TOKENS,
      tool: 'tavily_search', quantity: 1,
      profile: PERFIL, period, operationId: 'unidad-propia', provider: 'tavily',
    })
    await asentar()

    const fila = await AiConsumptionLedger.findOne({
      tenantId: TENANT,
      period,
      unit: 'toolCalls',
    })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(fila).not.toBeNull()
    expect(fila.amount).toBe(1)
    expect(fila.costUsd).toBeCloseTo(0.008, 6)
  })
})

describe('grounding de Google · se cuenta y se cobra solo', () => {
  test('readUsage cuenta CADA consulta, no una por respuesta', async () => {
    // Desde Gemini 3 se factura por cada busqueda que el modelo decide
    // ejecutar; en 2.5 y anteriores era por prompt. HENKO corre 3.x, asi que
    // una sola respuesta con tres busquedas cuesta tres.
    const { readUsage } = await import('../services/ai/aiUsageMetadata.js')

    const usage = readUsage({
      model: 'gemini-3.6-flash',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      groundingMetadata: {
        webSearchQueries: ['precio casco ls2', 'opiniones casco ls2', 'ls2 storm argentina'],
      },
    })

    expect(usage.groundingQueries).toBe(3)
  })

  test('sin grounding, cero: no se inventa una busqueda', async () => {
    const { readUsage } = await import('../services/ai/aiUsageMetadata.js')

    const sinNada = readUsage({
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
    })
    expect(sinNada.groundingQueries).toBe(0)

    const conMetadataVacia = readUsage({
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      groundingMetadata: { groundingChunks: [] },
    })
    expect(conMetadataVacia.groundingQueries).toBe(0)
  })

  test('el consumo lo cobra SOLO, sin que el llamador cablee nada', async () => {
    // Es el punto: un costo que depende de que alguien se acuerde de cablearlo
    // es un costo que no se cobra. El llamador pasa el objeto de readUsage
    // entero —que ya hacen los ocho— y el grounding queda cubierto.
    const { readUsage } = await import('../services/ai/aiUsageMetadata.js')
    const period = '2033-07'
    const operationId = 'con-grounding'

    const usage = readUsage({
      model: 'gemini-3.1-flash-lite',
      usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 200, totalTokenCount: 4200 },
      groundingMetadata: { webSearchQueries: ['una', 'dos'] },
    })

    await recordAiConsumption({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_TOKENS,
      amount: usage.totalTokens,
      profile: PERFIL,
      period,
      operationId,
      provider: 'gemini',
      usage,
    })
    await asentar()

    const filas = await AiProviderCall.find({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Dos filas: la de tokens y la del grounding, con callId propio para que
    // el indice unico no descarte la segunda como reintento.
    expect(filas).toHaveLength(2)

    const grounding = filas.find(f => f.tool === 'google_search')
    expect(grounding).toBeDefined()
    expect(grounding.toolQuantity).toBe(2)
    expect(grounding.toolUnitCostUsd).toBe(0.035)
    expect(grounding.toolCostUsd).toBeCloseTo(0.07, 6)
    expect(grounding.toolFamily).toBe('webSearch')
    expect(grounding.callId).toContain('grounding')

    // Y SEPARADO del costo por tokens, que es la consigna del bloque.
    const tokens = filas.find(f => !f.tool)
    expect(tokens.costUsd).toBeGreaterThan(0)
    expect(tokens.toolCostUsd).toBe(0)
  })

  test('sin busquedas no aparece fila de herramienta', async () => {
    const period = '2033-08'
    const operationId = 'sin-grounding'

    await recordAiConsumption({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_TOKENS,
      amount: 4200,
      model: 'gemini-3.1-flash-lite',
      profile: PERFIL,
      period,
      operationId,
      provider: 'gemini',
      usage: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200, groundingQueries: 0 },
    })
    await asentar()

    const filas = await AiProviderCall.find({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(filas).toHaveLength(1)
    expect(filas[0].tool).toBeNull()
  })
})
