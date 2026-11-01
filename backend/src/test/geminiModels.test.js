// Cadena de modelos de Gemini.
//
// Este archivo existe por un defecto concreto: los tres nombres de
// FALLBACK_MODELS quedaron idénticos tras un reemplazo global, getModelChain
// deduplicaba a UN modelo, y todo el aparato de cooldowns y descartes de
// geminiModels.js quedó sin efecto — no había a dónde caer. Nadie lo notó
// porque no había un solo test sobre este archivo.
//
// El primer test es la guarda de regresión de eso.

import {
  extractErrorStatus,
  supportsSearchGrounding,
  getModelChain,
  getModelHealth,
  isModelDead,
  isModelUnavailable,
  isOverloadError,
  isQuotaError,
  markModelDead,
  resetDeadModels,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TEXT_MODEL,
  resolveImageModel,
  resolveTextModel,
  resolveVisionModel,
} from '../services/ai/geminiModels.js'

beforeEach(() => {
  resetDeadModels()
})

describe('geminiModels · la cadena puede respaldar de verdad', () => {
  test('hay al menos dos modelos DISTINTOS para caer', () => {
    const chain = getModelChain()
    const unicos = new Set(chain)

    // Con un solo modelo único, un 429 o un 503 dejan la IA sin salida.
    expect(unicos.size).toBeGreaterThanOrEqual(2)
    expect(unicos.size).toBe(chain.length)
  })

  test('el modelo preferido va primero y no se duplica', () => {
    const chain = getModelChain('gemini-3.6-flash')

    expect(chain[0]).toBe('gemini-3.6-flash')
    expect(chain.filter(m => m === 'gemini-3.6-flash')).toHaveLength(1)
  })

  test('normaliza el prefijo models/ que devuelve la API de Google', () => {
    const chain = getModelChain('models/gemini-3.6-flash')

    expect(chain[0]).toBe('gemini-3.6-flash')
  })
})

describe('geminiModels · saturación del proveedor (503)', () => {
  // Verificado contra la API el 07/09/2026: gemini-3.6-flash devolvía 503
  // sostenido mientras gemini-3.7-flash respondía normal. Sin este caso el
  // 503 se propagaba como error y la IA fallaba entera teniendo alternativas.

  test('un 503 cuenta como motivo para pasar al siguiente modelo', () => {
    expect(isOverloadError(503)).toBe(true)
    expect(isModelUnavailable(503, 'high demand')).toBe(true)
  })

  test('un 503 saca al modelo de la cadena y deja los demás', () => {
    const antes = getModelChain()

    markModelDead(antes[0], 'high demand', 503)
    const despues = getModelChain()

    expect(despues).not.toContain(antes[0])
    expect(despues.length).toBeGreaterThan(0)
  })

  test('un 503 PAUSA el modelo, no lo mata: el modelo existe y va a volver', () => {
    const [modelo] = getModelChain()

    markModelDead(modelo, 'high demand', 503)
    const salud = getModelHealth()

    expect(salud.dead).not.toContain(modelo)
    expect(salud.coolingDown.map(c => c.model)).toContain(modelo)
  })
})

describe('geminiModels · permanente vs temporal', () => {
  test('un 404 sí descarta el modelo de forma permanente', () => {
    const [modelo] = getModelChain()

    markModelDead(modelo, '404 Not Found', 404)

    expect(getModelHealth().dead).toContain(modelo)
    expect(isModelDead(modelo)).toBe(true)
  })

  test('un 429 con texto de cuota pausa, no mata', () => {
    const [modelo] = getModelChain()

    expect(isQuotaError(429, 'quota exceeded')).toBe(true)
    markModelDead(modelo, '429: quota exceeded for this plan', 429)

    expect(getModelHealth().dead).not.toContain(modelo)
    expect(getModelHealth().coolingDown.map(c => c.model)).toContain(modelo)
  })

  test('un 429 pausa aunque el texto venga recortado antes de "quota"', () => {
    // Caso real (01/11/2026): aiVisionService pasa error.message recortado a
    // 100 caracteres, y el SDK de Google pone primero la URL.
    const [modelo] = getModelChain()
    const recortado =
      '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/mod'

    markModelDead(modelo, recortado, 429)

    expect(getModelHealth().dead).not.toContain(modelo)
    expect(getModelHealth().coolingDown.map(c => c.model)).toContain(modelo)
  })

  test('sin status se asume permanente, como antes', () => {
    const [modelo] = getModelChain()

    markModelDead(modelo, 'algo salió mal')

    expect(getModelHealth().dead).toContain(modelo)
  })

  test('nunca devuelve una lista vacía, aunque estén todos descartados', () => {
    getModelChain().forEach(m => markModelDead(m, '404', 404))

    expect(getModelChain().length).toBeGreaterThan(0)
  })
})

describe('geminiModels · extracción del status', () => {
  // markModelDead necesita el número para elegir entre pausa y descarte. Cada
  // capa lo reporta distinto, y dos de los tres llamadores no lo pasaban: un
  // 429 o un 503 los marcaba como muertos permanentes.

  test('lo saca de .status, de .statusCode y del texto del SDK', () => {
    expect(extractErrorStatus({ status: 503 })).toBe(503)
    expect(extractErrorStatus({ statusCode: 429 })).toBe(429)
    expect(extractErrorStatus({ message: '[404 Not Found] modelo inexistente' })).toBe(404)
  })

  test('devuelve undefined si no hay forma de saberlo', () => {
    expect(extractErrorStatus(null)).toBeUndefined()
    expect(extractErrorStatus({ message: 'sin código' })).toBeUndefined()
  })

  test('un error de saturación del SDK termina pausando y no matando', () => {
    const [modelo] = getModelChain()
    const error = { message: '[503 Service Unavailable] high demand' }

    markModelDead(modelo, error.message, extractErrorStatus(error))

    expect(getModelHealth().dead).not.toContain(modelo)
    expect(getModelHealth().coolingDown.map(c => c.model)).toContain(modelo)
  })
})

// ─── Un 429 de la búsqueda con Google no es un 429 del modelo ───────────────
//
// Verificado contra la API con la key de producción: la misma llamada sin
// `tools` devuelve 200 y con `tools: [{ google_search: {} }]` devuelve 429
// RESOURCE_EXHAUSTED, en todos los modelos de la cadena. La búsqueda se mide
// aparte de los tokens.
//
// El cliente no distinguía, así que recorría la cadena entera cobrando el
// mismo 429 en cada modelo y dejaba a todos en cooldown 15 minutos. Ese
// cooldown lo comparten el agente de ventas, el análisis de producto y los
// insights: un análisis de mercado degradaba a toda la plataforma por algo que
// no tenía nada que ver con ellos.

describe('cuota de búsqueda con Google', () => {
  const CUOTA = {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota, please check your plan and billing details.',
    },
  }

  let callAgentLLM
  let fetchOriginal
  let llamadas

  beforeAll(async () => {
    ;({ callAgentLLM } = await import('../services/aiAgent/aiAgentLLMService.js'))
  })

  beforeEach(() => {
    resetDeadModels()
    llamadas = 0
    fetchOriginal = global.fetch

    global.fetch = async () => {
      llamadas += 1
      return {
        ok: false,
        status: 429,
        json: async () => CUOTA,
        text: async () => JSON.stringify(CUOTA),
      }
    }
  })

  afterEach(() => {
    global.fetch = fetchOriginal
  })

  test('no deja a los modelos en cooldown ni prueba toda la cadena', async () => {
    await expect(
      callAgentLLM({
        systemPrompt: 'x',
        messages: [{ role: 'user', content: 'x' }],
        apiKey: 'test-key',
        tools: [{ google_search: {} }],
      }),
    ).rejects.toMatchObject({ code: 'AI_GROUNDING_QUOTA' })

    expect(getModelHealth().coolingDown).toHaveLength(0)
    expect(getModelHealth().dead).toHaveLength(0)

    // Un intento por modelo × la cadena entera era lo que pasaba antes.
    expect(llamadas).toBeLessThanOrEqual(getModelChain().length)
  }, 30000)

  test('sin búsqueda, un 429 sigue pausando el modelo como siempre', async () => {
    await expect(
      callAgentLLM({
        systemPrompt: 'x',
        messages: [{ role: 'user', content: 'x' }],
        apiKey: 'test-key',
      }),
    ).rejects.toBeDefined()

    expect(getModelHealth().coolingDown.length).toBeGreaterThan(0)
  }, 30000)
})

// ─── Gemma tiene la cuota más grande y no sabe buscar ───────────────────────
//
// 14.400 pedidos por día contra los 20 de los Flash, así que es el último
// respaldo de la cadena. Pero no soporta herramientas, y mandarle `tools` no
// devuelve un error: la llamada se cuelga hasta el timeout. Eso ya pasó en
// producción — cada análisis de mercado esperaba de gusto.

describe('qué modelo puede buscar en Google', () => {
  test('Gemma queda afuera de las llamadas con búsqueda', () => {
    expect(supportsSearchGrounding('gemma-4-26b-a4b-it')).toBe(false)
    expect(supportsSearchGrounding('models/gemma-4-31b-it')).toBe(false)
  })

  test('los Gemini sí pueden', () => {
    expect(supportsSearchGrounding('gemini-3.8-flash')).toBe(true)
    expect(supportsSearchGrounding('gemini-3.1-flash-lite')).toBe(true)
  })

  test('la cadena de respaldo prioriza cuota, y Gemma no está', () => {
    const chain = getModelChain('gemini-3.8-flash')

    // Los Flash grandes tienen 20 pedidos por día; los Lite, 500. Por eso los
    // Lite van antes que el otro Flash grande.
    expect(chain.indexOf('gemini-3.5-flash-lite')).toBeLessThan(chain.indexOf('gemini-3.7-flash'))
    expect(chain).toContain('gemini-3.1-flash-lite')

    // Gemma quedó fuera por decisión de producto, aunque su cuota sea la mayor.
    expect(chain.some(m => m.startsWith('gemma'))).toBe(false)
  })

  test('una llamada con búsqueda no cae en un modelo que no la soporta', async () => {
    const { callAgentLLM } = await import('../services/aiAgent/aiAgentLLMService.js')

    const fetchOriginal = global.fetch
    const modelosLlamados = []

    global.fetch = async url => {
      modelosLlamados.push(String(url).match(/models\/([^:]+):/)?.[1])
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { code: 503, message: 'high demand' } }),
        text: async () => 'high demand',
      }
    }

    try {
      await callAgentLLM({
        systemPrompt: 'x',
        messages: [{ role: 'user', content: 'x' }],
        apiKey: 'k',
        model: 'gemini-3.8-flash',
        tools: [{ google_search: {} }],
      }).catch(() => {})
    } finally {
      global.fetch = fetchOriginal
    }

    expect(modelosLlamados.length).toBeGreaterThan(0)
    // Al revés sería el absurdo: una búsqueda que no puede usar ningún Gemini.
    expect(modelosLlamados.some(m => String(m).startsWith('gemma'))).toBe(false)
    expect(modelosLlamados.every(m => String(m).startsWith('gemini'))).toBe(true)
  }, 30000)
})

describe('geminiModels · qué modelo está configurado (un solo lugar)', () => {
  test('texto: GEMINI_MODEL manda; los GOOGLE_* son respaldo, en ese orden', () => {
    expect(resolveTextModel({})).toBe(DEFAULT_TEXT_MODEL)
    expect(resolveTextModel({ GOOGLE_MODEL: 'b' })).toBe('b')
    expect(resolveTextModel({ GOOGLE_MODEL: 'b', GOOGLE_TEXT_MODEL: 'a' })).toBe('a')
    expect(resolveTextModel({ GOOGLE_MODEL: 'b', GOOGLE_TEXT_MODEL: 'a', GEMINI_MODEL: 'x' })).toBe(
      'x',
    )
  })

  test('un valor vacío o con espacios no tapa al siguiente, y se quita models/', () => {
    expect(resolveTextModel({ GEMINI_MODEL: '   ', GOOGLE_MODEL: 'models/gemini-3.6-flash' })).toBe(
      'gemini-3.6-flash',
    )
  })

  test('visión: AI_VISION_MODEL, y si no el de texto; nunca el generador de imágenes', () => {
    expect(resolveVisionModel({ AI_VISION_MODEL: 'v', GEMINI_MODEL: 't' })).toBe('v')
    expect(resolveVisionModel({ GEMINI_MODEL: 't', GEMINI_IMAGE_MODEL: 'i' })).toBe('t')
  })

  test('imagen: GEMINI_IMAGE_MODEL, después GOOGLE_IMAGE_MODEL; nunca el de texto', () => {
    expect(resolveImageModel({ GEMINI_MODEL: 't' })).toBe(DEFAULT_IMAGE_MODEL)
    expect(resolveImageModel({ GOOGLE_IMAGE_MODEL: 'g' })).toBe('g')
    expect(resolveImageModel({ GOOGLE_IMAGE_MODEL: 'g', GEMINI_IMAGE_MODEL: 'i' })).toBe('i')
  })

  test('los defaults son del tipo correcto', () => {
    expect(DEFAULT_IMAGE_MODEL).toMatch(/image/)
    expect(DEFAULT_TEXT_MODEL).not.toMatch(/image/)
  })
})

// ─── Reintentos, respaldo y presupuesto del agente ──────────────────────────
//
// El incidente: un timeout agotaba tres intentos sobre el mismo modelo y la
// llamada se rendía sin probar el respaldo, un 503 se insistía tres veces, un
// 429 sin la palabra "quota" no pasaba nunca al siguiente, y no había límite
// de tiempo para la llamada entera. Nada de eso tenía test.

describe('agente · reintentos, respaldo y presupuesto total', () => {
  let callAgentLLM
  let fetchOriginal
  let llamadas
  const ENV = [
    'AI_AGENT_LLM_TIMEOUT_MS',
    'AI_AGENT_LLM_TOTAL_BUDGET_MS',
    'AI_AGENT_LLM_MAX_ATTEMPTS',
  ]
  const guardado = {}

  const ok = texto => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
  })
  const http = (status, message) => ({
    ok: false,
    status,
    json: async () => ({ error: { code: status, message } }),
  })
  // Un pedido que no contesta nunca: solo termina cuando lo aborta el timeout.
  const colgado = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      )
    })

  // La misma cadena que arma callGemini: el configurado primero.
  const cadena = () => getModelChain(resolveTextModel())
  const modeloDe = url => String(url).match(/models\/([^:]+):/)[1]
  const llamar = () =>
    callAgentLLM({
      systemPrompt: 'x',
      messages: [{ role: 'user', content: 'hola' }],
      apiKey: 'test-key',
    })

  beforeAll(async () => {
    ;({ callAgentLLM } = await import('../services/aiAgent/aiAgentLLMService.js'))
  })

  beforeEach(() => {
    resetDeadModels()
    llamadas = []
    fetchOriginal = global.fetch
    for (const nombre of ENV) guardado[nombre] = process.env[nombre]
    process.env.AI_AGENT_LLM_TIMEOUT_MS = '1000'
    process.env.AI_AGENT_LLM_TOTAL_BUDGET_MS = '10000'
    process.env.AI_AGENT_LLM_MAX_ATTEMPTS = '3'
  })

  afterEach(() => {
    global.fetch = fetchOriginal
    for (const nombre of ENV) {
      if (guardado[nombre] === undefined) delete process.env[nombre]
      else process.env[nombre] = guardado[nombre]
    }
  })

  test('un timeout pasa al siguiente modelo sin reintentar, y no lo pausa', async () => {
    const [primero, segundo] = cadena()
    global.fetch = async (url, options) => {
      llamadas.push(modeloDe(url))
      return modeloDe(url) === primero ? colgado(url, options) : ok('respondió el respaldo')
    }

    const resultado = await llamar()

    expect(resultado.content).toBe('respondió el respaldo')
    expect(resultado.model).toBe(segundo)
    // Una sola vez al lento: repetirlo duplicaba costo y espera.
    expect(llamadas.filter(m => m === primero)).toHaveLength(1)
    // Un timeout no prueba que el modelo esté mal.
    expect(isModelDead(primero)).toBe(false)
  }, 15000)

  test('un 503 de saturación pausa el modelo y pasa al siguiente sin insistir', async () => {
    const [primero] = cadena()
    global.fetch = async url => {
      llamadas.push(modeloDe(url))
      return modeloDe(url) === primero
        ? http(503, 'This model is currently experiencing high demand.')
        : ok('ok')
    }

    await llamar()

    expect(llamadas.filter(m => m === primero)).toHaveLength(1)
    expect(getModelHealth().coolingDown.map(c => c.model ?? c)).toContain(primero)
  })

  test('un 429 sin la palabra "quota" también pasa al respaldo', async () => {
    const [primero, segundo] = cadena()
    global.fetch = async url => {
      llamadas.push(modeloDe(url))
      return modeloDe(url) === primero ? http(429, 'Resource has been exhausted.') : ok('ok')
    }

    const resultado = await llamar()

    expect(resultado.model).toBe(segundo)
    expect(llamadas.filter(m => m === primero)).toHaveLength(1)
  })

  test('un 500 se reintenta en el mismo modelo, limitado, y después pasa al siguiente', async () => {
    process.env.AI_AGENT_LLM_MAX_ATTEMPTS = '2'
    const [primero, segundo] = cadena()
    global.fetch = async url => {
      llamadas.push(modeloDe(url))
      return modeloDe(url) === primero ? http(500, 'Internal error') : ok('ok')
    }

    const resultado = await llamar()

    expect(llamadas.filter(m => m === primero)).toHaveLength(2)
    expect(resultado.model).toBe(segundo)
    // Un 500 tampoco pausa el modelo para el resto del proceso.
    expect(isModelDead(primero)).toBe(false)
  })

  test('un 401 corta: cambiar de modelo no arregla una credencial', async () => {
    global.fetch = async url => {
      llamadas.push(modeloDe(url))
      return http(401, 'API key not valid.')
    }

    await expect(llamar()).rejects.toMatchObject({ statusCode: 401 })
    expect(llamadas).toHaveLength(1)
  })

  test('con un timeout corto y el presupuesto por defecto, el respaldo igual arranca', async () => {
    // Intentos de 1 s y presupuesto por defecto (el doble, 2 s): con el mínimo
    // fijo en 2 s, el siguiente modelo nunca arrancaba.
    delete process.env.AI_AGENT_LLM_TOTAL_BUDGET_MS
    const [primero, segundo] = cadena()
    global.fetch = async (url, options) => {
      llamadas.push(modeloDe(url))
      return modeloDe(url) === primero ? colgado(url, options) : ok('respondió el respaldo')
    }

    const resultado = await llamar()

    expect(resultado.model).toBe(segundo)
  }, 15000)

  test('la llamada entera respeta el presupuesto total', async () => {
    process.env.AI_AGENT_LLM_TOTAL_BUDGET_MS = '3500'
    global.fetch = async (url, options) => {
      llamadas.push(modeloDe(url))
      return colgado(url, options)
    }

    const inicio = Date.now()
    // Sale con la causa REAL (el timeout del último modelo), no con un
    // genérico "se agotó el tiempo" que esconde qué pasó.
    await expect(llamar()).rejects.toMatchObject({ code: 'AI_LLM_TIMEOUT' })
    const duracion = Date.now() - inicio

    // 3,5 s de presupuesto con intentos de 1 s: no se empieza un intento con
    // menos de medio segundo, así que entran como mucho tres modelos y la
    // llamada termina a tiempo.
    expect(duracion).toBeLessThan(4500)
    expect(llamadas.length).toBeLessThanOrEqual(3)
  }, 15000)
})
