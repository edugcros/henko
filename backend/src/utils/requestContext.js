import mongoose from 'mongoose'

export const isValidObjectId = value => {
  return mongoose.Types.ObjectId.isValid(String(value || ''))
}

export const toObjectId = value => {
  if (!isValidObjectId(value)) return null
  return new mongoose.Types.ObjectId(String(value))
}

export const getUserIdFromRequest = req => {
  return req.user?._id || req.user?.id || null
}

export const getActorIdFromRequest = (req, fallback = null) => {
  const userId = getUserIdFromRequest(req)
  return userId ? String(userId) : fallback
}

export const getTenantIdFromRequest = (
  req,
  { allowBodyTenantId = false } = {},
) => {
  const candidates = [
    req.user?.tenantId,
    req.user?.tenant?._id,
    req.tenantId,
    req.tenant?._id,
    allowBodyTenantId ? req.body?.tenantId : null,
  ]

  const tenantId = candidates.find(value => isValidObjectId(value))
  return tenantId ? String(tenantId) : null
}

export const getAllowedTenantIdsFromRequest = req => {
  const candidates = [
    req.user?.tenantId,
    req.user?.tenant?._id,
    ...(Array.isArray(req.user?.allowedTenants) ? req.user.allowedTenants : []),
  ]

  return [...new Set(candidates.filter(value => isValidObjectId(value)).map(String))]
}

export const resolveTenantFromRequest = (
  req,
  {
    missingTenantMessage = 'Tenant no resuelto',
    mismatchMessage = 'El usuario no pertenece al tenant resuelto por el dominio',
    missingTenantStatus = 400,
    mismatchStatus = 403,
    includeObjectId = true,
  } = {},
) => {
  const domainTenantId = req.tenantId || req.tenant?._id || null
  const userTenantId = req.user?.tenantId || req.user?.tenant?._id || null

  if (!domainTenantId || !isValidObjectId(domainTenantId)) {
    const error = new Error(missingTenantMessage)
    error.statusCode = missingTenantStatus
    throw error
  }

  if (userTenantId && String(userTenantId) !== String(domainTenantId)) {
    const error = new Error(mismatchMessage)
    error.statusCode = mismatchStatus
    throw error
  }

  const tenantId = String(domainTenantId)

  if (!includeObjectId) {
    return tenantId
  }

  return {
    tenantId,
    tenantObjectId: toObjectId(tenantId),
  }
}

export const resolveAuthorizedTenantFromRequest = (
  req,
  {
    requireUserTenant = false,
    allowPrivilegedRoleBypass = false,
    privilegedRoles = ['admin', 'manager', 'superadmin'],
    missingTenantMessage = 'Tenant no resuelto',
    missingUserTenantMessage = 'El usuario autenticado no tiene tenantId válido',
    mismatchMessage = 'El usuario no pertenece al tenant resuelto por el dominio',
    missingTenantStatus = 400,
    missingUserTenantStatus = 401,
    mismatchStatus = 403,
    onMismatch = null,
  } = {},
) => {
  const domainTenantId = getTenantIdFromRequest(req)
  const userTenantId = req.user?.tenantId || req.user?.tenant?._id || null
  const normalizedUserTenantId = isValidObjectId(userTenantId) ? String(userTenantId) : null

  if (!domainTenantId) {
    const error = new Error(missingTenantMessage)
    error.statusCode = missingTenantStatus
    throw error
  }

  if (requireUserTenant && !normalizedUserTenantId) {
    const error = new Error(missingUserTenantMessage)
    error.statusCode = missingUserTenantStatus
    throw error
  }

  if (normalizedUserTenantId && normalizedUserTenantId !== String(domainTenantId)) {
    const role = req.user?.role || null
    const privileged = allowPrivilegedRoleBypass && privilegedRoles.includes(role)
    const allowedTenantIds = getAllowedTenantIdsFromRequest(req)
    const explicitlyAllowed = allowedTenantIds.includes(String(domainTenantId))

    if (!privileged && !explicitlyAllowed) {
      if (typeof onMismatch === 'function') {
        onMismatch({
          domainTenantId: String(domainTenantId),
          userTenantId: normalizedUserTenantId,
          allowedTenantIds,
          role,
        })
      }

      const error = new Error(mismatchMessage)
      error.statusCode = mismatchStatus
      throw error
    }
  }

  return {
    tenantId: String(domainTenantId),
    tenantObjectId: toObjectId(domainTenantId),
    userTenantId: normalizedUserTenantId,
  }
}
