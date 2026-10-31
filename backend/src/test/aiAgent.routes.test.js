import request from 'supertest'
import { Types } from 'mongoose'

import app from '../../app.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'
import AiInsight from '../models/aiInsightModel.js'
import AiLearningSuggestion from '../models/aiLearningSuggestionModel.js'
import AiKnowledge from '../models/aiKnowledgeModel.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { crearMongoEnMemoria } from './testDB.js'
import mongoose from 'mongoose'

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
  let mongod

  beforeAll(async () => {
    // Servidor propio en memoria, no la base de pruebas compartida.
    //
    // Con la compartida estos dos tests fallaban de vez en cuando: las filas
    // se insertan en el beforeAll y otra suite puede dropear la base entre
    // medio. Un test que falla una de cada tres corridas no dice nada sobre el
    // código, y enseña a ignorar el rojo.
    mongod = await crearMongoEnMemoria()
    await mongoose.connect(mongod.getUri())

    tenantContext = await createTestTenant()
    adminSession = await createTestUser({
      tenantId: tenantContext.tenant._id,
      email: 'colas-admin@test.com',
      role: 'admin',
    })

    const tenantId = tenantContext.tenant._id
    const base = { tenantId, status: 'pending_review' }

    // La huella es única por (comercio, tipo:entidad): insertando con el
    // driver crudo hay que ponerla a mano, o las tres filas chocan entre sí.
    await AiInsight.collection.insertMany([
      {
        ...base,
        priority: 'medium',
        title: 'Media',
        type: 'low_conversion',
        fingerprint: 'low_conversion:media',
        updatedAt: new Date(),
      },
      {
        ...base,
        priority: 'low',
        title: 'Baja',
        type: 'low_conversion',
        fingerprint: 'low_conversion:baja',
        updatedAt: new Date(),
      },
      {
        ...base,
        priority: 'high',
        title: 'Alta',
        type: 'low_conversion',
        fingerprint: 'low_conversion:alta',
        updatedAt: new Date(),
      },
    ])

    // Cada una con su fingerprint: el modelo lo exige y hay un índice único
    // (tenantId, fingerprint). collection.insertMany saltea la validación, así
    // que sin esto las cuatro iban con null y chocaban apenas el índice estaba
    // armado — en CI casi siempre; en una máquina lenta, a veces no.
    await AiLearningSuggestion.collection.insertMany([
      {
        ...base,
        fingerprint: 'cola:media',
        priority: 'medium',
        title: 'Media',
        question: '¿A?',
        updatedAt: new Date(),
      },
      {
        ...base,
        fingerprint: 'cola:critica',
        priority: 'critical',
        title: 'Crítica',
        question: '¿B?',
        updatedAt: new Date(),
      },
      {
        ...base,
        fingerprint: 'cola:alta',
        priority: 'high',
        title: 'Alta',
        question: '¿C?',
        updatedAt: new Date(),
      },
      {
        ...base,
        fingerprint: 'cola:baja',
        priority: 'low',
        title: 'Baja',
        question: '¿D?',
        updatedAt: new Date(),
      },
    ])
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongod?.stop()
  })

  test('Diagnóstico devuelve primero la prioridad alta', async () => {
    const res = await request(app)
      .get('/api/insights')
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
        }),
      )

    expect(res.statusCode).toBe(200)
    expect(res.body.data.items.map(item => item.priority)).toEqual(['high', 'medium', 'low'])
  })

  test('Revisión de aprendizaje devuelve primero lo crítico', async () => {
    const res = await request(app)
      .get('/api/ai-agent/learning-suggestions')
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
        }),
      )

    expect(res.statusCode).toBe(200)
    expect(res.body.data.items.map(item => item.priority)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ])
  })
})

// ─── Los contadores de la base de conocimiento ───────────────────────────────
//
// El resumen de la pantalla muestra cuántas entradas hay en cada estado, y en
// producción marcaba 0 en todos con 184 entradas cargadas. El listado filtraba
// bien —`find` convierte el id del comercio de texto a ObjectId— pero el conteo
// es una agregación, y `$match` en una agregación NO convierte nada: comparaba
// un ObjectId guardado contra un texto y no encontraba ninguna fila.

describe('base de conocimiento · contadores por estado', () => {
  let tenantContext
  let otherTenantContext
  let adminSession
  let mongod

  beforeAll(async () => {
    mongod = await crearMongoEnMemoria()
    await mongoose.connect(mongod.getUri())

    tenantContext = await createTestTenant()
    otherTenantContext = await createTestTenant()
    adminSession = await createTestUser({
      tenantId: tenantContext.tenant._id,
      email: 'conocimiento-admin@test.com',
      role: 'admin',
    })

    const entrada = (tenantId, status, title) => ({
      tenantId,
      status,
      title,
      content: `Contenido de ${title}`,
    })

    await AiKnowledge.create([
      entrada(tenantContext.tenant._id, 'approved', 'Envíos'),
      entrada(tenantContext.tenant._id, 'approved', 'Pagos'),
      entrada(tenantContext.tenant._id, 'archived', 'Promo vieja'),
      // De OTRO comercio: no puede sumar en los contadores de este.
      entrada(otherTenantContext.tenant._id, 'approved', 'Ajena'),
      entrada(otherTenantContext.tenant._id, 'pending_approval', 'Ajena pendiente'),
    ])
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongod?.stop()
  })

  test('cuenta las entradas de cada estado, solo las del comercio', async () => {
    const res = await request(app)
      .get('/api/ai-agent/knowledge?status=all')
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
        }),
      )

    expect(res.statusCode).toBe(200)

    const tenantId = tenantContext.tenant._id
    const esperado = {}
    for (const status of ['approved', 'archived', 'pending_approval']) {
      const count = await AiKnowledge.countDocuments({ tenantId, status }).setOptions({
        tenantId,
      })
      if (count) esperado[status] = count
    }

    expect(esperado.approved).toBeGreaterThanOrEqual(2)
    expect(res.body.meta.counters).toEqual(esperado)
    expect(res.body.meta.counters.pending_approval).toBeUndefined()
  })
})

describe('métricas del asistente · moneda', () => {
  let tenantContext
  let adminSession
  let mongod

  beforeAll(async () => {
    mongod = await crearMongoEnMemoria()
    await mongoose.connect(mongod.getUri())

    tenantContext = await createTestTenant()
    adminSession = await createTestUser({
      tenantId: tenantContext.tenant._id,
      email: 'metricas-admin@test.com',
      role: 'admin',
    })
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongod?.stop()
  })

  // Las ventas influenciadas están en la moneda de la tienda: el panel la necesita para no
  // mostrarlas siempre como pesos.
  test('devuelve la moneda de la tienda junto con las cifras', async () => {
    const res = await request(app)
      .get('/api/ai-agent/metrics?period=30d')
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
        }),
      )

    expect(res.statusCode).toBe(200)
    expect(res.body.data.currency).toBe(tenantContext.tenant.currency || 'ARS')
    expect(res.body.data.salesInfluence).toBeDefined()
  })
})
