// 📁 src/services/aiAgent/aiAgentLLMService.js
// VERSIÓN PRODUCCIÓN - GEMINI / MEMORIA CONVERSACIONAL / RESPUESTAS NO REPETITIVAS

const clean = value => String(value || '').trim()

const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

const DEFAULT_GEMINI_API_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta'

const DEFAULT_MODEL = 'gemini-2.0-flash'
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
  const model = clean(value || process.env.GEMINI_MODEL || DEFAULT_MODEL)
  return model.replace(/^models\//, '')
}

const getLastUserMessage = messages => {
  return [...(messages || [])]
    .reverse()
    .find(message => clean(message?.content) && message.role !== 'assistant' && message.role !== 'model')
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

const normalizeMessagesForGemini = messages => {
  const maxMessages = Math.min(
    Math.max(toNumber(process.env.AI_AGENT_LLM_MAX_INPUT_MESSAGES, 18), 4),
    40,
  )
  const maxCharsPerMessage = Math.min(
    Math.max(toNumber(process.env.AI_AGENT_LLM_MAX_CHARS_PER_MESSAGE, 5000), 800),
    12000,
  )
  const totalBudget = Math.min(
    Math.max(toNumber(process.env.AI_AGENT_LLM_TOTAL_INPUT_CHARS, 28000), 5000),
    80000,
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

const toGeminiContents = messages => {
  return normalizeMessagesForGemini(messages).map(message => ({
    role: normalizeRole(message.role),
    parts: [{ text: clean(message.content) }],
  }))
}

const getGeminiFinishInfo = response => {
  const candidates = Array.isArray(response?.candidates)
    ? response.candidates
    : []

  const firstCandidate = candidates[0] || {}

  return {
    finishReason: firstCandidate.finishReason || '',
    safetyRatings: firstCandidate.safetyRatings || [],
    citationMetadata: firstCandidate.citationMetadata || null,
  }
}

const normalizeGeminiText = response => {
  const candidates = Array.isArray(response?.candidates)
    ? response.candidates
    : []

  return candidates
    .flatMap(candidate =>
      Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
    )
    .map(part => part?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

const buildGeminiError = ({ response, data }) => {
  const message =
    data?.error?.message ||
    data?.message ||
    `Gemini API error ${response.status}`

  const error = new Error(message)
  error.statusCode = response.status
  error.details = data
  error.provider = DEFAULT_PROVIDER

  return error
}

const isQuotaExceededError = error => {
  const message = String(
    error?.message ||
      error?.details?.error?.message ||
      error?.details?.message ||
      '',
  ).toLowerCase()

  return (
    message.includes('quota exceeded') ||
    message.includes('exceeded your current quota') ||
    message.includes('free_tier') ||
    message.includes('generate_content_free_tier')
  )
}

const isRetryableGeminiError = error => {
  if (!error) return false
  if (error?.code === 'AI_LLM_TIMEOUT') return true
  if (error instanceof TypeError) return true
  if (error?.statusCode === 429 && !isQuotaExceededError(error)) return true
  return Number(error?.statusCode || 0) >= 500
}

const getRetryDelayMs = ({ attempt, error }) => {
  const baseMs = Math.min(250 * 2 ** (attempt - 1), 2000)
  const jitterMs = Math.floor(Math.random() * 120)

  if (error?.statusCode === 429) return Math.min(baseMs + 750 + jitterMs, 3000)
  return baseMs + jitterMs
}

const fetchGemini = async ({ url, apiKey, payload }) => {
  const timeoutMs = Math.min(
    Math.max(toNumber(process.env.AI_AGENT_LLM_TIMEOUT_MS, 15000), 1000),
    60000,
  )
  const maxAttempts = Math.min(
    Math.max(toNumber(process.env.AI_AGENT_LLM_MAX_ATTEMPTS, 3), 1),
    5,
  )

  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

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

    await sleep(getRetryDelayMs({ attempt, error: lastError }))
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
  const styleGuard = conversationalMode
    ? buildConversationStyleInstruction({ messages })
    : ''

  return [systemText, styleGuard]
    .filter(Boolean)
    .join('\n\n')
    .slice(
      0,
      Math.max(
        Number(process.env.AI_AGENT_MAX_SYSTEM_PROMPT_CHARS || 50000),
        5000,
      ),
    )
}

const getSafetySettings = () => {
  if (parseBoolean(process.env.AI_AGENT_DISABLE_SAFETY_SETTINGS, false)) {
    return undefined
  }

  const threshold =
    clean(process.env.AI_AGENT_SAFETY_THRESHOLD) || 'BLOCK_MEDIUM_AND_ABOVE'

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
}) => {
  const safeMaxOutputTokens = Math.min(
    Math.max(
      toNumber(
        maxOutputTokens,
        toNumber(process.env.AI_AGENT_MAX_OUTPUT_TOKENS, 1400),
      ),
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
} = {}) => {
  const apiKey = clean(process.env.GEMINI_API_KEY)
  const model = normalizeGeminiModelName()

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

  const contents = toGeminiContents(messages)

  if (!contents.length) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hola' }],
    })
  }

  const url = `${getGeminiApiBaseUrl()}/models/${model}:generateContent`
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
    }),
    ...(safetySettings ? { safetySettings } : {}),
  }

  const { data } = await fetchGemini({ url, apiKey, payload })

  const content = normalizeGeminiText(data)
  const finishInfo = getGeminiFinishInfo(data)
  const finishReason = finishInfo.finishReason
  const truncated = finishReason === 'MAX_TOKENS'

  return {
    content:
      content ||
      buildProviderFallbackContent({ messages, reason: 'empty_provider_response' }),
    provider: DEFAULT_PROVIDER,
    model,
    finishReason,
    truncated,
    safetyRatings: finishInfo.safetyRatings,
    citationMetadata: finishInfo.citationMetadata,
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
} = {}) => {
  const provider = clean(
    process.env.AI_AGENT_PROVIDER || DEFAULT_PROVIDER,
  ).toLowerCase()

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
  })
}

export const callAgentLLMForRepair = async ({
  systemPrompt,
  messages = [],
  previousResponse = '',
  validation = null,
  maxOutputTokens,
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
  })
}

export default {
  callGemini,
  callAgentLLM,
  callAgentLLMForRepair,
}
