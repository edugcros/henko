/**
 * webResearchSource.js
 *
 * Señales cualitativas del mercado: intención de búsqueda, menciones, quejas
 * repetidas, marcas que compiten y rango de precios publicado.
 *
 * DOS PASOS, Y NINGUNO NECESITA LA CUOTA QUE ESTÁ EN CERO
 *
 *   1. Tavily busca y devuelve páginas reales, cada una con su URL.
 *   2. Gemini ordena esos extractos en el schema, con una llamada COMÚN.
 *
 * Esto reemplaza al grounding de Google, que estaba muerto: la familia Gemini 3
 * tiene cuota de búsqueda CERO en el nivel gratuito. Comprobado contra la API
 * con la clave de producción, misma clave y mismo minuto — sin `tools`
 * responde 200, con `tools` responde 429, en todos los modelos y en las dos
 * versiones de la API. No era falta de crédito: la búsqueda se mide aparte, y
 * el panel del proyecto la muestra como "Fundamentación de la búsqueda ·
 * Gemini 3 · 0/0".
 *
 * QUÉ GANA EL ANÁLISIS CON EL CAMBIO
 *
 * Las señales de acá pesan el 60% del modelo de scoring —demanda, tendencia e
 * interés social— y venían apagadas. Además, cada una sale ahora de un texto
 * que llegó con su URL: el modelo ordena evidencia verificable en vez de
 * recordar. Las fuentes que se muestran en el panel son esas URLs, no algo que
 * el modelo escribió.
 *
 * QUÉ NO CAMBIA
 *
 * El modelo NUNCA calcula el puntaje. Solo produce señales estructuradas; el
 * cálculo vive en scoring/demandScoreEngine.js.
 */

import { callAgentLLM } from '../../aiAgent/aiAgentLLMService.js'
import { readUsage } from '../../ai/aiUsageMetadata.js'
import { buildExtractionPrompt } from '../prompts/researchPrompt.js'
import { hasTavilyKey, tavilyExtract, tavilySearch } from './tavilyClient.js'

const num = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** Suficiente para el JSON del schema; este paso no escribe prosa. */
const EXTRACTION_MAX_TOKENS = num('MARKET_EXTRACTION_MAX_TOKENS', 2048)

/**
 * Tiempo propio para esta llamada. El default del agente son 15 segundos, que
 * alcanzan para contestar un WhatsApp y no para leer doce páginas: cortarla ahí
 * tira a la basura la búsqueda que ya se pagó.
 */
const EXTRACTION_TIMEOUT_MS = num('MARKET_EXTRACTION_TIMEOUT_MS', 45000)

/** Cuántas páginas se le pasan al modelo. Más contexto no es más señal. */
const MAX_PAGES = num('MARKET_RESEARCH_PAGES', 12)

/**
 * Cuánto de cada página se le manda al modelo.
 *
 * Eran 600, y con el resumen del buscador eso era casi todo lo que había. Con
 * el cuerpo real de la página —que trae de 6.000 a 18.000 caracteres— 600 es
 * el menú de navegación y nada más.
 */
const MAX_CHARS_PER_PAGE = num('MARKET_RESEARCH_CHARS_PER_PAGE', 3000)

/**
 * A cuántas páginas se les pide el cuerpo.
 *
 * Extract cuesta 1 crédito cada 5 URLs, así que cinco es el escalón barato:
 * el análisis pasa de 1 crédito a 2. El endpoint Research, que hace esto y
 * además redacta, cuesta de 4 a 110 sobre un plan de 1.000 al mes.
 */
const EXTRACT_PAGES = num('MARKET_RESEARCH_EXTRACT_PAGES', 5)

/**
 * Lo que se busca. Apunta a opiniones y PROBLEMAS, no a fichas de producto:
 * los precios ya los trae el buscador de precios, y lo que falta acá es lo
 * que la gente dice.
 *
 * Nombrar los problemas en la consulta no es sesgar: es pedir el material que
 * esta fuente necesita. Medido sobre 30 resultados, 'review opiniones
 * problemas defectos' devolvió 17 reseñas y 2 tiendas, contra 6 y 22 de la
 * consulta anterior.
 */
const RESEARCH_SUFFIX =
  String(process.env.MARKET_RESEARCH_QUERY_SUFFIX || '').trim() ||
  'review opiniones problemas defectos'

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    searchIntent: {
      type: 'object',
      properties: {
        informational: { type: 'integer' },
        commercial: { type: 'integer' },
        transactional: { type: 'integer' },
      },
    },
    socialSignals: {
      type: 'object',
      properties: { mentions: { type: 'integer' }, engagement: { type: 'string' } },
    },
    trendDirection: {
      type: 'string',
      enum: ['CRECIENTE', 'ESTABLE', 'DECRECIENTE', 'INDETERMINADA'],
    },
    complaints: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'string' },
          mentionedIn: { type: 'array', items: { type: 'integer' } },
        },
        required: ['issue', 'mentionedIn'],
      },
    },
    competition: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA', 'INDETERMINADA'],
        },
        knownBrands: { type: 'array', items: { type: 'string' } },
      },
    },
    priceRange: {
      type: 'object',
      properties: {
        min: { type: 'number' },
        max: { type: 'number' },
        currency: { type: 'string' },
      },
    },
  },
  required: ['searchIntent', 'trendDirection'],
}

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {string} params.country - ISO-2
 * @param {string} [params.apiKey] - BYOK del tenant o key de plataforma
 * @returns {Promise<ResearchSignals>}
 *
 * @typedef {Object} ResearchSignals
 * @property {boolean} available
 * @property {{informational:number, commercial:number, transactional:number}} searchIntent
 * @property {'CRECIENTE'|'ESTABLE'|'DECRECIENTE'|'INDETERMINADA'} trendDirection
 * @property {string[]} recurringComplaints
 * @property {Array<{url:string, title:string}>} sources - las páginas leídas, verificables
 */
export async function getWebResearchSignals({
  product,
  country,
  brand,
  apiKey,
  // Acumulador de creditos de herramienta. Quien contabiliza lo pasa; el
  // resto llama igual que antes.
  toolUsage = null,
}) {
  if (!hasTavilyKey()) {
    return { available: false, reason: 'NO_DISPONIBLE: el buscador web no está configurado' }
  }

  // ACÁ EL PAÍS NO VA. En el buscador de precios sí: necesita tiendas locales
  // y el dominio .ar se exige siempre. Esta fuente copió ese patrón y era
  // exactamente al revés.
  //
  // Medido sobre 30 resultados de la misma consulta, con y sin la palabra
  // "argentina": con el país, 6 reseñas y 22 tiendas; sin el país, 14 reseñas
  // y 1 tienda. El nombre del país es una señal comercial y arrastra
  // e-commerce, que es justo lo que esta fuente NO necesita.
  //
  // Y no se pierde nada: lo que un usuario opina de unas botas no cambia por
  // el país donde se compran. La localización es problema de los precios.
  const pages = await tavilySearch({
    query: `${product} ${RESEARCH_SUFFIX}`.trim(),
    language: 'es',
    source: 'webResearchSource',
    toolUsage,
  })

  if (pages === null) {
    return { available: false, reason: 'NO_DISPONIBLE: el buscador web no respondió' }
  }

  // Buscó y no encontró nada. Es un dato —de este producto no se habla— y no
  // una falla, pero no hay nada que estructurar.
  if (pages.length === 0) {
    return {
      available: false,
      reason: 'NO_DISPONIBLE: no se encontraron páginas que hablen de este producto',
      sources: [],
    }
  }

  const relevantes = sinRepetidas(pages).filter(p => mencionaMarca(p, brand))

  // Buscó, encontró páginas, y ninguna era de este producto. Es un resultado
  // distinto de "no hay nada publicado" y merece decirlo distinto.
  if (relevantes.length === 0) {
    return {
      available: false,
      reason: `NO_DISPONIBLE: ninguna de las ${pages.length} páginas encontradas habla de ${brand}`,
      sources: [],
      pagesFound: 0,
    }
  }

  // Primero las que opinan. Tomar las primeras doce que vengan dejaba el
  // análisis a merced del ranking del buscador — ver opinionScore().
  const ordenadas = [...relevantes].sort(
    (a, b) => opinionScore(b, brand) - opinionScore(a, brand),
  )

  const usadas = await conTextoCompleto(
    conTopePorDominio(ordenadas).slice(0, MAX_PAGES),
    toolUsage,
  )

  const extraction = await callAgentLLM({
    systemPrompt: buildExtractionPrompt({ product, country }),
    messages: [{ role: 'user', content: buildPagesDigest(usadas) }],
    conversationalMode: false,
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
    maxOutputTokens: EXTRACTION_MAX_TOKENS,
    // El default del agente son 5.000 caracteres por mensaje, pensado para un
    // chat. Acá el mensaje son doce páginas: medido, 8.765 caracteres se
    // recortaban a 5.000 —el 38%, y con él las últimas cuatro páginas— y el
    // panel seguía diciendo "12 páginas leídas". Se pide el tamaño real.
    maxCharsPerMessage: MAX_PAGES * (MAX_CHARS_PER_PAGE + 300),
    // Este paso no razona: ordena texto que ya está escrito. Con el
    // presupuesto por defecto, un modelo "thinking" gasta la salida pensando y
    // corta el JSON por la mitad.
    thinkingBudget: 1,
    timeoutMs: EXTRACTION_TIMEOUT_MS,
    apiKey,
  })

  const tokensUsed = Number(extraction?.usageMetadata?.totalTokenCount || 0)
  const usage = readUsage(extraction)

  // Las fuentes son las URLs que devolvió el buscador, nunca lo que el modelo
  // escriba: una URL inventada por un modelo es indistinguible de una real
  // hasta que alguien la abre.
  const sources = usadas.map(p => ({
    url: p?.url || null,
    title: String(p?.title || '').slice(0, 200) || 'NO_DISPONIBLE',
  }))

  const parsed = safeParseJson(extraction?.content)

  if (!parsed) {
    return {
      available: false,
      reason: 'NO_DISPONIBLE: la IA no devolvió las señales en el formato esperado',
      // La búsqueda salió bien y está pagada: se conserva lo que trajo.
      sources,
      pagesFound: usadas.length,
      tokensUsed,
      usage,
    }
  }

  const { complaints, ...senales } = parsed

  return {
    available: true,
    ...senales,
    // La regla vive acá y no en el prompt: una queja que aparece en dos
    // páginas distintas es un patrón; una sola es la experiencia de alguien.
    // El modelo reporta el hecho, el código decide qué cuenta.
    recurringComplaints: recurrentes(complaints),
    // También las sueltas, que no entran al score pero el comerciante puede
    // querer verlas: "una persona dijo que el cierre falla" es información.
    singleComplaints: sueltas(complaints),
    sources,
    pagesFound: usadas.length,
    tokensUsed,
    usage,
  }
}

/** Cuántas páginas distintas tienen que mencionarla para ser un patrón. */
const MIN_PAGES_FOR_PATTERN = num('MARKET_RESEARCH_MIN_COMPLAINT_PAGES', 2)

const listaDeQuejas = (complaints, filtro) =>
  (Array.isArray(complaints) ? complaints : [])
    .filter(c => c?.issue && filtro(new Set(c.mentionedIn || []).size))
    .map(c => String(c.issue).slice(0, 200))

const recurrentes = c => listaDeQuejas(c, n => n >= MIN_PAGES_FOR_PATTERN)
const sueltas = c => listaDeQuejas(c, n => n > 0 && n < MIN_PAGES_FOR_PATTERN)

/**
 * Como máximo unas pocas páginas por sitio.
 *
 * La fuente de precios ya guardaba UNA oferta por dominio —diez páginas de un
 * vendedor son un vendedor— pero acá no había tope, y se notó: una corrida
 * real leyó ONCE de sus doce páginas en fc-moto.de, un shop alemán, incluidas
 * fichas de la Tech-5 y la Tech-10, que no son el producto. Doce lecturas para
 * enterarse de lo que opina un solo sitio.
 *
 * El tope se aplica DESPUÉS de ordenar por opinión, así que un foro con varios
 * hilos buenos conserva sus dos mejores y el resto de los lugares queda para
 * otras voces. Dos, y no uno, porque en un foro o en YouTube dos hilos
 * distintos sí son dos opiniones distintas.
 */
const MAX_PER_DOMAIN = num('MARKET_RESEARCH_MAX_PER_DOMAIN', 2)

function conTopePorDominio(pages) {
  const cuenta = new Map()

  return pages.filter(p => {
    let host
    try {
      host = new URL(String(p?.url || '')).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      return false
    }

    const vistas = cuenta.get(host) || 0
    if (vistas >= MAX_PER_DOMAIN) return false

    cuenta.set(host, vistas + 1)
    return true
  })
}

/**
 * Cuánto promete opinar esta página.
 *
 * Esta fuente busca lo que la gente DICE del producto. La misma consulta,
 * repetida con minutos de diferencia, devolvió una vez doce fichas de tienda
 * —cuatro de ellas del sitio del propio fabricante, donde por definición no
 * hay una queja— y otra vez diez reseñas entre las primeras doce. El ranking
 * del buscador varía, y tomar las primeras que vengan ataba el análisis a esa
 * lotería: con las doce fichas de tienda, `recurringComplaints` volvió vacío.
 *
 * No se descarta nada, se ordena: si no hay una sola reseña, se leen las
 * fichas igual y el resultado lo dirá. Lo que cambia es a quién se le pide el
 * cuerpo completo —solo las primeras cinco, que es lo que cuesta un crédito—
 * y qué doce llegan al modelo.
 */
const OPINION_MARKERS =
  /(review|rese[nñ]a|revis[ai]|opinion|opini[oó]n|prueba|probamos|probada|test|comparativ|an[aá]lisis|foro|forum|viewtopic|hilo|coment|vale la pena|versus)/i

/** Sitios cuyo contenido ES la opinión de la gente. */
const COMMUNITY_HOSTS =
  /(reddit|youtube|youtu\.be|tiktok|instagram|facebook|quora|forocoches|taringa|vitalmx)/i

/** Marcas de página de venta: tiene precio y botón de comprar, no opiniones. */
const SHOP_MARKERS = /(\/products?\/|\/productos?\/|\/collections?\/|\/comprar|\/tienda\/|\/shop\/|\/cart)/i

function opinionScore(page, brand = null) {
  const url = String(page?.url || '')
  const texto = `${page?.title || ''} ${url}`.toLowerCase()

  let score = 0

  if (OPINION_MARKERS.test(texto)) score += 3
  if (COMMUNITY_HOSTS.test(url)) score += 3
  if (SHOP_MARKERS.test(url)) score -= 2

  // El sitio del propio fabricante. En la corrida que motivó esto, cuatro de
  // las doce páginas eran es.alpinestars.com: una marca no publica las quejas
  // sobre su producto, así que pedirle opiniones a su tienda es gastar la
  // lectura. Pesa más que cualquier otra marca porque es una certeza, no un
  // indicio.
  if (brand && esSitioDeLaMarca(url, brand)) score -= 5

  return score
}

function esSitioDeLaMarca(url, brand) {
  const token = String(brand)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (token.length < 3) return false

  try {
    return new URL(url).hostname.toLowerCase().replace(/[^a-z0-9]/g, '').includes(token)
  } catch {
    return false
  }
}

/**
 * El cuerpo real de las primeras páginas, con el resumen como respaldo.
 *
 * Lo que devuelve `search` en `content` es un resumen, y para una ficha de
 * tienda ese resumen es el texto ALT de las fotos. Medido sobre las botas
 * Alpinestars Tech-7, lo que llegaba al modelo era "vista superior que
 * muestra el forro interior... goma texturizada azul y negra". Pedirle quejas
 * de compradores a eso y recibir una lista vacía no era un fallo del modelo:
 * era la respuesta correcta, porque ahí no hay ninguna queja.
 *
 * `extract` devuelve el texto de verdad —7.319 caracteres del hilo del foro,
 * 8.732 de la review, 18.286 de la prueba— por 1 crédito cada 5 URLs.
 *
 * Solo a las primeras EXTRACT_PAGES, que son las mejor rankeadas. Si Extract
 * falla o no cubre una página, esa se queda con el resumen del buscador: se
 * pierde calidad en esa página, no el análisis.
 */
async function conTextoCompleto(pages, toolUsage = null) {
  if (pages.length === 0) return pages

  const objetivo = pages.slice(0, EXTRACT_PAGES)
  const extraidas = await tavilyExtract({
    urls: objetivo.map(p => p.url).filter(Boolean),
    source: 'webResearchSource',
    toolUsage,
  })

  if (!extraidas?.length) return pages

  const porUrl = new Map(extraidas.map(e => [e.url, e.content]))

  return pages.map(p => {
    const cuerpo = porUrl.get(p.url)
    return cuerpo ? { ...p, content: cuerpo, fullText: true } : p
  })
}

/**
 * La página tiene que nombrar la marca en el título o la URL.
 *
 * Medido contra la API: "Gorra Fox Racing Negra con Logo Blanco" devolvió 20
 * páginas y una sola era de una gorra Fox. El modelo leyó las otras
 * diecinueve —gorras de PUMA, Alpinestars, 226ERS, Armani, un sitio de
 * stickers PNG— y reportó obedientemente `knownBrands: [226ERS, Mitchell
 * Ness, HRT, Alpinestars]` y competencia ALTA. Son señales que pesan el 60%
 * del score, construidas leyendo sobre otros productos.
 *
 * Sin marca conocida —producto fuera del catálogo— no se filtra: es preferible
 * leer de más que no leer nada.
 */
function mencionaMarca(page, brand) {
  if (!brand) return true

  const token = String(brand)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)[0]

  if (!token || token.length < 2) return true

  return `${page?.title || ''} ${page?.url || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .includes(token)
}

/**
 * La misma página, una sola vez.
 *
 * En una corrida real entraron `es.alpinestars.com//products/intuitive-
 * snapback-hat` y `es.alpinestars.com/products/intuitive-snapback-hat`: la
 * misma página con una barra de más. Tavily las devolvió como dos resultados,
 * el modelo las contó como dos menciones y el panel las listó dos veces. Un
 * conteo de páginas que se puede inflar con una barra no mide nada.
 */
function sinRepetidas(pages) {
  const vistas = new Set()

  return pages.filter(p => {
    const clave = normalizarUrl(p?.url)
    if (!clave || vistas.has(clave)) return false

    vistas.add(clave)
    return true
  })
}

function normalizarUrl(url) {
  try {
    const { hostname, pathname } = new URL(String(url || ''))

    // Sin query ni ancla, sin barras repetidas y sin la barra final: es la
    // misma página en todos esos casos.
    const ruta = pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '')

    return `${hostname.toLowerCase()}${ruta}`
  } catch {
    return null
  }
}

/**
 * Las páginas, numeradas y con su URL. El prompt pide contar extractos por
 * tipo, así que la numeración no es decorativa: es lo que el modelo cuenta.
 */
function buildPagesDigest(pages) {
  return pages
    .map((p, i) => {
      const texto = String(p?.content || '')
        .replace(/\s+/g, ' ')
        .slice(0, MAX_CHARS_PER_PAGE)

      return `[${i + 1}] ${p?.title || 'sin título'}\n${p?.url || ''}\n${texto}`
    })
    .join('\n\n')
}

/**
 * El modelo debería devolver JSON pelado —se le pide responseMimeType y
 * schema— pero a veces lo envuelve en un bloque de código o le antepone una
 * línea. Las dos formas se recuperan sin gastar otra llamada.
 */
function safeParseJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const candidatos = [raw]

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidatos.push(fenced[1].trim())

  const primera = raw.indexOf('{')
  const ultima = raw.lastIndexOf('}')
  if (primera !== -1 && ultima > primera) candidatos.push(raw.slice(primera, ultima + 1))

  for (const candidato of candidatos) {
    try {
      const parsed = JSON.parse(candidato)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Se prueba la forma siguiente.
    }
  }

  return null
}

/**
 * Expuesto solo para los tests: el orden en que se leen las páginas decide qué
 * ve el modelo, y esa regla necesita cobertura sin salir a la red.
 */
export const __test__ = { opinionScore, conTopePorDominio, recurrentes, sueltas }
