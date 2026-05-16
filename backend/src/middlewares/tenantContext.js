// 📁 src/middlewares/tenantContext.js
// ADAPTADOR DE COMPATIBILIDAD
// La resolución real del tenant vive en tenantMiddleware.js.
// Mantener este archivo evita romper imports legacy mientras se migra el proyecto.

import mongoose from 'mongoose'

import {
  resolveTenantByDomain,
} from './tenantMiddleware.js'

// =====================================================
// Compatibilidad legacy
// =====================================================

/**
 * Alias legacy.
 *
 * Antes este archivo resolvía tenants por su cuenta.
 * En producción debe existir una sola fuente de verdad, por eso
 * delega completamente en resolveTenantByDomain.
 */
export const tenantContext = resolveTenantByDomain

/**
 * Helper tenant-scoped para operaciones explícitas.
 *
 * Recomendación:
 * - preferir siempre pasar tenantId en filtros de controllers críticos;
 * - usar este helper cuando quieras centralizar operaciones por modelo.
 */
export const withTenant = (model, tenantId) => {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    throw new Error('Se requiere un tenantId válido para la operación')
  }

  return {
    find: query =>
      model.find(query).setOptions({ tenantId }),

    findOne: query =>
      model.findOne(query).setOptions({ tenantId }),

    create: data => {
      const payload = Array.isArray(data)
        ? data.map(item => ({ ...item, tenantId }))
        : { ...data, tenantId }

      return model.create(payload)
    },

    updateOne: (query, update, options = {}) =>
      model.updateOne(query, update, {
        ...options,
        tenantId,
      }),

    findOneAndUpdate: (query, update, options = {}) =>
      model.findOneAndUpdate(query, update, {
        ...options,
        tenantId,
      }),

    deleteOne: (query, options = {}) =>
      model.deleteOne(query, {
        ...options,
        tenantId,
      }),

    aggregate: pipeline =>
      model.aggregate(pipeline).option({ tenantId }),
  }
}

export default tenantContext