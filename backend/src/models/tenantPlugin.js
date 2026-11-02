// 📁 src/models/tenantPlugin.js
// VERSIÓN PRODUCCIÓN - AISLAMIENTO TENANT-SCOPED PARA MONGOOSE

import mongoose from 'mongoose'

import { getTenantContext } from '../utils/tenantRequestContext.js'
import logger from '../../config/logger.js'

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

/**
 * El aislamiento solo se saltea cuando alguien lo pide EXPLÍCITAMENTE en la
 * consulta.
 *
 * Acá vivía además `process.env.NODE_ENV === 'test'`, que apagaba el plugin
 * entero durante los tests. El efecto no era un bug: era peor. Volvía
 * indetectable una clase completa de fallo — ninguna prueba de este proyecto
 * podía descubrir una fuga entre comercios, que es la propiedad sobre la que
 * descansa todo el modelo multi-tenant. Y encima un test que INTENTARA
 * verificar el aislamiento fallaba contra código correcto, lo que invita a
 * "arreglar" algo que nunca estuvo roto.
 *
 * Se sacó después de medirlo: los 332 tests pasan igual sin ese atajo. No lo
 * necesitaba ninguno; solo quitaba seguridad.
 *
 * La salida explícita —`ignoreTenant` / `skipTenant` en las opciones de la
 * consulta— sigue estando, y es la que corresponde: un reporte de plataforma
 * que cruza comercios lo declara en el lugar donde lo hace, y se lee.
 */
const shouldIgnoreTenant = context => {
  const options = getQueryOptions(context)

  return Boolean(
    options.ignoreTenant || options.skipTenant || context?._mongooseOptions?.ignoreTenant,
  )
}

/**
 * Deja rastro cuando alguien escapa el aislamiento desde adentro de una request
 * que YA tiene tenant.
 *
 * POR QUÉ ESA CONDICIÓN Y NO OTRA
 *
 * `ignoreTenant` no se puede prohibir: hay operaciones que cruzan comercios por
 * definición —el gasto de IA de la plataforma, el worker de recuperación de
 * carritos, buscar un usuario por email antes de saber a qué comercio
 * pertenece— y sin la salida habría que reimplementarlas peor.
 *
 * Pero esos casos comparten algo: NO hay tenant en el contexto. Un worker, un
 * script y una request pre-login corren sin contexto. Cuando sí lo hay, el
 * comercio de esa request ya está determinado, y saltear el filtro significa ir
 * a buscar datos fuera de él. Ese es el único caso que hay que mirar.
 *
 * ESA REGLA TENÍA UNA EXCEPCIÓN QUE NO VI, y la encontró producción.
 *
 * El login NO corre sin contexto: resolveTenantByDomain resuelve el comercio a
 * partir del dominio ANTES de saber quién es el usuario. Así que buscar un
 * usuario por email —que es cross-tenant por definición, porque todavía no se
 * sabe a qué comercio pertenece— ocurre con un tenant ya en contexto, y la
 * guarda lo marcaba como sospechoso en cada inicio de sesión.
 *
 * Un aviso de nivel error en cada login es exactamente lo que esta guarda no
 * tenía que ser: ruido que enseña a ignorar el log. Los diez puntos del camino
 * de autenticación declaran su motivo con platformScope y ya no gritan.
 *
 * QUÉ HACE Y QUÉ NO
 *
 * Registra, no bloquea. Bloquear en runtime convertiría un uso legítimo que no
 * anticipé en una caída de producción; el objetivo acá es que un escape nuevo y
 * descuidado sea imposible de no ver, no atajarlo a ciegas.
 *
 * `platformScope` es la forma de declarar que el cruce es a propósito: se
 * escribe el motivo en el mismo lugar donde se saltea, que es exactamente lo
 * que se quiere poder leer en una revisión.
 */
const auditTenantBypass = (context, { modelName, operation }) => {
  const requestContext = getTenantContext()
  const contextTenantId = requestContext?.tenantId

  if (!contextTenantId) return

  const options = getQueryOptions(context)
  const scope = String(options.platformScope || '').trim()

  if (scope) return

  logger.error('[Tenant] Aislamiento salteado dentro de una request con tenant', {
    model: modelName,
    operation,
    tenantEnContexto: String(contextTenantId),
    comoDeclararlo: 'setOptions({ ignoreTenant: true, platformScope: "<motivo>" })',
  })
}

const getTenantIdFromQueryContext = context => {
  const options = getQueryOptions(context)
  const filter = context.getFilter?.() || {}
  const requestContext = getTenantContext()

  return (
    options.tenantId || context?._tenantId || requestContext?.tenantId || filter.tenantId || null
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

// Los operadores que escriben un campo de primer nivel. $setOnInsert no está:
// se admite con el mismo comercio (assertValidTenantUpsert). Los de arrays van
// aparte (assertNoTenantMutationInNestedOperators).
const FIELD_WRITE_OPERATORS = [
  '$set',
  '$unset',
  '$rename',
  '$inc',
  '$mul',
  '$min',
  '$max',
  '$currentDate',
]

// Las etapas de un update con pipeline que pueden escribir tenantId.
const PIPELINE_WRITE_STAGES = [
  '$set',
  '$addFields',
  '$unset',
  '$project',
  '$replaceRoot',
  '$replaceWith',
]

const pipelineStageWritesTenant = stage =>
  PIPELINE_WRITE_STAGES.some(operator => {
    const value = stage?.[operator]
    if (value === undefined) return false
    // $replaceRoot/$replaceWith cambian el documento entero, y con él su
    // comercio. $unset admite un nombre o una lista.
    if (operator === '$replaceRoot' || operator === '$replaceWith') return true
    if (typeof value === 'string') return value === 'tenantId'
    if (Array.isArray(value)) return value.includes('tenantId')
    return value?.tenantId !== undefined
  })

const hasForbiddenTenantMutation = update => {
  if (!update) return false

  // Un update con pipeline (un array de etapas) no pasa por los operadores de
  // abajo: sin esto, `[{ $set: { tenantId } }]` movía el documento.
  if (Array.isArray(update)) return update.some(pipelineStageWritesTenant)

  return Boolean(
    update.tenantId !== undefined ||
    FIELD_WRITE_OPERATORS.some(operator => update[operator]?.tenantId !== undefined),
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

  const operators = ['$push', '$addToSet', '$pull', '$pullAll', '$pop']

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

/**
 * findOneAndReplace / replaceOne: el reemplazo es el documento entero, así que
 * su tenantId no es una "mutación" a rechazar sino el campo que tiene que
 * quedar. Sin él el documento quedaría huérfano; con otro, en otro comercio.
 */
const assertTenantReplacement = ({ query, tenantId, modelName }) => {
  const replacement = query.getUpdate?.()
  if (!replacement || typeof replacement !== 'object') return

  const normalizedTenantId = ensureObjectId(tenantId)
  const replacementTenantId = replacement.tenantId

  if (replacementTenantId === undefined) {
    if (normalizedTenantId) query.setUpdate({ ...replacement, tenantId: normalizedTenantId })
    return
  }

  const normalizedReplacement = ensureObjectId(replacementTenantId)

  if (
    !normalizedTenantId ||
    !normalizedReplacement ||
    !normalizedReplacement.equals(normalizedTenantId)
  ) {
    throw createTenantError({
      code: 'TENANT_MUTATION_FORBIDDEN',
      model: modelName,
      message: `[Tenant] Cannot modify tenantId for model "${modelName}"`,
    })
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

// Un $match de comercio solo acota si es la PRIMERA etapa. Más adelante
// —después de un $group, un $lookup o un $unionWith— llega tarde: las etapas
// anteriores ya corrieron sobre todos los comercios.
const isTenantScopedFromStart = pipeline => pipeline[0]?.$match?.tenantId !== undefined

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
    if (shouldIgnoreTenant(this)) {
      auditTenantBypass(this, {
        modelName: this.model?.modelName,
        operation: this.op || 'find',
      })
      return next()
    }

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
    if (shouldIgnoreTenant(this)) {
      auditTenantBypass(this, {
        modelName: this.model?.modelName,
        operation: this.op || 'update',
      })
      return next()
    }

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

  function applyTenantReplaceGuard(next) {
    if (shouldIgnoreTenant(this)) {
      auditTenantBypass(this, {
        modelName: this.model?.modelName,
        operation: this.op || 'replace',
      })
      return next()
    }

    try {
      const tenantId = getTenantIdFromQueryContext(this)

      assertTenantReplacement({ query: this, tenantId, modelName: this.model?.modelName })
      addTenantFilter({ query: this, tenantId, modelName: this.model?.modelName })

      return next()
    } catch (error) {
      return next(error)
    }
  }

  // Cada operación de consulta de Mongoose tiene su propio hook: la que no está
  // en estas listas corre SIN filtro de comercio. findByIdAndDelete (que es
  // findOneAndDelete), distinct y los reemplazos no estaban; hoy todos sus
  // usos pasan el tenantId a mano, y eso es lo que no puede depender de que
  // nadie se olvide.
  schema.pre(['find', 'findOne', 'countDocuments', 'count', 'distinct'], applyTenantFilter)
  schema.pre(
    [
      'findOneAndUpdate',
      'updateMany',
      'updateOne',
      'deleteMany',
      'deleteOne',
      'findOneAndDelete',
      'findOneAndRemove',
    ],
    applyTenantUpdateGuard,
  )
  schema.pre(['findOneAndReplace', 'replaceOne'], applyTenantReplaceGuard)

  // insertMany no dispara el hook de save: sin esto, cada fila entraba con el
  // tenantId que trajera, aunque fuera de otro comercio que el de la request.
  schema.pre('insertMany', function validateTenantOnInsertMany(next, docs, options = {}) {
    try {
      if (options.ignoreTenant || options.skipTenant) return next()

      const modelName = this.modelName
      const contextTenantId = ensureObjectId(options.tenantId || getTenantContext()?.tenantId)

      for (const doc of Array.isArray(docs) ? docs : [docs]) {
        if (!doc || typeof doc !== 'object') continue

        const docTenantId = ensureObjectId(doc.tenantId)

        if (!docTenantId && !contextTenantId) {
          throw createTenantError({
            code: 'TENANT_INVALID',
            model: modelName,
            message: `[Tenant] Missing or invalid tenantId for model "${modelName}"`,
          })
        }

        if (docTenantId && contextTenantId && !docTenantId.equals(contextTenantId)) {
          throw createTenantError({
            code: 'TENANT_MISMATCH',
            model: modelName,
            message: `[Tenant] Tenant mismatch for model "${modelName}": doc=${docTenantId} context=${contextTenantId}`,
          })
        }

        if (!docTenantId) doc.tenantId = contextTenantId
      }

      return next()
    } catch (error) {
      return next(error)
    }
  })

  // El comercio con el que se leyó cada documento, para que el save pueda
  // distinguir "le cambiaron el comercio" de "no tenía y se le completa".
  schema.post('init', function rememberLoadedTenant() {
    this.$locals.loadedTenantId = this.tenantId ?? null
  })

  schema.pre('save', function validateTenantOnSave(next) {
    try {
      // Un documento que ya existe conserva su comercio: el contexto de la
      // request NO se le aplica encima. Antes sí, y un documento de otro
      // comercio (leído con ignoreTenant) que se guardaba dentro de una
      // request pasaba en silencio al comercio de esa request.
      if (!this.isNew) {
        const modelName = this.constructor?.modelName

        const ownTenantId = ensureObjectId(this.tenantId)
        const contextTenantId = ensureObjectId(
          this.$__?.saveOptions?.tenantId || this._tenantId || getTenantContext()?.tenantId,
        )

        if (this.isModified('tenantId')) {
          // Se admite un solo caso: un documento viejo que se leyó SIN
          // comercio y recibe justo el de la request, que es lo que este hook
          // le ponía antes. Cualquier otro cambio es mover el documento.
          const completesMissing =
            !ensureObjectId(this.$locals.loadedTenantId) &&
            ownTenantId &&
            contextTenantId &&
            ownTenantId.equals(contextTenantId)

          if (!completesMissing) {
            throw createTenantError({
              code: 'TENANT_MUTATION_FORBIDDEN',
              model: modelName,
              message: `[Tenant] Cannot modify tenantId for model "${modelName}"`,
            })
          }

          return next()
        }

        // Sin tenantId cargado (una proyección que no lo trajo) no se escribe
        // nada: el save solo manda los campos modificados y el de la base
        // queda como está.

        if (ownTenantId && contextTenantId && !ownTenantId.equals(contextTenantId)) {
          // Registra, no bloquea: mismo criterio que auditTenantBypass.
          logger.error('[Tenant] Se guardó un documento de otro comercio dentro de una request', {
            model: modelName,
            tenantDelDocumento: String(ownTenantId),
            tenantEnContexto: String(contextTenantId),
          })
        }

        return next()
      }

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
    if (options.ignoreTenant || options.skipTenant) {
      // Es la vía que más cruza comercios: los reportes de plataforma son
      // agregaciones. Justamente por eso también se audita.
      auditTenantBypass(this, {
        modelName: this._model?.modelName || this.model?.()?.modelName,
        operation: 'aggregate',
      })
      return next()
    }

    const requestContext = getTenantContext()
    const pipeline = this.pipeline()
    const pipelineTenantId = getTenantIdFromPipeline(pipeline)
    const normalizedTenantId = ensureObjectId(
      options.tenantId || requestContext?.tenantId || pipelineTenantId,
    )

    if (!normalizedTenantId) {
      return next(
        createTenantError({
          code: 'TENANT_INVALID',
          message: '[Tenant] Missing or invalid tenantId for aggregate operation',
        }),
      )
    }

    // Un $match inicial con OTRO comercio que el de la request se rechaza, como
    // en las consultas (addTenantFilter). Antes se respetaba tal cual.
    const contextTenantId = ensureObjectId(options.tenantId || requestContext?.tenantId)
    if (pipelineTenantId && contextTenantId) {
      const matchTenantId = ensureObjectId(pipelineTenantId)
      if (!matchTenantId || !matchTenantId.equals(contextTenantId)) {
        return next(
          createTenantError({
            code: 'TENANT_MISMATCH',
            message: `[Tenant] Tenant mismatch for aggregate: match=${pipelineTenantId} context=${contextTenantId}`,
          }),
        )
      }
    }

    if (!isTenantScopedFromStart(pipeline)) {
      pipeline.unshift({ $match: { tenantId: normalizedTenantId } })
    }

    return next()
  })
}

// =====================================================
// Query helper explícito
// =====================================================
