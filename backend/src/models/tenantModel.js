// 📁 src/models/tenantModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT

import mongoose from 'mongoose'

import {
  buildDomainKeys,
  normalizeDomainValue,
  normalizeHostname,
  normalizeSlug,
} from '../utils/domainUtils.js'
import {
  encryptSecret,
  decryptSecret,
} from '../services/aiAgent/aiCryptoService.js'

const { Schema } = mongoose

// =====================================================
// Domain Schema
// =====================================================

const domainSchema = new Schema(
  {
    hostname: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    normalizedHostname: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['platform_subdomain', 'custom_domain'],
      default: 'platform_subdomain',
      index: true,
    },

    context: {
      type: String,
      enum: ['storefront', 'admin'],
      default: 'storefront',
      index: true,
    },

    status: {
      type: String,
      enum: ['pending', 'active', 'failed', 'disabled'],
      default: 'active',
      index: true,
    },

    isPrimary: {
      type: Boolean,
      default: false,
      index: true,
    },

    verificationToken: {
      type: String,
      default: null,
      select: false,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    sslStatus: {
      type: String,
      enum: ['pending', 'active', 'failed', 'not_required'],
      default: 'not_required',
    },

    lastCheckedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
)

domainSchema.pre('validate', function normalizeDomain(next) {
  if (this.hostname) {
    this.hostname = normalizeDomainValue(this.hostname)
    this.normalizedHostname = normalizeHostname(this.hostname)
  }

  next()
})

// =====================================================
// Tenant Schema
// =====================================================

const tenantSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    domains: {
      type: [domainSchema],
      default: [],
    },

    adminDomains: {
      type: [domainSchema],
      default: [],
    },

    /**
     * Campo denormalizado para garantizar unicidad global cruzada
     * entre domains y adminDomains.
     */
    domainKeys: {
      type: [String],
      default: [],
      select: false,
    },

    /**
     * Compatibilidad temporal con registros legacy.
     */
    legacyDomains: {
      type: [String],
      default: [],
      select: false,
    },

    legacyAdminDomains: {
      type: [String],
      default: [],
      select: false,
    },

    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    status: {
      type: String,
      enum: ['active', 'suspended', 'deleted'],
      default: 'active',
      index: true,
    },

    plan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: 'free',
      index: true,
    },

    subscriptionStatus: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'cancelled', 'expired'],
      default: 'trialing',
      index: true,
    },

    trialEndsAt: {
      type: Date,
      default: null,
    },

    currency: {
      type: String,
      default: 'ARS',
      uppercase: true,
      trim: true,
    },

    locale: {
      type: String,
      default: 'es-AR',
      trim: true,
    },

    timezone: {
      type: String,
      default: 'America/Argentina/Buenos_Aires',
      trim: true,
    },

    country: {
      type: String,
      default: 'AR',
      uppercase: true,
      trim: true,
    },

    onboarding: {
      completed: {
        type: Boolean,
        default: false,
      },

      step: {
        type: String,
        enum: [
          'account',
          'store',
          'theme',
          'products',
          'payments',
          'domain',
          'completed',
        ],
        default: 'account',
      },

      completedAt: {
        type: Date,
        default: null,
      },
    },

    integrations: {
      ga4: {
        measurementId: {
          type: String,
          default: null,
          trim: true,
        },

        propertyId: {
          type: String,
          default: null,
          trim: true,
        },

        apiSecret: {
          type: String,
          default: null,
          select: false,
          set: value => (value ? encryptSecret(value) : value),
          get: value => (value ? decryptSecret(value) : value),
        },

        serviceAccountKey: {
          type: String,
          default: null,
          select: false,
          set: value => (value ? encryptSecret(value) : value),
          get: value => (value ? decryptSecret(value) : value),
        },

        isEnabled: {
          type: Boolean,
          default: false,
        },

        connectedAt: {
          type: Date,
          default: null,
        },

        updatedAt: {
          type: Date,
          default: null,
        },
      },

      meta: {
        pixelId: {
          type: String,
          default: null,
          trim: true,
        },

        accessToken: {
          type: String,
          default: null,
          select: false,
          set: value => (value ? encryptSecret(value) : value),
          get: value => (value ? decryptSecret(value) : value),
        },

        isEnabled: {
          type: Boolean,
          default: false,
        },

        connectedAt: {
          type: Date,
          default: null,
        },

        updatedAt: {
          type: Date,
          default: null,
        },
      },

      mercadopago: {
        mode: {
          type: String,
          enum: ['test', 'production'],
          default: 'test',
        },

        publicKey: {
          type: String,
          trim: true,
        },

        accessToken: {
          type: String,
          select: false,
          set: value => (value ? encryptSecret(value) : value),
          get: value => (value ? decryptSecret(value) : value),
        },

        isEnabled: {
          type: Boolean,
          default: false,
        },

        connectedAt: {
          type: Date,
          default: null,
        },

        updatedAt: {
          type: Date,
          default: null,
        },
      },
    },

    settings: {
      branding: {
        logoUrl: {
          type: String,
          default: null,
        },

        faviconUrl: {
          type: String,
          default: null,
        },
      },

      store: {
        description: {
          type: String,
          default: '',
          maxlength: 300,
        },

        contactEmail: {
          type: String,
          default: null,
          lowercase: true,
          trim: true,
        },

        contactPhone: {
          type: String,
          default: null,
          trim: true,
        },

        address: {
          type: String,
          default: '',
        },
      },

      checkout: {
        allowGuestCheckout: {
          type: Boolean,
          default: true,
        },

        defaultCurrency: {
          type: String,
          default: 'ARS',
          uppercase: true,
        },
      },

      features: {
        promotionalBlocks: {
          type: Boolean,
          default: true,
        },

        aiProductEnrichment: {
          type: Boolean,
          default: true,
        },

        customDomain: {
          type: Boolean,
          default: true,
        },
      },
    },

    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
)

// =====================================================
// Indexes
// =====================================================

tenantSchema.index({ status: 1, plan: 1 })
tenantSchema.index({ ownerUserId: 1 })
tenantSchema.index({ 'domains.hostname': 1 })
tenantSchema.index({ 'domains.normalizedHostname': 1 })
tenantSchema.index({ 'domains.status': 1 })
tenantSchema.index({ 'adminDomains.hostname': 1 })
tenantSchema.index({ 'adminDomains.normalizedHostname': 1 })
tenantSchema.index({ 'adminDomains.status': 1 })

/**
 * Índice único real y cruzado para impedir que el mismo hostname
 * exista como storefront en un tenant y admin domain en otro.
 */
tenantSchema.index(
  { domainKeys: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      domainKeys: { $type: 'string' },
    },
  },
)

// =====================================================
// Hooks
// =====================================================

tenantSchema.pre('validate', function normalizeTenant(next) {
  if (this.slug) {
    this.slug = normalizeSlug(this.slug)
  }

  if (this.currency) {
    this.currency = String(this.currency).toUpperCase()
  }

  if (this.country) {
    this.country = String(this.country).toUpperCase()
  }

  if (Array.isArray(this.domains)) {
    this.domains = this.domains.map(domain => {
      if (typeof domain === 'string') {
        return {
          hostname: normalizeDomainValue(domain),
          normalizedHostname: normalizeHostname(domain),
          type: domain.includes(this.slug) ? 'platform_subdomain' : 'custom_domain',
          context: 'storefront',
          status: 'active',
          isPrimary: false,
        }
      }

      return domain
    })
  }

  if (Array.isArray(this.adminDomains)) {
    this.adminDomains = this.adminDomains.map(domain => {
      if (typeof domain === 'string') {
        return {
          hostname: normalizeDomainValue(domain),
          normalizedHostname: normalizeHostname(domain),
          type: domain.includes(this.slug) ? 'platform_subdomain' : 'custom_domain',
          context: 'admin',
          status: 'active',
          isPrimary: false,
        }
      }

      return domain
    })
  }

  const activePrimaryStorefrontDomains = this.domains.filter(domain => {
    return domain.status === 'active' && domain.isPrimary
  })

  const activePrimaryAdminDomains = this.adminDomains.filter(domain => {
    return domain.status === 'active' && domain.isPrimary
  })

  if (activePrimaryStorefrontDomains.length > 1) {
    return next(new Error('Solo puede existir un dominio storefront primario activo.'))
  }

  if (activePrimaryAdminDomains.length > 1) {
    return next(new Error('Solo puede existir un dominio admin primario activo.'))
  }

  this.domainKeys = buildDomainKeys({
    domains: this.domains,
    adminDomains: this.adminDomains,
  })

  const uniqueDomainKeys = [...new Set(this.domainKeys)]

  if (uniqueDomainKeys.length !== this.domainKeys.length) {
    return next(new Error('No puede repetirse el mismo dominio dentro del tenant.'))
  }

  next()
})

// =====================================================
// Methods
// =====================================================

tenantSchema.methods.getPrimaryDomain = function getPrimaryDomain() {
  const primary = this.domains.find(domain => {
    return domain.status === 'active' && domain.isPrimary
  })

  if (primary) return primary.hostname

  const firstActive = this.domains.find(domain => domain.status === 'active')
  return firstActive?.hostname || null
}

tenantSchema.methods.getPrimaryAdminDomain = function getPrimaryAdminDomain() {
  const primary = this.adminDomains.find(domain => {
    return domain.status === 'active' && domain.isPrimary
  })

  if (primary) return primary.hostname

  const firstActive = this.adminDomains.find(domain => domain.status === 'active')
  return firstActive?.hostname || null
}

tenantSchema.methods.hasDomain = function hasDomain(hostname) {
  const normalized = normalizeHostname(hostname)

  return this.domains.some(domain => {
    return (
      domain.normalizedHostname === normalized ||
      domain.hostname === normalized
    )
  })
}

tenantSchema.methods.hasActiveDomain = function hasActiveDomain(hostname) {
  const normalized = normalizeHostname(hostname)

  return this.domains.some(domain => {
    return (
      domain.status === 'active' &&
      (
        domain.normalizedHostname === normalized ||
        domain.hostname === normalized
      )
    )
  })
}

tenantSchema.methods.hasAdminDomain = function hasAdminDomain(hostname) {
  const normalized = normalizeHostname(hostname)

  return this.adminDomains.some(domain => {
    return (
      domain.normalizedHostname === normalized ||
      domain.hostname === normalized
    )
  })
}

tenantSchema.methods.hasActiveAdminDomain = function hasActiveAdminDomain(hostname) {
  const normalized = normalizeHostname(hostname)

  return this.adminDomains.some(domain => {
    return (
      domain.status === 'active' &&
      (
        domain.normalizedHostname === normalized ||
        domain.hostname === normalized
      )
    )
  })
}

// =====================================================
// Statics
// =====================================================

tenantSchema.statics.findByDomain = function findByDomain(hostname) {
  const raw = normalizeDomainValue(hostname)
  const normalized = normalizeHostname(hostname)

  return this.findOne({
    status: 'active',
    $or: [
      {
        domains: {
          $elemMatch: {
            status: 'active',
            $or: [
              { hostname: raw },
              { normalizedHostname: normalized },
            ],
          },
        },
      },
      {
        adminDomains: {
          $elemMatch: {
            status: 'active',
            $or: [
              { hostname: raw },
              { normalizedHostname: normalized },
            ],
          },
        },
      },
      { legacyDomains: raw },
      { legacyDomains: normalized },
      { legacyAdminDomains: raw },
      { legacyAdminDomains: normalized },
    ],
  })
}

tenantSchema.statics.findStorefrontByDomain = function findStorefrontByDomain(hostname) {
  const raw = normalizeDomainValue(hostname)
  const normalized = normalizeHostname(hostname)

  return this.findOne({
    status: 'active',
    $or: [
      {
        domains: {
          $elemMatch: {
            status: 'active',
            $or: [
              { hostname: raw },
              { normalizedHostname: normalized },
            ],
          },
        },
      },
      { legacyDomains: raw },
      { legacyDomains: normalized },
    ],
  })
}

tenantSchema.statics.findAdminByDomain = function findAdminByDomain(hostname) {
  const raw = normalizeDomainValue(hostname)
  const normalized = normalizeHostname(hostname)

  return this.findOne({
    status: 'active',
    $or: [
      {
        adminDomains: {
          $elemMatch: {
            status: 'active',
            $or: [
              { hostname: raw },
              { normalizedHostname: normalized },
            ],
          },
        },
      },
      { legacyAdminDomains: raw },
      { legacyAdminDomains: normalized },
    ],
  })
}

const Tenant = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema)

export default Tenant

export {
  normalizeDomainValue,
  normalizeHostname,
  normalizeSlug,
}