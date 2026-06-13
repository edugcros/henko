// 📁 src/models/tenantPlugin.js
// VERSIÓN PRODUCCIÓN - AISLAMIENTO TENANT-SCOPED PARA MONGOOSE

import mongoose from 'mongoose'

import { getTenantContext } from '../utils/tenantRequestContext.js'

const { Types } = mongoose

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
    process.env.NODE_ENV === 'test' ||
    options.ignoreTenant ||
    options.skipTenant ||
    context?._mongooseOptions?.ignoreTenant,
  )
}

const getTenantIdFromQueryContext = context => {
  const options = getQueryOptions(context)
  const filter = context.getFilter?.() || {}
  const requestContext = getTenantContext()

  return (
    options.tenantId ||
    context?._tenantId ||
    requestContext?.tenantId ||
    filter.tenantId ||
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

const hasForbiddenTenantMutation = update => {
  if (!update) return false

  return Boolean(
    update.tenantId !== undefined ||
    update.$set?.tenantId !== undefined ||
    update.$unset?.tenantId !== undefined ||
    update.$rename?.tenantId !== undefined,
  )
}

const assertValidTenantUpsert = ({ update, tenantId, modelName }) => {
  const upsertTenantId = update?.$setOnInsert?.tenantId

  if (upsertTenantId === undefined) return

  const normalizedContextTenantId = ensureObjectId(tenantId)
  const normalizedUpsertTenantId = ensureObjectId(upsertTenantId)

  if (
    !normalizedContextTenantId ||
    !normalizedUpsertTenantId ||
    !normalizedUpsertTenantId.equals(normalizedContextTenantId)
  ) {
    throw createTenantError({
      code: 'TENANT_MUTATION_FORBIDDEN',
      model: modelName,
      message: `[Tenant] Cannot modify tenantId for model "${modelName}"`,
    })
  }
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

const getTenantIdFromPipeline = pipeline => {
  const tenantMatch = pipeline.find(stage => stage?.$match?.tenantId !== undefined)
  return tenantMatch?.$match?.tenantId || null
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

export const tenantPlugin = (schema, options = {}) => {
  // 1. Añadimos el campo tenantId solo si no existe
  if (options.addTenantField !== false && !schema.path('tenantId')) {
    schema.add({
      tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        index: true,
      },
    })
  }

  function applyTenantFilter(next) {
    if (shouldIgnoreTenant(this)) return next()

    try {
      addTenantFilter({
        query: this,
        tenantId: getTenantIdFromQueryContext(this),
        modelName: this.model?.modelName,
      })

      return next()
    } catch (error) {
      return next(error)
    }
  }

  function applyTenantUpdateGuard(next) {
    if (shouldIgnoreTenant(this)) return next()

    try {
      const update = this.getUpdate?.() || {}
      const tenantId = getTenantIdFromQueryContext(this)

      if (hasForbiddenTenantMutation(update)) {
        throw createTenantError({
          code: 'TENANT_MUTATION_FORBIDDEN',
          model: this.model?.modelName,
          message: `[Tenant] Cannot modify tenantId for model "${this.model?.modelName}"`,
        })
      }

      assertValidTenantUpsert({
        update,
        tenantId,
        modelName: this.model?.modelName,
      })
      assertNoTenantMutationInNestedOperators(update)
      addTenantFilter({
        query: this,
        tenantId,
        modelName: this.model?.modelName,
      })

      return next()
    } catch (error) {
      return next(error)
    }
  }

  schema.pre(['find', 'findOne', 'countDocuments'], applyTenantFilter)
  schema.pre(['findOneAndUpdate', 'updateMany', 'updateOne', 'deleteMany', 'deleteOne'], applyTenantUpdateGuard)

  schema.pre('save', function validateTenantOnSave(next) {
    try {
      const tenantId = getTenantIdFromDocumentContext(this)
      const normalizedTenantId = ensureObjectId(tenantId)

      if (!normalizedTenantId) {
        throw createTenantError({
          code: 'TENANT_INVALID',
          model: this.constructor?.modelName,
          message: `[Tenant] Missing or invalid tenantId for model "${this.constructor?.modelName}"`,
        })
      }

      this.tenantId = normalizedTenantId
      return next()
    } catch (error) {
      return next(error)
    }
  })

  schema.pre('aggregate', function applyTenantAggregation(next) {
    const options = this.options || {}
    if (options.ignoreTenant || options.skipTenant) return next()

    const requestContext = getTenantContext()
    const pipeline = this.pipeline()
    const pipelineTenantId = getTenantIdFromPipeline(pipeline)
    const normalizedTenantId = ensureObjectId(
      options.tenantId ||
        requestContext?.tenantId ||
        pipelineTenantId,
    )

    if (!normalizedTenantId) {
      return next(createTenantError({
        code: 'TENANT_INVALID',
        message: '[Tenant] Missing or invalid tenantId for aggregate operation',
      }))
    }

    if (!pipelineTenantId) {
      pipeline.unshift({ $match: { tenantId: normalizedTenantId } })
    }

    return next()
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
