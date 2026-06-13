// src/services/aiAgent/aiCatalogEventService.js

export const registerAiCatalogChangedEvent = async ({
  tenantId,
  productId,
  action = 'product_updated',
} = {}) => {
  console.log('[AI_CATALOG_CHANGED]', {
    tenantId,
    productId,
    action,
    at: new Date().toISOString(),
  })

  return true
}