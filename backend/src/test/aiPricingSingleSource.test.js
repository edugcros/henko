// 📁 src/test/aiPricingSingleSource.test.js
//
// Un solo archivo sabe cuánto cuesta la IA.
//
// Antes el costo salía de una tarifa mezclada única
// (AI_COST_USD_PER_1M_TOKENS, 1,3 por defecto) que no separaba entrada de
// salida ni un modelo de otro. Se reemplazó por el catálogo, pero el precio
// POR IMAGEN se había quedado en aiPlanPolicy.js con un 0,02 fijo: un segundo
// lugar que sabía precios.
//
// Dos archivos que saben precios es la forma exacta en que vuelve el problema:
// el que sobra se usa por accidente y nadie nota que los números no coinciden.
// Este archivo existe para que el día que alguien agregue una tarifa en otro
// lado, un test falle.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const { computeCostUsd, computeImageCostUsd, getImagePrice, getModelPrice } =
  await import('../services/ai/aiModelPricing.js')

const SRC = path.resolve('src')

/** Todos los .js del backend, menos los tests y el propio catálogo. */
const archivosDeCodigo = (dir = SRC, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'test') archivosDeCodigo(full, acc)
    } else if (entry.name.endsWith('.js') && entry.name !== 'aiModelPricing.js') {
      acc.push(full)
    }
  }
  return acc
}

/** El código, sin comentarios: una mención histórica no es un calculador. */
const sinComentarios = texto =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')

describe('precios · una sola fuente', () => {
  test('ningún archivo fuera del catálogo lee una tarifa', () => {
    const culpables = []

    for (const archivo of archivosDeCodigo()) {
      const codigo = sinComentarios(fs.readFileSync(archivo, 'utf8'))

      // Las variables de entorno que definían tarifas alternativas. Que
      // aparezcan en un comentario está bien —explican qué se sacó—; que las
      // LEA el código, no.
      if (/AI_COST_USD_PER_1M_TOKENS|AI_COST_USD_PER_IMAGE_EDIT/.test(codigo)) {
        culpables.push(path.relative(SRC, archivo))
      }
    }

    expect(culpables).toEqual([])
  })

  test('el catálogo es el único que divide por millón', () => {
    // La firma de un cálculo de costo por token: dividir por 1.000.000.
    const culpables = []

    for (const archivo of archivosDeCodigo()) {
      const codigo = sinComentarios(fs.readFileSync(archivo, 'utf8'))

      // Se excluyen los usos legítimos: topes y validaciones de rango, que
      // comparan contra un millón pero no calculan plata.
      const divide = /\/\s*(1_000_000|1000000|1e6)\b/.test(codigo)
      if (divide) culpables.push(path.relative(SRC, archivo))
    }

    expect(culpables).toEqual([])
  })
})

describe('precio por imagen · vive en el catálogo y lleva fecha', () => {
  const original = process.env.AI_COST_USD_PER_IMAGE_EDIT

  afterEach(() => {
    if (original === undefined) delete process.env.AI_COST_USD_PER_IMAGE_EDIT
    else process.env.AI_COST_USD_PER_IMAGE_EDIT = original
  })

  test('el número no cambió al mudarse', () => {
    // La mudanza es organizativa. Si además cambiara el precio, el gasto de
    // imágenes daría distinto sin que nadie lo haya decidido.
    delete process.env.AI_COST_USD_PER_IMAGE_EDIT

    expect(getImagePrice().perImage).toBe(0.02)
    expect(computeImageCostUsd(3)).toBeCloseTo(0.06, 10)
  })

  test('el entorno lo corrige, y se sabe que vino de ahí', () => {
    process.env.AI_COST_USD_PER_IMAGE_EDIT = '0.05'

    const precio = getImagePrice()
    expect(precio.perImage).toBe(0.05)
    // Un número que no salió del catálogo tiene que poder distinguirse cuando
    // alguien audite el gasto.
    expect(precio.source).toBe('env')
  })

  test('cantidades que no son cantidades cuestan cero', () => {
    expect(computeImageCostUsd(0)).toBe(0)
    expect(computeImageCostUsd(-2)).toBe(0)
    expect(computeImageCostUsd('tres')).toBe(0)
    expect(computeImageCostUsd(undefined)).toBe(0)
  })
})

describe('las tarifas siguen fechadas', () => {
  test('la duplicación anunciada no repricea el pasado', () => {
    // Es la propiedad que hace confiable la contabilidad histórica.
    const antes = getModelPrice('gemini-3.6-flash', new Date('2026-12-31T00:00:00Z'))
    const despues = getModelPrice('gemini-3.6-flash', new Date('2027-01-02T00:00:00Z'))

    expect(antes.input).toBe(0.75)
    expect(despues.input).toBe(1.5)
  })

  test('un modelo desconocido se cobra caro, no gratis', () => {
    // Sobreestimar hace que el techo corte antes de tiempo y se note.
    // Subestimar llega en la factura.
    const desconocido = getModelPrice('gemini-9.9-inventado')

    expect(desconocido.fallback).toBe(true)
    expect(desconocido.input).toBeGreaterThan(1)

    const costo = computeCostUsd({
      model: 'gemini-9.9-inventado',
      inputTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(costo.price.fallback).toBe(true)
    expect(costo.costUsd).toBeGreaterThan(1)
  })
})
