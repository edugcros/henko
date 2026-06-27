// 📁 src/services/aiAgent/aiCartRecoveryService.js
import mongoose from 'mongoose'
import AiAgent from '../../models/aiAgentModel.js'
import AiCartRecovery from '../../models/aiCartRecoveryModel.js'
import AiCampaignRule from '../../models/aiCampaignRuleModel.js'
import User from '../../models/userModel.js'
import Product from '../../models/productModel.js'

const clean = value => String(value || '').trim()

const toCents = value => {
  const number = Number(value || 0)
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0
}

const toSafePositiveNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

const normalizeProductId = value => {
  const cleanValue = clean(value?._id || value?.id || value)
  return cleanValue || null
}

const addMinutes = (date, minutes) => {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000)
}

const getUserPhone = user => {
  return clean(
    user?.mobile ||
      user?.phone ||
      user?.telefono ||
      user?.profile?.mobile ||
      user?.profile?.phone ||
      '',
  )
}

const getUserName = user => {
  const explicit = clean(user?.name || user?.fullName)
  if (explicit) return explicit

  return clean(
    `${user?.firstname || user?.firstName || ''} ${user?.lastname || user?.lastName || ''}`,
  )
}

const resolveTenantDomain = tenant => {
  const domains = Array.isArray(tenant?.domains) ? tenant.domains : []

  const primary = domains.find(
    domain => domain?.status === 'active' && domain?.isPrimary,
  )
  const firstActive = domains.find(domain => domain?.status === 'active')
  const selected = primary || firstActive

  return clean(selected?.hostname || selected?.normalizedHostname || '')
}

const buildCheckoutUrl = ({ tenant, recoveryId }) => {
  const domain = resolveTenantDomain(tenant)
  const explicitBaseUrl =
    process.env.PUBLIC_STOREFRONT_URL ||
    process.env.FRONTEND_URL ||
    process.env.WEBSITE_URL ||
    ''

  if (explicitBaseUrl && explicitBaseUrl.includes('{domain}') && domain) {
    const resolved = explicitBaseUrl.replaceAll('{domain}', domain)
    return `${resolved.replace(/\/+$/, '')}/checkout?recovery=${recoveryId}`
  }

  if (domain) {
    const protocol =
      domain.includes('localhost') || domain.includes('.local')
        ? 'http'
        : 'https'
    return `${protocol}://${domain.replace(/\/+$/, '')}/checkout?recovery=${recoveryId}`
  }

  if (
    explicitBaseUrl &&
    process.env.AI_ALLOW_GLOBAL_STOREFRONT_URL === 'true'
  ) {
    return `${explicitBaseUrl.replace(/\/+$/, '')}/checkout?recovery=${recoveryId}`
  }

  return ''
}

const getImageUrl = ({ cartItem, product }) => {
  if (clean(cartItem?.image)) return clean(cartItem.image)

  const selectedVariantImage = cartItem?.selectedVariant?.image
  if (typeof selectedVariantImage === 'string' && clean(selectedVariantImage)) {
    return clean(selectedVariantImage)
  }

  if (clean(selectedVariantImage?.url)) return clean(selectedVariantImage.url)

  const firstImage = product?.images?.[0]
  if (typeof firstImage === 'string') return clean(firstImage)

  return clean(firstImage?.url || '')
}

const getVariantSnapshot = item => {
  return {
    cartKey: item?.cartKey || null,
    variantId: item?.variantId || item?.selectedVariant?.id || null,
    variantSku:
      item?.variantSku ||
      item?.variantSKU ||
      item?.selectedVariant?.sku ||
      null,
    selectedAttributes:
      item?.selectedAttributes ||
      item?.variantAttributes ||
      item?.selectedVariant?.attributes ||
      {},
    selectedVariant: item?.selectedVariant || null,
    colorId: item?.colorId || null,
    size: item?.size || null,
    gender: item?.gender || null,
  }
}

export const createCartRecoveryFromCart = async ({
  tenantId,
  tenant = null,
  cart,
  userId = null,
}) => {
  const cartItems = Array.isArray(cart?.products) ? cart.products : []

  if (!tenantId || !cart?._id || cartItems.length === 0) {
    return null
  }

  const [agent, rule, user] = await Promise.all([
    AiAgent.findOne({
      tenantId,
      enabled: true,
      'channels.whatsapp.enabled': true,
    })
      .setOptions({ tenantId })
      .lean(),

    AiCampaignRule.findOne({
      tenantId,
      type: 'abandoned_cart',
      enabled: true,
      channel: 'whatsapp',
    })
      .setOptions({ tenantId })
      .lean(),

    userId
      ? User.findOne({ _id: userId, tenantId }).setOptions({ tenantId }).lean()
      : null,
  ])

  if (!agent || !rule || !user) {
    return null
  }

  const phone = getUserPhone(user)

  if (!phone) {
    return null
  }

  const existing = await AiCartRecovery.findOne({
    tenantId,
    cartId: cart._id,
    status: {
      $in: ['pending', 'scheduled', 'processing', 'sent', 'responded', 'converted'],
    },
  }).setOptions({ tenantId })

  if (existing) {
    return existing
  }

  const productIds = [
    ...new Set(
      cartItems
        .map(item => normalizeProductId(item?.productId || item?.product))
        .filter(Boolean),
    ),
  ]

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId,
    isDeleted: { $ne: true },
  })
    .setOptions({ tenantId })
    .select(
      'title slug images price compareAtPrice currency stock hasVariants variants status visibility',
    )
    .lean()

  const productMap = new Map(
    products.map(product => [String(product._id), product]),
  )

  const snapshotItems = cartItems
    .map(item => {
      const productId = normalizeProductId(item?.productId || item?.product)
      if (!productId) return null

      const product = productMap.get(String(productId))
      const price = Number(
        item?.price ?? item?.selectedVariant?.price ?? product?.price ?? 0,
      )
      const quantity = Math.max(toSafePositiveNumber(item?.quantity || item?.count, 1), 1)
      const title = clean(item?.title || product?.title || 'Producto')
      const slug = clean(product?.slug)

      return {
        productId: String(productId),
        title,
        quantity,
        priceCents: toCents(price),
        image: getImageUrl({ cartItem: item, product }),
        url: slug ? `/product/${slug}` : `/product/${productId}`,
        variant: getVariantSnapshot(item),
      }
    })
    .filter(Boolean)

  if (snapshotItems.length === 0) {
    return null
  }

  const subtotalCents =
    toCents(cart.totalAfterDiscount || cart.cartTotal) ||
    snapshotItems.reduce(
      (total, item) => total + item.priceCents * item.quantity,
      0,
    )

  if (subtotalCents < toSafePositiveNumber(rule.trigger?.minCartAmountCents, 0)) {
    return null
  }

  const cartVersion = new Date(cart.updatedAt || cart.createdAt || 0).getTime()
  const dedupeKey = `${String(cart._id)}:${cartVersion}`
  const recoveryId = new mongoose.Types.ObjectId()
  const checkoutUrl = buildCheckoutUrl({
    tenant,
    recoveryId,
  })

  return AiCartRecovery.findOneAndUpdate(
    { tenantId, dedupeKey },
    {
      $setOnInsert: {
        _id: recoveryId,
        tenantId,
        dedupeKey,
        userId,
        cartId: cart._id,
        channel: 'whatsapp',
        customer: {
          name: getUserName(user),
          phone,
          email: clean(user.email),
        },
        cartSnapshot: {
          items: snapshotItems,
          subtotalCents,
          currency:
            clean(cartItems[0]?.currency || tenant?.currency || 'ARS') || 'ARS',
          checkoutUrl,
        },
        status: 'scheduled',
        recoveryStage: 1,
        scheduledAt: addMinutes(new Date(), rule.trigger?.delayMinutes || 30),
        expiresAt: addMinutes(
          new Date(),
          toSafePositiveNumber(
            process.env.AI_CART_RECOVERY_EXPIRE_MINUTES,
            60 * 24 * 7,
          ),
        ),
        attempts: 0,
        metadata: {
          ruleId: rule._id,
          source: 'cart_abandoned_detector',
          cartUpdatedAt: cart.updatedAt || null,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}
