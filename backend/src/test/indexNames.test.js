// 📁 src/test/indexNames.test.js
//
// Ningún modelo puede declarar dos índices con el mismo nombre.
//
// Mongo deriva el nombre de las claves (`tenantId_1`), y tenantPlugin ya
// declara un { tenantId: 1 } no único en cada modelo con aislamiento. Un
// `schema.index({ tenantId: 1 }, { unique: true })` sin nombre propio sale con
// el MISMO nombre y la base rechaza el segundo: `ensure:indexes` lo reporta
// como "An existing index has the same name" (código 86) y el índice único
// nunca llega a existir. Pasó con PricingPolicy; aiTenantPolicy ya lo tenía
// resuelto con un nombre propio.
//
// Sin base de datos: solo mira lo que los modelos declaran.

import mongoose from 'mongoose'

import { loadAllModels } from '../services/indexHealthService.js'

// Mismo cálculo de nombre por defecto que usa MongoDB.
const nameOf = ([keys, options]) =>
  options?.name ||
  Object.entries(keys)
    .map(([key, direction]) => `${key}_${direction}`)
    .join('_')

describe('nombres de índice declarados en los modelos', () => {
  beforeAll(async () => {
    await loadAllModels()
  })

  it('ningún modelo declara el mismo nombre con opciones distintas', () => {
    const conflictos = []

    for (const [modelo, model] of Object.entries(mongoose.models)) {
      const porNombre = new Map()

      for (const entry of model.schema.indexes()) {
        const nombre = nameOf(entry)
        const opciones = JSON.stringify({
          unique: Boolean(entry[1]?.unique),
          partial: entry[1]?.partialFilterExpression || null,
          ttl: entry[1]?.expireAfterSeconds ?? null,
          sparse: Boolean(entry[1]?.sparse),
        })

        if (porNombre.has(nombre) && porNombre.get(nombre) !== opciones) {
          conflictos.push(`${modelo}: '${nombre}' declarado con opciones distintas`)
        }

        porNombre.set(nombre, opciones)
      }
    }

    expect(conflictos).toEqual([])
  })

  it('PricingPolicy tiene su índice único con nombre propio', () => {
    const entradas = mongoose.models.PricingPolicy.schema.indexes()
    const unico = entradas.find(([keys, opts]) => keys.tenantId === 1 && opts?.unique)

    expect(unico?.[1]?.name).toBe('pricingPolicy_tenant_unique')
  })
})
