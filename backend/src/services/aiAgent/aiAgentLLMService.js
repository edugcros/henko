// 📁 src/services/aiAgent/aiAgentLLMService.js

const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta'

const clean = value => String(value || '').trim()

const toNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const normalizeGeminiModelName = value => {
  const model = clean(value || process.env.GEMINI_MODEL || 'gemini-2.0-flash')

  // El endpoint ya agrega /models/:model.
  // Si viene "models/gemini-2.0-flash", lo normalizamos.
  return model.replace(/^models\//, '')
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

  const text = candidates
    .flatMap(candidate =>
      Array.isArray(candidate?.content?.parts)
        ? candidate.content.parts
        : [],
    )
    .map(part => part?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim()

  return text
}

const toGeminiContents = messages => {
  return (messages || [])
    .filter(message => clean(message?.content))
    .map(message => ({
      role:
        message.role === 'assistant' || message.role === 'model'
          ? 'model'
          : 'user',
      parts: [
        {
          text: clean(message.content),
        },
      ],
    }))
}

const buildGeminiError = ({ response, data }) => {
  const message =
    data?.error?.message ||
    data?.message ||
    `Gemini API error ${response.status}`

  const error = new Error(message)
  error.statusCode = response.status
  error.details = data
  error.provider = 'gemini'

  return error
}

const buildFallbackContent = () => {
  return 'Gracias por escribirnos. En este momento estoy tomando tu consulta y un asesor podrá ayudarte a la brevedad.'
}

export const callGemini = async ({
  systemPrompt,
  messages = [],
  temperature = 0.35,
  maxOutputTokens,
} = {}) => {
  const apiKey = clean(process.env.GEMINI_API_KEY)
  const model = normalizeGeminiModelName()
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

  if (!apiKey) {
    return {
      content: buildFallbackContent(),
      provider: 'gemini',
      model,
      fallback: true,
      error: 'missing_gemini_api_key',
      finishReason: 'MISSING_API_KEY',
      truncated: false,
    }
  }

  const systemText = clean(systemPrompt)

  const contents = toGeminiContents(messages)

  if (!contents.length) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hola' }],
    })
  }

  const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent`

  const payload = {
    ...(systemText
      ? {
        system_instruction: {
          parts: [
            {
              text: systemText,
            },
          ],
        },
      }
      : {}),
    contents,
    generationConfig: {
      temperature: toNumber(temperature, 0.35),
      maxOutputTokens: safeMaxOutputTokens,
      topP: toNumber(process.env.AI_AGENT_TOP_P, 0.9),
      topK: Math.max(toNumber(process.env.AI_AGENT_TOP_K, 40), 1),
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw buildGeminiError({ response, data })
  }

  const content = normalizeGeminiText(data)
  const finishInfo = getGeminiFinishInfo(data)
  const finishReason = finishInfo.finishReason
  const truncated = finishReason === 'MAX_TOKENS'

  return {
    content:
      content ||
      'No pude generar una respuesta completa en este momento. ¿Podés reformular tu consulta?',
    provider: 'gemini',
    model,
    raw: data,
    finishReason,
    truncated,
    safetyRatings: finishInfo.safetyRatings,
    citationMetadata: finishInfo.citationMetadata,
  }
}

export const callAgentLLM = async ({
  systemPrompt,
  messages = [],
  temperature,
  maxOutputTokens,
} = {}) => {
  const provider = clean(process.env.AI_AGENT_PROVIDER || 'gemini').toLowerCase()

  if (provider !== 'gemini') {
    return callGemini({
      systemPrompt,
      messages,
      temperature,
      maxOutputTokens,
    })
  }

  return callGemini({
    systemPrompt,
    messages,
    temperature,
    maxOutputTokens,
  })
}

export default {
  callGemini,
  callAgentLLM,
}