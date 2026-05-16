// 📁 src/controller/tenantCtrl.js
// VERSIÓN PRODUCCIÓN - RESOLUCIÓN PÚBLICA DE TENANT

import expressAsyncHandler from 'express-async-handler'
import Tenant from '../models/tenantModel.js'

import {
  getDomainCandidates,
  normalizeSlug,
} from '../utils/domainUtils.js'

// =====================================================
// Helpers
// =====================================================

const buildPublicTenantResponse = tenant => {
  const primaryDomain = tenant.getPrimaryDomain?.() || null

  return {
    tenantId: tenant._id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    plan: tenant.plan,
    currency: tenant.currency,
    locale: tenant.locale,
    timezone: tenant.timezone,
    country: tenant.country,
    domains: tenant.domains,
    primaryDomain,
    settings: tenant.settings,
  }
}

// =====================================================
// @desc    Resolver tenant por dominio o slug
// @route   GET /api/tenants/resolve?domains=henko.local
// @route   GET /api/tenants/resolve?slug=mi-tienda
// @access  Public
// =====================================================

export const resolveTenant = expressAsyncHandler(async (req, res) => {
  const { domains, domain, slug } = req.query

  if (slug) {
    const cleanSlug = normalizeSlug(slug)

    if (!cleanSlug) {
      return res.status(400).json({
        success: false,
        message: 'Slug inválido',
      })
    }

    const tenantBySlug = await Tenant.findOne({
      slug: cleanSlug,
      status: 'active',
    }).select(
      '_id name slug domains status plan settings currency locale timezone country',
    )

    if (!tenantBySlug) {
      return res.status(404).json({
        success: false,
        message: 'Tenant no encontrado',
      })
    }

    return res.status(200).json({
      success: true,
      data: buildPublicTenantResponse(tenantBySlug),
    })
  }

  const requestedDomain =
    domains ||
    domain ||
    req.headers['x-tenant-domain'] ||
    null

  if (!requestedDomain) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere domain, domains, slug o header x-tenant-domain',
    })
  }

  const candidates = getDomainCandidates(requestedDomain)

  if (!candidates.length) {
    return res.status(400).json({
      success: false,
      message: 'Dominio inválido',
    })
  }

  const tenantByDomain = await Tenant.findOne({
    status: 'active',
    $or: [
      {
        domains: {
          $elemMatch: {
            status: 'active',
            $or: [
              { hostname: { $in: candidates } },
              { normalizedHostname: { $in: candidates } },
            ],
          },
        },
      },
      { legacyDomains: { $in: candidates } },
    ],
  }).select(
    '_id name slug domains status plan settings currency locale timezone country',
  )

  if (!tenantByDomain) {
    return res.status(404).json({
      success: false,
      message: 'Tenant no encontrado',
    })
  }

  return res.status(200).json({
    success: true,
    data: buildPublicTenantResponse(tenantByDomain),
  })
})