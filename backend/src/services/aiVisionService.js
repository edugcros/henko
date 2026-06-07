// src/services/aiVisionService.js
import crypto from 'crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import AIPreference from '../models/aIPreference.js'
import CorrectionLog from '../models/correctionLog.js'
import mongoose from 'mongoose'
import logger from '../../config/logger.js'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const MODEL_NAME = process.env.GEMINI_MODEL || 'models/gemini-3.1-flash-lite'
const MIN_CONFIDENCE = Number(process.env.AI_MIN_CONFIDENCE || 0.65)
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES || 3)

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY no está configurada')
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function logInfo(message, meta = {}) {
  logger.info('[AI VISION SERVICE]', { message, ...meta })
}

function logWarn(message, meta = {}) {
  logger.warn('[AI VISION SERVICE]', { message, ...meta })
}

function logError(message, meta = {}) {
  logger.error('[AI VISION SERVICE]', { message, ...meta })
}

function normalizeMimeType(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') return 'image/jpeg'
  const normalized = mimeType.trim().toLowerCase()
  return SUPPORTED_MIME_TYPES.has(normalized) ? normalized : 'image/jpeg'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let lastError = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      const message = String(error?.message || '').toLowerCase()
      const isTransient =
        message.includes('429') ||
        message.includes('quota') ||
        message.includes('rate limit') ||
        message.includes('timeout') ||
        message.includes('503') ||
        message.includes('500') ||
        message.includes('temporarily unavailable') ||
        message.includes('deadline exceeded')

      if (!isTransient || attempt === maxRetries) {
        throw error
      }

      const backoffMs = 400 * attempt * attempt
      logWarn('Retry transitorio contra Gemini', {
        attempt,
        maxRetries,
        backoffMs,
        error: error?.message,
      })

      await sleep(backoffMs)
    }
  }

  throw lastError
}

function safeString(value, { lower = false, upper = false } = {}) {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  if (!clean) return null
  if (lower) return clean.toLowerCase()
  if (upper) return clean.toUpperCase()
  return clean
}

function uniqueStringArray(value, { lower = false } = {}) {
  if (!Array.isArray(value)) return []
  const out = value
    .map(v => safeString(String(v ?? ''), { lower }))
    .filter(Boolean)

  return [...new Set(out)]
}

function normalizeTags(value) {
  return uniqueStringArray(value, { lower: true })
}

function normalizeAttributes(atributos) {
  if (!atributos || typeof atributos !== 'object' || Array.isArray(atributos)) {
    return {}
  }

  const normalized = {}

  for (const [key, value] of Object.entries(atributos)) {
    const cleanKey = safeString(String(key ?? ''), { lower: true })
    const cleanValue = safeString(String(value ?? ''))
    if (cleanKey && cleanValue) {
      normalized[cleanKey] = cleanValue
    }
  }

  return normalized
}

function clampConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function extractJsonObject(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Respuesta vacía o inválida del modelo')
  }

  const trimmed = rawText.trim()

  try {
    return JSON.parse(trimmed)
  } catch {
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('El modelo no devolvió un JSON parseable')
    }

    const candidate = trimmed.slice(firstBrace, lastBrace + 1)
    return JSON.parse(candidate)
  }
}

function normalizePreferenceType(type) {
  const clean = safeString(type, { lower: true })
  if (!clean) return null

  if (clean === 'categoria') return 'category'
  if (clean === 'marca') return 'brand'
  if (clean === 'subcategoria') return 'subcategory'

  return clean
}

async function loadTenantLearningContext(tenantId) {
  const context = {
    knownCategories: [],
    knownBrands: [],
    learnedRules: [],
    preferencesByType: {
      category: [],
      brand: [],
      subcategory: [],
      material: [],
      attribute: [],
      tag: [],
      general: [],
    },
  }

  try {
    const preferences = await AIPreference.find({ tenantId })
      .sort({ usageCount: -1, confidence: -1, updatedAt: -1 })
      .lean()

    for (const pref of preferences) {
      const type = normalizePreferenceType(pref.type)
      const correctedValue = safeString(pref.correctedValue)
      const rawInput = safeString(pref.rawInput, { lower: true })

      if (!type || !correctedValue) continue

      if (type === 'category') context.knownCategories.push(correctedValue)
      if (type === 'brand') context.knownBrands.push(correctedValue)

      if (!context.preferencesByType[type]) {
        context.preferencesByType[type] = []
      }

      context.preferencesByType[type].push({
        rawInput,
        correctedValue,
        usageCount:
          typeof pref.usageCount === 'number' && Number.isFinite(pref.usageCount)
            ? pref.usageCount
            : 1,
        confidence:
          typeof pref.confidence === 'number' && Number.isFinite(pref.confidence)
            ? pref.confidence
            : 0.7,
        source: pref.source || 'manual',
      })
    }

    context.knownCategories = [...new Set(context.knownCategories)]
    context.knownBrands = [...new Set(context.knownBrands)]
  } catch (error) {
    logError('Error cargando aIPreference', {
      tenantId,
      error: error?.message,
    })
  }

  try {
    const recentCorrections = await CorrectionLog.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()

    const rules = []

    for (const item of recentCorrections) {
      if (Array.isArray(item.learnedRules)) {
        for (const learned of item.learnedRules) {
          const rule = safeString(learned?.rule)
          if (rule) rules.push(rule)
        }
      }

      const hint = safeString(item?.metadata?.businessRuleHint)
      if (hint) rules.push(hint)
    }

    context.learnedRules = [...new Set(rules)].slice(0, 15)
  } catch (error) {
    logError('Error cargando correctionLog', {
      tenantId,
      error: error?.message,
    })
  }

  return context
}

function buildPrompt({
  tenantId,
  knownCategories,
  knownBrands,
  learnedRules,
  preferencesByType,
}) {
  return `
Actuá como un motor senior de enriquecimiento de productos para un e-commerce multi-tenant.

Estás analizando una imagen de producto para el tenant: "${tenantId}".

CONTEXTO DEL TENANT:
- Categorías conocidas: ${JSON.stringify(knownCategories)}
- Marcas conocidas: ${JSON.stringify(knownBrands)}
- Preferencias por tipo: ${JSON.stringify(preferencesByType)}
- Reglas aprendidas del tenant: ${JSON.stringify(learnedRules)}

OBJETIVO:
Analizar la imagen y devolver una propuesta comercial estructurada del producto, pensada para catálogo e-commerce.

REGLAS OBLIGATORIAS:
1. Devolvé exclusivamente JSON válido.
2. No escribas texto fuera del JSON.
3. No uses markdown.
4. No inventes información sin evidencia visual suficiente.
5. Si no hay certeza razonable, usar null.
6. Si la marca no es visible o no puede inferirse con seguridad, usar null.
7. Debés intentar inferir el material principal si hay evidencia visual razonable por textura, acabado, contexto y tipo de producto.
8. Si el material no puede determinarse con seguridad, devolvé el material más probable solo si la inferencia es razonable y acompañalo con confidence baja o media.
9. Si el precio no puede estimarse con base razonable, usar null.
10. Para estimar precio, considerá: tipo de producto, calidad aparente, segmento visual, terminación, marca visible, rubro comercial y contexto del tenant.
11. Preferí categorías conocidas del tenant si encajan correctamente.
12. Si ninguna categoría conocida aplica, proponé una categoría breve y lógica.
13. Aplicá reglas aprendidas del tenant solo si coinciden con la evidencia visual.
14. Identificá atributos comerciales relevantes.
15. Usá tags en minúsculas, sin duplicados y orientados a búsqueda.
16. Debés marcar si el resultado requiere revisión humana.
17. La confidence general debe ser un número entre 0 y 1.
18. No inventes variantes si no hay evidencia.
19. Material y precio son campos prioritarios: intentá resolverlos con el mayor criterio posible sin inventar.

MATERIALES COMERCIALES POSIBLES SEGÚN CONTEXTO:
- algodón
- poliéster
- cuero
- eco-cuero
- cuero sintético
- denim
- lona
- plástico
- goma
- metal
- aluminio
- acero
- madera
- vidrio
- cerámica
- tela
- gamuza
- nylon
- silicona

ESQUEMA JSON OBLIGATORIO:
{
  "titulo": "string | null",
  "descripcion": "string | null",
  "categoria": "string | null",
  "subcategoria": "string | null",
  "marca": "string | null",
  "precio_sugerido": null,
  "price_confidence": 0.0,
  "price_reasoning": "string | null",
  "moneda": "ARS",
  "atributos": {
    "color": "string | null",
    "material": "string | null"
  },
  "material_confidence": 0.0,
  "tags": ["string"],
  "hasVariants": false,
  "confidence": 0.0,
  "reasoningFlags": ["string"],
  "requiresHumanReview": false
}

CRITERIOS DE CALIDAD:
- titulo: corto, comercial y claro
- descripcion: profesional, útil para catálogo, sin exageraciones
- categoria y subcategoria: específicas y comerciales
- marca: solo con evidencia razonable
- precio_sugerido: estimar solo si hay base visual/comercial razonable
- price_reasoning: breve explicación de por qué se estimó ese valor
- atributos.material: priorizar el material principal visible o más probable
- material_confidence: entre 0 y 1
- reasoningFlags: usar flags como "uncertain_brand", "taxonomy_inferred", "price_low_confidence", "material_inferred", "new_pattern_detected"

Devolvé solamente el JSON.
`.trim()
}

function normalizeAnalysis(parsed, { hash, tenantId }) {
  const confidence = clampConfidence(parsed?.confidence)

  const titulo = safeString(parsed?.titulo)
  const descripcion = safeString(parsed?.descripcion)
  const categoria = safeString(parsed?.categoria)
  const subcategoria = safeString(parsed?.subcategoria)
  const marca = safeString(parsed?.marca)
  const moneda = safeString(parsed?.moneda, { upper: true }) || 'ARS'

  const atributos = normalizeAttributes(parsed?.atributos)

  const precio_sugerido =
    typeof parsed?.precio_sugerido === 'number' && Number.isFinite(parsed.precio_sugerido)
      ? parsed.precio_sugerido
      : null

  const material_confidence = clampConfidence(parsed?.material_confidence)
  const price_confidence = clampConfidence(parsed?.price_confidence)
  const price_reasoning = safeString(parsed?.price_reasoning)

  const needsReview =
    parsed?.requiresHumanReview === true ||
    confidence < MIN_CONFIDENCE ||
    !titulo ||
    !categoria ||
    !atributos?.material ||
    precio_sugerido == null

  return {
    titulo,
    descripcion,
    categoria,
    subcategoria,
    marca,
    precio_sugerido,
    price_confidence,
    price_reasoning,
    moneda,
    atributos,
    material_confidence,
    tags: normalizeTags(parsed?.tags),
    hasVariants: Boolean(parsed?.hasVariants),
    confidence,
    reasoningFlags: uniqueStringArray(parsed?.reasoningFlags),
    needsReview,
    hash,
    source: MODEL_NAME,
    tenantId,
    aiProcessed: true,
  }
}

function buildFallbackResult({ hash, tenantId, error }) {
  const message = String(error?.message || '')
  const lower = message.toLowerCase()
  const isQuotaError = message.includes('429') || lower.includes('quota')

  return {
    titulo: null,
    descripcion: isQuotaError
      ? 'Cuota de IA excedida temporalmente.'
      : 'Error técnico en el servicio de visión.',
    categoria: null,
    subcategoria: null,
    marca: null,
    precio_sugerido: null,
    price_confidence: 0,
    price_reasoning: null,
    moneda: 'ARS',
    atributos: {},
    material_confidence: 0,
    tags: ['revision-pendiente'],
    hasVariants: false,
    confidence: 0,
    reasoningFlags: ['analysis_failed'],
    needsReview: true,
    hash,
    source: 'fallback-error',
    tenantId,
    aiProcessed: false,
    errorInfo: message,
  }
}

export async function analyzeImage(imageBuffer, mimeType, tenantId) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    throw new Error('imageBuffer inválido')
  }

  const normalizedTenantId = String(tenantId || '').trim()

  if (!mongoose.Types.ObjectId.isValid(normalizedTenantId)) {
    throw new Error('tenantId inválido')
  }

  const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex')
  const safeMime = normalizeMimeType(mimeType)

  try {
    const learningContext = await loadTenantLearningContext(normalizedTenantId)

    logInfo('Contexto de aprendizaje cargado', {
      tenantId,
      hash,
      knownCategories: learningContext.knownCategories.length,
      knownBrands: learningContext.knownBrands.length,
      learnedRules: learningContext.learnedRules.length,
    })

    const prompt = buildPrompt({
      tenantId: normalizedTenantId,
      knownCategories: learningContext.knownCategories,
      knownBrands: learningContext.knownBrands,
      learnedRules: learningContext.learnedRules,
      preferencesByType: learningContext.preferencesByType,
    })

    const model = genAI.getGenerativeModel({ model: MODEL_NAME })

    const result = await withRetry(async () => {
      return model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: imageBuffer.toString('base64'),
                  mimeType: safeMime,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topP: 0.9,
          responseMimeType: 'application/json',
        },
      })
    })

    const response = await result.response
    const rawText = response.text()
    const parsed = extractJsonObject(rawText)
    const normalized = normalizeAnalysis(parsed, { hash, tenantId })

    logInfo('Análisis IA completado', {
      tenantId,
      hash,
      confidence: normalized.confidence,
      needsReview: normalized.needsReview,
      categoria: normalized.categoria,
      marca: normalized.marca,
    })

    return normalized
  } catch (error) {
    logError('analyzeImage failed', {
      tenantId,
      hash,
      error: error?.message,
    })

    return buildFallbackResult({ hash, tenantId, error })
  }
}

export async function analyzeProductImage({ tenantId, imageBuffer, mimeType }) {
  return analyzeImage(imageBuffer, mimeType, tenantId)
}

export async function analyzeProductImageFromUrl({ tenantId, imageUrl }) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('imageUrl inválida')
  }

  const response = await fetch(imageUrl)

  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen (${response.status})`)
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const arrayBuffer = await response.arrayBuffer()

  return analyzeImage(Buffer.from(arrayBuffer), contentType, tenantId)
}
