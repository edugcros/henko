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

/**
 * Lee un contador del proveedor SIN confundir "no vino" con "vino en cero".
 *
 * Antes esto devolvía 0 para las dos cosas y el llamador hacía `|| null`, con
 * lo cual un cero MEDIDO terminaba como "no se sabe". No es lo mismo, y la
 * diferencia se paga: computeCostUsd, al no ver desglose, reparte el total con
 * una proporción supuesta e inventa tokens de salida que no existieron.
 *
 * Reproducido contra la API, maxOutputTokens 1:
 *
 *   prompt 13 · candidates (NO VINO) · total 13   ← Google midió 13 y 0
 *   readUsage      → in 13 · out null
 *   computeCostUsd → in 10 · out 3 · estimated    ← los 13 medidos, a la basura
 *
 * Y en producción dejó cuatro filas con la firma exacta del reparto:
 * 8581 × 0,8 = 6865 de entrada y 1716 de salida que nunca ocurrieron, cobrados
 * a tarifa de salida, que es 5 o 6 veces la de entrada.
 */
const leer = value => {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
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

  const inputTokens = leer(usage.promptTokenCount)
  const visibleTokens = leer(usage.candidatesTokenCount)
  const thinkingTokens = leer(usage.thoughtsTokenCount)
  const declaredTotal = leer(usage.totalTokenCount)

  // Lo que el proveedor desglosó por nombre.
  const desglosada =
    visibleTokens === null && thinkingTokens === null
      ? null
      : (visibleTokens || 0) + (thinkingTokens || 0)

  // Y lo que su propia aritmética dice: total menos entrada ES la salida
  // facturable, sin importar en qué claves la haya repartido. Esto es lo que
  // recupera el caso de arriba —candidates ausente con total igual a prompt da
  // cero de salida, que es un dato, no una ausencia— y de paso captura
  // cualquier categoría de salida que Google agregue con un nombre nuevo.
  const porDiferencia =
    declaredTotal !== null && inputTokens !== null
      ? Math.max(0, declaredTotal - inputTokens)
      : null

  // Gana la mayor: si las dos vías coinciden da igual, y si difieren la culpa
  // es de una clave que no estamos leyendo, que se cobra igual.
  const outputTokens =
    porDiferencia !== null
      ? Math.max(porDiferencia, desglosada || 0)
      : desglosada

  // Entrada servida desde la caché de contexto. Hoy siempre viene vacío porque
  // HENKO no usa caché —verificado contra la API: la clave no aparece en la
  // respuesta— pero leerla no cuesta nada y el día que se active, el dato ya
  // está. Importa porque se factura con descuento: contarla como entrada plena
  // sería el error de este archivo, al revés.
  const cachedInputTokens = leer(usage.cachedContentTokenCount)

  const totalTokens = declaredTotal || (inputTokens || 0) + (outputTokens || 0)

  // Una llamada que no gastó nada no es un consumo.
  if (!totalTokens) return null

  return {
    // Sin `|| null`: un cero acá es un cero MEDIDO y tiene que llegar como
    // tal, o computeCostUsd lo toma por ausencia y reparte.
    inputTokens,
    outputTokens,
    visibleTokens,
    thinkingTokens,
    cachedInputTokens,
    totalTokens,
    // 'standard' o 'flex'/'priority' según el plan. Viene en toda respuesta
    // —medido— y es la explicación de dos facturas distintas por el mismo
    // trabajo, así que se guarda aunque hoy sea siempre el mismo valor.
    serviceTier: usage.serviceTier || null,

    /**
     * Cuántas búsquedas de Google ejecutó el modelo, que NO se pagan por token.
     *
     * LA UNIDAD ES LA CONSULTA, Y CAMBIÓ CON LA GENERACIÓN 3.
     *
     * En Gemini 2.5 y anteriores el grounding se facturaba POR PROMPT: una
     * respuesta con tres búsquedas adentro costaba una. Desde la 3 se factura
     * por CADA consulta que el modelo decide ejecutar, y HENKO corre 3.x. Por
     * eso se cuenta la longitud del arreglo y no "1 si hubo grounding".
     *
     * HOY ES SIEMPRE CERO, y no por olvido: el parámetro `tools` de callGemini
     * no lo pasa ningún llamador, porque con `tools` puesto la API devuelve
     * 429 en todos los modelos de la cadena — verificado de nuevo contra la
     * key de producción al escribir esto, los tres dieron 429.
     *
     * Se cuenta igual para que el día que eso cambie el costo se registre
     * SOLO, sin que nadie tenga que acordarse de cablear nada. Un costo que
     * depende de que alguien se acuerde es un costo que no se cobra.
     */
    groundingQueries:
      result?.groundingMetadata?.webSearchQueries?.length || 0,

    model: result?.model || null,
  }
}

// ACÁ VIVÍA sumUsage, Y SE BORRÓ A PROPÓSITO.
//
// Sumaba los desgloses de varias llamadas en uno solo y se quedaba con el
// modelo de la última que informara uno. Su propio comentario lo admitía:
// "si dos pasos corrieron en modelos distintos con tarifas distintas, el costo
// del conjunto queda calculado con una sola".
//
// POR QUÉ ERA GRAVE
//
// Entre gemini-3.6-flash (0,75/3,75) y gemini-3.1-flash-lite (0,25/1,50) hay
// 3x de tarifa, y quién responde no lo decide la configuración sino la cadena
// de respaldo — medido: 72 de 122 filas no eran el modelo pedido.
//
// Con un millón de tokens en cada uno, repartidos 80/20 entrada/salida:
//
//   por llamada   1,35 (3.6-flash) + 0,50 (3.1-flash-lite) = USD 1,85
//   consolidado   2M enteros a tarifa del último           = USD 1,00
//
// Consolidar registra el 54% del gasto y pierde el 46%, hacia abajo, que es el
// error que no se nota hasta la factura.
//
// POR QUÉ SE PUEDE BORRAR EN VEZ DE ARREGLAR
//
// Consolidar era un parche para una época en la que el consumo de una
// operación se registraba UNA sola vez al final. Eso ya no es así: desde
// AiProviderCall, la unidad contable es (operación, llamada), y cada llamada
// deja su fila con su propio modelo, su propia tarifa y su propio costo.
//
// Verificado contra producción, cuatro operaciones del agente con dos
// llamadas cada una:
//
//   op agent:…msg_d87f0262
//      main    gemini-3.1-flash-lite  USD 0,002166  tarifa salida 1,5
//      repair  gemini-3.1-flash-lite  USD 0,002236  tarifa salida 1,5
//      costo de la operación = la suma de las dos
//
// Cuando aparezca un paso nuevo, la forma correcta es una llamada más a
// recordAiConsumption con otro callId, no volver a fusionar desgloses. Por eso
// esto no queda deprecado: queda borrado, y un test estructural impide que
// vuelva. Una función que promedia modelos distintos, existiendo, se usa.
//
// No tenía un solo llamador en backend, admin ni website.

export default { readUsage }
