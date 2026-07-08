// 📁 src/controller/themeConfigCtrl.js
// VERSIÓN GO PRODUCCIÓN - MULTI-TENANT / THEME ÚNICO POR TENANT / UPSERT SEGURO / PREVIEW EFÍMERO / CLOUDINARY

import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import ThemeConfig, {
  DEFAULT_THEME_CONFIG,
} from './themeConfigModel.js'
import Tenant from '../../models/tenantModel.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
  resolveTenantFromRequest,
  toObjectId,
} from '../../utils/requestContext.js'
import {
  sendErrorResponse,
  sendSuccessResponse,
} from '../../utils/response.js'
import logger from '../../../config/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '../../')

// =====================================================
// CONSTANTES
// =====================================================

const PROTECTED_FIELDS = new Set([
  '_id',
  'id',
  'tenantId',
  'compiledCSS',
  'createdAt',
  'updatedAt',
  '__v',
  'version',
  'isActive',
  'isDefault',
  'isPreview',
  'parentVersion',
  'lastModifiedBy',
  'changeType',
  'changeNote',
  'previewExpiresAt',
])

const DESIGN_ROOT_KEYS = new Set([
  'general',
  'colors',
  'typography',
  'spacing',
  'layout',
  'buttons',
  'header',
  'hero',
  'footer',
  'products',
  'animations',
  'advanced',
  'maintenanceMode',
])

const IMAGE_FIELDS = new Set(['backgroundImage', 'logo', 'favicon'])
const ALLOWED_UPLOAD_TYPES = new Set(['background', 'backgroundImage', 'logo', 'favicon', 'hero', 'generic'])

const DEFAULT_PREVIEW_TTL_MINUTES = 30

// =====================================================
// RESPUESTAS
// =====================================================

const successResponse = sendSuccessResponse

const errorResponse = (res, message, statusCode = 400, errors = null) => {
  return sendErrorResponse(res, message, statusCode, errors ? { errors } : {})
}

const setNoStoreHeaders = res => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')
}

// =====================================================
// HELPERS BASE
// =====================================================

const isProd = process.env.NODE_ENV === 'production'

const getUserId = getUserIdFromRequest

const resolveTenantContext = req => resolveTenantFromRequest(req)

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

const normalizeImageAsset = value => {
  const image = value?.image || value?.payload?.image || value?.payload || value

  if (!image) return null
  if (typeof image === 'string') {
    const url = image.trim()
    return url ? { url, public_id: '' } : null
  }
  if (!isPlainObject(image)) return null

  const url = typeof image.url === 'string' ? image.url.trim() : ''
  if (!url) return null

  return {
    url,
    public_id: image.public_id || image.publicId || '',
  }
}

const normalizeUploadType = value => {
  const type = String(value || 'generic').trim()
  return ALLOWED_UPLOAD_TYPES.has(type) ? type : 'generic'
}

const normalizeExternalImageUrl = value => {
  const rawUrl = String(value || '').trim()

  if (!rawUrl || rawUrl.length > 2048) return null

  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:') return null
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)) {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}

const sanitizeThemePatchValue = (value, key = '') => {
  if (IMAGE_FIELDS.has(key)) return normalizeImageAsset(value)
  if (!isPlainObject(value)) return value

  return Object.entries(value).reduce((acc, [childKey, childValue]) => {
    if (['meta', 'error'].includes(childKey)) return acc
    acc[childKey] = sanitizeThemePatchValue(childValue, childKey)
    return acc
  }, {})
}

const sanitizeUpdates = updates => {
  if (!isPlainObject(updates)) return {}

  return Object.entries(updates).reduce((acc, [key, value]) => {
    if (PROTECTED_FIELDS.has(key)) return acc
    if (!DESIGN_ROOT_KEYS.has(key)) return acc

    acc[key] = sanitizeThemePatchValue(value, key)
    return acc
  }, {})
}

const getDefaultThemePayload = req => {
  return deepMerge(DEFAULT_THEME_CONFIG, {
    general: {
      storeName: req.tenant?.name || 'Mi Tienda',
      tagline: 'Los mejores productos para ti',
    },
  })
}

const getSafeSnapshotPayload = theme => {
  if (theme && typeof theme.toSnapshotPayload === 'function') {
    return theme.toSnapshotPayload()
  }

  return {
    general: theme?.general || DEFAULT_THEME_CONFIG.general,
    colors: theme?.colors || DEFAULT_THEME_CONFIG.colors,
    typography: theme?.typography || DEFAULT_THEME_CONFIG.typography,
    spacing: theme?.spacing || DEFAULT_THEME_CONFIG.spacing,
    layout: theme?.layout || DEFAULT_THEME_CONFIG.layout,
    buttons: theme?.buttons || DEFAULT_THEME_CONFIG.buttons,
    header: theme?.header || DEFAULT_THEME_CONFIG.header,
    hero: theme?.hero || DEFAULT_THEME_CONFIG.hero,
    footer: theme?.footer || DEFAULT_THEME_CONFIG.footer,
    products: theme?.products || DEFAULT_THEME_CONFIG.products,
    animations: theme?.animations || DEFAULT_THEME_CONFIG.animations,
    advanced: theme?.advanced || DEFAULT_THEME_CONFIG.advanced,
    maintenanceMode: theme?.maintenanceMode ?? DEFAULT_THEME_CONFIG.maintenanceMode,
  }
}

const buildFullPayloadFromActive = ({ active, updates }) => {
  return deepMerge(getSafeSnapshotPayload(active), updates)
}

const buildAdminResponse = theme => {
  const publicData =
    theme && typeof theme.toPublicJSON === 'function'
      ? theme.toPublicJSON()
      : theme

  return {
    ...publicData,
    isActive: theme.isActive,
    isDefault: theme.isDefault,
    isPreview: theme.isPreview,
    version: theme.version,
    parentVersion: theme.parentVersion,
    lastModifiedBy: theme.lastModifiedBy,
    maintenanceMode: theme.maintenanceMode,
    advanced: theme.advanced,
    changeType: theme.changeType,
    changeNote: theme.changeNote,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
  }
}

const isTransactionUnsupportedError = error => {
  const message = String(error?.message || '')

  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('replica set') ||
    message.includes('mongos')
  )
}

const runThemeTransaction = async work => {
  const session = await mongoose.startSession()

  try {
    let result

    await session.withTransaction(async () => {
      result = await work(session)
    })

    return result
  } catch (error) {
    if (!isProd && isTransactionUnsupportedError(error)) {
      logger.warn(
        '⚠️ Mongo sin transacciones en desarrollo; usando fallback no transaccional para ThemeConfig',
      )

      return work(null)
    }

    throw error
  } finally {
    await session.endSession()
  }
}

// =====================================================
// HELPERS THEME
// =====================================================

const ensureActiveTheme = async ({ tenantId, req, session = null }) => {
  const tenantObjectId = toObjectId(tenantId)

  if (!tenantObjectId) {
    const error = new Error('Tenant inválido')
    error.statusCode = 400
    throw error
  }

  const defaults = getDefaultThemePayload(req)

  const query = ThemeConfig.findOneAndUpdate(
    { tenantId: tenantObjectId },
    {
      $setOnInsert: {
        version: 1,
        createdAt: new Date(),
        ...defaults,
      },
      $set: {
        isActive: true,
        isPreview: false,
        updatedAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  ).setOptions({ tenantId: String(tenantId) })

  return query
}

const getThemeByPublicTenantId = async tenantId => {
  const tenantObjectId = toObjectId(tenantId)

  if (!tenantObjectId) return null

  return ThemeConfig.findOne({
    tenantId: tenantObjectId,
  }).setOptions({ tenantId: String(tenantId) })
}


const recoverActiveThemeAfterDuplicateKey = async ({ req, error }) => {
  const tenantId = req.tenantId || req.tenant?._id || req.user?.tenantId
  const tenantObjectId = toObjectId(tenantId)

  logger.warn('⚠️ Conflicto de índice único en ThemeConfig; recuperando theme por tenantId', {
    tenantId,
    keyPattern: error?.keyPattern,
    keyValue: error?.keyValue,
  })

  if (!tenantObjectId) return null

  const theme = await ThemeConfig.findOneAndUpdate(
    { tenantId: tenantObjectId },
    {
      $set: {
        isActive: true,
        isPreview: false,
        updatedAt: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    },
  ).setOptions({ tenantId: String(tenantId) })

  return theme
}

const updateActiveThemeInPlace = async ({
  tenantId,
  req,
  updates,
  userId = null,
  changeType = 'patch',
  changeNote = '',
  session = null,
}) => {
  const tenantObjectId = toObjectId(tenantId)

  if (!tenantObjectId) {
    const error = new Error('Tenant inválido')
    error.statusCode = 400
    throw error
  }

  const active = await ensureActiveTheme({ tenantId, req, session })

  const payload = buildFullPayloadFromActive({
    active,
    updates,
  })

  const previousVersion = Number(active.version || 1)
  const nextVersion = previousVersion + 1

  const update = {
    ...payload,
    isActive: true,
    isDefault: false,
    isPreview: false,
    version: nextVersion,

    // Con índice único tenantId, no hay historial documental real.
    // Evita CastError porque parentVersion en el model es ObjectId.
    parentVersion: null,

    lastModifiedBy: userId || null,
    changeType,
    changeNote,
    previewExpiresAt: null,
    updatedAt: new Date(),
  }

  return ThemeConfig.findOneAndUpdate(
    { tenantId: tenantObjectId },
    {
      $set: update,
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  ).setOptions({ tenantId: String(tenantId) })
}

// =====================================================
// CLOUDINARY
// =====================================================

const configureCloudinaryIfNeeded = () => {
  if (cloudinary.config()?.cloud_name) return

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  })
}

const uploadBufferToCloudinary = async ({
  buffer,
  mimetype,
  tenantId,
  type = 'generic',
}) => {
  configureCloudinaryIfNeeded()

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error('Cloudinary no está configurado')
  }

  const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`

  return cloudinary.uploader.upload(dataUri, {
    folder: `themes/${tenantId}/${type}`,
    resource_type: 'image',
    overwrite: false,
  })
}

const getPublicBaseUrl = req => {
  return (
    process.env.PUBLIC_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/+$/, '')
}

const uploadThemeImageLocally = async ({ file, tenantId, type, req }) => {
  const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg'
  const safeName = `${Date.now()}-${crypto.randomUUID()}${extension}`
  const relativePath = path.posix.join('theme-assets', String(tenantId), type, safeName)
  const folderAbs = path.join(rootDir, 'uploads', 'theme-assets', String(tenantId), type)
  const fileAbs = path.join(folderAbs, safeName)

  await fs.mkdir(folderAbs, { recursive: true })
  await fs.writeFile(fileAbs, file.buffer)

  return {
    public_id: relativePath,
    url: `${getPublicBaseUrl(req)}/uploads/${relativePath}`.replace(/([^:]\/)\/+/g, '$1'),
    width: null,
    height: null,
    format: extension.replace('.', ''),
    bytes: file.size,
    type,
    storage: 'local',
  }
}

// =====================================================
// CONTROLLERS PÚBLICOS
// =====================================================

/**
 * GET /api/theme
 * GET /api/theme/public
 */
export const getPublicTheme = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const theme = await ensureActiveTheme({ tenantId, req })

    setNoStoreHeaders(res)
    return successResponse(res, theme.toPublicJSON())
  } catch (error) {
    return next(error)
  }
}

/**
 * GET /api/theme/public/:tenantId
 */
export const getPublicThemeById = async (req, res, next) => {
  try {
    const { tenantId: paramTenantId } = req.params

    if (!isValidObjectId(paramTenantId)) {
      return errorResponse(res, 'tenantId inválido', 400)
    }

    const tenantExists = await Tenant.exists({
      _id: paramTenantId,
      status: 'active',
    })

    if (!tenantExists) {
      return errorResponse(res, 'Tenant no encontrado', 404)
    }

    let theme = await getThemeByPublicTenantId(paramTenantId)

    if (!theme) {
      theme = await ensureActiveTheme({
        tenantId: String(paramTenantId),
        req,
      })
    }

    setNoStoreHeaders(res)
    return successResponse(res, theme.toPublicJSON())
  } catch (error) {
    if (error?.code === 11000) {
      const theme = await recoverActiveThemeAfterDuplicateKey({ req, error })

      if (theme) {
        return successResponse(res, theme.toPublicJSON())
      }
    }

    return next(error)
  }
}

/**
 * GET /api/theme/theme.css
 */
export const getThemeCSS = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    let theme = await ThemeConfig.findActiveByTenant(tenantId)

    if (!theme) {
      theme = await ensureActiveTheme({ tenantId, req })
    }

    res.setHeader('Content-Type', 'text/css; charset=utf-8')
    setNoStoreHeaders(res)

    return res.status(200).send(
      theme.compiledCSS ||
        (typeof theme.toCSSStringMinified === 'function'
          ? theme.toCSSStringMinified()
          : typeof theme.toCSSString === 'function'
            ? theme.toCSSString()
            : ''),
    )
  } catch (error) {
    return next(error)
  }
}

// =====================================================
// CONTROLLERS ADMIN
// =====================================================

export const getThemeForAdmin = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const theme = await ensureActiveTheme({ tenantId, req })

    return successResponse(res, buildAdminResponse(theme))
  } catch (error) {
    if (error?.code === 11000) {
      const theme = await recoverActiveThemeAfterDuplicateKey({ req, error })

      if (theme) {
        return successResponse(res, buildAdminResponse(theme))
      }
    }

    logger.error(`❌ Error obteniendo theme admin: ${error.stack || error.message}`)
    return next(error)
  }
}

export const updateTheme = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const updates = sanitizeUpdates(req.body)

    if (!Object.keys(updates).length) {
      return errorResponse(res, 'No hay datos válidos para actualizar', 400)
    }

    const theme = await runThemeTransaction(session => {
      return updateActiveThemeInPlace({
        tenantId,
        req,
        updates,
        userId: getUserId(req),
        changeType: 'update',
        session,
      })
    })

    return successResponse(res, buildAdminResponse(theme))
  } catch (error) {
    if (error?.code === 11000) {
      const theme = await recoverActiveThemeAfterDuplicateKey({ req, error })

      if (theme) {
        return successResponse(res, buildAdminResponse(theme))
      }
    }

    return next(error)
  }
}

export const patchTheme = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const updates = sanitizeUpdates(req.body)

    if (!Object.keys(updates).length) {
      return errorResponse(res, 'No hay datos válidos para actualizar', 400)
    }

    const theme = await runThemeTransaction(session => {
      return updateActiveThemeInPlace({
        tenantId,
        req,
        updates,
        userId: getUserId(req),
        changeType: 'patch',
        session,
      })
    })

    return successResponse(res, buildAdminResponse(theme))
  } catch (error) {
    if (error?.code === 11000) {
      const theme = await recoverActiveThemeAfterDuplicateKey({ req, error })

      if (theme) {
        return successResponse(res, buildAdminResponse(theme))
      }
    }

    return next(error)
  }
}

/**
 * Preview efímero:
 * Con índice único { tenantId: 1 }, no se puede persistir un documento preview
 * en la misma colección. Se devuelve el payload calculado para que el frontend
 * pueda previsualizar sin insertar y sin romper tenantId_1.
 */
const buildEphemeralPreview = ({ active, updates, userId }) => {
  const payload = buildFullPayloadFromActive({
    active,
    updates,
  })

  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + DEFAULT_PREVIEW_TTL_MINUTES * 60 * 1000,
  )

  return {
    ...payload,
    _id: `preview-${active.tenantId}-${Date.now()}`,
    tenantId: String(active.tenantId),

    isActive: false,
    isDefault: false,
    isPreview: true,

    version: Number(active.version || 1) + 1,

    // Tu schema espera ObjectId, pero el preview es efímero.
    // No hay documento padre real porque no estamos versionando documentos.
    parentVersion: null,

    lastModifiedBy: userId || null,
    changeType: 'preview',
    changeNote: 'Preview efímero no persistido por índice único tenantId',
    previewExpiresAt: expiresAt,

    createdAt: now,
    updatedAt: now,
  }
}

export const createPreview = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const updates = sanitizeUpdates(req.body)

    const active = await ensureActiveTheme({ tenantId, req })

    const preview = buildEphemeralPreview({
      active,
      updates,
      userId: getUserId(req),
    })

    return successResponse(
      res,
      {
        previewId: preview._id,
        expiresAt: preview.previewExpiresAt,
        version: preview.version,
        data: preview,
      },
      201,
    )
  } catch (error) {
    return next(error)
  }
}

/**
 * Activación de preview:
 * No aplica con preview efímero. Para activarlo, el frontend debe enviar el payload
 * a PATCH /api/theme/admin.
 */
export const activatePreview = async (req, res) => {
  return errorResponse(
    res,
    'Preview persistente no disponible con índice único por tenant. Aplicá el preview usando PATCH /api/theme/admin.',
    409,
  )
}

export const resetTheme = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)

    const theme = await runThemeTransaction(session => {
      return updateActiveThemeInPlace({
        tenantId,
        req,
        updates: getDefaultThemePayload(req),
        userId: getUserId(req),
        changeType: 'reset',
        changeNote: 'Reset a valores por defecto',
        session,
      })
    })

    return successResponse(res, buildAdminResponse(theme))
  } catch (error) {
    if (error?.code === 11000) {
      const theme = await recoverActiveThemeAfterDuplicateKey({ req, error })

      if (theme) {
        return successResponse(res, buildAdminResponse(theme))
      }
    }

    return next(error)
  }
}

export const toggleMaintenance = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const { enabled } = req.body

    if (typeof enabled !== 'boolean') {
      return errorResponse(res, 'Campo "enabled" booleano requerido', 400)
    }

    const theme = await runThemeTransaction(session => {
      return updateActiveThemeInPlace({
        tenantId,
        req,
        updates: { maintenanceMode: enabled },
        userId: getUserId(req),
        changeType: 'patch',
        changeNote: enabled
          ? 'Mantenimiento activado'
          : 'Mantenimiento desactivado',
        session,
      })
    })

    return successResponse(res, {
      maintenanceMode: theme.maintenanceMode,
      version: theme.version,
    })
  } catch (error) {
    if (error?.code === 11000) {
      const theme = await recoverActiveThemeAfterDuplicateKey({ req, error })

      if (theme) {
        return successResponse(res, {
          maintenanceMode: theme.maintenanceMode,
          version: theme.version,
        })
      }
    }

    return next(error)
  }
}

export const exportTheme = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    let theme = await ThemeConfig.findActiveByTenant(tenantId)

    if (!theme) {
      theme = await ensureActiveTheme({ tenantId, req })
    }

    const exportData = getSafeSnapshotPayload(theme)

    exportData.exportedAt = new Date()
    exportData.exportedBy = getUserId(req)
    exportData.version = theme.version

    const safeStoreName = String(theme.general?.storeName || 'export')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 60)

    const filename = `theme_${safeStoreName}_v${theme.version}_${Date.now()}.json`

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

    return res.status(200).json(exportData)
  } catch (error) {
    return next(error)
  }
}

export const importTheme = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const importData = sanitizeUpdates(req.body)

    if (!Object.keys(importData).length) {
      return errorResponse(res, 'Datos de importación inválidos', 400)
    }

    if (!importData.colors || !importData.typography) {
      return errorResponse(
        res,
        'JSON inválido: se requieren "colors" y "typography"',
        400,
      )
    }

    const theme = await runThemeTransaction(session => {
      return updateActiveThemeInPlace({
        tenantId,
        req,
        updates: importData,
        userId: getUserId(req),
        changeType: 'import',
        changeNote: 'Importación de tema',
        session,
      })
    })

    return successResponse(res, buildAdminResponse(theme))
  } catch (error) {
    if (error?.code === 11000) {
      const theme = await recoverActiveThemeAfterDuplicateKey({ req, error })

      if (theme) {
        return successResponse(res, buildAdminResponse(theme))
      }
    }

    return next(error)
  }
}

/**
 * Historial lógico:
 * Con índice único tenantId_1 no hay documentos históricos reales.
 * Se devuelve el theme actual como snapshot único.
 */
export const getThemeHistory = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const theme = await ensureActiveTheme({ tenantId, req })

    return successResponse(res, [
      {
        _id: theme._id,
        tenantId: theme.tenantId,
        version: theme.version,
        changeType: theme.changeType || 'current',
        changeNote: theme.changeNote || 'Versión actual',
        lastModifiedBy: theme.lastModifiedBy || null,
        isActive: theme.isActive,
        isPreview: theme.isPreview,
        createdAt: theme.createdAt,
        updatedAt: theme.updatedAt,
      },
    ])
  } catch (error) {
    return next(error)
  }
}

/**
 * Rollback:
 * No hay historial persistente con índice único tenantId.
 * Si se solicita la versión actual, se responde OK. Otra versión devuelve 409.
 */
export const rollbackTheme = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const targetVersion = Number(req.body?.version)

    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      return errorResponse(res, 'Versión numérica válida requerida', 400)
    }

    const theme = await ensureActiveTheme({ tenantId, req })

    if (Number(theme.version) !== targetVersion) {
      return errorResponse(
        res,
        'Rollback histórico no disponible con índice único por tenant',
        409,
      )
    }

    return successResponse(res, buildAdminResponse(theme))
  } catch (error) {
    return next(error)
  }
}

export const uploadImage = async (req, res, next) => {
  try {
    const { tenantId } = resolveTenantContext(req)

    if (!req.file && !req.body?.url) {
      return errorResponse(res, 'Archivo o URL requerida', 400)
    }

    if (req.body?.url && !req.file) {
      const safeUrl = normalizeExternalImageUrl(req.body.url)

      if (!safeUrl) {
        return errorResponse(res, 'URL de imagen inválida o no permitida', 400)
      }

      return successResponse(res, {
        public_id: '',
        url: safeUrl,
        type: normalizeUploadType(req.body.type),
      })
    }

    const type = normalizeUploadType(req.body.type)
    let upload

    try {
      upload = await uploadBufferToCloudinary({
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        tenantId,
        type,
      })

      return successResponse(res, {
        public_id: upload.public_id,
        url: upload.secure_url,
        width: upload.width,
        height: upload.height,
        format: upload.format,
        bytes: upload.bytes,
        type,
        storage: 'cloudinary',
      })
    } catch (cloudinaryError) {
      logger.warn('[ThemeConfig] Cloudinary no disponible. Usando storage local para imagen de theme.', {
        tenantId,
        type,
        error: cloudinaryError.message,
      })

      upload = await uploadThemeImageLocally({
        file: req.file,
        tenantId,
        type,
        req,
      })

      return successResponse(res, upload)
    }
  } catch (error) {
    return next(error)
  }
}

export const validateTheme = async (req, res, next) => {
  try {
    const { tenantObjectId } = resolveTenantContext(req)
    const config = sanitizeUpdates(req.body)
    const defaults = getDefaultThemePayload(req)

    const tempTheme = new ThemeConfig({
      tenantId: tenantObjectId,
      version: 1,
      ...defaults,
      ...config,
      general: deepMerge(defaults.general, config.general || {}),
    })

    const validationError = tempTheme.validateSync()

    if (validationError) {
      const errors = Object.values(validationError.errors).map(error => ({
        field: error.path,
        message: error.message,
      }))

      return errorResponse(res, 'Validación fallida', 400, errors)
    }

    return successResponse(res, {
      valid: true,
      accessibility:
        typeof tempTheme.checkAccessibility === 'function'
          ? tempTheme.checkAccessibility()
          : null,
      generatedCSS:
        typeof tempTheme.toCSSString === 'function'
          ? `${tempTheme.toCSSString().slice(0, 1000)}...`
          : '',
    })
  } catch (error) {
    return next(error)
  }
}
