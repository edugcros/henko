export const DEFAULT_THEME_COLORS = {
  primary: '#2563eb',
  secondary: '#64748b',
  accent: '#0f172a',
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#111827',
  textSecondary: '#64748b',
  border: '#e5e7eb',
  error: '#dc2626',
  warning: '#f59e0b',
  info: '#0288d1',
  success: '#16a34a',
}

export const getActiveThemeConfig = themeState => {
  if (themeState?.previewMode && themeState?.previewConfig) {
    return themeState.previewConfig
  }

  return themeState?.config || {}
}

export const getThemeColors = config => ({
  ...DEFAULT_THEME_COLORS,
  ...(config?.colors || {}),
  textSecondary:
    config?.colors?.textSecondary ||
    config?.colors?.mutedText ||
    config?.colors?.textMuted ||
    DEFAULT_THEME_COLORS.textSecondary,
})

export const getProductThemeConfig = config => ({
  gridStyle: 'grid',
  columns: 4,
  gap: 24,
  hoverEffect: 'lift',
  imageAspectRatio: '1:1',
  itemsPerPage: 12,
  showBadge: true,
  showQuickView: true,
  showWishlist: true,
  showCompare: false,
  showRating: true,
  showPrice: true,
  ...(config?.productCard || {}),
  ...(config?.products || {}),
  imageAspectRatio:
    config?.products?.imageAspectRatio ||
    config?.products?.cardImage?.aspectRatio ||
    config?.productCard?.imageAspectRatio ||
    '1:1',
  showQuickView:
    config?.products?.showQuickView ??
    config?.products?.cardLayout?.showQuickView ??
    config?.productCard?.showQuickView ??
    true,
  showRating:
    config?.products?.showRating ??
    config?.products?.cardLayout?.showRating ??
    config?.productCard?.showRating ??
    true,
  cardPadding:
    config?.products?.cardLayout?.padding ??
    config?.spacing?.cardPadding ??
    config?.productCard?.cardPadding ??
    0,
})

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
  containerPadding: 0,
  borderRadius: config?.spacing?.radius ?? 8,
  shadowIntensity: 2,
  ...(config?.layout || {}),
})

export const getSpacingThemeConfig = config => ({
  section: 0,
  container: 0,
  radius: 8,
  cardPadding: 0,
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
