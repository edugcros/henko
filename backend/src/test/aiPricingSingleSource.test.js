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

// ─── El modelo real, no el configurado ──────────────────────────────────────
//
// Medido en producción sobre 122 filas de costo por tokens:
//
//   gemini-3.1-flash-lite   50    ← el configurado en GEMINI_MODEL
//   gemini-3.6-flash        40    ← 3x más caro
//   gemini-3.5-flash-lite   22
//   gemini-3.7-flash         8
//   gemini-3.5-flash         4
//   gemini-3.8-flash         2
//
// 72 de 122 NO son el modelo configurado. Si el costo se calculara con
// GEMINI_MODEL, el 59% del gasto estaría mal — y hacia abajo, que es el error
// que llega en la factura.

describe('costeo · con el modelo que respondió', () => {
  test('la diferencia entre el pedido y el real es real', () => {
    const pedido = computeCostUsd({
      model: 'gemini-3.8-flash',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    const respondio = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })

    // 0,75+3,75 contra 0,25+1,50. Costear con el equivocado no es un redondeo.
    expect(pedido.costUsd).toBeCloseTo(4.5, 6)
    expect(respondio.costUsd).toBeCloseTo(1.75, 6)
    expect(pedido.costUsd / respondio.costUsd).toBeGreaterThan(2.5)
  })

  test('el modelo inferido ya no prefiere el de imágenes', () => {
    // La precedencia preguntaba primero por GEMINI_IMAGE_MODEL para costear
    // TOKENS. Un llamador que se olvidara del modelo pagaba 3x por un error de
    // orden, no por una decisión.
    const fuente = fs.readFileSync(
      path.join(SRC, 'services/ai/aiBudgetService.js'),
      'utf8',
    )
    const bloque = fuente.slice(
      fuente.indexOf('const getDefaultPricingModel'),
      fuente.indexOf('const resolvePricingModel'),
    )

    expect(bloque).toContain('GEMINI_MODEL')
    expect(bloque).not.toContain('GEMINI_IMAGE_MODEL')
  })

  test('adivinar el modelo deja marca y no pasa desapercibido', () => {
    // Un costo supuesto que se ve igual que uno medido es peor que no tenerlo.
    const fuente = fs.readFileSync(
      path.join(SRC, 'services/ai/aiBudgetService.js'),
      'utf8',
    )

    expect(fuente).toContain('pricingFallback')
    expect(fuente).toContain('[AI PRICING] Costo calculado con un modelo INFERIDO')
  })
})

describe('pensar es salida, y la salida cuesta 5x', () => {
  // MEDIDO CONTRA LA API, mismo prompt, thinkingBudget 512:
  //
  //   gemini-3.6-flash  prompt 61 · candidates 387 · thoughts 462 · total 910
  //
  // thoughtsTokenCount NO está dentro de candidatesTokenCount y SÍ está dentro
  // de totalTokenCount. Google lo factura a tarifa de salida.
  //
  // Y MEDIDO CONTRA LA BASE DE PRODUCCIÓN: de 122 filas de consumo con
  // desglose, 40 tenían total > entrada + salida. 23.836 tokens de
  // razonamiento sin contar contra 2.910 de salida contados. El costo
  // registrado del histórico era USD 0,459 contra 0,556 reales: 21,2% de
  // menos, con el disyuntor de plataforma decidiendo sobre ese número.

  const RESPUESTA_REAL = {
    model: 'gemini-3.6-flash',
    usageMetadata: {
      promptTokenCount: 61,
      candidatesTokenCount: 387,
      thoughtsTokenCount: 462,
      totalTokenCount: 910,
      serviceTier: 'standard',
    },
  }

  test('el razonamiento entra en la salida, no se evapora', async () => {
    const { readUsage } = await import('../services/ai/aiUsageMetadata.js')
    const usage = readUsage(RESPUESTA_REAL)

    // Antes esto daba 387 y se perdían 462.
    expect(usage.outputTokens).toBe(387 + 462)
    expect(usage.visibleTokens).toBe(387)
    expect(usage.thinkingTokens).toBe(462)

    // La invariante que el bug rompía: el desglose vuelve a dar el total.
    expect(usage.inputTokens + usage.outputTokens).toBe(usage.totalTokens)
  })

  test('el nivel de servicio viaja; la caché no miente cuando no hay', async () => {
    const { readUsage } = await import('../services/ai/aiUsageMetadata.js')
    const usage = readUsage(RESPUESTA_REAL)

    expect(usage.serviceTier).toBe('standard')
    // No se usa caché de contexto: la clave ni siquiera vuelve de la API.
    expect(usage.cachedInputTokens).toBeNull()
  })

  test('un modelo que no piensa no cambia de comportamiento', async () => {
    const { readUsage } = await import('../services/ai/aiUsageMetadata.js')

    // gemini-3.5-flash-lite, mismo prompt: thoughts 0.
    const usage = readUsage({
      model: 'gemini-3.5-flash-lite',
      usageMetadata: {
        promptTokenCount: 61,
        candidatesTokenCount: 388,
        totalTokenCount: 449,
      },
    })

    expect(usage.outputTokens).toBe(388)
    expect(usage.thinkingTokens).toBeNull()
  })

  test('sumar varias llamadas suma el razonamiento de cada una', async () => {
    const { readUsage, sumUsage } = await import('../services/ai/aiUsageMetadata.js')

    const total = sumUsage(readUsage(RESPUESTA_REAL), readUsage(RESPUESTA_REAL))

    expect(total.thinkingTokens).toBe(924)
    expect(total.outputTokens).toBe(1698)
    expect(total.totalTokens).toBe(1820)
    expect(total.serviceTier).toBe('standard')
  })

  test('el costo sube lo que el razonamiento vale', () => {
    // gemini-3.6-flash está fuera del catálogo, así que cae en la tarifa tope
    // (1,5 / 9,0). El punto no es el número exacto: es que 462 tokens de
    // salida no pueden costar cero.
    const sinPensar = computeCostUsd({
      model: 'gemini-3.6-flash',
      inputTokens: 61,
      outputTokens: 387,
      totalTokens: 448,
    })

    const conPensar = computeCostUsd({
      model: 'gemini-3.6-flash',
      inputTokens: 61,
      outputTokens: 387 + 462,
      totalTokens: 910,
    })

    expect(conPensar.costUsd).toBeGreaterThan(sinPensar.costUsd)

    const precio = getModelPrice('gemini-3.6-flash')
    expect(conPensar.costUsd - sinPensar.costUsd).toBeCloseTo(
      (462 * precio.output) / 1e6,
      6,
    )
  })

  test('el remanente que el proveedor no desglosa se cobra, y como salida', () => {
    // La red para el PRÓXIMO campo, sea cual sea su nombre: si el total dice
    // más de lo que el desglose explica, la diferencia no se evapora.
    const r = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 61,
      outputTokens: 387,
      totalTokens: 910,
    })

    expect(r.residualTokens).toBe(462)
    expect(r.outputTokens).toBe(387 + 462)
    expect(r.totalTokens).toBe(910)
    // No es un costo repartido: los tokens vinieron medidos.
    expect(r.estimated).toBe(false)
  })

  test('un desglose consistente no inventa remanente', () => {
    const r = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 61,
      outputTokens: 388,
      totalTokens: 449,
    })

    expect(r.residualTokens).toBe(0)
    expect(r.outputTokens).toBe(388)
  })

  test('un total menor que el desglose no descuenta nada', () => {
    // El total manda solo hacia arriba. Si viniera más chico que la suma, el
    // dato roto es el total, y restar salida sería cobrar de menos otra vez.
    const r = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 1000,
      outputTokens: 1000,
      totalTokens: 500,
    })

    expect(r.residualTokens).toBe(0)
    expect(r.outputTokens).toBe(1000)
  })

  test('el remanente se avisa en vez de quedar como columna en cero', () => {
    const fuente = fs.readFileSync(
      path.join(SRC, 'services/ai/aiBudgetService.js'),
      'utf8',
    )

    expect(fuente).toContain('[AI PRICING] El proveedor cobró tokens que no desglosó')
  })

  test('la entrada cacheada se cobra al 10%, no al 100%', () => {
    // LA FILA REAL DE PRODUCCIÓN, la primera que se registró leyendo la clave:
    // agentTokens/repair, gemini-3.1-flash-lite, entrada 8525 de las cuales
    // 4075 vinieron de caché, salida 70.
    //
    // Gemini 2.5 en adelante cachea IMPLÍCITAMENTE, sin que nadie lo pida, y
    // Google pasa el ahorro solo. La llamada de reparación del agente reenvía
    // la conversación entera, así que casi la mitad de su prompt pega en
    // caché todas las veces.
    const conCache = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 8525,
      cachedInputTokens: 4075,
      outputTokens: 70,
      totalTokens: 8595,
    })

    const sinLeerlo = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 8525,
      outputTokens: 70,
      totalTokens: 8595,
    })

    // Lo que costaba la fila antes de leer la clave: USD 0,002236.
    expect(sinLeerlo.costUsd).toBeCloseTo(0.002236, 6)

    // Lo que cuesta de verdad: 4450 frescos a 0,25 + 4075 a 0,025 + 70 a 1,5.
    expect(conCache.costUsd).toBeCloseTo(
      (4450 * 0.25 + 4075 * 0.025 + 70 * 1.5) / 1e6,
      6,
    )
    expect(conCache.costUsd).toBeCloseTo(0.001319, 6)

    // 41% de sobrecobro. Y de más es tan malo como de menos: el disyuntor de
    // plataforma corta con ese número, y sobrestimar el gasto deja sin IA a
    // todos los comercios antes de tiempo.
    expect(sinLeerlo.costUsd / conCache.costUsd).toBeGreaterThan(1.4)
  })

  test('la tarifa de caché es la décima parte, modelo por modelo', () => {
    // Sale de la tabla de Google, no de un supuesto: gemini-3.8-flash cobra
    // 0,75 de entrada y 0,075 de caché; gemini-3.5-flash-lite, 0,30 y 0,03.
    for (const modelo of [
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
    ]) {
      const p = getModelPrice(modelo)
      expect(p.cachedInput).toBeCloseTo(p.input * 0.1, 8)
    }

    // Y un modelo fuera del catálogo también tiene tarifa de caché, o cobrar
    // la parte cacheada daría NaN.
    const desconocido = getModelPrice('gemini-9.9-inventado')
    expect(desconocido.cachedInput).toBeCloseTo(desconocido.input * 0.1, 8)
  })

  test('la parte cacheada sale de la entrada, no se suma', () => {
    // cachedContentTokenCount es un SUBCONJUNTO de promptTokenCount. Sumarlo
    // contaría dos veces los mismos tokens.
    const r = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 100,
      totalTokens: 1100,
    })

    expect(r.inputTokens).toBe(1000)
    expect(r.totalTokens).toBe(1100)
    expect(r.costUsd).toBeCloseTo((600 * 0.25 + 400 * 0.025 + 100 * 1.5) / 1e6, 8)
  })

  test('un caché mayor que la entrada no genera entrada negativa', () => {
    // Dato incoherente del proveedor: se topea. Cobrar de menos por un número
    // roto sería el mismo error que este archivo corrige.
    const r = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 100,
      cachedInputTokens: 5000,
      outputTokens: 10,
      totalTokens: 110,
    })

    expect(r.cachedInputTokens).toBe(100)
    // El costo viaja redondeado a 6 decimales, así que la expectativa se
    // redondea igual en vez de pedirle al test una precisión que la función no
    // promete.
    expect(r.costUsd).toBe(Number(((100 * 0.025 + 10 * 1.5) / 1e6).toFixed(6)))
    expect(r.costUsd).toBeGreaterThan(0)
  })

  test('sin caché nada cambia', () => {
    const conNull = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 1000,
      cachedInputTokens: null,
      outputTokens: 100,
      totalTokens: 1100,
    })

    const sinElCampo = computeCostUsd({
      model: 'gemini-3.1-flash-lite',
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
    })

    expect(conNull.costUsd).toBe(sinElCampo.costUsd)
    expect(conNull.cachedInputTokens).toBeNull()
  })

  test('UN SOLO archivo lee el desglose del proveedor', () => {
    // Esta es la causa raíz, no el síntoma. candidatesTokenCount se leía a
    // mano en cuatro archivos además del lector: aiVisionService,
    // aiAgentBrainService (dos veces) y pricingAiService. Agregar un campo
    // medido obligaba a tocar cinco lugares, así que no se agregaba — y
    // thoughtsTokenCount quedó afuera desde el día que Google lo publicó.
    const culpables = []

    for (const archivo of archivosDeCodigo()) {
      if (archivo.endsWith('aiUsageMetadata.js')) continue

      const codigo = sinComentarios(fs.readFileSync(archivo, 'utf8'))

      if (/candidatesTokenCount|thoughtsTokenCount|cachedContentTokenCount/.test(codigo)) {
        culpables.push(path.relative(process.cwd(), archivo))
      }
    }

    expect(culpables).toEqual([])
  })
})
