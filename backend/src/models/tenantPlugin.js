// 📁 src/models/tenantPlugin.js
// VERSIÓN PRODUCCIÓN - AISLAMIENTO TENANT-SCOPED PARA MONGOOSE

import mongoose from 'mongoose'

import { getTenantContext } from '../utils/tenantRequestContext.js'

const { Types } = mongoose
const debug = process.env.NODE_ENV === 'development'

// =====================================================
// Helpers
// =====================================================

const ensureObjectId = value => {
  if (!value) return null

  if (value instanceof Types.ObjectId) {
    return value
  }

  if (!Types.ObjectId.isValid(String(value))) {
    return null
  }

  return new Types.ObjectId(String(value))
}

const isValidTenantId = value => Boolean(ensureObjectId(value))

const createTenantError = ({ code, message, model }) => {
  const error = new Error(message)
  error.code = code
  if (model) error.model = model
  return error
}

const getQueryOptions = context => {
  return context?.getOptions?.() || context?.options || {}
}

const shouldIgnoreTenant = context => {
  const options = getQueryOptions(context)

  return Boolean(
    options.ignoreTenant ||
    options.skipTenant ||
    context?._mongooseOptions?.ignoreTenant,
  )
}

const getTenantIdFromQueryContext = context => {
  const options = getQueryOptions(context)
  const requestContext = getTenantContext()

  return (
    options.tenantId ||
    context?._tenantId ||
    requestContext?.tenantId ||
    null
  )
}

const getTenantIdFromDocumentContext = doc => {
  const requestContext = getTenantContext()

  return (
    doc?.$__?.saveOptions?.tenantId ||
    doc?._tenantId ||
    requestContext?.tenantId ||
    doc?.tenantId ||
    null
  )
}

const hasTenantMutation = update => {
  if (!update) return false

  return Boolean(
    update.tenantId !== undefined ||
    update.$set?.tenantId !== undefined ||
    update.$setOnInsert?.tenantId !== undefined ||
    update.$unset?.tenantId !== undefined ||
    update.$rename?.tenantId !== undefined,
  )
}

const assertNoTenantMutationInNestedOperators = update => {
  if (!update) return

  const operators = [
    '$push',
    '$addToSet',
    '$pull',
    '$pullAll',
    '$pop',
  ]

  for (const operator of operators) {
    if (!update[operator]) continue

    const serialized = JSON.stringify(update[operator])

    if (serialized.includes('tenantId')) {
      throw createTenantError({
        code: 'TENANT_MUTATION_FORBIDDEN',
        message: '[Tenant] Cannot modify tenantId in nested update operators',
      })
    }
  }
}

const addTenantFilter = ({ query, tenantId, modelName }) => {
  const currentFilter = query.getFilter() || {}
  const normalizedTenantId = ensureObjectId(tenantId)

  if (!normalizedTenantId) {
    throw createTenantError({
      code: 'TENANT_INVALID',
      model: modelName,
      message: `[Tenant] Missing or invalid tenantId for model "${modelName}"`,
    })
  }

  if (currentFilter.tenantId) {
    const existingTenantId = ensureObjectId(currentFilter.tenantId)

    if (!existingTenantId || !existingTenantId.equals(normalizedTenantId)) {
      throw createTenantError({
        code: 'TENANT_MISMATCH',
        model: modelName,
        message:
          `[Tenant] Tenant mismatch for model "${modelName}": ` +
          `filter=${currentFilter.tenantId} context=${normalizedTenantId}`,
      })
    }

    return
  }

  query.setQuery({
    ...currentFilter,
    tenantId: normalizedTenantId,
  })
}

// =====================================================
// Plugin
// =====================================================

/**
 * Plugin de aislamiento tenant-scoped.
 *
 * IMPORTANTE:
 * Aplicar explícitamente solo en schemas raíz tenant-scoped:
 *
 *   schema.plugin(tenantPlugin)
 *
 * No registrar globalmente con mongoose.plugin().
 */

export const tenantPlugin = schema => {
  // 1. Añadimos el campo tenantId solo si no existe
  if (!schema.path('tenantId')) {
    schema.add({
      tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        index: true,
      },
    })
  }

  // 2. Definimos la lógica de filtrado
  function filterByTenant(next) {
    const tenantId = this.getOptions().tenantId
    
    if (tenantId) {
      // Validamos que sea un ObjectId válido para evitar errores de cast
      if (mongoose.Types.ObjectId.isValid(tenantId)) {
        this.where({ tenantId: new mongoose.Types.ObjectId(tenantId) })
      } else {
        return next(new Error('Tenant ID inválido para la consulta'))
      }
    }
    next()
  }

  // 3. Aplicamos el filtro a TODOS los métodos de lectura y actualización
  const methods = ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateMany', 'updateOne']
  
  methods.forEach(method => {
    schema.pre(method, filterByTenant)
  })
}

// =====================================================
// Query helper explícito
// =====================================================

export const withTenant = (query, tenantId) => {
  const normalizedTenantId = ensureObjectId(tenantId)

  if (!normalizedTenantId) {
    throw new Error('Invalid tenantId format')
  }

  return query.setOptions({ tenantId: normalizedTenantId })
}