// 📁 src/services/wishlistPromotionNotifierService.js
import mongoose from 'mongoose'
import logger from '../../config/logger.js'
import Product from '../models/productModel.js'
import PromotionalBlock from '../models/promotionalBlockModel.js'
import Tenant from '../models/tenantModel.js'
import User from '../models/userModel.js'
import UserMetricEvent, {
  USER_METRIC_EVENTS,
} from '../models/userMetricEventModel.js'
import WishlistPromotionNotification from '../models/wishlistPromotionNotificationModel.js'
import { sendEmail } from './emailService.js'
import { env } from '../../config/env.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ADMIN_ROLES = new Set([
  'admin',
  'superadmin',
  'super_admin',
  'owner',
  'tenant_owner',
  'merchant',
  'seller',
])

const CUSTOMER_ROLES = new Set([
  'user',
  'customer',
  'cliente',
  'buyer',
])

const sanitizeString = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback
  const clean = String(value).trim()
  return clean || fallback
}

const escapeHtml = value => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const normalizeEmail = value => {
  const email = sanitizeString(value).toLowerCase()
  return EMAIL_REGEX.test(email) ? email : null
}

const toObjectId = value => {
  if (!mongoose.Types.ObjectId.isValid(value)) return null
  return new mongoose.Types.ObjectId(value)
}

const toIdString = value => {
  if (!value) return ''
  return String(value?._id || value)
}

const formatMoney = (value, currency = 'ARS') => {
  const amount = Number(value || 0)

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

const getUserName = user => {
  const fullName = [
    user?.firstname || user?.firstName,
    user?.lastname || user?.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  return fullName || user?.name || 'cliente'
}

const getUserRole = user => {
  return sanitizeString(
    user?.role ||
      user?.userType ||
      user?.accountType ||
      user?.type,
  ).toLowerCase()
}

const isAdminLikeUser = user => {
  const role = getUserRole(user)

  return (
    ADMIN_ROLES.has(role) ||
    user?.isAdmin === true ||
    user?.isSuperAdmin === true ||
    user?.isOwner === true ||
    user?.admin === true
  )
}

const isCustomerLikeUser = user => {
  const role = getUserRole(user)

  if (!role) {
    // Si tu app no guarda roles en clientes, permitimos usuarios sin role,
    // pero igual excluimos admins por flags.
    return !isAdminLikeUser(user)
  }

  return CUSTOMER_ROLES.has(role) && !isAdminLikeUser(user)
}

const getTenantOwnerIds = tenant => {
  return [
    tenant?.ownerUserId,
    tenant?.owner,
    tenant?.adminUserId,
    tenant?.createdBy,
  ]
    .filter(Boolean)
    .map(toIdString)
}

const isTenantOwnerUser = ({ user, tenant }) => {
  const userId = toIdString(user?._id)
  if (!userId) return false

  return getTenantOwnerIds(tenant).includes(userId)
}

const getStoreName = tenant => {
  return (
    sanitizeString(tenant?.storeName) ||
    sanitizeString(tenant?.name) ||
    sanitizeString(tenant?.general?.storeName) ||
    sanitizeString(tenant?.settings?.store?.name) ||
    'Tu tienda'
  )
}

const normalizeDomainValue = domain => {
  if (!domain) return ''

  if (typeof domain === 'string') {
    return sanitizeString(domain)
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
  }

  if (typeof domain === 'object') {
    return sanitizeString(
      domain.hostname ||
        domain.normalizedHostname ||
        domain.domain ||
        domain.value,
    )
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
  }

  return ''
}

const getPrimaryStorefrontDomain = tenant => {
  const domains = Array.isArray(tenant?.domains) ? tenant.domains : []

  const objectDomains = domains.filter(domain => {
    if (typeof domain === 'string') return true

    return (
      domain?.context === 'storefront' &&
      ['active', undefined, null, ''].includes(domain?.status)
    )
  })

  const primary =
    objectDomains.find(domain => typeof domain === 'object' && domain?.isPrimary) ||
    objectDomains[0]

  return normalizeDomainValue(primary)
}

const buildStoreUrl = tenant => {
  const domain = getPrimaryStorefrontDomain(tenant)

  if (domain) {
    const protocol =
      domain.includes('localhost') ||
      domain.includes('127.0.0.1') ||
      domain.endsWith('.local')
        ? 'http'
        : 'https'

    return `${protocol}://${domain}`.replace(/\/+$/, '')
  }

  const configured =
    sanitizeString(env.shopFrontendUrl) ||
    sanitizeString(env.clientUrl)

  return configured.replace(/\/+$/, '')
}

const buildProductUrl = ({ tenant, product }) => {
  const storeUrl = buildStoreUrl(tenant)
  if (!storeUrl || !product?._id) return ''

  return `${storeUrl}:3002/product/${product._id}`
}

const getProductImage = product => {
  const images = Array.isArray(product?.images) ? product.images : []
  const main = images.find(image => image?.isMain) || images[0]

  return (
    sanitizeString(main?.url) ||
    sanitizeString(main?.secure_url) ||
    sanitizeString(main?.imageUrl) ||
    ''
  )
}

const getDiscountedPrice = ({ product, discountPercentage }) => {
  const price = Number(product?.price || 0)
  const discount = Math.min(100, Math.max(0, Number(discountPercentage || 0)))

  return Math.max(0, price - price * (discount / 100))
}

const buildPromotionEmail = ({ tenant, user, product, promotion }) => {
  const storeName = getStoreName(tenant)
  const userName = getUserName(user)
  const productUrl = buildProductUrl({ tenant, product })
  const imageUrl = getProductImage(product)
  const discount = Number(promotion.discountPercentage || 0)
  const currency = product?.currency || 'ARS'
  const originalPrice = Number(product?.price || 0)
  const finalPrice = getDiscountedPrice({ product, discountPercentage: discount })
  const productTitle = sanitizeString(product.title, 'Producto')
  const promotionTitle =
    sanitizeString(promotion.promotionTitle) ||
    sanitizeString(promotion.customTitle) ||
    'Promoción especial'

  const subject = `${productTitle} tiene ${discount}% OFF en ${storeName}`

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Hola ${escapeHtml(userName)},</h2>

      <p style="margin: 0 0 16px;">
        Un producto que guardaste en tu lista de deseos ahora tiene una promoción activa.
      </p>

      <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; max-width: 560px;">
        ${
  imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(productTitle)}" style="width: 100%; max-height: 260px; object-fit: contain; border-radius: 8px; margin-bottom: 14px;" />`
    : ''
}

        <h3 style="margin: 0 0 8px;">${escapeHtml(productTitle)}</h3>

        <p style="margin: 0 0 10px;">
          ${escapeHtml(promotionTitle)}
        </p>

        <p style="margin: 0 0 16px; font-size: 18px;">
          <strong>${discount}% OFF</strong>
          <span style="color: #6b7280; text-decoration: line-through; margin-left: 8px;">
            ${formatMoney(originalPrice, currency)}
          </span>
          <span style="font-weight: 700; margin-left: 8px;">
            ${formatMoney(finalPrice, currency)}
          </span>
        </p>

        ${
  productUrl
    ? `<a href="${escapeHtml(productUrl)}" style="display: inline-block; background: #111827; color: #ffffff; padding: 12px 18px; border-radius: 8px; text-decoration: none; font-weight: 700;">Ver producto</a>`
    : ''
}
      </div>

      <p style="color: #6b7280; font-size: 12px; margin-top: 18px;">
        Recibiste este aviso porque el producto está en tu lista de deseos.
      </p>
    </div>
  `

  const text = [
    `Hola ${userName},`,
    `Un producto de tu lista de deseos tiene promoción: ${productTitle}`,
    `${discount}% OFF - ${formatMoney(finalPrice, currency)}`,
    productUrl ? `Ver producto: ${productUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subject, html, text }
}

const getActivePromotionItems = async ({
  tenantId,
  now = new Date(),
  promotionBlockId = null,
  productId = null,
}) => {
  const productObjectId = productId ? toObjectId(productId) : null
  const query = {
    tenantId,
    isDeleted: false,
    isActive: true,
    visibility: 'public',
    startDate: { $lte: now },
    endDate: { $gte: now },
    products: {
      $elemMatch: {
        ...(productObjectId ? { productId: productObjectId } : {}),
        isActive: { $ne: false },
        discountPercentage: { $gt: 0 },
      },
    },
  }

  if (promotionBlockId) {
    query._id = promotionBlockId
  }

  const blocks = await PromotionalBlock.find(query)
    .setOptions({ tenantId })
    .select('_id title type priority products')
    .lean()

  return blocks.flatMap(block => {
    return (block.products || [])
      .filter(item => item?.isActive !== false && Number(item?.discountPercentage || 0) > 0)
      .filter(item => {
        return !productObjectId || String(item.productId) === String(productObjectId)
      })
      .map(item => ({
        promotionId: block._id,
        promotionTitle: block.title,
        promotionType: block.type,
        productId: item.productId,
        customTitle: item.customTitle,
        customLabel: item.customLabel,
        discountPercentage: Number(item.discountPercentage || 0),
      }))
  })
}

const buildCustomerEligibilityQuery = ({
  tenantId,
  ownerIds = [],
  userId = null,
}) => {
  const query = {
    tenantId,
    isBlocked: { $ne: true },
    email: { $exists: true, $ne: '' },
    $and: [
      {
        $or: [
          { role: { $exists: false } },
          { role: { $in: [...CUSTOMER_ROLES] } },
        ],
      },
      {
        $or: [
          { isAdmin: { $exists: false } },
          { isAdmin: { $ne: true } },
        ],
      },
      {
        $or: [
          { isSuperAdmin: { $exists: false } },
          { isSuperAdmin: { $ne: true } },
        ],
      },
      {
        $or: [
          { isOwner: { $exists: false } },
          { isOwner: { $ne: true } },
        ],
      },
    ],
  }

  if (ownerIds.length) {
    query._id = { $nin: ownerIds }
  }

  if (userId) {
    query._id = ownerIds.length
      ? { $eq: userId, $nin: ownerIds }
      : userId
  }

  return query
}

const getWishlistProductIdsFromMetrics = async ({
  tenantId,
  productIds,
  userId = null,
}) => {
  const events = await UserMetricEvent.find({
    tenantId,
    productId: { $in: productIds },
    userId: userId || { $ne: null },
    eventType: {
      $in: [
        USER_METRIC_EVENTS.WISHLIST_ADD,
        USER_METRIC_EVENTS.WISHLIST_REMOVE,
      ],
    },
  })
    .sort({ occurredAt: -1, createdAt: -1 })
    .limit(5000)
    .select('userId productId eventType occurredAt createdAt')
    .lean()

  const latestByUserProduct = new Map()

  events.forEach(event => {
    if (!event.userId || !event.productId) return

    const key = `${String(event.userId)}::${String(event.productId)}`

    if (!latestByUserProduct.has(key)) {
      latestByUserProduct.set(key, event)
    }
  })

  const productIdsByUser = new Map()

  latestByUserProduct.forEach(event => {
    if (event.eventType !== USER_METRIC_EVENTS.WISHLIST_ADD) return

    const userKey = String(event.userId)
    const current = productIdsByUser.get(userKey) || new Set()

    current.add(String(event.productId))
    productIdsByUser.set(userKey, current)
  })

  return productIdsByUser
}



export const notifyWishlistPromotions = async ({
  tenantId,
  promotionBlockId = null,
  productId = null,
  userId = null,
  dryRun = false,
  limit = 100,
}) => {
  const normalizedTenantId = toObjectId(tenantId)
  const normalizedPromotionBlockId = promotionBlockId
    ? toObjectId(promotionBlockId)
    : null
  const normalizedProductId = productId ? toObjectId(productId) : null
  const normalizedUserId = userId ? toObjectId(userId) : null

  if (!normalizedTenantId) {
    throw new Error('tenantId inválido')
  }

  if (promotionBlockId && !normalizedPromotionBlockId) {
    throw new Error('promotionBlockId inválido')
  }

  if (productId && !normalizedProductId) {
    throw new Error('productId inválido')
  }

  if (userId && !normalizedUserId) {
    throw new Error('userId inválido')
  }

  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100))

  const tenant = await Tenant.findById(normalizedTenantId).lean()

  if (!tenant || tenant.status !== 'active') {
    throw new Error('Tenant inválido o inactivo')
  }

  const promotionItems = await getActivePromotionItems({
    tenantId: normalizedTenantId,
    promotionBlockId: normalizedPromotionBlockId,
    productId: normalizedProductId,
  })

  logger.info('[WishlistPromotionNotifier] Promociones activas detectadas', {
    tenantId: String(normalizedTenantId),
    promotionBlockId: normalizedPromotionBlockId
      ? String(normalizedPromotionBlockId)
      : null,
    productId: normalizedProductId ? String(normalizedProductId) : null,
    userId: normalizedUserId ? String(normalizedUserId) : null,
    count: promotionItems.length,
    promotionItems: promotionItems.map(item => ({
      promotionId: String(item.promotionId),
      productId: String(item.productId),
      discountPercentage: item.discountPercentage,
      promotionTitle: item.promotionTitle,
    })),
  })

  if (!promotionItems.length) {
    return {
      success: true,
      dryRun,
      scannedPromotions: 0,
      matchedUsers: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      items: [],
    }
  }

  const productIds = [
    ...new Set(
      promotionItems
        .map(item => String(item.productId || ''))
        .filter(Boolean),
    ),
  ]

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId: normalizedTenantId,
    isDeleted: { $ne: true },
    status: { $in: ['active', 'out-of-stock'] },
    visibility: 'visible',
  })
    .setOptions({ tenantId: normalizedTenantId })
    .select('_id title slug price currency images status visibility')
    .lean()

  const productById = new Map(
    products.map(product => [String(product._id), product]),
  )

  const validProductIds = products.map(product => product._id)
  const validProductIdStrings = validProductIds.map(id => String(id))

  logger.info('[WishlistPromotionNotifier] Productos válidos detectados', {
    tenantId: String(normalizedTenantId),
    requestedProductIds: productIds,
    validProductIds: validProductIdStrings,
    productsCount: products.length,
  })

  if (!validProductIds.length) {
    return {
      success: true,
      dryRun,
      scannedPromotions: promotionItems.length,
      matchedUsers: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      items: [],
    }
  }

  const ownerIds = getTenantOwnerIds(tenant)
    .filter(Boolean)
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id))

  const wishlistProductIdsByUser = await getWishlistProductIdsFromMetrics({
    tenantId: normalizedTenantId,
    productIds: validProductIds,
    userId: normalizedUserId,
  })

  const userQuery = {
    ...buildCustomerEligibilityQuery({
      tenantId: normalizedTenantId,
      ownerIds,
      userId: normalizedUserId,
    }),

    $or: [
      { wishlist: { $in: validProductIds } },
      { wishlist: { $in: validProductIdStrings } },
    ],
  }

  const usersFromWishlist = await User.find(userQuery)
    .setOptions({ tenantId: normalizedTenantId })
    .select(
      '_id email firstname lastname firstName lastName name wishlist role userType accountType type isAdmin isOwner isSuperAdmin',
    )
    .limit(safeLimit)
    .lean()

  const usersById = new Map(
    usersFromWishlist.map(user => [String(user._id), user]),
  )

  const metricUserIds = [...wishlistProductIdsByUser.keys()]
    .filter(userIdFromMetric => !usersById.has(userIdFromMetric))
    .filter(userIdFromMetric => mongoose.Types.ObjectId.isValid(userIdFromMetric))
    .map(userIdFromMetric => new mongoose.Types.ObjectId(userIdFromMetric))

  if (metricUserIds.length) {
    const metricUsers = await User.find({
      ...buildCustomerEligibilityQuery({
        tenantId: normalizedTenantId,
        ownerIds,
      }),
      _id: { $in: metricUserIds },
    })
      .setOptions({ tenantId: normalizedTenantId })
      .select(
        '_id email firstname lastname firstName lastName name wishlist role userType accountType type isAdmin isOwner isSuperAdmin',
      )
      .limit(Math.max(0, safeLimit - usersById.size))
      .lean()

    metricUsers.forEach(user => {
      usersById.set(String(user._id), user)
    })
  }

  const users = [...usersById.values()].slice(0, safeLimit)
  console.log('users',users)


  logger.info('[WishlistPromotionNotifier] Usuarios con wishlist detectados', {
    tenantId: String(normalizedTenantId),
    usersCount: users.length,
    usersFromWishlistCount: usersFromWishlist.length,
    usersFromMetricEventsCount: wishlistProductIdsByUser.size,
    users: users.map(user => ({
      userId: String(user._id),
      email: user.email,
      role: getUserRole(user),
      isAdmin: user.isAdmin,
      isOwner: user.isOwner,
      isSuperAdmin: user.isSuperAdmin,
      wishlist: (user.wishlist || []).map(id => String(id)),
    })),
  })

  const results = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const user of users) {
    const recipientEmail = normalizeEmail(user.email)
    console.log('recipientEmail',recipientEmail)


    if (!recipientEmail) {
      skipped += 1
      results.push({
        status: 'skipped',
        reason: 'invalid_user_email',
        userId: user._id,
      })
      continue
    }

    if (
      isTenantOwnerUser({ user, tenant }) ||
      isAdminLikeUser(user) ||
      !isCustomerLikeUser(user)
    ) {
      skipped += 1
      results.push({
        status: 'skipped',
        reason: 'not_customer_user',
        email: recipientEmail,
        userId: user._id,
        role: getUserRole(user),
      })
      continue
    }

    const wishlistSet = new Set(
      (user.wishlist || []).map(id => String(id)),
    )
    const metricWishlistSet =
      wishlistProductIdsByUser.get(String(user._id)) || new Set()

    const matchingItems = promotionItems.filter(item => {
      const itemProductId = String(item.productId)

      return (
        wishlistSet.has(itemProductId) ||
        metricWishlistSet.has(itemProductId)
      )
    })

    for (const promotion of matchingItems) {
      const product = productById.get(String(promotion.productId))

      if (!product) {
        skipped += 1
        results.push({
          status: 'skipped',
          reason: 'product_not_found_after_validation',
          email: recipientEmail,
          userId: user._id,
          productId: promotion.productId,
          promotionId: promotion.promotionId,
        })
        continue
      }

      const notificationKey = {
        tenantId: normalizedTenantId,
        userId: user._id,
        productId: product._id,
        promotionId: promotion.promotionId,
      }

      const existing =
        await WishlistPromotionNotification.findOne(notificationKey)

      if (existing?.status === 'sent' || existing?.status === 'pending') {
        skipped += 1
        results.push({
          status: 'skipped',
          reason: 'already_notified',
          email: recipientEmail,
          userId: user._id,
          productId: product._id,
          promotionId: promotion.promotionId,
        })
        continue
      }

      if (dryRun) {
        skipped += 1
        results.push({
          status: 'dry_run',
          email: recipientEmail,
          userId: user._id,
          productId: product._id,
          productTitle: product.title,
          promotionId: promotion.promotionId,
          discountPercentage: promotion.discountPercentage,
        })
        continue
      }

      let notification = existing || null

      try {
        if (notification) {
          notification.status = 'pending'
          notification.recipientEmail = recipientEmail
          notification.discountPercentage = promotion.discountPercentage
          notification.errorMessage = ''
          notification.metadata = {
            promotionTitle: promotion.promotionTitle,
            productTitle: product.title,
            retriedAt: new Date(),
          }

          await notification.save()
        } else {
          notification = await WishlistPromotionNotification.create({
            ...notificationKey,
            recipientEmail,
            status: 'pending',
            discountPercentage: promotion.discountPercentage,
            metadata: {
              promotionTitle: promotion.promotionTitle,
              productTitle: product.title,
            },
          })
        }

        const emailContent = buildPromotionEmail({
          tenant,
          user,
          product,
          promotion,
        })
console.log('emailContent',emailContent)

        logger.info('[WishlistPromotionNotifier] Enviando email de wishlist', {
          tenantId: String(normalizedTenantId),
          userId: String(user?._id),
          recipientEmail,
          userRole: getUserRole(user),
          productId: String(product._id),
          promotionId: String(promotion.promotionId),
        })

        const emailResult = await sendEmail({
          to: recipientEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          tenantConfig: tenant,
        })

        if (!emailResult?.success) {
          throw new Error(emailResult?.error || 'EMAIL_SEND_FAILED')
        }

        notification.status = 'sent'
        notification.sentAt = new Date()
        notification.errorMessage = ''
        await notification.save()

        sent += 1

        results.push({
          status: 'sent',
          email: recipientEmail,
          userId: user._id,
          productId: product._id,
          productTitle: product.title,
          promotionId: promotion.promotionId,
          discountPercentage: promotion.discountPercentage,
        })
      } catch (error) {
        failed += 1

        if (notification) {
          notification.status = 'failed'
          notification.errorMessage = error.message

          await notification.save().catch(saveError => {
            logger.warn(
              '[WishlistPromotionNotifier] No se pudo guardar fallo',
              {
                error: saveError.message,
              },
            )
          })
        }

        logger.error('[WishlistPromotionNotifier] Error enviando promoción', {
          tenantId: String(normalizedTenantId),
          userId: String(user._id),
          recipientEmail,
          productId: String(product._id),
          promotionId: String(promotion.promotionId),
          error: error.stack || error.message,
        })

        results.push({
          status: 'failed',
          email: recipientEmail,
          userId: user._id,
          productId: product._id,
          promotionId: promotion.promotionId,
          error: error.message,
        })
      }
    }
  }

  return {
    success: true,
    dryRun,
    scannedPromotions: promotionItems.length,
    matchedUsers: users.length,
    sent,
    skipped,
    failed,
    items: results,
  }
}

export default {
  notifyWishlistPromotions,
}
