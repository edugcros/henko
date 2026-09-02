export const DEFAULT_THEME_COLORS = {
  primary: '#1976d2',
  secondary: '#dc004e',
  accent: '#ff9800',
  background: '#ffffff',
  surface: '#f5f5f5',
  headerBackground: '#ffffff',
  headerText: '#1a1a1a',
  headerLink: '#1976d2',
  headerIcon: '#666666',
  cardBackground: '#f5f5f5',
  cardText: '#1a1a1a',
  cardMutedText: '#666666',
  cardBorder: '#e0e0e0',
  cardPrice: '#1976d2',
  text: '#1a1a1a',
  mutedText: '#666666',
  textSecondary: '#666666',
  border: '#e0e0e0',
  actionPrimary: '#1976d2',
  actionPrimaryText: '#ffffff',
  actionSecondary: '#dc004e',
  actionSecondaryText: '#ffffff',
  link: '#1976d2',
  price: '#1976d2',
  salePrice: '#d32f2f',
  badgeBackground: '#dc004e',
  badgeText: '#ffffff',
  error: '#d32f2f',
  warning: '#ed6c02',
  info: '#0288d1',
  success: '#2e7d32',
}

export const getActiveThemeConfig = themeState => {
  if (themeState?.previewMode && themeState?.previewConfig) {
    return themeState.previewConfig
  }

  return themeState?.config || {}
}

export const getThemeColors = config => {
  const colors = {
    ...DEFAULT_THEME_COLORS,
    ...(config?.colors || {}),
  }

  const textSecondary =
    colors.mutedText ||
    colors.textSecondary ||
    colors.textMuted ||
    DEFAULT_THEME_COLORS.textSecondary

  return {
    ...colors,
    textSecondary,
    mutedText: colors.mutedText || textSecondary,
    headerBackground: colors.headerBackground,
    headerText: colors.headerText,
    headerLink: colors.headerLink,
    headerIcon: colors.headerIcon,
    cardBackground: colors.cardBackground,
    cardText: colors.cardText,
    cardMutedText: colors.cardMutedText,
    cardBorder: colors.cardBorder,
    cardPrice: colors.cardPrice,
    actionPrimary: colors.actionPrimary,
    actionPrimaryText: colors.actionPrimaryText,
    actionSecondary: colors.actionSecondary,
    actionSecondaryText: colors.actionSecondaryText,
    link: colors.link,
    price: colors.price,
    salePrice: colors.salePrice,
    badgeBackground: colors.badgeBackground,
    badgeText: colors.badgeText,
  }
}

export const getProductThemeConfig = config => {
  const productCard = config?.productCard || {}
  const products = config?.products || {}
  const cardLayout = products?.cardLayout || {}
  const cardImage = products?.cardImage || {}

  return {
    gridStyle: 'grid',
    columns: 4,
    gap: 24,
    hoverEffect: 'lift',
    itemsPerPage: 12,
    showBadge: true,
    showWishlist: true,
    showCompare: false,
    showPrice: true,

    ...productCard,
    ...products,

    imageAspectRatio:
      products.imageAspectRatio || cardImage.aspectRatio || productCard.imageAspectRatio || '1:1',

    showQuickView:
      products.showQuickView ?? cardLayout.showQuickView ?? productCard.showQuickView ?? true,

    showRating: products.showRating ?? cardLayout.showRating ?? productCard.showRating ?? true,

    cardPadding: cardLayout.padding ?? config?.spacing?.cardPadding ?? productCard.cardPadding ?? 0,
  }
}

export const getButtonThemeConfig = config => ({
  radius: 8,
  elevation: 2,
  uppercase: false,
  size: 'medium',
  variant: 'contained',
  ...(config?.buttons || {}),
})

export const getLayoutThemeConfig = config => ({
  maxWidth: 1200,
  containerPadding: 24,
  borderRadius: config?.spacing?.radius ?? 8,
  shadowIntensity: 2,
  ...(config?.layout || {}),
})

export const getSpacingThemeConfig = config => ({
  section: 64,
  container: 24,
  radius: 8,
  cardPadding: 18,
  ...(config?.spacing || {}),
})

export const getCommerceSettings = config => {
  const general = config?.general || {}
  const commerce = config?.commerce || config?.ecommerce || {}

  return {
    currency: general.currency || commerce.currency || 'ARS',
    locale: general.locale || commerce.locale || 'es-AR',
  }
}

export const formatCurrency = (value, config) => {
  const { currency, locale } = getCommerceSettings(config)

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

export const getAssetUrl = asset => {
  if (!asset) return null
  if (typeof asset === 'string') return asset

  return asset.url || asset.secure_url || asset.src || null
}

export const getProductImage = product => {
  const candidates = [
    product?.displayImage,
    product?.filterMatchedVariant?.image,
    product?.images?.[0],
    product?.image,
    product?.imageUrl,
    product?.thumbnail,
    product?.featuredImage,
  ]

  for (const candidate of candidates) {
    const url = getAssetUrl(candidate)
    if (url) return url
  }

  return '/assets/images/placeholder.png'
}

export const getProductRouteId = product => {
  const rawId = product?._id || product?.id || product?.productId || product?.slug

  if (!rawId) return ''
  if (typeof rawId === 'object') return rawId._id || rawId.id || ''

  return rawId
}
