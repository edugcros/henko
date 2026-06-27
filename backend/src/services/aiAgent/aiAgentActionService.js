// 📁 src/services/aiAgent/aiAgentActionService.js

const clean = value => String(value || '').trim()

const normalize = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const tokenize = value => {
  return normalize(value)
    .split(/[^a-z0-9]+/i)
    .map(token => token.trim())
    .filter(token => /^\d+$/.test(token) || token.length >= 3)
}

const wantsProductDetails = text => {
  return /detalle|detalles|ver producto|mostrar|link|foto|imagen|caracteristicas|características|abrir producto|verlo|mostrarlo|entrar|enlace/.test(
    normalize(text),
  )
}

const wantsAddToCart = text => {
  return /agregar|sumar|poner|añadir|anadir|carrito|comprar|lo llevo|quiero ese|quiero esa|quiero este|quiero esta|finalizar compra|pedido/.test(
    normalize(text),
  )
}

const wantsHuman = text => {
  return /asesor|humano|persona|vendedor|contactar|hablar con alguien|atencion|atención|documentacion|documentación/.test(
    normalize(text),
  )
}

const isGenericPurchaseHelp = text => {
  const value = normalize(text)

  return /ayuda para comprar|necesito ayuda|quiero comprar|como compro|cómo compro|comprar algo|que tenes|qué tenés|productos destacados|ofertas|promociones/.test(
    value,
  )
}

const getProductId = product => {
  const id = product?.id || product?._id || product?.productId || null
  return id ? String(id) : null
}

const getProductTitle = product => {
  return clean(product?.title || product?.name || product?.nombre || '')
}

const getProductSlug = product => {
  return clean(product?.slug || '')
}

const getProductSku = product => {
  return clean(product?.sku || product?.SKU || '')
}

const getProductUrl = product => {
  const slug = getProductSlug(product)
  const id = getProductId(product)

  if (slug) return `/product/${encodeURIComponent(slug)}`
  if (id) return `/product/${encodeURIComponent(id)}`

  return ''
}

const getProductText = product => {
  return normalize(
    [
      getProductTitle(product),
      getProductSlug(product),
      getProductSku(product),
      product?.brand,
      product?.marca,
      product?.category,
      product?.categoria,
      product?.subcategory,
      product?.subcategoria,
      ...(Array.isArray(product?.tags) ? product.tags : []),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

const getResponseUrlScore = ({ product, responseText }) => {
  const slug = getProductSlug(product)
  const id = getProductId(product)
  const response = clean(responseText)

  let score = 0

  if (slug && response.includes(`/product/${slug}`)) score += 250
  if (id && response.includes(`/product/${id}`)) score += 220

  return score
}

const scoreProductForText = ({ product, text, responseText }) => {
  const queryTokens = tokenize(text)
  const responseTokens = tokenize(responseText)
  const productText = getProductText(product)
  const title = normalize(getProductTitle(product))
  const slug = normalize(getProductSlug(product))
  const sku = normalize(getProductSku(product))
  const normalizedText = normalize(text)
  const normalizedResponse = normalize(responseText)

  if (!productText) return 0

  let score = 0

  // Máxima prioridad: si Gemini puso la URL exacta del producto en la respuesta.
  score += getResponseUrlScore({ product, responseText })

  // Segunda prioridad: si Gemini nombró el título.
  if (title && normalizedResponse.includes(title)) score += 180
  if (slug && normalizedResponse.includes(slug)) score += 140
  if (sku && normalizedResponse.includes(sku)) score += 120

  // Tercera prioridad: si el usuario nombró el producto.
  if (title && normalizedText.includes(title)) score += 160
  if (slug && normalizedText.includes(slug)) score += 130
  if (sku && normalizedText.includes(sku)) score += 110

  // Coincidencias parciales con el texto del usuario.
  for (const token of queryTokens) {
    if (productText.includes(token)) score += 12
  }

  // Coincidencias parciales con la respuesta final de Gemini.
  for (const token of responseTokens) {
    if (productText.includes(token)) score += 6
  }

  if (product?.available) score += 8
  if (Number(product?.stock || 0) > 0) score += 6

  return score
}

const findBestActionProduct = ({ text, responseText, products }) => {
  const safeProducts = Array.isArray(products) ? products : []

  if (safeProducts.length === 0) return null

  const ranked = safeProducts
    .map(product => ({
      product,
      score: scoreProductForText({
        product,
        text,
        responseText,
      }),
    }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]

  if (!best) return null

  // Si Gemini mencionó URL/título, el score va a ser alto.
  // Si solo hay coincidencias genéricas, no generamos acción.
  if (best.score < 30) return null

  return best.product
}

const getVariantSearchText = variant => {
  const attributes =
    variant?.attributes ||
    variant?.selectedAttributes ||
    variant?.options ||
    {}

  return normalize(
    [
      variant?.sku,
      variant?.key,
      variant?.name,
      variant?.title,
      ...Object.entries(attributes).flatMap(([key, value]) => [key, value]),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

const getBestAvailableVariant = ({ product, text, responseText }) => {
  const availableVariants = (
    Array.isArray(product?.variants) ? product.variants : []
  ).filter(variant => {
    return variant?.available || Number(variant?.stock || 0) > 0
  })

  if (availableVariants.length === 0) return null
  if (availableVariants.length === 1) return availableVariants[0]

  const queryTokens = tokenize(`${text} ${responseText}`)
  const ranked = availableVariants
    .map(variant => {
      const variantText = getVariantSearchText(variant)
      const score = queryTokens.reduce((total, token) => {
        return total + (variantText.includes(token) ? 20 : 0)
      }, 0)

      return { variant, score }
    })
    .sort((a, b) => b.score - a.score)

  if (!ranked[0]?.score || ranked[0].score === ranked[1]?.score) {
    return null
  }

  return ranked[0].variant
}

const getProductPrice = product => {
  return Number(product?.price || product?.precio || product?.salePrice || 0)
}

const getVariantStock = variant => {
  return Number(
    variant?.stock ||
      variant?.quantity ||
      variant?.qty ||
      variant?.inventory ||
      0,
  )
}

const getProductStock = product => {
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return product.variants
      .filter(variant => variant?.isActive !== false && variant?.active !== false)
      .reduce((total, variant) => total + getVariantStock(variant), 0)
  }

  return Number(
    product?.stock ||
      product?.quantity ||
      product?.qty ||
      product?.inventory ||
      0,
  )
}

const isProductAvailableForCart = product => {
  if (!product) return false

  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return product.variants.some(variant => {
      return (
        variant?.isActive !== false &&
        variant?.active !== false &&
        (variant?.available || getVariantStock(variant) > 0)
      )
    })
  }

  return product?.available !== false && getProductStock(product) > 0
}

const hasProductSpecificAnswer = ({ product, responseText }) => {
  if (!product) return false

  const response = normalize(responseText)
  const title = normalize(getProductTitle(product))
  const slug = normalize(getProductSlug(product))

  return Boolean(
    (title && response.includes(title)) ||
    (slug && response.includes(slug)) ||
    clean(responseText).includes(getProductUrl(product)),
  )
}

export const buildAgentActions = ({
  text,
  responseText = '',
  products = [],
  promotions = [],
  behavior = {},
} = {}) => {
  const actions = []
  const cleanText = clean(text)
  const cleanResponse = clean(responseText)

  const selectedProduct = findBestActionProduct({
    text: cleanText,
    responseText: cleanResponse,
    products,
  })

  const genericHelp = isGenericPurchaseHelp(cleanText)
  const productWasActuallyMentioned = hasProductSpecificAnswer({
    product: selectedProduct,
    responseText: cleanResponse,
  })

  const allowProductAction =
    selectedProduct && (!genericHelp || productWasActuallyMentioned)

  const shouldCreateViewAction =
    behavior.canRecommendProducts !== false &&
    allowProductAction &&
    (wantsProductDetails(cleanText) ||
      wantsAddToCart(cleanText) ||
      productWasActuallyMentioned)

  const shouldCreateCartAction =
    behavior.canCreateCartLinks !== false &&
    allowProductAction &&
    isProductAvailableForCart(selectedProduct) &&
    wantsAddToCart(`${cleanText} ${cleanResponse}`)

  if (shouldCreateViewAction) {
    actions.push({
      type: 'view_product',
      label: `Ver ${getProductTitle(selectedProduct) || 'producto'}`,
      productId: getProductId(selectedProduct),
      slug: getProductSlug(selectedProduct),
      title: getProductTitle(selectedProduct),
      url: getProductUrl(selectedProduct),
    })
  }

  if (shouldCreateCartAction) {
    const variant = getBestAvailableVariant({
      product: selectedProduct,
      text: cleanText,
      responseText: cleanResponse,
    })
    const hasVariantCatalog =
      selectedProduct?.hasVariants ||
      (Array.isArray(selectedProduct?.variants) && selectedProduct.variants.length > 0)

    const requiresVariantSelection =
      hasVariantCatalog &&
      (!variant ||
        (Array.isArray(selectedProduct?.variants) &&
          selectedProduct.variants.length > 1 &&
          !variant))

    if (!requiresVariantSelection) {
      actions.push({
        type: 'add_to_cart',
        label: `Agregar ${getProductTitle(selectedProduct) || 'producto'} al carrito`,
        productId: getProductId(selectedProduct),
        variantId: variant?.id || variant?._id || null,
        sku: variant?.sku || getProductSku(selectedProduct),
        variantSku: variant?.sku || '',
        selectedAttributes:
          variant?.attributes || variant?.selectedAttributes || {},
        quantity: 1,
        title: getProductTitle(selectedProduct),
        price: Number(variant?.price || getProductPrice(selectedProduct)),
        stock: Number(variant ? getVariantStock(variant) : getProductStock(selectedProduct)),
        slug: getProductSlug(selectedProduct),
        url: getProductUrl(selectedProduct),
      })
    }
  }

  const wantsPromotion =
    /promo|promocion|promoción|descuento|cupon|cupón|oferta/.test(
      normalize(`${cleanText} ${cleanResponse}`),
    )

  if (
    behavior.canOfferDiscounts !== false &&
    wantsPromotion &&
    Array.isArray(promotions) &&
    promotions.length > 0
  ) {
    const selectedProductId = selectedProduct
      ? String(getProductId(selectedProduct))
      : ''

    const applicablePromotion =
      promotions.find(promo => {
        if (promo.usageScope !== 'specific_products') return true

        const applicableIds = Array.isArray(promo.applicableProductIds)
          ? promo.applicableProductIds.map(id => String(id))
          : []

        return selectedProductId && applicableIds.includes(selectedProductId)
      }) || null

    if (applicablePromotion) {
      actions.push({
        type: 'apply_coupon_hint',
        label:
          applicablePromotion.usageScope === 'specific_products'
            ? `Usar cupón ${applicablePromotion.code} en producto válido`
            : `Usar cupón ${applicablePromotion.code}`,
        couponCode: applicablePromotion.code,
        description:
          applicablePromotion.usageText ||
          applicablePromotion.description ||
          '',
        usageScope: applicablePromotion.usageScope,
        applicableProductIds: applicablePromotion.applicableProductIds || [],
        applicableProducts: applicablePromotion.applicableProducts || [],
      })
    }
  }

  if (wantsHuman(cleanText)) {
    actions.push({
      type: 'request_human',
      label: 'Hablar con un asesor',
    })
  }

  // Evita duplicados por tipo + producto.
  const unique = []
  const seen = new Set()

  for (const action of actions) {
    const key = `${action.type}:${action.productId || action.couponCode || ''}`

    if (seen.has(key)) continue

    seen.add(key)
    unique.push(action)
  }

  return unique
}

export const buildActionAwareReplySuffix = actions => {
  if (!Array.isArray(actions) || actions.length === 0) return ''

  const hasCartAction = actions.some(action => action.type === 'add_to_cart')
  const hasViewAction = actions.some(
    action => action.type === 'view_product',
  )
  const hasHumanAction = actions.some(
    action => action.type === 'request_human',
  )

  if (hasCartAction) {
    return '\n\nTe dejé una acción lista para agregar ese producto al carrito.'
  }

  if (hasViewAction) {
    return '\n\nTe dejé una acción para abrir ese producto.'
  }

  if (hasHumanAction) {
    return '\n\nTambién puedo dejar tu consulta marcada para que la tome un asesor.'
  }

  return ''
}
