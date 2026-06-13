// 📁 src/services/aiAgent/aiAgentResponseValidatorService.js

const clean = value => String(value || '').trim()

const normalizeText = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const extractNumbers = text => {
  return normalizeText(text).match(/\d+(?:[.,]\d+)?/g) || []
}

const includesAny = (text, values) => {
  const normalizedText = normalizeText(text)

  return values.some(value => {
    const normalizedValue = normalizeText(value)
    return normalizedValue && normalizedText.includes(normalizedValue)
  })
}

const productTextValues = product => {
  return [
    product.title,
    product.sku,
    product.brand,
    product.category,
    product.subcategory,
    product.slug,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean)
}

const collectAllowedProductNames = products => {
  return products.flatMap(productTextValues)
}

const collectAllowedPromotionCodes = promotions => {
  return promotions
    .flatMap(promotion => [promotion.code, promotion.description])
    .filter(Boolean)
}

export const validateAgentCommerceResponse = ({
  responseText,
  products = [],
  promotions = [],
} = {}) => {
  const text = clean(responseText)

  const warnings = []
  const blockedReasons = []

  if (!text) {
    blockedReasons.push('empty_response')
  }

  const lower = normalizeText(text)

  const mentionsPrice =
    /\$|ars|precio|vale|sale|cuesta|cuestan|valor/.test(lower)

  const mentionsStock =
    /stock|disponible|disponibles|hay unidades|tenemos/.test(lower)

  const mentionsDiscount =
    /descuento|cupon|cupón|promo|promocion|promoción|oferta/.test(lower)

  if (mentionsPrice && products.length === 0) {
    warnings.push('mentions_price_without_products')
  }

  if (mentionsStock && products.length === 0) {
    warnings.push('mentions_stock_without_products')
  }

  if (mentionsDiscount && promotions.length === 0) {
    warnings.push('mentions_discount_without_promotions')
  }

  const allowedProductNames = collectAllowedProductNames(products)
  const allowedPromotionCodes = collectAllowedPromotionCodes(promotions)

  const mentionsKnownProduct = includesAny(text, allowedProductNames)
  const mentionsKnownPromotion = includesAny(text, allowedPromotionCodes)

  if (products.length > 0 && /recomiendo|te sugiero|tenemos|encontre|encontré/.test(lower)) {
    if (!mentionsKnownProduct) {
      warnings.push('commercial_recommendation_without_known_product_reference')
    }
  }

  if (mentionsDiscount && promotions.length > 0 && !mentionsKnownPromotion) {
    warnings.push('discount_mentioned_without_known_code')
  }

  const responseNumbers = extractNumbers(text)
  const allowedNumbers = [
    ...products.flatMap(product => [
      product.price,
      product.stock,
      product.compareAtPrice,
      ...(Array.isArray(product.variants)
        ? product.variants.flatMap(variant => [variant.price, variant.stock])
        : []),
    ]),
    ...promotions.flatMap(promotion => [
      promotion.discountValue,
      promotion.minPurchaseAmount,
      promotion.maxDiscountAmount,
    ]),
  ]
    .map(value => String(Number(value || 0)))
    .filter(value => value !== '0')

  const suspiciousNumbers = responseNumbers.filter(number => {
    const normalized = number.replace(',', '.')
    if (Number(normalized) <= 31) return false
    return !allowedNumbers.some(allowed => allowed.includes(String(Math.round(Number(normalized)))))
  })

  if (suspiciousNumbers.length > 0 && (mentionsPrice || mentionsDiscount)) {
    warnings.push('contains_numbers_not_present_in_context')
  }

  return {
    ok: blockedReasons.length === 0,
    blockedReasons,
    warnings,
    shouldFallback:
      blockedReasons.length > 0 ||
      warnings.includes('mentions_price_without_products') ||
      warnings.includes('mentions_stock_without_products') ||
      warnings.includes('mentions_discount_without_promotions'),
  }
}

export const buildSafeFallbackResponse = ({
  products = [],
  promotions = [],
} = {}) => {
  if (products.length > 0) {
    const available = products.filter(product => product.available).slice(0, 3)

    if (available.length > 0) {
      const lines = available.map(product => {
        return `• ${product.title} — ${product.formattedPrice || `$${product.price}`} — stock: ${product.stock}`
      })

      return [
        'Encontré estas opciones disponibles:',
        '',
        ...lines,
        '',
        '¿Querés que te muestre más detalle de alguna?',
      ].join('\n')
    }
  }

  if (promotions.length > 0) {
    return 'Hay promociones activas, pero necesito que me indiques qué producto te interesa para confirmarte cuál aplica.'
  }

  return 'No encontré información suficiente en el catálogo para responder con precisión. ¿Podés decirme qué producto, marca, talle, color o categoría estás buscando?'
}