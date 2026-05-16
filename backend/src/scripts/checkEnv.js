import { env } from '../../config/env.js'

console.log('✅ ENV cargado correctamente')
console.log({
  nodeEnv: env.nodeEnv,
  port: env.port,
  apiPrefix: env.apiPrefix,
  rootDomain: env.rootDomain,
  publicBaseDomain: env.publicBaseDomain,
  adminBaseDomain: env.adminBaseDomain,
  apiDomain: env.apiDomain,
  allowedOrigins: env.allowedOrigins,
  allowedRootDomains: env.allowedRootDomains,
  allowDynamicTenantOrigins: env.allowDynamicTenantOrigins,
  allowCustomDomains: env.allowCustomDomains,
  tenantHeader: env.tenantHeader,
  cookieSecure: env.cookieSecure,
  cookieSameSite: env.cookieSameSite,
  csrfEnabled: env.csrfEnabled,
})