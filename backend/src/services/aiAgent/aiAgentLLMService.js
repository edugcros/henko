// 📁 src/services/aiAgent/aiAgentLLMService.js
// VERSIÓN PRODUCCIÓN - GEMINI / MEMORIA CONVERSACIONAL / RESPUESTAS NO REPETITIVAS
//
// PATCH APLICADO (aditivo, no rompe llamadores existentes):
// 1. callGemini/callAgentLLM aceptan un parámetro opcional "tools" que se
//    pasa tal cual al payload de la API (necesario para Google Search
//    grounding desde marketIntelligence/sources/geminiGroundingSource.js).
//    Si no se pasa, el payload es idéntico al de antes del patch.
// 2. getGeminiFinishInfo ahora también extrae groundingMetadata, para poder
//    citar fuentes reales cuando se usa el tool de grounding.

import logger from '../../../config/logger.js'
import {
  getModelChain,
  isModelUnavailable,
  markModelDead,
  resolveTextModel,
  supportsSearchGrounding,
} from '../ai/geminiModels.js'

const clean = value => String(value || '').trim()

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const DEFAULT_GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

const DEFAULT_PROVIDER = 'gemini'

const REPETITIVE_OPENERS = [
  'Encontré estas opciones del catálogo',
  'Encontré estas opciones disponibles',
  'Te puedo mostrar estas opciones',
]

const FALLBACK_LIKE_PATTERNS = [
  /encontre estas opciones/i,
  /encontré estas opciones/i,
  /no encontre informacion suficiente/i,
  /no encontré información suficiente/i,
  /necesito que me indiques que producto/i,
  /necesito que me indiques qué producto/i,
]

const FOLLOW_UP_PATTERNS = [
  /\b(ese|esa|eso|esos|esas|este|esta|estos|estas)\b/i,
  /\b(el mismo|la misma|lo mismo|igual|tambien|también)\b/i,
  /\b(y en|y con|y si|y para|y cuanto|y cuánto|y envio|y envío)\b/i,
  /\b(mas barato|más barato|otro|otra|mejor|similar)\b/i,
  /\b(negro|blanco|rojo|azul|verde|talle|color|medida|cuota|cuotas)\b/i,
]

const SUPPORTED_PROVIDERS = new Set([DEFAULT_PROVIDER])

const toNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const clamp = ({ value, fallback, min, max }) => {
  const number = toNumber(value, fallback)
  return Math.min(Math.max(number, min), max)
}

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value

  const normalized = String(value).trim().toLowerCase()

  if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false

  return fallback
}

const getGeminiApiBaseUrl = () => {
  const rawUrl = clean(process.env.GEMINI_API_BASE_URL) || DEFAULT_GEMINI_API_BASE_URL

  try {
    const parsed = new URL(rawUrl)
    const isGoogleApiHost =
      parsed.hostname === 'generativelanguage.googleapis.com' ||
      parsed.hostname.endsWith('.googleapis.com')

    if (process.env.NODE_ENV === 'production') {
      if (parsed.protocol !== 'https:' || !isGoogleApiHost) {
        return DEFAULT_GEMINI_API_BASE_URL
      }
    }

    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return DEFAULT_GEMINI_API_BASE_URL
  }
}

const normalizeGeminiModelName = value => {
  const model = clean(value || resolveTextModel())
  return model.replace(/^models\//, '')
}

const getLastUserMessage = messages => {
  return [...(messages || [])]
    .reverse()
    .find(
      message =>
        clean(message?.content) && message.role !== 'assistant' && message.role !== 'model',
    )
}

const isFollowUpMessage = text => {
  const value = clean(text)
  if (!value) return false

  const wordCount = value.split(/\s+/).filter(Boolean).length
  return wordCount <= 14 && FOLLOW_UP_PATTERNS.some(pattern => pattern.test(value))
}

const looksLikeRepetitiveFallback = text => {
  const value = clean(text)
  if (!value) return false

  return FALLBACK_LIKE_PATTERNS.some(pattern => pattern.test(value))
}

const normalizeRole = role => {
  return role === 'assistant' || role === 'model' ? 'model' : 'user'
}

const compactMessageContent = (content, maxChars) => {
  const value = clean(content)
  if (value.length <= maxChars) return value

  return `${value.slice(0, Math.max(0, maxChars - 80))}\n[Mensaje recortado por longitud]`
}

const removeLowValueRepeatedFallbacks = messages => {
  const result = []
  let fallbackAssistantCount = 0

  for (const message of messages || []) {
    const content = clean(message?.content)
    if (!content) continue

    const role = normalizeRole(message.role)

    if (role === 'model' && looksLikeRepetitiveFallback(content)) {
      fallbackAssistantCount += 1

      // Conservamos el último fallback cercano, pero quitamos repeticiones antiguas
      // para que el modelo no copie siempre la misma frase.
      if (fallbackAssistantCount > 1) continue
    }

    result.push({ ...message, role })
  }

  return result
}

const mergeAdjacentSameRoleMessages = messages => {
  const merged = []

  for (const message of messages || []) {
    const content = clean(message?.content)
    if (!content) continue

    const role = normalizeRole(message.role)
    const previous = merged[merged.length - 1]

    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${content}`
      continue
    }

    merged.push({
      ...message,
      role,
      content,
    })
  }

  return merged
}

/**
 * @param {Array} messages
 * @param {number} [maxCharsOverride] - límite propio del llamador.
 *
 * El default de 5.000 caracteres por mensaje está pensado para un chat de
 * WhatsApp. La extracción de señales de mercado manda UN mensaje con doce
 * páginas dentro: 8.765 caracteres medidos, recortados a 5.000 sin que nadie
 * se enterara —el 38% del texto, y con él las últimas cuatro páginas—. Encima
 * el panel seguía diciendo "12 páginas leídas".
 */
const normalizeMessagesForGemini = (messages, maxCharsOverride = null) => {
  const maxMessages = Math.min(
    Math.max(toNumber(process.env.AI_AGENT_LLM_MAX_INPUT_MESSAGES, 18), 4),
    40,
  )
  // El tope de 12.000 aplica al default compartido. Un llamador que sabe qué
  // está mandando puede pedir más, hasta el presupuesto total.
  const maxCharsPerMessage = maxCharsOverride
    ? Math.min(Math.max(maxCharsOverride, 800), 200000)
    : Math.min(Math.max(toNumber(process.env.AI_AGENT_LLM_MAX_CHARS_PER_MESSAGE, 5000), 800), 12000)
  const totalBudget = Math.max(
    Math.min(Math.max(toNumber(process.env.AI_AGENT_LLM_TOTAL_INPUT_CHARS, 28000), 5000), 80000),
    // El presupuesto total nunca puede quedar por debajo de lo que el propio
    // llamador pidió para un mensaje: recortaría por la otra punta.
    maxCharsPerMessage,
  )

  const recent = (messages || []).slice(-maxMessages)
  const withoutRepeatedFallbacks = removeLowValueRepeatedFallbacks(recent)
  const merged = mergeAdjacentSameRoleMessages(withoutRepeatedFallbacks)

  const normalized = []
  let usedChars = 0

  for (const message of merged.reverse()) {
    const content = compactMessageContent(message.content, maxCharsPerMessage)
    const nextUsedChars = usedChars + content.length

    if (normalized.length > 0 && nextUsedChars > totalBudget) break

    usedChars = nextUsedChars
    normalized.push({
      role: message.role,
      content,
    })
  }

  return normalized.reverse()
}

const toGeminiContents = (messages, maxCharsPerMessage = null) => {
  return normalizeMessagesForGemini(messages, maxCharsPerMessage).map(message => ({
    role: normalizeRole(message.role),
    parts: [{ text: clean(message.content) }],
  }))
}

const getGeminiFinishInfo = response => {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : []

  const firstCandidate = candidates[0] || {}

  return {
    finishReason: firstCandidate.finishReason || '',
    safetyRatings: firstCandidate.safetyRatings || [],
    citationMetadata: firstCandidate.citationMetadata || null,
    // PATCH: necesario para citar fuentes reales cuando se usa el tool de
    // Google Search grounding (ver marketIntelligence/sources/geminiGroundingSource.js).
    groundingMetadata: firstCandidate.groundingMetadata || null,
  }
}

const normalizeGeminiText = response => {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : []

  return candidates
    .flatMap(candidate => (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []))
    .map(part => part?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

const buildGeminiError = ({ response, data }) => {
  const message = data?.error?.message || data?.message || `Gemini API error ${response.status}`

  const error = new Error(message)
  error.statusCode = response.status
  error.details = data
  error.provider = DEFAULT_PROVIDER

  return error
}

// ─── Reintentos y respaldo ──────────────────────────────────────────────────
//
// QUÉ SE REINTENTA EN EL MISMO MODELO Y QUÉ PASA AL SIGUIENTE
//
//   red (TypeError), 500/502/504   reintento corto en el mismo modelo: el
//                                  pedido probablemente ni llegó
//   timeout                        siguiente modelo, SIN reintentar: el pedido
//                                  pudo haberse procesado y cobrado, y repetirlo
//                                  en el mismo modelo lento duplica costo y
//                                  espera. Tampoco pausa el modelo: un timeout
//                                  no prueba que esté caído
//   429, 503                       pausa el modelo (markModelDead) y siguiente
//   404, 400 "not supported"       descarta el modelo y siguiente
//   400, 401, 403                  corta: cambiar de modelo no lo arregla
//
// Antes un timeout agotaba tres intentos sobre el mismo modelo y la llamada
// se rendía sin probar el respaldo (isModelUnavailable no lo reconocía), y un
// 503 de saturación se insistía tres veces antes de cambiar.
//
// PRESUPUESTO TOTAL. El timeout era por intento: tres intentos de 15 s por
// cada modelo de la cadena. Ahora la llamada entera tiene un límite
// (AI_AGENT_LLM_TOTAL_BUDGET_MS, por defecto el doble del de un intento) y cada
// intento recibe solo lo que queda. El agente contesta mientras alguien espera.
//
// La configuración se lee acá, en cada llamada. config/env.js tenía
// llmTimeoutMs y llmMaxAttempts que nadie leía: dos versiones del mismo dato.

/**
 * Menos tiempo que esto no alcanza para que un modelo conteste: no se empieza.
 *
 * Proporcional al timeout de un intento, con 2 s de tope. Fijo en 2 s, un
 * timeout configurado por debajo de eso dejaba la cadena sin respaldo: con
 * intentos de 1 s y el presupuesto por defecto (2 s), cuando el primer modelo
 * agotaba su tiempo quedaba menos de 2 s y el siguiente nunca arrancaba.
 */
const minAttemptMs = attemptTimeoutMs => Math.min(2000, attemptTimeoutMs / 2)

const resolveAttemptTimeoutMs = timeoutOverrideMs =>
  // El default está pensado para el agente de ventas: un mensaje corto que
  // tiene que contestar mientras alguien espera del otro lado. Una llamada que
  // manda doce páginas de contexto no entra en esa medida, y cortarla a los 15
  // segundos tira a la basura la búsqueda que ya se pagó. Por eso el llamador
  // puede pedir su propio presupuesto.
  Math.min(
    Math.max(
      toNumber(timeoutOverrideMs, toNumber(process.env.AI_AGENT_LLM_TIMEOUT_MS, 15000)),
      1000,
    ),
    120000,
  )

const resolveTotalBudgetMs = attemptTimeoutMs =>
  Math.min(
    Math.max(
      toNumber(process.env.AI_AGENT_LLM_TOTAL_BUDGET_MS, attemptTimeoutMs * 2),
      attemptTimeoutMs,
    ),
    180000,
  )

const budgetExceededError = () =>
  Object.assign(new Error('Gemini: se agotó el tiempo total de la llamada'), {
    code: 'AI_LLM_BUDGET_EXCEEDED',
    provider: DEFAULT_PROVIDER,
  })

/** ¿Vale la pena repetir en el MISMO modelo? Solo fallas de transporte. */
const isRetryableGeminiError = error => {
  if (!error) return false
  if (error instanceof TypeError) return true
  const status = Number(error?.statusCode || 0)
  return status >= 500 && status !== 503
}

/** ¿Hay que probar el SIGUIENTE modelo de la cadena? */
const shouldTryNextModel = error => {
  if (!error) return false
  if (error.code === 'AI_LLM_TIMEOUT') return true
  if (error instanceof TypeError) return true
  const status = Number(error.statusCode || 0)
  return isModelUnavailable(status, String(error.message || '')) || status >= 500
}

const getRetryDelayMs = ({ attempt }) =>
  Math.min(250 * 2 ** (attempt - 1), 2000) + Math.floor(Math.random() * 120)

const fetchGemini = async ({ url, apiKey, payload, attemptTimeoutMs, deadline }) => {
  const maxAttempts = Math.min(Math.max(toNumber(process.env.AI_AGENT_LLM_MAX_ATTEMPTS, 3), 1), 5)

  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = deadline - Date.now()
    if (remaining < minAttemptMs(attemptTimeoutMs)) throw lastError || budgetExceededError()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.min(attemptTimeoutMs, remaining))

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      const data = await response.json().catch(() => null)

      if (response.ok) return { response, data }

      const error = buildGeminiError({ response, data })
      if (!isRetryableGeminiError(error) || attempt === maxAttempts) throw error

      lastError = error
    } catch (error) {
      const normalizedError =
        error?.name === 'AbortError'
          ? Object.assign(new Error('Gemini API timeout'), {
              code: 'AI_LLM_TIMEOUT',
              provider: DEFAULT_PROVIDER,
            })
          : error

      if (!isRetryableGeminiError(normalizedError) || attempt === maxAttempts) {
        throw normalizedError
      }

      lastError = normalizedError
    } finally {
      clearTimeout(timeout)
    }

    const delay = getRetryDelayMs({ attempt })
    // Esperar para reintentar no puede comerse el tiempo del respaldo.
    if (deadline - Date.now() - delay < minAttemptMs(attemptTimeoutMs)) throw lastError
    await sleep(delay)
  }

  throw lastError || new Error('Gemini API unavailable')
}

const buildConversationStyleInstruction = ({ messages = [] } = {}) => {
  const lastUserMessage = getLastUserMessage(messages)
  const lastUserText = clean(lastUserMessage?.content)
  const followUp = isFollowUpMessage(lastUserText)

  return [
    'INSTRUCCIONES DE CONVERSACIÓN FLUIDA:',
    '- Respondé como continuidad natural del diálogo, no como si fuera la primera consulta.',
    '- Usá el historial reciente para resolver referencias como "ese", "esa", "lo mismo", "más barato", "en negro", "talle", "cuotas" o "envío".',
    '- No empieces siempre con una lista de catálogo.',
    '- Evitá repetir literalmente frases usadas antes por el asistente.',
    `- No uses estas frases de apertura salvo que el usuario pida explícitamente listar opciones: ${REPETITIVE_OPENERS.map(item => `"${item}"`).join(', ')}.`,
    '- Si ya se venía hablando de un producto, seguí sobre ese producto antes de traer otros.',
    '- Si faltan datos, hacé una pregunta concreta y breve en vez de reiniciar la conversación.',
    '- Si tenés productos relevantes, podés mencionarlos, pero integrados en una respuesta conversacional.',
    '- Mantené respuestas breves, útiles y con tono humano de vendedor consultivo.',
    followUp
      ? '- El último mensaje parece una continuación. Priorizá el contexto previo antes que una búsqueda genérica.'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const buildProviderFallbackContent = ({ messages = [], reason = '' } = {}) => {
  const lastUser = clean(getLastUserMessage(messages)?.content)

  if (isFollowUpMessage(lastUser)) {
    return 'Dame un segundo: necesito revisar el contexto anterior para responderte bien. Si querés, repetíme el producto o la variante y te confirmo la información exacta.'
  }

  if (/env[ií]o|entrega|retiro/i.test(lastUser)) {
    return 'Puedo ayudarte con el envío, pero necesito confirmar la política exacta del comercio para no darte un dato incorrecto. ¿Me decís para qué producto o zona querés consultarlo?'
  }

  if (/precio|cuanto|cu[aá]nto|cuotas|financiaci[oó]n/i.test(lastUser)) {
    return 'Puedo ayudarte con precio o cuotas, pero necesito confirmar el producto exacto para darte un dato correcto. ¿De cuál querés que revise el detalle?'
  }

  if (reason === 'missing_gemini_api_key') {
    return 'Recibí tu consulta, pero el asistente automático no está configurado para responder ahora. La dejo lista para que la revise un asesor.'
  }

  return 'Recibí tu consulta. Para responderte con precisión, ¿me indicás qué producto, variante o detalle querés revisar?'
}

const buildSystemInstruction = ({ systemPrompt, messages, conversationalMode }) => {
  const systemText = clean(systemPrompt)
  const styleGuard = conversationalMode ? buildConversationStyleInstruction({ messages }) : ''

  return [systemText, styleGuard]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, Math.max(Number(process.env.AI_AGENT_MAX_SYSTEM_PROMPT_CHARS || 50000), 5000))
}

const getSafetySettings = () => {
  if (parseBoolean(process.env.AI_AGENT_DISABLE_SAFETY_SETTINGS, false)) {
    return undefined
  }

  const threshold = clean(process.env.AI_AGENT_SAFETY_THRESHOLD) || 'BLOCK_MEDIUM_AND_ABOVE'

  return [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map(category => ({ category, threshold }))
}

const buildGenerationConfig = ({
  temperature,
  maxOutputTokens,
  responseMimeType,
  responseSchema,
  stopSequences,
  thinkingBudget,
}) => {
  const safeMaxOutputTokens = Math.min(
    Math.max(
      toNumber(maxOutputTokens, toNumber(process.env.AI_AGENT_MAX_OUTPUT_TOKENS, 1400)),
      256,
    ),
    8192,
  )

  return {
    temperature: clamp({ value: temperature, fallback: 0.35, min: 0, max: 1 }),
    maxOutputTokens: safeMaxOutputTokens,
    topP: clamp({ value: process.env.AI_AGENT_TOP_P, fallback: 0.9, min: 0.1, max: 1 }),
    topK: Math.round(clamp({ value: process.env.AI_AGENT_TOP_K, fallback: 40, min: 1, max: 100 })),
    ...(responseMimeType ? { responseMimeType } : {}),
    ...(responseSchema ? { responseSchema } : {}),
    ...(Array.isArray(stopSequences) && stopSequences.length
      ? { stopSequences: stopSequences.map(clean).filter(Boolean).slice(0, 5) }
      : {}),
    // Los modelos Gemini "thinking" (gemini-3.6-flash, y 2.5 mientras vivió)
    // gastan maxOutputTokens en razonamiento interno antes de escribir la
    // respuesta — con presupuestos chicos (tareas de JSON corto, sin
    // razonamiento real que hacer) eso corta la respuesta con MAX_TOKENS
    // antes de que el modelo llegue a contestar. La API rechaza budget:0
    // (400 INVALID_ARGUMENT) en estos modelos; 1 es el mínimo aceptado y
    // deja el razonamiento en la práctica desactivado.
    //
    // PATCH: si vas a combinar esto con tools de grounding (google_search),
    // NO pases thinkingBudget bajo en esa llamada específica — el modelo
    // puede necesitar presupuesto de thinking para decidir qué buscar, y
    // cortarlo temprano corta el grounding a mitad de camino.
    ...(Number.isFinite(thinkingBudget) ? { thinkingConfig: { thinkingBudget } } : {}),
  }
}

export const callGemini = async ({
  systemPrompt,
  messages = [],
  temperature = 0.35,
  maxOutputTokens,
  conversationalMode = true,
  responseMimeType,
  responseSchema,
  stopSequences,
  thinkingBudget,
  apiKey: providedApiKey,
  // Presupuesto de tiempo propio, para llamadas que no son un chat.
  timeoutMs: timeoutOverrideMs,
  // Presupuesto de texto propio, por el mismo motivo: el default de 5.000
  // caracteres es el de un chat, y una extracción manda doce páginas en un
  // solo mensaje.
  maxCharsPerMessage,
  // Modelo pedido por el llamador. Sin esto, todo el backend queda atado a
  // GEMINI_MODEL: si esa variable apunta a un modelo que no soporta
  // herramientas, el análisis de mercado no tiene forma de pedir uno que sí.
  model: providedModel,
  // PATCH: opcional, pasado tal cual al payload de la API (ej. para
  // Google Search grounding: tools: [{ google_search: {} }]). Si no se
  // pasa, el comportamiento y el payload son idénticos a antes del patch.
  tools,
} = {}) => {
  // La key la resuelve quien llama (aiCredentialsService), porque puede ser
  // la del comercio y no la de la plataforma. El fallback a la variable de
  // entorno queda para los llamadores que todavía no pasan tenant.
  const apiKey = clean(providedApiKey) || clean(process.env.GEMINI_API_KEY)
  const model = normalizeGeminiModelName(providedModel)

  if (!apiKey) {
    return {
      content: buildProviderFallbackContent({
        messages,
        reason: 'missing_gemini_api_key',
      }),
      provider: DEFAULT_PROVIDER,
      model,
      fallback: true,
      error: 'missing_gemini_api_key',
      finishReason: 'MISSING_API_KEY',
      truncated: false,
      usageMetadata: null,
    }
  }

  const systemText = buildSystemInstruction({
    systemPrompt,
    messages,
    conversationalMode,
  })

  const contents = toGeminiContents(messages, maxCharsPerMessage)

  if (!contents.length) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hola' }],
    })
  }

  const safetySettings = getSafetySettings()

  const payload = {
    ...(systemText
      ? {
          system_instruction: {
            parts: [{ text: systemText }],
          },
        }
      : {}),
    contents,
    generationConfig: buildGenerationConfig({
      temperature,
      maxOutputTokens,
      responseMimeType,
      responseSchema,
      stopSequences,
      thinkingBudget,
    }),
    ...(safetySettings ? { safetySettings } : {}),
    // PATCH: aditivo — payload idéntico al de antes si "tools" no se pasa.
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
  }

  const usesGrounding = Array.isArray(tools) && tools.length > 0

  // Con herramientas, la cadena se queda solo con los modelos que las
  // soportan. Caer en uno que no las soporta no falla rápido: se cuelga hasta
  // el timeout.
  const candidates = getModelChain(model).filter(
    candidate => !usesGrounding || supportsSearchGrounding(candidate),
  )

  if (candidates.length === 0) {
    const error = new Error('Ningún modelo disponible soporta la búsqueda con Google')
    error.code = 'AI_NO_GROUNDING_MODEL'
    throw error
  }

  // Google retira modelos sin aviso (404) o agota su cuota (429). Un modelo
  // muerto en GEMINI_MODEL rompía el agente en silencio, así que recorremos
  // la cadena de respaldos antes de darnos por vencidos, dentro del
  // presupuesto total (ver "Reintentos y respaldo").
  const attemptTimeoutMs = resolveAttemptTimeoutMs(timeoutOverrideMs)
  const deadline = Date.now() + resolveTotalBudgetMs(attemptTimeoutMs)

  let data
  let usedModel = model
  let lastError

  for (const candidate of candidates) {
    if (deadline - Date.now() < minAttemptMs(attemptTimeoutMs)) {
      lastError = lastError || budgetExceededError()
      break
    }

    const startedAt = Date.now()
    try {
      const url = `${getGeminiApiBaseUrl()}/models/${candidate}:generateContent`
      const result = await fetchGemini({ url, apiKey, payload, attemptTimeoutMs, deadline })

      data = result.data
      usedModel = candidate
      lastError = null
      break
    } catch (error) {
      const detail = String(error?.message || '')

      // Qué modelo falló, con qué y cuánto tardó. Sin la key ni el contenido.
      logger.warn('[AI AGENT] El modelo no respondió', {
        requestedModel: model,
        model: candidate,
        status: error?.statusCode ?? null,
        code: error?.code ?? null,
        durationMs: Date.now() - startedAt,
      })

      // La búsqueda con Google se mide aparte del modelo, y su 429 llega
      // idéntico al de una cuota de tokens. Verificado contra la API con la
      // key de producción: la misma llamada sin `tools` devuelve 200 y con
      // `tools` devuelve 429, en todos los modelos de la cadena.
      //
      // Tratarlo como problema del modelo tenía dos costos: se recorría la
      // cadena entera para cobrar el mismo 429 en cada modelo, y cada uno
      // quedaba en cooldown 15 minutos — un cooldown que comparten el agente
      // de ventas, el análisis de producto y los insights, que no tienen nada
      // que ver con la búsqueda. Un análisis de mercado degradaba a toda la
      // plataforma.
      if (usesGrounding && error?.statusCode === 429) {
        error.code = 'AI_GROUNDING_QUOTA'
        throw error
      }

      if (!shouldTryNextModel(error)) throw error

      // Solo lo que el proveedor DIJO pausa o descarta el modelo (404, 429,
      // 503). Un timeout o una caída de red deciden el respaldo de ESTA
      // llamada nada más: no prueban que el modelo esté mal.
      //
      // El tercer argumento es lo que permite distinguir un retiro de Google
      // (permanente) de una cuota agotada (temporal, con cooldown). Sin él,
      // un 429 dejaría el modelo descartado hasta reiniciar el proceso.
      if (isModelUnavailable(error?.statusCode, detail)) {
        markModelDead(candidate, `${error?.statusCode}: ${detail.slice(0, 80)}`, error?.statusCode)
      }
      lastError = error
    }
  }

  if (lastError) throw lastError

  const content = normalizeGeminiText(data)
  const finishInfo = getGeminiFinishInfo(data)
  const finishReason = finishInfo.finishReason
  const truncated = finishReason === 'MAX_TOKENS'

  return {
    content:
      content || buildProviderFallbackContent({ messages, reason: 'empty_provider_response' }),
    provider: DEFAULT_PROVIDER,
    // El que RESPONDIÓ. Puede no ser el que se pidió: la cadena de respaldo
    // entrega otro cuando el primero está saturado o sin cupo.
    model: usedModel,
    // El que se PIDIÓ. Medido en producción, de 122 filas de costo, 72 son de
    // un modelo distinto al configurado — y entre gemini-3.6-flash y
    // gemini-3.1-flash-lite hay 3x de tarifa. Sin este par, "por qué la
    // factura no da" no se contesta.
    requestedModel: normalizeGeminiModelName(model),
    finishReason,
    truncated,
    safetyRatings: finishInfo.safetyRatings,
    citationMetadata: finishInfo.citationMetadata,
    // PATCH: fuentes reales de Google Search grounding, cuando se usó el tool.
    groundingMetadata: finishInfo.groundingMetadata,
    usageMetadata: data?.usageMetadata || null,
    fallback: !content,
    error: content ? null : 'empty_provider_response',
  }
}

export const callAgentLLM = async ({
  systemPrompt,
  messages = [],
  temperature,
  maxOutputTokens,
  conversationalMode = true,
  responseMimeType,
  responseSchema,
  stopSequences,
  thinkingBudget,
  apiKey,
  model,
  timeoutMs,
  maxCharsPerMessage,
  // PATCH: propagado igual que el resto de los parámetros opcionales.
  tools,
} = {}) => {
  const provider = clean(process.env.AI_AGENT_PROVIDER || DEFAULT_PROVIDER).toLowerCase()

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    const error = new Error(`Proveedor IA no soportado: ${provider}`)
    error.code = 'AI_PROVIDER_NOT_SUPPORTED'
    throw error
  }

  return callGemini({
    systemPrompt,
    messages,
    temperature,
    maxOutputTokens,
    conversationalMode,
    responseMimeType,
    responseSchema,
    stopSequences,
    thinkingBudget,
    apiKey,
    model,
    timeoutMs,
    maxCharsPerMessage,
    tools,
  })
}

export const callAgentLLMForRepair = async ({
  systemPrompt,
  messages = [],
  previousResponse = '',
  validation = null,
  maxOutputTokens,
  apiKey,
} = {}) => {
  const repairMessages = [
    ...(messages || []),
    {
      role: 'user',
      content: [
        'Reescribí la última respuesta para que sea segura y conversacional.',
        'No inventes datos. No uses una lista genérica de catálogo si el usuario no la pidió.',
        'Mantené continuidad con el historial y respondé solo con el nuevo texto final.',
        '',
        `Respuesta anterior:\n${clean(previousResponse)}`,
        '',
        validation
          ? `Problemas detectados por validación interna:\n${JSON.stringify(validation).slice(0, 2500)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]

  return callAgentLLM({
    systemPrompt,
    messages: repairMessages,
    temperature: 0.25,
    maxOutputTokens: maxOutputTokens || 900,
    conversationalMode: true,
    apiKey,
  })
}

export default {
  callGemini,
  callAgentLLM,
  callAgentLLMForRepair,
}
