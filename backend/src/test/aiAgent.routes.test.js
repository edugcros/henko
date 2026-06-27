import request from 'supertest'
import { Types } from 'mongoose'

import app from '../../app.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'

describe('AI agent route security', () => {
  test('protects conversation administration before tenant resolution', async () => {
    const response = await request(app).get('/api/ai-agent/conversations')

    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
  })

  test('protects lead administration and does not expose a pre-CSRF mount', async () => {
    const response = await request(app).get('/api/ai-agent/leads')

    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
  })

  test('protects AI configuration administration', async () => {
    const response = await request(app).get('/api/ai-agent/config')

    expect(response.status).toBe(401)
    expect(response.body.success).toBe(false)
  })

  test('rejects an authenticated user from a different resolved tenant', () => {
    const domainTenantId = new Types.ObjectId()
    const userTenantId = new Types.ObjectId()

    expect(() =>
      resolveAuthorizedTenantFromRequest(
        {
          tenantId: domainTenantId,
          user: { tenantId: userTenantId, role: 'admin' },
        },
        { requireUserTenant: true },
      ),
    ).toThrow(
      expect.objectContaining({
        statusCode: 403,
      }),
    )
  })
})
