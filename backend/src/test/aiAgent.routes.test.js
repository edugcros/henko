import request from 'supertest'
import { Types } from 'mongoose'

import app from '../../app.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'
import AiInsight from '../models/aiInsightModel.js'
import AiLearningSuggestion from '../models/aiLearningSuggestionModel.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
import { authHeaders, createTestTenant, createTestUser } from './testSetup.js'

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

// ─── El orden de las colas de revisión ───────────────────────────────────────
//
// Diagnóstico y Revisión de aprendizaje existen para contestar "¿qué mirás
// primero?". Las dos ordenaban por `priority` con -1 sobre un campo de TEXTO,
// o sea alfabéticamente al revés: medium, low, high (y critical al final, en la
// de aprendizaje). Lo urgente quedaba abajo, y con más de una página podía no
// aparecer.

describe('colas de revisión · primero lo urgente', () => {
  let tenantContext
  let adminSession

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(AiInsight, AiLearningSuggestion, User, Tenant)

    tenantContext = await createTestTenant()
    adminSession = await createTestUser({
      tenantId: tenantContext.tenant._id,
      email: 'colas-admin@test.com',
      role: 'admin',
    })

    const tenantId = tenantContext.tenant._id
    const base = { tenantId, status: 'pending_review' }

    await AiInsight.collection.insertMany([
      { ...base, priority: 'medium', title: 'Media', type: 'low_conversion', updatedAt: new Date() },
      { ...base, priority: 'low', title: 'Baja', type: 'low_conversion', updatedAt: new Date() },
      { ...base, priority: 'high', title: 'Alta', type: 'low_conversion', updatedAt: new Date() },
    ])

    await AiLearningSuggestion.collection.insertMany([
      { ...base, priority: 'medium', title: 'Media', question: '¿A?', updatedAt: new Date() },
      { ...base, priority: 'critical', title: 'Crítica', question: '¿B?', updatedAt: new Date() },
      { ...base, priority: 'high', title: 'Alta', question: '¿C?', updatedAt: new Date() },
      { ...base, priority: 'low', title: 'Baja', question: '¿D?', updatedAt: new Date() },
    ])
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('Diagnóstico devuelve primero la prioridad alta', async () => {
    const res = await request(app)
      .get('/api/insights')
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.data.items.map(item => item.priority)).toEqual([
      'high',
      'medium',
      'low',
    ])
  })

  test('Revisión de aprendizaje devuelve primero lo crítico', async () => {
    const res = await request(app)
      .get('/api/ai-agent/learning-suggestions')
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.data.items.map(item => item.priority)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ])
  })
})
