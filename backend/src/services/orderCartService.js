import mongoose from 'mongoose'
import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import { isValidObjectId, toObjectId } from '../utils/requestContext.js'
import { resolveCartPricing } from './cartPricingService.js'

const ALLOWED_CURRENCIES = ['ARS', 'USD', 'EUR']
const MAX_ORDER_LINES = 100

const normalizeObjectId = value => {
  if (!value) return null
  if (value instanceof mongoose.Types.ObjectId) return value
  if (!isValidObjectId(value)) return null
  return toObjectId(value)
}

const selectedAttributesToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const findVariant = ({ product, cartItem }) => {
  if (!product?.hasVariants) return null

  const variantIdentifier =
    cartItem.variantId ||
    cartItem.selectedVariant?.id ||
    cartItem.variantSku ||
    cartItem.variantSKU ||
    null

  if (!variantIdentifier) return null

  return (
    product.variants?.find(variant => {
      return (
        String(variant._id) === String(variantIdentifier) ||
        String(variant.id) === String(variantIdentifier) ||
        String(variant.key) === String(variantIdentifier) ||
        String(variant.sku) === String(variantIdentifier)
      )
    }) || null
  )
}

const getProductImageUrl = product => {
  return (
    product?.images?.find?.(image => image?.isMain)?.url ||
    product?.images?.[0]?.url ||
    null
  )
}

const getVariantImageUrl = variant => variant?.image?.url || null

export const validateCartOwnership = ({ cart, userId, tenantId }) => {
  if (!cart) {
    throw new Error('El carrito no existe')
  }

  if (String(cart.userId) !== String(userId)) {
    throw new Error('El carrito no pertenece al usuario actual')
  }

  if (String(cart.tenantId) !== String(tenantId)) {
    throw new Error('El carrito no pertenece al comercio actual')
  }

  if (!Array.isArray(cart.products) || cart.products.length === 0) {
    throw new Error('El carrito está vacío')
  }

  if (cart.products.length > MAX_ORDER_LINES) {
    throw new Error(`La orden supera el máximo de ${MAX_ORDER_LINES} líneas`)
  }
}

export const calculateCartLines = async ({
  cart,
  tenantId,
  session = null,
  money,
}) => {
  const tenantObjectId = normalizeObjectId(tenantId)

  if (!tenantObjectId) {
    throw new Error('tenantId inválido para cálculo de carrito')
  }

  const productIds = cart.products
    .map(item => item.productId)
    .filter(Boolean)
    .map(id => String(id))

  if (!productIds.length) {
    throw new Error('El carrito no contiene productos válidos')
  }

  const dbProducts = await Product.find({
    _id: { $in: productIds },
    tenantId: tenantObjectId,
    isDeleted: { $ne: true },
  })
    .setOptions({ tenantId })
    .session(session)
    .lean()

  const productMap = new Map(
    dbProducts.map(product => [String(product._id), product]),
  )

  let currency = null
  let subtotalCents = 0

  const lines = []
  const lineContexts = []

  for (let index = 0; index < cart.products.length; index += 1) {
    const cartItem = cart.products[index]
    const product = productMap.get(String(cartItem.productId))

    if (!product) {
      throw new Error(`Producto no disponible en ítem ${index + 1}`)
    }

    const count = Number(cartItem.quantity)

    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Cantidad inválida en ítem ${index + 1}`)
    }

    const variant = findVariant({ product, cartItem })

    if (product.hasVariants && !variant) {
      throw new Error(
        `La variante seleccionada ya no existe para "${product.title}"`,
      )
    }

    if (variant && variant.isActive === false) {
      throw new Error(
        `La variante seleccionada está inactiva para "${product.title}"`,
      )
    }

    const availableStock = variant
      ? Number(variant.stock ?? variant.quantity ?? 0)
      : Number(product.stock ?? product.quantity ?? 0)

    if (availableStock < count) {
      throw new Error(
        `Stock insuficiente para "${product.title}" (solicitado: ${count}, disponible: ${availableStock})`,
      )
    }

    const pricing = await resolveCartPricing({
      tenantId,
      product,
      variant,
    })

    const lineCurrency = String(
      cartItem.currency || product.currency || 'ARS',
    ).toUpperCase()

    if (!ALLOWED_CURRENCIES.includes(lineCurrency)) {
      throw new Error(`Moneda inválida: ${lineCurrency}`)
    }

    if (!currency) currency = lineCurrency

    if (currency !== lineCurrency) {
      throw new Error('Todas las líneas deben usar la misma moneda')
    }

    const priceCents = money.fromDecimal(pricing.price)
    const originalPriceCents = money.fromDecimal(
      pricing.originalPrice ?? pricing.price,
    )
    const lineSubtotalCents = money.multiply(priceCents, count)
    const originalSubtotalCents = money.multiply(originalPriceCents, count)

    subtotalCents += lineSubtotalCents

    const persistedLine = {
      tenantId: tenantObjectId,
      product: normalizeObjectId(product._id),
      count,
      color:
        cartItem.colorId && isValidObjectId(cartItem.colorId)
          ? normalizeObjectId(cartItem.colorId)
          : null,
      titleSnapshot: product.title,
      slugSnapshot: product.slug || null,
      imageSnapshot: getVariantImageUrl(variant) || getProductImageUrl(product),
      skuSnapshot: variant?.sku || product.sku || null,
      variantId: variant?._id || null,
      variantKey: variant?.key || null,
      variantSku: variant?.sku || null,
      selectedAttributes: selectedAttributesToObject(
        cartItem.selectedAttributes ||
          cartItem.variantAttributes ||
          cartItem.selectedVariant?.attributes,
      ),
      priceCents,
      originalPriceCents,
      discountPercentage: Number(pricing.discountPercentage || 0),
      promotionId: pricing.promotionId || null,
      promotionTitle: pricing.promotionTitle || null,
      promotionType: pricing.promotionType || null,
      subtotalCents: lineSubtotalCents,
      originalSubtotalCents,
      currency: lineCurrency,
    }

    lines.push(persistedLine)
    lineContexts.push({
      line: persistedLine,
      product,
      variant,
    })
  }

  return {
    lines,
    lineContexts,
    subtotalCents,
    currency: currency || 'ARS',
  }
}

export const clearCart = async ({ cartId, tenantId, session = null }) => {
  await Cart.deleteOne({
    _id: cartId,
    tenantId,
  })
    .setOptions({ tenantId })
    .session(session)
}
