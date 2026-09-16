// 📁 src/services/ai/aiUsageMetadata.js
//
// Lee el desglose de tokens que devuelve el proveedor y lo suma cuando una
// operación hizo más de una llamada.
//
// POR QUÉ EXISTE
//
// Gemini devuelve promptTokenCount y candidatesTokenCount además del total.
// Varios servicios los descartaban y guardaban solo el total, con lo cual el
// costo se calculaba repartiendo entrada y salida con una proporción supuesta.
// La salida cuesta cinco veces la entrada, así que ese reparto es justo donde
// más se equivoca uno: dos operaciones con el mismo total pueden costar muy
// distinto.
//
// Tener el desglose medido no es un lujo — es la diferencia entre un panel que
// informa y uno que aproxima. El ledger ya marca cuál es cuál en `costEstimated`;
// esto reduce cuántas filas caen del lado estimado.
//
// La forma es la misma que espera recordAiConsumption, para que propagarla sea
// pasar el objeto y no traducir en cada llamador.

const num = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
}

/**
 * Desglose de una respuesta del proveedor.
 *
 * Devuelve null cuando no hay nada que leer: distinguir "no vino" de "vino en
 * cero" importa, porque cero entrada y cero salida es un desglose válido y
 * significa otra cosa.
 *
 * LOS TOKENS DE PENSAMIENTO SON SALIDA
 *
 * candidatesTokenCount cuenta solo el texto que se ve. Lo que el modelo razonó
 * antes de contestar viaja aparte, en thoughtsTokenCount, NO está incluido ahí
 * —y sí está incluido en totalTokenCount—. Google lo factura a tarifa de
 * salida, que es la cara: 3,75 contra 0,75 por millón en 3.8-flash.
 *
 * Medido contra la API, mismo prompt, con thinkingBudget 512:
 *
 *   gemini-3.6-flash       prompt 61 · candidates 387 · thoughts 462 · total 910
 *   gemini-3.5-flash-lite  prompt 61 · candidates 388 · thoughts   0 · total 449
 *
 * Y medido contra la base de producción: de 122 filas de consumo con desglose,
 * 40 tenían total > entrada + salida. 23.836 tokens de pensamiento sin contar
 * contra 2.910 de salida contados — el 89% de la salida de esas filas. El
 * costo registrado de todo el histórico era USD 0,459 contra 0,556 reales:
 * 21,2% de menos, y el disyuntor de plataforma decide con ese número.
 *
 * Por eso outputTokens los SUMA. thinkingTokens queda aparte para poder
 * explicar por qué la salida de una fila es diez veces su texto visible, pero
 * no es una tercera categoría de precio: no existe tal cosa en la factura.
 */
export const readUsage = result => {
  const usage = result?.usageMetadata
  if (!usage) return null

  const inputTokens = num(usage.promptTokenCount)
  const visibleTokens = num(usage.candidatesTokenCount)
  const thinkingTokens = num(usage.thoughtsTokenCount)
  const outputTokens = visibleTokens + thinkingTokens

  // Entrada servida desde la caché de contexto. Hoy siempre viene vacío porque
  // HENKO no usa caché —verificado contra la API: la clave no aparece en la
  // respuesta— pero leerla no cuesta nada y el día que se active, el dato ya
  // está. Importa porque se factura con descuento: contarla como entrada plena
  // sería el error de este archivo, al revés.
  const cachedInputTokens = num(usage.cachedContentTokenCount)

  const totalTokens = num(usage.totalTokenCount) || inputTokens + outputTokens

  if (!totalTokens) return null

  return {
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
    visibleTokens: visibleTokens || null,
    thinkingTokens: thinkingTokens || null,
    cachedInputTokens: cachedInputTokens || null,
    totalTokens,
    // 'standard' o 'flex'/'priority' según el plan. Viene en toda respuesta
    // —medido— y es la explicación de dos facturas distintas por el mismo
    // trabajo, así que se guarda aunque hoy sea siempre el mismo valor.
    serviceTier: usage.serviceTier || null,
    model: result?.model || null,
  }
}

/**
 * Suma los desgloses de varias llamadas en uno solo.
 *
 * Hace falta donde una operación llama al proveedor más de una vez —el
 * grounding de mercado hace dos, y el agente puede sumar una de reparación— y
 * el consumo se registra una sola vez al final.
 *
 * El modelo que queda es el de la última llamada que informó uno. Si dos pasos
 * corrieron en modelos distintos con tarifas distintas, el costo del conjunto
 * queda calculado con una sola: es una aproximación, y es mejor que la
 * alternativa actual de repartir el total entero con una proporción inventada.
 */
export const sumUsage = (...usages) => {
  const presentes = usages.filter(Boolean)
  if (!presentes.length) return null

  // Si a alguna llamada le faltó el desglose, sumar solo las que lo tienen
  // daría un total menor al real. En ese caso se informa el total —que sí es
  // correcto— y se deja el desglose afuera para que el costo se marque como
  // estimado en vez de mentir con precisión.
  const completos = presentes.every(u => u.inputTokens !== null && u.outputTokens !== null)

  const totalTokens = presentes.reduce((sum, u) => sum + u.totalTokens, 0)
  const sumar = campo => {
    const total = presentes.reduce((s, u) => s + (Number(u[campo]) || 0), 0)
    return total || null
  }

  return {
    inputTokens: completos ? presentes.reduce((s, u) => s + u.inputTokens, 0) : null,
    outputTokens: completos ? presentes.reduce((s, u) => s + u.outputTokens, 0) : null,
    visibleTokens: sumar('visibleTokens'),
    thinkingTokens: sumar('thinkingTokens'),
    cachedInputTokens: sumar('cachedInputTokens'),
    totalTokens,
    serviceTier: presentes.map(u => u.serviceTier).filter(Boolean).pop() || null,
    model: presentes.map(u => u.model).filter(Boolean).pop() || null,
  }
}

export default { readUsage, sumUsage }
