// 📁 src/models/userModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT

import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import sanitizeHtml from 'sanitize-html'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

// =====================================================
// HELPERS
// =====================================================

/**
 * Convierte duraciones tipo "30m", "1h", "2d" a milisegundos.
 * @param {string} value
 * @param {number} fallbackMs
 * @returns {number}
 */
const parseExpireToMs = (value = '1h', fallbackMs = 60 * 60 * 1000) => {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(String(value || '').trim().toLowerCase())

  if (!match) return fallbackMs

  const [, amount, unit] = match
  const num = Number(amount)

  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }

  return num * multipliers[unit]
}

const normalizeEmail = value => String(value || '').trim().toLowerCase()

const sanitizePlainText = value => {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {},
  }).trim()
}

// =====================================================
// SCHEMA
// =====================================================

const userSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'El tenantId es obligatorio'],
      index: true,
    },

    firstname: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      minlength: [2, 'El nombre debe tener al menos 2 caracteres'],
      maxlength: [80, 'El nombre no puede superar los 80 caracteres'],
    },

    lastname: {
      type: String,
      required: [true, 'El apellido es obligatorio'],
      trim: true,
      minlength: [2, 'El apellido debe tener al menos 2 caracteres'],
      maxlength: [80, 'El apellido no puede superar los 80 caracteres'],
    },

    email: {
      type: String,
      required: [true, 'El email es obligatorio'],
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')),
        message: props => `${props.value} no es un email válido`,
      },
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    emailVerificationToken: {
      type: String,
      select: false,
    },

    emailVerificationExpires: {
      type: Date,
      select: false,
    },

    mobile: {
      type: String,
      required: [true, 'El móvil es obligatorio'],
      trim: true,
      validate: {
        validator: value => /^\+?[1-9]\d{1,14}$/.test(String(value || '')),
        message: props => `${props.value} no es un número de móvil válido.`,
      },
    },

    password: {
      type: String,
      required: [true, 'La contraseña es obligatoria'],
      minlength: [8, 'La contraseña debe tener al menos 8 caracteres'],
      select: false,
    },

    role: {
      type: String,
      enum: {
        values: ['user', 'admin', 'moderator'],
        message: 'Rol no válido. Roles permitidos: user, admin, moderator',
      },
      default: 'user',
      required: true,
      index: true,
    },

    mpAccessToken: {
      type: String,
      select: false,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    isBlocked: {
      type: Boolean,
      default: false,
      index: true,
      validate: {
        validator: value => typeof value === 'boolean',
        message: 'El valor de isBlocked debe ser booleano',
      },
    },

    blockedUntil: {
      type: Date,
      default: null,
    },

    address: {
      type: String,
      trim: true,
      maxlength: [200, 'La dirección no puede superar los 200 caracteres'],
    },

    wishlist: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],

    /**
     * LEGADO. El casillero único, de antes de refreshSessions.
     *
     * Se conserva para no desloguear a todo el mundo el día del deploy: un
     * refresh que llega con este token se acepta UNA vez y se migra a una
     * sesión del array. Cuando no queden usuarios con este campo poblado, se
     * puede borrar.
     *
     * La ventana de gracia ya no vive acá: es parte de cada sesión, porque
     * cada una rota por su cuenta.
     */
    refreshToken: {
      type: String,
      select: false,
    },

    /**
     * Las sesiones abiertas, una por origen o dispositivo.
     *
     * POR QUÉ UN ARRAY Y NO UN CAMPO
     *
     * Había UN solo `refreshToken` por usuario, y las cookies son host-only
     * —getCookieDomain() devuelve undefined, y `.vercel.app` está en la Public
     * Suffix List, así que no puede existir una cookie de dominio padre—.
     * Resultado: el panel en henko-admin y la tienda en henko-web tienen cada
     * uno SU cookie, y el servidor un solo casillero. El que refresca último
     * pisa al otro, y la cookie del perdedor queda muerta para siempre.
     *
     * Medido en producción sobre un día: 26 respuestas 403 de refresh, TODAS
     * desde henko-web; todas las de henko-admin devolvieron 200. No era una
     * carrera entre requests: era la tienda intentando con una cookie que el
     * panel ya había invalidado.
     *
     * Y no es un caso raro: el propio panel embebe la tienda para la vista
     * previa del tema (theme-preview?source=admin), así que estar logueado en
     * los dos a la vez es un flujo central del producto.
     *
     * Cada sesión rota por su cuenta. Cerrar una no toca a las demás.
     */
    refreshSessions: {
      type: [
        {
          _id: false,
          // Hash del jti vigente de ESTA sesión.
          tokenHash: { type: String, required: true },

          // El inmediatamente anterior y cuándo se rotó: la ventana de gracia
          // para dos requests de la MISMA sesión que salen juntas.
          previousTokenHash: { type: String, default: null },
          rotatedAt: { type: Date, default: null },

          createdAt: { type: Date, default: Date.now },
          lastUsedAt: { type: Date, default: Date.now },

          // Para que el usuario pueda reconocer sus sesiones si alguna vez se
          // listan en el panel. No se usa para decidir nada.
          userAgent: { type: String, default: null },
        },
      ],
      default: [],
      select: false,
    },

    passwordChangedAt: {
      type: Date,
    },

    passwordResetToken: {
      type: String,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    minimize: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// =====================================================
// INDEXES
// =====================================================

/**
 * Regla SaaS multi-tenant:
 * - mismo email puede existir en tiendas distintas
 * - mismo email NO puede repetirse dentro de la misma tienda
 */
userSchema.index({ email: 1, tenantId: 1 }, { unique: true })
userSchema.index({ mobile: 1, tenantId: 1 }, { unique: true, sparse: true })
userSchema.index({ tenantId: 1, role: 1 })
userSchema.index({ tenantId: 1, isBlocked: 1 })
userSchema.index({ tenantId: 1, createdAt: -1 })
userSchema.index({ tenantId: 1 })

// =====================================================
// METHODS - TOKENS
// =====================================================

userSchema.methods.createEmailVerificationToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex')

  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex')

  this.emailVerificationExpires = Date.now() + parseExpireToMs(
    process.env.EMAIL_VERIFY_EXPIRES || '24h',
    24 * 60 * 60 * 1000,
  )

  return rawToken
}

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex')

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex')

  this.passwordResetExpires = Date.now() + parseExpireToMs(
    process.env.PASSWORD_RESET_EXPIRES || '1h',
    60 * 60 * 1000,
  )

  return resetToken
}

userSchema.methods.isResetTokenValid = function () {
  return Boolean(
    this.passwordResetToken &&
    this.passwordResetExpires &&
    this.passwordResetExpires > Date.now(),
  )
}

userSchema.methods.clearResetToken = async function () {
  this.passwordResetToken = undefined
  this.passwordResetExpires = undefined
  await this.save({ validateBeforeSave: false })
}

// =====================================================
// METHODS - SECURITY / SERIALIZATION
// =====================================================

userSchema.methods.toSafeObject = function () {
  const safeUser = this.toObject({ virtuals: true })

  delete safeUser.password
  delete safeUser.refreshToken
  delete safeUser.mpAccessToken
  delete safeUser.passwordChangedAt
  delete safeUser.passwordResetToken
  delete safeUser.passwordResetExpires
  delete safeUser.emailVerificationToken
  delete safeUser.emailVerificationExpires
  delete safeUser.__v

  return safeUser
}

userSchema.methods.isPasswordMatched = async function (enteredPassword) {
  if (!this.password) return false
  return bcrypt.compare(enteredPassword, this.password)
}

userSchema.methods.changedPasswordAfter = function (JWTTimestamp = 0) {
  if (!this.passwordChangedAt) return false

  const changedTimestamp = Math.floor(this.passwordChangedAt.getTime() / 1000)
  return JWTTimestamp < changedTimestamp
}

userSchema.methods.hasChangedEmail = function (oldEmail) {
  return this.email !== oldEmail
}

userSchema.methods.toggleBlock = async function () {
  this.isBlocked = !this.isBlocked

  if (!this.isBlocked) {
    this.blockedUntil = null
    this.failedLoginAttempts = 0
  }

  await this.save({ validateBeforeSave: false })
  return this.isBlocked
}

// =====================================================
// HOOKS
// =====================================================

userSchema.pre('validate', function (next) {
  if (this.isModified('email') && this.email) {
    this.email = normalizeEmail(this.email)
  }

  if (this.isModified('firstname') && this.firstname) {
    this.firstname = sanitizePlainText(this.firstname)
  }

  if (this.isModified('lastname') && this.lastname) {
    this.lastname = sanitizePlainText(this.lastname)
  }

  if (this.isModified('mobile') && this.mobile) {
    this.mobile = String(this.mobile).trim()
  }

  if (this.isModified('address') && this.address) {
    this.address = sanitizePlainText(this.address)
  }

  next()
})

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()

  this.passwordChangedAt = Date.now() - 1000

  if (!/^\$2[aby]\$/.test(this.password)) {
    const salt = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)
  }

  next()
})

/**
 * Normaliza errores de duplicidad originados por .save().
 * Los índices de MongoDB siguen siendo la fuente real de verdad.
 */
userSchema.post('save', function (error, doc, next) {
  if (error?.name === 'MongoServerError' && error.code === 11000) {
    const keyValue = error.keyValue || {}
    const duplicateKeys = Object.keys(keyValue)

    if (duplicateKeys.includes('email')) {
      return next(new Error('Email ya registrado en este comercio.'))
    }

    if (duplicateKeys.includes('mobile')) {
      return next(new Error('Móvil ya registrado en este comercio.'))
    }

    return next(new Error('Conflicto de duplicidad detectado.'))
  }

  return next(error)
})

// =====================================================
// MODEL
// =====================================================

userSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const User = mongoose.models.User || mongoose.model('User', userSchema)

export default User
