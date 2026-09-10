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
 */
export const readUsage = result => {
  const usage = result?.usageMetadata
  if (!usage) return null

  const inputTokens = num(usage.promptTokenCount)
  const outputTokens = num(usage.candidatesTokenCount)
  const totalTokens = num(usage.totalTokenCount) || inputTokens + outputTokens

  if (!totalTokens) return null

  return {
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
    totalTokens,
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

  return {
    inputTokens: completos ? presentes.reduce((s, u) => s + u.inputTokens, 0) : null,
    outputTokens: completos ? presentes.reduce((s, u) => s + u.outputTokens, 0) : null,
    totalTokens,
    model: presentes.map(u => u.model).filter(Boolean).pop() || null,
  }
}

export default { readUsage, sumUsage }
