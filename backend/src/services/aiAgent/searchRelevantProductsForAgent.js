// 📁 src/services/aiAgent/aiLeadProfileService.js

const clean = value => String(value || '').trim()

const normalize = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const unique = values => {
  return [...new Set(values.filter(Boolean))]
}

export const extractLeadPreferences = text => {
  const value = normalize(text)

  const colors = []
  const sizes = []
  const categories = []
  const intents = []

  const colorMap = [
    'negro',
    'blanco',
    'rojo',
    'azul',
    'verde',
    'amarillo',
    'gris',
    'marron',
    'beige',
    'rosa',
    'violeta',
    'naranja',
  ]

  for (const color of colorMap) {
    if (value.includes(color)) colors.push(color)
  }

  const sizeMatches = value.match(/\b(?:talle|numero|número|size)?\s*(\d{2,3}|xs|s|m|l|xl|xxl)\b/g) || []
  for (const match of sizeMatches) {
    const size = match.replace(/talle|numero|número|size/g, '').trim()
    if (size) sizes.push(size.toUpperCase())
  }

  const categoryMap = [
    'zapatilla',
    'zapatillas',
    'remera',
    'remeras',
    'campera',
    'camperas',
    'pantalon',
    'pantalón',
    'jean',
    'jeans',
    'buzo',
    'buzos',
    'celular',
    'notebook',
    'moto',
    'casco',
  ]

  for (const category of categoryMap) {
    if (value.includes(normalize(category))) categories.push(category)
  }

  if (/comprar|lo llevo|pagar|checkout|finalizar/.test(value)) {
    intents.push('purchase')
  }

  if (/barato|economico|económico|menos|oferta|promo|descuento/.test(value)) {
    intents.push('price_sensitive')
  }

  if (/envio|envío|entrega|retiro/.test(value)) {
    intents.push('shipping_interest')
  }

  const budgetMatch = value.match(/(?:hasta|menos de|maximo|máximo)\s*\$?\s*([\d.,]+)/)
  const budgetMax = budgetMatch
    ? Number(String(budgetMatch[1]).replace(/\./g, '').replace(',', '.'))
    : null

  return {
    colors: unique(colors),
    sizes: unique(sizes),
    categories: unique(categories),
    intents: unique(intents),
    budgetMax: Number.isFinite(budgetMax) ? budgetMax : null,
  }
}

export const mergeLeadPreferences = (current = {}, next = {}) => {
  return {
    colors: unique([...(current.colors || []), ...(next.colors || [])]),
    sizes: unique([...(current.sizes || []), ...(next.sizes || [])]),
    categories: unique([...(current.categories || []), ...(next.categories || [])]),
    intents: unique([...(current.intents || []), ...(next.intents || [])]),
    budgetMax: next.budgetMax || current.budgetMax || null,
  }
}