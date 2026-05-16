// 📁 src/utils/tenantRequestContext.js
// Contexto tenant-safe por request usando AsyncLocalStorage

import { AsyncLocalStorage } from 'node:async_hooks'

const tenantAsyncStorage = new AsyncLocalStorage()

export const runWithTenantContext = (context, callback) => {
  return tenantAsyncStorage.run(context, callback)
}

export const getTenantContext = () => {
  return tenantAsyncStorage.getStore() || null
}

export const hasTenantContext = () => {
  return Boolean(getTenantContext()?.tenantId)
}