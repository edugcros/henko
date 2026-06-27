// 📁 src/services/aiAgent/aiLeadProfileService.js

const clean = value => String(value ?? '').trim()

const normalize = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s$.,-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const unique = (values, limit = 30) => {
  const seen = new Set()
  const result = []

  for (const value of Array.isArray(values) ? values : []) {
    const normalized = clean(value)
    if (!normalized) continue

    const key = normalize(normalized)
    if (!key || seen.has(key)) continue

    seen.add(key)
    result.push(normalized)

    if (result.length >= limit) break
  }

  return result
}

const toArray = value => {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

const parseLocalizedNumber = value => {
  const raw = clean(value).replace(/[^\d.,-]/g, '')
  if (!raw) return null

  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : ''

  let normalized = raw

  if (decimalSeparator) {
    const separatorIndex = raw.lastIndexOf(decimalSeparator)
    const decimals = raw.length - separatorIndex - 1
    const isDecimal = decimals > 0 && decimals <= 2

    normalized = isDecimal
      ? `${raw.slice(0, separatorIndex).replace(/[.,]/g, '')}.${raw.slice(
        separatorIndex + 1,
      )}`
      : raw.replace(/[.,]/g, '')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const COLOR_ALIASES = [
  ['negro', ['negro', 'negra']],
  ['blanco', ['blanco', 'blanca']],
  ['rojo', ['rojo', 'roja', 'bordo', 'burdeos', 'vinotinto']],
  ['azul', ['azul', 'marino', 'celeste', 'turquesa']],
  ['verde', ['verde']],
  ['amarillo', ['amarillo', 'amarilla']],
  ['gris', ['gris', 'plata', 'plateado', 'plateada']],
  ['marron', ['marron', 'marrón', 'cafe', 'café', 'camel', 'suela']],
  ['beige', ['beige', 'crema', 'natural']],
  ['rosa', ['rosa', 'fucsia']],
  ['violeta', ['violeta', 'lila', 'morado', 'morada']],
  ['naranja', ['naranja']],
  ['dorado', ['dorado', 'dorada', 'oro']],
]

const INTENT_RULES = [
  ['purchase', /\b(comprar|lo llevo|la llevo|pagar|checkout|finalizar|reservar|señar|senar|hacer pedido)\b/],
  ['price_sensitive', /\b(barato|economico|economico|menos|oferta|promo|descuento|rebaja|liquidacion|liquidación)\b/],
  ['shipping_interest', /\b(envio|envios|entrega|retiro|retirar|delivery|despacho|correo)\b/],
  ['financing_interest', /\b(cuotas|financiacion|financiación|financiar|tarjeta|mercado pago|mercadopago|transferencia)\b/],
  ['stock_interest', /\b(stock|disponible|disponibles|hay|queda|quedan|tenes|tienen)\b/],
]

const extractColors = value => {
  const colors = []

  for (const [canonical, aliases] of COLOR_ALIASES) {
    if (aliases.some(alias => new RegExp(`\\b${normalize(alias)}\\b`).test(value))) {
      colors.push(canonical)
    }
  }

  return colors
}

const extractSizes = value => {
  const sizes = []

  const sizeMatches =
    value.match(
      /\b(?:talle|numero|nro|num|size|medida)?\s*(\d{1,3}|xxs|xs|s|m|l|xl|xxl|xxxl)\b/g,
    ) || []

  for (const match of sizeMatches) {
    const size = match
      .replace(/\b(talle|numero|nro|num|size|medida)\b/g, '')
      .trim()
      .toUpperCase()

    if (size && !['DE', 'EL', 'LA'].includes(size)) sizes.push(size)
  }

  return sizes
}

const extractCategories = ({ value, knownCategories }) => {
  return toArray(knownCategories)
    .map(clean)
    .filter(Boolean)
    .filter(category => {
      const normalizedCategory = normalize(category)
      return normalizedCategory && value.includes(normalizedCategory)
    })
}

const extractIntents = value => {
  return INTENT_RULES.filter(([, regex]) => regex.test(value)).map(
    ([intent]) => intent,
  )
}

const extractBudgetMax = value => {
  const patterns = [
    /(?:hasta|menos de|maximo|max)\s*\$?\s*([\d.,]+)/,
    /(?:presupuesto|gastar|pagar)\s*(?:de|hasta)?\s*\$?\s*([\d.,]+)/,
    /(?:entre|de)\s*\$?\s*[\d.,]+\s*(?:y|a|hasta)\s*\$?\s*([\d.,]+)/,
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    const parsed = match ? parseLocalizedNumber(match[1]) : null
    if (Number.isFinite(parsed)) return parsed
  }

  return null
}

const normalizePreferenceArray = values => unique(toArray(values).map(clean), 30)

const normalizeBudget = value => {
  const parsed = parseLocalizedNumber(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const extractLeadPreferences = (input, options = {}) => {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : { text: input }

  const text = source.text
  const knownCategories = Array.isArray(source.knownCategories)
    ? source.knownCategories
    : Array.isArray(options.knownCategories)
      ? options.knownCategories
      : []

  const value = normalize(text)

  if (!value) {
    return {
      colors: [],
      sizes: [],
      categories: [],
      intents: [],
      budgetMax: null,
    }
  }

  return {
    colors: unique(extractColors(value)),
    sizes: unique(extractSizes(value)),
    categories: unique(extractCategories({ value, knownCategories })),
    intents: unique(extractIntents(value)),
    budgetMax: extractBudgetMax(value),
  }
}

export const mergeLeadPreferences = (current = {}, next = {}) => {
  const currentBudget = normalizeBudget(current.budgetMax)
  const nextBudget = normalizeBudget(next.budgetMax)

  return {
    colors: unique([
      ...normalizePreferenceArray(current.colors),
      ...normalizePreferenceArray(next.colors),
    ]),
    sizes: unique([
      ...normalizePreferenceArray(current.sizes),
      ...normalizePreferenceArray(next.sizes),
    ]),
    categories: unique([
      ...normalizePreferenceArray(current.categories),
      ...normalizePreferenceArray(next.categories),
    ]),
    intents: unique([
      ...normalizePreferenceArray(current.intents),
      ...normalizePreferenceArray(next.intents),
    ]),
    budgetMax: nextBudget ?? currentBudget ?? null,
  }
}
