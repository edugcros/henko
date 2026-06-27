import request from 'supertest'
import { Types } from 'mongoose'

import app from '../../app.js'
import Tenant from '../models/tenantModel.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import { generateAccessToken } from '../../config/generateAccessToken.js'

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const getCSRFToken = async (domain = null) => {
  const req = request(app).get('/api/user/csrf-token')
  if (domain) req.set('x-tenant-domain', domain)

  const res = await req
  const csrfToken = res.body.csrfToken
  const cookies = res.headers['set-cookie']
  const csrfCookie = Array.isArray(cookies)
    ? cookies.map(cookie => cookie.split(';')[0]).join('; ')
    : cookies

  return {
    csrfToken,
    cookies,
    csrfCookie,
  }
}

export const createTestTenant = async ({
  name = 'Test Store',
  slug = `test-${uniqueSuffix()}`,
} = {}) => {
  const shopDomain = `${slug}.shop.test`
  const adminDomain = `${slug}.admin.test`

  const tenant = await Tenant.create({
    name,
    slug,
    status: 'active',
    plan: 'starter',
    domains: [
      {
        hostname: shopDomain,
        normalizedHostname: shopDomain,
        type: 'platform_subdomain',
        context: 'storefront',
        status: 'active',
        isPrimary: true,
      },
    ],
    adminDomains: [
      {
        hostname: adminDomain,
        normalizedHostname: adminDomain,
        type: 'platform_subdomain',
        context: 'admin',
        status: 'active',
        isPrimary: true,
      },
    ],
  })

  return { tenant, shopDomain, adminDomain }
}

export const createTestUser = async ({
  tenantId,
  email = `user-${uniqueSuffix()}@test.com`,
  role = 'user',
  password = 'Test1234!',
} = {}) => {
  const user = await User.create({
    tenantId,
    firstname: role === 'admin' ? 'Admin' : 'Test',
    lastname: 'User',
    email,
    password,
    mobile: `11${Math.floor(10000000 + Math.random() * 89999999)}`,
    role,
    isEmailVerified: true,
  })

  const token = generateAccessToken(user._id, {
    tenantId,
    role,
    email,
  })

  return { user, token, password }
}

export const registerAndLoginUser = async ({
  shopDomain,
  email = `buyer-${uniqueSuffix()}@test.com`,
  password = 'Test1234!',
} = {}) => {
  const { csrfToken, csrfCookie } = await getCSRFToken(shopDomain)

  const registerRes = await request(app)
    .post('/api/user/register')
    .set('x-tenant-domain', shopDomain)
    .set('Cookie', csrfCookie)
    .set('X-CSRF-Token', csrfToken)
    .send({
      firstname: 'Test',
      lastname: 'Buyer',
      email,
      password,
      mobile: `11${Math.floor(10000000 + Math.random() * 89999999)}`,
    })

  if (registerRes.status !== 201) {
    throw new Error(`Register failed: ${registerRes.status} ${JSON.stringify(registerRes.body)}`)
  }

  await User.updateOne(
    { email },
    {
      isEmailVerified: true,
      emailVerificationToken: undefined,
      emailVerificationExpires: undefined,
    },
  )

  const loginRes = await request(app)
    .post('/api/user/login')
    .set('x-tenant-domain', shopDomain)
    .set('Cookie', csrfCookie)
    .set('X-CSRF-Token', csrfToken)
    .send({ email, password })

  if (![200, 201].includes(loginRes.status)) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`)
  }

  return {
    csrfToken,
    csrfCookie,
    user: registerRes.body.data,
    token: loginRes.body.data?.token || loginRes.body.accessToken || loginRes.body.token,
  }
}

export const createTestProduct = async ({
  tenantId,
  title = `Producto ${uniqueSuffix()}`,
  stock = 30,
  price = 500,
} = {}) => {
  const suffix = uniqueSuffix()

  return Product.create({
    tenantId,
    title,
    slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
    description: 'Producto de prueba para suite automatizada',
    marca: 'Marca Test',
    categoria: 'Test',
    subcategoria: 'General',
    price,
    stock,
    currency: 'ARS',
    sku: `SKU-${String(new Types.ObjectId()).slice(-8).toUpperCase()}`,
    status: 'active',
    visibility: 'visible',
  })
}

export const authHeaders = ({ token, domain, csrfToken, csrfCookie } = {}) => {
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-tenant-domain': domain,
  }

  if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  if (csrfCookie) headers.Cookie = csrfCookie

  return headers
}
