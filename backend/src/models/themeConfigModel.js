// 📁 src/models/themeConfigModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / SNAPSHOTS VERSIONADOS / PREVIEWS

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

// =====================================================
// CONSTANTES Y UTILIDADES

const CSS_VAR_PREFIX = '--'
const PREVIEW_TTL_HOURS = 24

const VALIDATION = {
  color: /^#([0-9A-F]{3}|[0-9A-F]{4}|[0-9A-F]{6}|[0-9A-F]{8})$/i,
  rgba: /^rgba?\((\s*\d+\s*,){2,3}\s*[\d.]+\s*\)$/i,
  hsla: /^hsla?\((\s*\d+\s*,){2,3}\s*[\d.]+\s*\)$/i,
  cssVar: /^var\(--[a-zA-Z0-9_-]+\)$/,
}

export const THEME_CHANGE_TYPES = [
  'initial',
  'update',
  'patch',
  'reset',
  'import',
  'rollback',
  'preview_activation',
]

export const DEFAULT_THEME_CONFIG = {
  general: {
    storeName: 'Mi Tienda',
    tagline: 'Bienvenidos',
  },
  colors: {
    primary: '#1976d2',
    secondary: '#dc004e',
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
    border: '#e0e0e0',
    accent: '#ff9800',
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
  },
  typography: {
    fontFamily: 'Inter, Roboto, sans-serif',
    headingFont: 'Inter, sans-serif',
    secondaryFont: 'Open Sans, sans-serif',
    baseSize: 16,
  },
}

const isValidObjectId = value => mongoose.Types.ObjectId.isValid(String(value || ''))

const isPlainObject = value => {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof mongoose.Types.ObjectId),
  )
}

const deepMerge = (base, patch) => {
  const output = { ...(base || {}) }

  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value)
    } else {
      output[key] = value
    }
  }

  return output
}

function isValidColor(value) {
  if (!value || typeof value !== 'string') return false
  const v = value.trim()

  return (
    VALIDATION.color.test(v) ||
    VALIDATION.rgba.test(v) ||
    VALIDATION.hsla.test(v) ||
    VALIDATION.cssVar.test(v) ||
    ['transparent', 'inherit', 'currentColor'].includes(v.toLowerCase())
  )
}

const getImageUrl = image => {
  if (!image) return null
  if (typeof image === 'string') return image
  return image.url || null
}

const omitThemeSystemFields = value => {
  const clean = { ...(value || {}) }

  for (const field of [
    '_id',
    'id',
    'tenantId',
    'compiledCSS',
    'createdAt',
    'updatedAt',
    '__v',
    'version',
    'isActive',
    'isPreview',
    'isDefault',
    'parentVersion',
    'lastModifiedBy',
    'changeType',
    'changeNote',
    'previewExpiresAt',
  ]) {
    delete clean[field]
  }

  return clean
}

// =====================================================
// SUB-SCHEMAS
// =====================================================

const imageAssetSchema = new Schema(
  {
    public_id: { type: String, default: '', trim: true },
    url: {
      type: String,
      required: [true, 'La URL de la imagen es requerida'],
      trim: true,
      validate: {
        validator: value => /^https?:\/\/.+/.test(value) || /^\/uploads\/.+/.test(value),
        message: 'URL de imagen inválida',
      },
    },
  },
  { _id: false },
)

const headingSchema = new Schema(
  {
    size: { type: Number, default: 32, min: 12, max: 120 },
    weight: { type: Number, default: 700, min: 100, max: 900 },
    transform: {
      type: String,
      default: 'none',
      enum: ['none', 'uppercase', 'lowercase', 'capitalize'],
    },
    lineHeight: { type: Number, default: 1.3, min: 0.8, max: 3 },
    letterSpacing: { type: Number, default: -0.3, min: -5, max: 10 },
  },
  { _id: false },
)

const secondaryTypographySchema = new Schema(
  {
    size: { type: Number, default: 14, min: 10, max: 24 },
    weight: { type: Number, default: 400, min: 100, max: 900 },
    lineHeight: { type: Number, default: 1.6, min: 0.8, max: 3 },
    letterSpacing: { type: Number, default: 0, min: -5, max: 10 },
  },
  { _id: false },
)

const colorSchema = new Schema(
  {
    primary: {
      type: String,
      default: '#1976d2',
      validate: { validator: isValidColor, message: 'Color primario inválido' },
    },
    secondary: {
      type: String,
      default: '#dc004e',
      validate: { validator: isValidColor, message: 'Color secundario inválido' },
    },
    background: {
      type: String,
      default: '#ffffff',
      validate: { validator: isValidColor, message: 'Color de fondo inválido' },
    },
    surface: {
      type: String,
      default: '#f5f5f5',
      validate: { validator: isValidColor, message: 'Color de superficie inválido' },
    },
    headerBackground: {
      type: String,
      default: '#ffffff',
      validate: { validator: isValidColor, message: 'Color de fondo de header inválido' },
    },
    headerText: {
      type: String,
      default: '#1a1a1a',
      validate: { validator: isValidColor, message: 'Color de texto de header inválido' },
    },
    headerLink: {
      type: String,
      default: '#1976d2',
      validate: { validator: isValidColor, message: 'Color de link de header inválido' },
    },
    headerIcon: {
      type: String,
      default: '#666666',
      validate: { validator: isValidColor, message: 'Color de iconos de header inválido' },
    },
    cardBackground: {
      type: String,
      default: '#f5f5f5',
      validate: { validator: isValidColor, message: 'Color de fondo de card inválido' },
    },
    cardText: {
      type: String,
      default: '#1a1a1a',
      validate: { validator: isValidColor, message: 'Color de texto de card inválido' },
    },
    cardMutedText: {
      type: String,
      default: '#666666',
      validate: { validator: isValidColor, message: 'Color de texto secundario de card inválido' },
    },
    cardBorder: {
      type: String,
      default: '#e0e0e0',
      validate: { validator: isValidColor, message: 'Color de borde de card inválido' },
    },
    cardPrice: {
      type: String,
      default: '#1976d2',
      validate: { validator: isValidColor, message: 'Color de precio en card inválido' },
    },
    text: {
      type: String,
      default: '#1a1a1a',
      validate: { validator: isValidColor, message: 'Color de texto inválido' },
    },
    mutedText: {
      type: String,
      default: '#666666',
      validate: { validator: isValidColor, message: 'Color de texto muted inválido' },
    },
    border: {
      type: String,
      default: '#e0e0e0',
      validate: { validator: isValidColor, message: 'Color de borde inválido' },
    },
    accent: {
      type: String,
      default: '#ff9800',
      validate: { validator: isValidColor, message: 'Color de acento inválido' },
    },
    actionPrimary: {
      type: String,
      default: '#1976d2',
      validate: { validator: isValidColor, message: 'Color de acción primaria inválido' },
    },
    actionPrimaryText: {
      type: String,
      default: '#ffffff',
      validate: { validator: isValidColor, message: 'Color de texto en acción primaria inválido' },
    },
    actionSecondary: {
      type: String,
      default: '#dc004e',
      validate: { validator: isValidColor, message: 'Color de acción secundaria inválido' },
    },
    actionSecondaryText: {
      type: String,
      default: '#ffffff',
      validate: { validator: isValidColor, message: 'Color de texto en acción secundaria inválido' },
    },
    link: {
      type: String,
      default: '#1976d2',
      validate: { validator: isValidColor, message: 'Color de links inválido' },
    },
    price: {
      type: String,
      default: '#1976d2',
      validate: { validator: isValidColor, message: 'Color de precio inválido' },
    },
    salePrice: {
      type: String,
      default: '#d32f2f',
      validate: { validator: isValidColor, message: 'Color de precio promocional inválido' },
    },
    badgeBackground: {
      type: String,
      default: '#dc004e',
      validate: { validator: isValidColor, message: 'Color de fondo de badge inválido' },
    },
    badgeText: {
      type: String,
      default: '#ffffff',
      validate: { validator: isValidColor, message: 'Color de texto de badge inválido' },
    },
    error: { type: String, default: '#d32f2f', validate: { validator: isValidColor } },
    warning: { type: String, default: '#ed6c02', validate: { validator: isValidColor } },
    info: { type: String, default: '#0288d1', validate: { validator: isValidColor } },
    success: { type: String, default: '#2e7d32', validate: { validator: isValidColor } },
  },
  { _id: false },
)

const typographySchema = new Schema(
  {
    fontFamily: { type: String, default: 'Inter, Roboto, sans-serif', trim: true },
    headingFont: { type: String, default: 'Inter, sans-serif', trim: true },
    secondaryFont: { type: String, default: 'Open Sans, sans-serif', trim: true },
    baseSize: { type: Number, default: 16, min: 12, max: 24 },
    scale: { type: Number, default: 1.25, min: 1, max: 2 },
    lineHeight: { type: Number, default: 1.5, min: 1, max: 3 },
    headings: {
      h1: {
        type: headingSchema,
        default: () => ({ size: 48, weight: 700, lineHeight: 1.2, letterSpacing: -0.5 }),
      },
      h2: {
        type: headingSchema,
        default: () => ({ size: 40, weight: 700, lineHeight: 1.25, letterSpacing: -0.3 }),
      },
      h3: { type: headingSchema, default: () => ({ size: 32, weight: 600, lineHeight: 1.3 }) },
      h4: { type: headingSchema, default: () => ({ size: 26, weight: 600, lineHeight: 1.35 }) },
      h5: { type: headingSchema, default: () => ({ size: 22, weight: 500, lineHeight: 1.4 }) },
      h6: { type: headingSchema, default: () => ({ size: 18, weight: 500, lineHeight: 1.5 }) },
    },
    secondary: { type: secondaryTypographySchema, default: () => ({ size: 14, weight: 400 }) },
  },
  { _id: false },
)

const spacingSchema = new Schema(
  {
    section: { type: Number, default: 64, min: 0, max: 200 },
    container: { type: Number, default: 24, min: 0, max: 100 },
    radius: { type: Number, default: 12, min: 0, max: 50 },
    cardPadding: { type: Number, default: 16, min: 0, max: 50 },
  },
  { _id: false },
)

const layoutSchema = new Schema(
  {
    maxWidth: { type: Number, default: 1200, min: 320, max: 2560 },
    containerPadding: { type: Number, default: 24, min: 0, max: 100 },
    borderRadius: { type: Number, default: 8, min: 0, max: 50 },
    shadowIntensity: { type: Number, default: 2, min: 0, max: 5 },
  },
  { _id: false },
)

const buttonsSchema = new Schema(
  {
    radius: { type: Number, default: 8, min: 0, max: 50 },
    uppercase: { type: Boolean, default: false },
    elevation: { type: Number, default: 2, min: 0, max: 24 },
    size: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
    variant: { type: String, enum: ['text', 'outlined', 'contained'], default: 'contained' },
  },
  { _id: false },
)

const heroSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    title: { type: String, maxlength: 200, trim: true },
    subtitle: {
      type: String,
      default: '',
      maxlength: 300,
      trim: true,
    },
    alignment: { type: String, enum: ['left', 'center', 'right'], default: 'center' },
    height: { type: String, enum: ['small', 'medium', 'large', 'fullscreen'], default: 'medium' },
    overlayOpacity: { type: Number, default: 0.3, min: 0, max: 1 },
    showCta: { type: Boolean, default: true },
    ctaText: { type: String, default: 'Ver productos', maxlength: 50, trim: true },
    ctaLink: { type: String, default: '/products', trim: true },
    backgroundImage: { type: imageAssetSchema, default: null },
    textColor: {
      type: String,
      default: '#ffffff',
      validate: { validator: isValidColor, message: 'Color de texto hero inválido' },
    },
  },
  { _id: false },
)

const headerSchema = new Schema(
  {
    height: { type: Number, default: 64, min: 40, max: 200 },
    sticky: { type: Boolean, default: true },
    transparent: { type: Boolean, default: false },
    showLogo: { type: Boolean, default: true },
    showSearch: { type: Boolean, default: true },
    showCart: { type: Boolean, default: true },
    showAccount: { type: Boolean, default: true },
    showWishlist: { type: Boolean, default: true },
    showCompare: { type: Boolean, default: false },
    logoWidth: { type: Number, default: 120, min: 20, max: 400 },
    logo: { type: imageAssetSchema, default: null },
  },
  { _id: false },
)

const footerSchema = new Schema(
  {
    logo: { type: imageAssetSchema, default: null },
    description: {
      type: String,
      default: 'Tu tienda de confianza para los mejores productos.',
      maxlength: 500,
      trim: true,
    },
    email: { type: String, default: 'contacto@mitienda.com', trim: true, lowercase: true },
    phone: { type: String, default: '+1 234 567 890', trim: true },
    showNewsletter: { type: Boolean, default: true },
    newsletterText: {
      type: String,
      default: 'Suscríbete para recibir ofertas exclusivas',
      maxlength: 200,
      trim: true,
    },
    social: {
      facebook: { type: String, default: '', trim: true },
      instagram: { type: String, default: '', trim: true },
      twitter: { type: String, default: '', trim: true },
      youtube: { type: String, default: '', trim: true },
      tiktok: { type: String, default: '', trim: true },
      linkedin: { type: String, default: '', trim: true },
    },
    columns: { type: Number, default: 4, min: 1, max: 6 },
  },
  { _id: false },
)

const productsSchema = new Schema(
  {
    gridStyle: { type: String, enum: ['grid', 'masonry', 'list'], default: 'grid' },
    columns: { type: Number, default: 4, min: 1, max: 6 },
    gap: { type: Number, default: 24, min: 0, max: 100 },
    hoverEffect: { type: String, enum: ['none', 'zoom', 'lift', 'border', 'scale'], default: 'lift' },
    cardTitle: {
      size: { type: String, default: '1.1rem' },
      weight: { type: Number, default: 600, min: 100, max: 900 },
      color: { type: String, default: 'inherit' },
      lineHeight: { type: Number, default: 1.3, min: 0.8, max: 3 },
      transform: { type: String, default: 'none' },
    },
    cardPrice: {
      size: { type: String, default: '1.25rem' },
      weight: { type: Number, default: 700, min: 100, max: 900 },
      color: { type: String, default: 'price' },
    },
    cardImage: {
      aspectRatio: { type: String, default: '1:1' },
      borderRadius: { type: Number, default: 12, min: 0, max: 50 },
      objectFit: {
        type: String,
        enum: ['cover', 'contain', 'fill', 'none', 'scale-down'],
        default: 'cover',
      },
    },
    cardLayout: {
      padding: { type: Number, default: 16, min: 0, max: 50 },
      gap: { type: Number, default: 12, min: 0, max: 50 },
      alignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
      showRating: { type: Boolean, default: true },
      showQuickView: { type: Boolean, default: true },
    },
    showBadge: { type: Boolean, default: true },
    showWishlist: { type: Boolean, default: true },
    showQuickView: { type: Boolean, default: true },
    showCompare: { type: Boolean, default: false },
    showRating: { type: Boolean, default: true },
    showPrice: { type: Boolean, default: true },
    itemsPerPage: { type: Number, default: 12, min: 4, max: 100 },
    imageAspectRatio: { type: String, default: '1:1' },
  },
  { _id: false },
)

const animationsSchema = new Schema(
  {
    preset: { type: String, enum: ['subtle', 'smooth', 'bouncy', 'instant', 'dramatic'], default: 'smooth' },
    pageTransitions: { type: String, enum: ['fade', 'slide', 'scale', 'bounce'], default: 'fade' },
    elementEntrance: { type: String, default: 'fadeUp' },
    stagger: { type: Number, default: 0.1, min: 0, max: 2 },
    respectPrefersReducedMotion: { type: Boolean, default: true },
    duration: { type: Number, default: 300, min: 0, max: 5000 },
    easing: { type: String, default: 'ease-in-out' },
    hoverScale: { type: Number, default: 1.02, min: 1, max: 2 },
  },
  { _id: false },
)

const advancedSchema = new Schema(
  {
    lazyLoadImages: { type: Boolean, default: true },
    preloadFonts: { type: Boolean, default: false },
    optimizeImages: { type: Boolean, default: true },
    enableServiceWorker: { type: Boolean, default: false },
    analyticsId: { type: String, default: '', trim: true },
    customCSS: {
      type: String,
      default: '',
      maxlength: 50000,
      validate: {
        validator: value => !value || value.length <= 50000,
        message: 'CSS custom excede límite de 50KB',
      },
    },
    customJS: {
      type: String,
      default: '',
      maxlength: 50000,
      validate: {
        validator: value => {
          if (!value) return true
          const dangerous = ['eval(', 'function(', 'document.write', 'innerhtml']
          return !dangerous.some(token => value.toLowerCase().includes(token))
        },
        message: 'JavaScript custom contiene código potencialmente peligroso',
      },
    },
  },
  { _id: false },
)

const generalSchema = new Schema(
  {
    storeName: {
      type: String,
      trim: true,
      maxlength: 100,
      required: [true, 'El nombre de la tienda es requerido'],
    },
    tagline: {
      type: String,
      default: 'Los mejores productos para ti',
      trim: true,
      maxlength: 200,
    },
    favicon: { type: imageAssetSchema, default: null },
    language: { type: String, default: 'es', enum: ['es', 'en', 'pt', 'fr', 'de', 'it'] },
    currency: {
      type: String,
      default: 'ARS',
      enum: ['USD', 'EUR', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL'],
    },
  },
  { _id: false },
)

// =====================================================
// MAIN SCHEMA
// =====================================================

const themeConfigSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'tenantId es requerido'],
      immutable: true,
      index: true,
    },
    compiledCSS: { type: String, default: '' },
    general: { type: generalSchema, default: () => ({}) },
    colors: { type: colorSchema, default: () => ({}) },
    typography: { type: typographySchema, default: () => ({}) },
    spacing: { type: spacingSchema, default: () => ({}) },
    layout: { type: layoutSchema, default: () => ({}) },
    buttons: { type: buttonsSchema, default: () => ({}) },
    header: { type: headerSchema, default: () => ({}) },
    hero: { type: heroSchema, default: () => ({}) },
    footer: { type: footerSchema, default: () => ({}) },
    products: { type: productsSchema, default: () => ({}) },
    animations: { type: animationsSchema, default: () => ({}) },
    advanced: { type: advancedSchema, default: () => ({}) },
    maintenanceMode: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false, index: true },
    isDefault: { type: Boolean, default: false },
    isPreview: { type: Boolean, default: false, index: true },
    version: { type: Number, required: true, min: 1, index: true },
    parentVersion: {
      type: Schema.Types.ObjectId,
      ref: 'ThemeConfig',
      default: null,
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    changeType: {
      type: String,
      enum: THEME_CHANGE_TYPES,
      default: 'update',
    },
    changeNote: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    previewExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id?.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
    toObject: { virtuals: true },
  },
)

// =====================================================
// INDEXES
// =====================================================

themeConfigSchema.index(
  { tenantId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isActive: true,
      isPreview: false,
    },
    name: 'one_active_theme_per_tenant',
  },
)

themeConfigSchema.index(
  { tenantId: 1, version: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isPreview: false,
    },
    name: 'unique_theme_version_per_tenant',
  },
)

themeConfigSchema.index({ tenantId: 1, isPreview: 1, createdAt: -1 })
themeConfigSchema.index({ tenantId: 1, updatedAt: -1 })
themeConfigSchema.index({ previewExpiresAt: 1 }, { expireAfterSeconds: 0 })

// =====================================================
// METHODS
// =====================================================

themeConfigSchema.methods.toCSSVariables = function toCSSVariables() {
  const sanitize = (value, type = 'string') => {
    if (value === undefined || value === null) return null

    switch (type) {
    case 'color':
      return isValidColor(value) ? value.toLowerCase().trim() : null
    case 'number': {
      const num = Number.parseFloat(value)
      return Number.isFinite(num) ? num : null
    }
    case 'px': {
      const px = Number.parseFloat(value)
      return Number.isFinite(px) && px >= 0 ? `${Math.round(px)}px` : null
    }
    case 'string':
      return String(value)
        .replace(/[<>]/g, '')
        .replace(/["\\]/g, '\\$&')
        .trim()
        .slice(0, 500)
    default:
      return String(value)
    }
  }

  const varValue = (value, fallback, type = 'string') => {
    const sanitized = sanitize(value, type)
    return sanitized !== null ? sanitized : fallback
  }

  const cssVar = (category, property, subProperty = null) => {
    const parts = [CSS_VAR_PREFIX, category]
    if (property) parts.push('-', property)
    if (subProperty) parts.push('-', subProperty)
    return parts.join('')
  }

  const vars = {}
  const colors = this.colors || {}
  const actionPrimary = colors.actionPrimary || DEFAULT_THEME_CONFIG.colors.actionPrimary
  const actionPrimaryText = colors.actionPrimaryText || DEFAULT_THEME_CONFIG.colors.actionPrimaryText
  const actionSecondary = colors.actionSecondary || DEFAULT_THEME_CONFIG.colors.actionSecondary
  const actionSecondaryText = colors.actionSecondaryText || DEFAULT_THEME_CONFIG.colors.actionSecondaryText
  const link = colors.link || DEFAULT_THEME_CONFIG.colors.link
  const price = colors.price || DEFAULT_THEME_CONFIG.colors.price
  const headerBackground = colors.headerBackground || DEFAULT_THEME_CONFIG.colors.headerBackground
  const headerText = colors.headerText || DEFAULT_THEME_CONFIG.colors.headerText
  const headerLink = colors.headerLink || DEFAULT_THEME_CONFIG.colors.headerLink
  const headerIcon = colors.headerIcon || DEFAULT_THEME_CONFIG.colors.headerIcon
  const cardBackground = colors.cardBackground || DEFAULT_THEME_CONFIG.colors.cardBackground
  const cardText = colors.cardText || DEFAULT_THEME_CONFIG.colors.cardText
  const cardMutedText = colors.cardMutedText || DEFAULT_THEME_CONFIG.colors.cardMutedText
  const cardBorder = colors.cardBorder || DEFAULT_THEME_CONFIG.colors.cardBorder
  const cardPrice = colors.cardPrice || DEFAULT_THEME_CONFIG.colors.cardPrice
  const salePrice = colors.salePrice || DEFAULT_THEME_CONFIG.colors.salePrice
  const badgeBackground = colors.badgeBackground || DEFAULT_THEME_CONFIG.colors.badgeBackground
  const badgeText = colors.badgeText || DEFAULT_THEME_CONFIG.colors.badgeText

  Object.assign(vars, {
    [cssVar('color', 'primary')]: varValue(colors.primary, '#1976d2', 'color'),
    [cssVar('color', 'secondary')]: varValue(colors.secondary, '#dc004e', 'color'),
    [cssVar('color', 'background')]: varValue(colors.background, '#ffffff', 'color'),
    [cssVar('color', 'surface')]: varValue(colors.surface, '#f5f5f5', 'color'),
    [cssVar('color', 'header', 'background')]: varValue(headerBackground, DEFAULT_THEME_CONFIG.colors.headerBackground, 'color'),
    [cssVar('color', 'header', 'text')]: varValue(headerText, DEFAULT_THEME_CONFIG.colors.headerText, 'color'),
    [cssVar('color', 'header', 'link')]: varValue(headerLink, DEFAULT_THEME_CONFIG.colors.headerLink, 'color'),
    [cssVar('color', 'header', 'icon')]: varValue(headerIcon, DEFAULT_THEME_CONFIG.colors.headerIcon, 'color'),
    [cssVar('color', 'card', 'background')]: varValue(cardBackground, DEFAULT_THEME_CONFIG.colors.cardBackground, 'color'),
    [cssVar('color', 'card', 'text')]: varValue(cardText, DEFAULT_THEME_CONFIG.colors.cardText, 'color'),
    [cssVar('color', 'card', 'text-muted')]: varValue(cardMutedText, DEFAULT_THEME_CONFIG.colors.cardMutedText, 'color'),
    [cssVar('color', 'card', 'border')]: varValue(cardBorder, DEFAULT_THEME_CONFIG.colors.cardBorder, 'color'),
    [cssVar('color', 'card', 'price')]: varValue(cardPrice, DEFAULT_THEME_CONFIG.colors.cardPrice, 'color'),
    [cssVar('color', 'text')]: varValue(colors.text, '#1a1a1a', 'color'),
    [cssVar('color', 'text', 'muted')]: varValue(colors.mutedText, '#666666', 'color'),
    [cssVar('color', 'border')]: varValue(colors.border, '#e0e0e0', 'color'),
    [cssVar('color', 'accent')]: varValue(colors.accent, '#ff9800', 'color'),
    [cssVar('color', 'action', 'primary')]: varValue(actionPrimary, '#1976d2', 'color'),
    [cssVar('color', 'action', 'primary-text')]: varValue(actionPrimaryText, '#ffffff', 'color'),
    [cssVar('color', 'action', 'secondary')]: varValue(actionSecondary, '#dc004e', 'color'),
    [cssVar('color', 'action', 'secondary-text')]: varValue(actionSecondaryText, '#ffffff', 'color'),
    [cssVar('color', 'link')]: varValue(link, DEFAULT_THEME_CONFIG.colors.link, 'color'),
    [cssVar('color', 'price')]: varValue(price, DEFAULT_THEME_CONFIG.colors.price, 'color'),
    [cssVar('color', 'price', 'sale')]: varValue(salePrice, DEFAULT_THEME_CONFIG.colors.salePrice, 'color'),
    [cssVar('color', 'badge', 'background')]: varValue(badgeBackground, DEFAULT_THEME_CONFIG.colors.badgeBackground, 'color'),
    [cssVar('color', 'badge', 'text')]: varValue(badgeText, DEFAULT_THEME_CONFIG.colors.badgeText, 'color'),
    [cssVar('color', 'error')]: varValue(colors.error, '#d32f2f', 'color'),
    [cssVar('color', 'warning')]: varValue(colors.warning, '#ed6c02', 'color'),
    [cssVar('color', 'info')]: varValue(colors.info, '#0288d1', 'color'),
    [cssVar('color', 'success')]: varValue(colors.success, '#2e7d32', 'color'),
  })

  const typography = this.typography || {}
  const baseSize = varValue(typography.baseSize, 16, 'number') || 16
  const scaleRatio = varValue(typography.scale, 1.25, 'number') || 1.25

  vars[cssVar('font', 'family')] = varValue(typography.fontFamily, 'Inter, Roboto, sans-serif', 'string')
  vars[cssVar('font', 'heading')] = varValue(typography.headingFont, 'Inter, sans-serif', 'string')
  vars[cssVar('font', 'secondary')] = varValue(typography.secondaryFont, 'Open Sans, sans-serif', 'string')
  vars[cssVar('font', 'size', 'base')] = `${baseSize}px`
  vars[cssVar('font', 'size', 'scale')] = scaleRatio
  vars[cssVar('font', 'line-height')] = varValue(typography.lineHeight, 1.5, 'number')

  for (const [index, level] of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].entries()) {
    const heading = typography.headings?.[level] || {}
    const defaultSize = Math.round(baseSize * Math.pow(scaleRatio, 5 - index))

    vars[cssVar('font', level, 'size')] = varValue(heading.size, defaultSize, 'px')
    vars[cssVar('font', level, 'weight')] = varValue(heading.weight, Math.max(400, 700 - index * 100), 'number')
    vars[cssVar('font', level, 'line-height')] = varValue(heading.lineHeight, 1.3 - index * 0.02, 'number')
    vars[cssVar('font', level, 'letter-spacing')] = `${varValue(heading.letterSpacing, -0.3 + index * 0.1, 'number')}px`
    vars[cssVar('font', level, 'transform')] = varValue(heading.transform, 'none', 'string')
  }

  const secondary = typography.secondary || {}
  vars[cssVar('font', 'secondary', 'size')] = varValue(secondary.size, 14, 'px')
  vars[cssVar('font', 'secondary', 'weight')] = varValue(secondary.weight, 400, 'number')
  vars[cssVar('font', 'secondary', 'line-height')] = varValue(secondary.lineHeight, 1.6, 'number')

  const spacing = this.spacing || {}
  vars[cssVar('spacing', 'section')] = varValue(spacing.section, 64, 'px')
  vars[cssVar('spacing', 'container')] = varValue(spacing.container, 24, 'px')
  vars[cssVar('spacing', 'radius')] = varValue(spacing.radius, 12, 'px')
  vars[cssVar('spacing', 'card')] = varValue(spacing.cardPadding, 16, 'px')

  ;[0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8].forEach((multiplier, index) => {
    vars[cssVar('spacing', `s${index + 1}`)] = `${Math.round(16 * multiplier)}px`
  })

  const layout = this.layout || {}
  vars[cssVar('layout', 'max-width')] = varValue(layout.maxWidth, 1200, 'px')
  vars[cssVar('layout', 'container', 'padding')] = varValue(layout.containerPadding, 24, 'px')
  vars[cssVar('layout', 'radius')] = varValue(layout.borderRadius, 8, 'px')
  vars[cssVar('layout', 'shadow')] = varValue(layout.shadowIntensity, 2, 'number')

  const buttons = this.buttons || {}
  vars[cssVar('button', 'radius')] = varValue(buttons.radius, 8, 'px')
  vars[cssVar('button', 'uppercase')] = buttons.uppercase ? 'uppercase' : 'none'
  vars[cssVar('button', 'elevation')] = varValue(buttons.elevation, 2, 'number')
  vars[cssVar('button', 'size')] = varValue(buttons.size, 'medium', 'string')
  vars[cssVar('button', 'variant')] = varValue(buttons.variant, 'contained', 'string')

  const header = this.header || {}
  vars[cssVar('header', 'height')] = varValue(header.height, 64, 'px')
  vars[cssVar('header', 'sticky')] = header.sticky ? 'fixed' : 'relative'
  vars[cssVar('header', 'transparent')] = header.transparent ? 'transparent' : 'var(--color-surface)'
  vars[cssVar('header', 'logo', 'width')] = varValue(header.logoWidth, 120, 'px')

  const hero = this.hero || {}
  const heightMap = { small: '300px', medium: '500px', large: '700px', fullscreen: '100vh' }
  vars[cssVar('hero', 'height')] = heightMap[hero.height] || '500px'
  vars[cssVar('hero', 'overlay')] = varValue(hero.overlayOpacity, 0.3, 'number')
  vars[cssVar('hero', 'text', 'color')] = varValue(hero.textColor, '#ffffff', 'color')
  vars[cssVar('hero', 'alignment')] = varValue(hero.alignment, 'center', 'string')

  const products = this.products || {}
  vars[cssVar('product', 'grid', 'columns')] = varValue(products.columns, 4, 'number')
  vars[cssVar('product', 'grid', 'gap')] = varValue(products.gap, 24, 'px')
  vars[cssVar('product', 'hover')] = varValue(products.hoverEffect, 'lift', 'string')
  vars[cssVar('product', 'card', 'radius')] = varValue(products.cardImage?.borderRadius, 12, 'px')
  vars[cssVar('product', 'card', 'aspect')] = varValue(
    products.imageAspectRatio || products.cardImage?.aspectRatio,
    '1:1',
    'string',
  )
  vars[cssVar('product', 'quick-view')] =
    (products.showQuickView ?? products.cardLayout?.showQuickView ?? true) ? 'true' : 'false'
  vars[cssVar('product', 'title', 'size')] = varValue(products.cardTitle?.size, '1.1rem', 'string')
  vars[cssVar('product', 'title', 'weight')] = varValue(products.cardTitle?.weight, 600, 'number')
  vars[cssVar('product', 'price', 'size')] = varValue(products.cardPrice?.size, '1.25rem', 'string')
  vars[cssVar('product', 'price', 'weight')] = varValue(products.cardPrice?.weight, 700, 'number')

  const animations = this.animations || {}
  vars[cssVar('animation', 'duration')] = `${varValue(animations.duration, 300, 'number')}ms`
  vars[cssVar('animation', 'easing')] = varValue(animations.easing, 'ease-in-out', 'string')
  vars[cssVar('animation', 'stagger')] = `${varValue(animations.stagger, 0.1, 'number')}s`
  vars[cssVar('animation', 'hover', 'scale')] = varValue(animations.hoverScale, 1.02, 'number')
  vars[cssVar('animation', 'reduced-motion')] = animations.respectPrefersReducedMotion ? 'reduce' : 'no-preference'

  const shadowIntensity = varValue(layout.shadowIntensity, 2, 'number') || 2
  const alpha = Math.min(0.1 * shadowIntensity, 0.5)
  Object.assign(vars, {
    [cssVar('shadow', '0')]: 'none',
    [cssVar('shadow', '1')]: `0 1px 3px rgba(0,0,0,${alpha})`,
    [cssVar('shadow', '2')]: `0 4px 6px rgba(0,0,0,${alpha})`,
    [cssVar('shadow', '3')]: `0 10px 15px rgba(0,0,0,${alpha})`,
    [cssVar('shadow', '4')]: `0 20px 25px rgba(0,0,0,${alpha * 1.5})`,
  })

  if (this.advanced?.customCSS?.trim()) {
    vars[cssVar('has', 'custom-css')] = 'true'
  }

  return Object.fromEntries(
    Object.entries(vars).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

themeConfigSchema.methods.toCSSString = function toCSSString() {
  const vars = this.toCSSVariables()
  const cssLines = [
    ':root {',
    ...Object.entries(vars).map(([key, value]) => `  ${key}: ${value};`),
    '}',
  ]

  if (this.advanced?.customCSS?.trim()) {
    cssLines.push('', '/* Custom CSS - User Generated */', this.advanced.customCSS.trim())
  }

  return cssLines.join('\n')
}

themeConfigSchema.methods.toCSSStringMinified = function toCSSStringMinified() {
  return this.toCSSString()
    .replace(/\s+/g, ' ')
    .replace(/;\s*}/g, '}')
    .replace(/{\s+/g, '{')
    .trim()
}

themeConfigSchema.methods.getCSSVarsByPrefix = function getCSSVarsByPrefix(prefix) {
  const prefixKey = `${CSS_VAR_PREFIX}${prefix}`

  return Object.fromEntries(
    Object.entries(this.toCSSVariables()).filter(([key]) => key.startsWith(prefixKey)),
  )
}

themeConfigSchema.methods.checkAccessibility = function checkAccessibility() {
  const colors = this.colors || {}

  const getLuminance = hex => {
    if (!/^#([0-9A-F]{6})$/i.test(hex || '')) return null
    const rgb = Number.parseInt(hex.slice(1), 16)
    const r = (rgb >> 16) & 0xff
    const g = (rgb >> 8) & 0xff
    const b = rgb & 0xff
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }

  const backgroundLuminance = getLuminance(colors.background || '#ffffff')
  const textLuminance = getLuminance(colors.text || '#1a1a1a')

  if (backgroundLuminance === null || textLuminance === null) {
    return {
      contrastRatio: null,
      wcagAA: null,
      wcagAAA: null,
      suggestions: ['El contraste automático solo se calcula para colores hexadecimales de 6 dígitos.'],
    }
  }

  const contrast =
    (Math.max(backgroundLuminance, textLuminance) + 0.05) /
    (Math.min(backgroundLuminance, textLuminance) + 0.05)

  return {
    contrastRatio: Math.round(contrast * 100) / 100,
    wcagAA: contrast >= 4.5,
    wcagAAA: contrast >= 7,
    suggestions: contrast < 4.5 ? ['Aumentar contraste entre texto y fondo'] : [],
  }
}

themeConfigSchema.methods.toPublicJSON = function toPublicJSON() {
  const obj = this.toObject({ virtuals: true })

  return {
    id: obj._id?.toString(),
    updatedAt: obj.updatedAt,
    version: obj.version,
    general: {
      storeName: obj.general?.storeName,
      tagline: obj.general?.tagline || '',
      favicon: getImageUrl(obj.general?.favicon),
      language: obj.general?.language || 'es',
      currency: obj.general?.currency || 'ARS',
    },
    colors: obj.colors,
    typography: obj.typography,
    spacing: obj.spacing,
    layout: obj.layout,
    buttons: obj.buttons,
    header: {
      ...obj.header,
      logo: getImageUrl(obj.header?.logo),
    },
    hero: {
      ...obj.hero,
      backgroundImage: getImageUrl(obj.hero?.backgroundImage),
    },
    footer: {
      ...obj.footer,
      logo: getImageUrl(obj.footer?.logo),
    },
    products: obj.products,
    animations: obj.animations,
    maintenanceMode: obj.maintenanceMode,
  }
}

themeConfigSchema.methods.toSnapshotPayload = function toSnapshotPayload() {
  return omitThemeSystemFields(this.toObject())
}

// =====================================================
// HOOKS
// =====================================================

themeConfigSchema.pre('save', function themeConfigPreSave(next) {
  this.compiledCSS = this.toCSSStringMinified()
  return next()
})

// =====================================================
// STATICS
// =====================================================

themeConfigSchema.statics.findActiveByTenant = function findActiveByTenant(tenantId) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')

  return this.findOne({
    tenantId,
    isActive: true,
    isPreview: false,
  }).setOptions({ tenantId })
}

themeConfigSchema.statics.getNextVersion = async function getNextVersion(tenantId, session = null) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')

  const latest = await this.findOne({
    tenantId,
    isPreview: false,
  })
    .setOptions({ tenantId })
    .sort({ version: -1 })
    .select('version')
    .session(session)
    .lean()

  return Number(latest?.version || 0) + 1
}

themeConfigSchema.statics.getOrCreateActive = async function getOrCreateActive(
  tenantId,
  defaults = {},
  session = null,
) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')

  const active = await this.findActiveByTenant(tenantId).session(session)
  if (active) return active

  const payload = deepMerge(DEFAULT_THEME_CONFIG, defaults)

  const [created] = await this.create(
    [
      {
        tenantId,
        ...payload,
        version: 1,
        isActive: true,
        isPreview: false,
        isDefault: true,
        changeType: 'initial',
      },
    ],
    { session },
  )

  return created
}

themeConfigSchema.statics.createVersionFromActive = async function createVersionFromActive({
  tenantId,
  payload = {},
  userId = null,
  changeType = 'update',
  changeNote = '',
  session = null,
}) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')

  const active = await this.getOrCreateActive(tenantId, {}, session)
  const nextVersion = await this.getNextVersion(tenantId, session)
  const mergedPayload = deepMerge(active.toSnapshotPayload(), payload)

  active.isActive = false
  await active.save({ session, tenantId })

  const [created] = await this.create(
    [
      {
        tenantId,
        ...mergedPayload,
        version: nextVersion,
        isActive: true,
        isPreview: false,
        isDefault: false,
        parentVersion: active._id,
        lastModifiedBy: userId,
        changeType,
        changeNote,
      },
    ],
    { session },
  )

  return created
}

themeConfigSchema.statics.createPreview = async function createPreview({
  tenantId,
  payload = {},
  userId = null,
}) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')

  const active = await this.getOrCreateActive(tenantId)
  const previewVersion = await this.getNextVersion(tenantId)
  const mergedPayload = deepMerge(active.toSnapshotPayload(), payload)

  await this.deleteMany({
    tenantId,
    isPreview: true,
  }).setOptions({ tenantId })

  return this.create({
    tenantId,
    ...mergedPayload,
    version: previewVersion,
    isActive: false,
    isPreview: true,
    isDefault: false,
    parentVersion: active._id,
    lastModifiedBy: userId,
    previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_HOURS * 60 * 60 * 1000),
  })
}

themeConfigSchema.statics.activatePreview = async function activatePreview({
  tenantId,
  previewId,
  userId = null,
  session = null,
}) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')
  if (!isValidObjectId(previewId)) throw new Error('previewId inválido')

  const preview = await this.findOne({
    _id: previewId,
    tenantId,
    isPreview: true,
    isActive: false,
  })
    .setOptions({ tenantId })
    .session(session)

  if (!preview) throw new Error('Preview no encontrado')

  const active = await this.getOrCreateActive(tenantId, {}, session)
  const nextVersion = await this.getNextVersion(tenantId, session)

  active.isActive = false
  await active.save({ session, tenantId })

  const [created] = await this.create(
    [
      {
        tenantId,
        ...preview.toSnapshotPayload(),
        version: nextVersion,
        isActive: true,
        isPreview: false,
        isDefault: false,
        parentVersion: active._id,
        lastModifiedBy: userId,
        changeType: 'preview_activation',
      },
    ],
    { session },
  )

  await this.deleteOne({
    _id: preview._id,
    tenantId,
    isPreview: true,
  }).setOptions({ tenantId })

  return created
}

themeConfigSchema.statics.getHistory = function getHistory(tenantId, limit = 10) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')

  return this.find({
    tenantId,
    isPreview: false,
  })
    .setOptions({ tenantId })
    .sort({ version: -1 })
    .limit(limit)
    .select('version updatedAt lastModifiedBy isActive isDefault changeType changeNote parentVersion')
    .lean()
}

themeConfigSchema.statics.rollback = async function rollback({
  tenantId,
  targetVersion,
  userId = null,
  session = null,
}) {
  if (!isValidObjectId(tenantId)) throw new Error('tenantId inválido')

  const target = await this.findOne({
    tenantId,
    version: targetVersion,
    isPreview: false,
  })
    .setOptions({ tenantId })
    .session(session)

  if (!target) throw new Error('Versión objetivo no encontrada')

  return this.createVersionFromActive({
    tenantId,
    payload: target.toSnapshotPayload(),
    userId,
    changeType: 'rollback',
    changeNote: `Rollback a versión ${targetVersion}`,
    session,
  })
}

// =====================================================
// TENANT PLUGIN
// =====================================================

themeConfigSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

// =====================================================
// MODEL
// =====================================================

const ThemeConfig =
  mongoose.models.ThemeConfig || mongoose.model('ThemeConfig', themeConfigSchema)

export default ThemeConfig
