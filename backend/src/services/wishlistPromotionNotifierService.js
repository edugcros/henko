import mongoose from 'mongoose'
import logger from '../../config/logger.js'
import Product from '../models/productModel.js'
import PromotionalBlock from '../models/promotionalBlockModel.js'
import Tenant from '../models/tenantModel.js'
import User from '../models/userModel.js'
import WishlistPromotionNotification from '../models/wishlistPromotionNotificationModel.js'
import { sendEmail } from './emailService.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

const getPrimaryStorefrontDomain = tenant => {
  const domains = Array.isArray(tenant?.domains) ? tenant.domains : []
  const activeDomains = domains.filter(domain => {
    return domain?.context === 'storefront' && domain?.status === 'active'
  })

  const primary = activeDomains.find(domain => domain.isPrimary) || activeDomains[0]
  return primary?.hostname || primary?.normalizedHostname || ''
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
    sanitizeString(process.env.SHOP_FRONTEND_URL) ||
    sanitizeString(process.env.CLIENT_URL)

  return configured.replace(/\/+$/, '')
}

const buildProductUrl = ({ tenant, product }) => {
  const storeUrl = buildStoreUrl(tenant)
  if (!storeUrl || !product?._id) return ''

  return `${storeUrl}/product/${product._id}`
}
console.log(buildProductUrl)
const getProductImage = product => {
  const images = Array.isArray(product?.images) ? product.images : []
  const main = images.find(image => image?.isMain) || images[0]
  return main?.url || main?.secure_url || ''
}

const getDiscountedPrice = ({ product, discountPercentage }) => {
  const price = Number(product?.price || 0)
  const discount = Math.min(100, Math.max(0, Number(discountPercentage || 0)))
  return Math.max(0, price - price * (discount / 100))
}

const buildPromotionEmail = ({ tenant, user, product, promotion }) => {
  const storeName = sanitizeString(tenant?.name, 'Tu tienda')
  const userName = getUserName(user)
  const productUrl = buildProductUrl({ tenant, product })
  console.log(productUrl)
  const imageUrl = getProductImage(product)
  const discount = Number(promotion.discountPercentage || 0)
  const currency = product?.currency || 'ARS'
  const originalPrice = Number(product?.price || 0)
  const finalPrice = getDiscountedPrice({ product, discountPercentage: discount })
  const productTitle = sanitizeString(product.title, 'Producto')

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
        <p style="margin: 0 0 10px;">${escapeHtml(promotion.promotionTitle)}</p>
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

const getActivePromotionItems = async ({ tenantId, now = new Date() }) => {
  const blocks = await PromotionalBlock.find({
    tenantId,
    isDeleted: false,
    isActive: true,
    visibility: 'public',
    startDate: { $lte: now },
    endDate: { $gte: now },
    products: {
      $elemMatch: {
        isActive: { $ne: false },
        discountPercentage: { $gt: 0 },
      },
    },
  })
    .setOptions({ tenantId })
    .select('_id title type priority products')
    .lean()

  return blocks.flatMap(block => {
    return (block.products || [])
      .filter(item => item?.isActive !== false && Number(item?.discountPercentage || 0) > 0)
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

export const notifyWishlistPromotions = async ({
  tenantId,
  dryRun = false,
  limit = 100,
}) => {
  const normalizedTenantId = toObjectId(tenantId)
  if (!normalizedTenantId) throw new Error('tenantId inválido')

  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100))

  const tenant = await Tenant.findById(normalizedTenantId).lean()
  if (!tenant || tenant.status !== 'active') {
    throw new Error('Tenant inválido o inactivo')
  }

  const promotionItems = await getActivePromotionItems({
    tenantId: normalizedTenantId,
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

  const productIds = [...new Set(promotionItems.map(item => String(item.productId)))]
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

  const productById = new Map(products.map(product => [String(product._id), product]))
  const validProductIds = products.map(product => product._id)

  const users = await User.find({
    tenantId: normalizedTenantId,
    isBlocked: { $ne: true },
    email: { $exists: true, $ne: '' },
    wishlist: { $in: validProductIds },
  })
    .setOptions({ tenantId: normalizedTenantId })
    .select('_id email firstname lastname firstName lastName name wishlist')
    .limit(safeLimit)
    .lean()

  const results = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const user of users) {
    const recipientEmail = normalizeEmail(user.email)
    if (!recipientEmail) continue

    const wishlistSet = new Set((user.wishlist || []).map(id => String(id)))
    const matchingItems = promotionItems.filter(item => wishlistSet.has(String(item.productId)))

    for (const promotion of matchingItems) {
      const product = productById.get(String(promotion.productId))
      if (!product) continue

      const notificationKey = {
        tenantId: normalizedTenantId,
        userId: user._id,
        productId: product._id,
        promotionId: promotion.promotionId,
      }

      const existing = await WishlistPromotionNotification.findOne(notificationKey)
      if (existing?.status === 'sent' || existing?.status === 'pending') {
        skipped += 1
        results.push({
          status: 'skipped',
          reason: 'already_notified',
          email: recipientEmail,
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

        const emailResult = await sendEmail({
          to: recipientEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          tenantConfig: tenant,
        })

        if (!emailResult.success) {
          throw new Error(emailResult.error || 'EMAIL_SEND_FAILED')
        }

        notification.status = 'sent'
        notification.sentAt = new Date()
        await notification.save()

        sent += 1
        results.push({
          status: 'sent',
          email: recipientEmail,
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
            logger.warn('[WishlistPromotionNotifier] No se pudo guardar fallo', {
              error: saveError.message,
            })
          })
        }

        logger.error('[WishlistPromotionNotifier] Error enviando promoción', {
          tenantId: String(normalizedTenantId),
          userId: String(user._id),
          productId: String(product._id),
          promotionId: String(promotion.promotionId),
          error: error.message,
        })

        results.push({
          status: 'failed',
          email: recipientEmail,
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
