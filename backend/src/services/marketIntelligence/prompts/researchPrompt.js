/**
 * researchPrompt.js
 *
 * Prompt de la extracción de señales para webResearchSource.js. Separado del
 * cliente para poder iterar el texto sin tocar la lógica de parseo ni el
 * schema.
 *
 * ANTES BUSCABA EL MODELO; AHORA BUSCA TAVILY.
 *
 * Había un prompt previo que le pedía a Gemini investigar con Google Search
 * grounding. Ese camino está cerrado: la familia Gemini 3 tiene cuota de
 * grounding CERO en el nivel gratuito —el panel del proyecto lo muestra como
 * "Fundamentación de la búsqueda · Gemini 3 · 0/0"— así que la llamada
 * devolvía 429 siempre, con la clave llena de tokens. Ese prompt se retiró:
 * dejarlo era conservar la pregunta de un camino que no existe.
 *
 * Ahora Tavily trae las páginas y el modelo solo las ordena. Eso cambia una
 * cosa de fondo y para bien: cada señal sale de un texto que vino con su URL,
 * verificable, en vez de lo que el modelo recuerde.
 *
 * Principio que no cambia: el prompt NO le pide al modelo que calcule ningún
 * puntaje. Solo señales observables. El cálculo vive en
 * scoring/demandScoreEngine.js.
 *
 * Por eso las quejas cambiaron de forma. Antes se le pedía "solo las que
 * aparezcan en al menos dos extractos": eso es un JUICIO sobre qué es un
 * patrón, y contradecía el principio de arriba. Ahora se le pide el hecho
 * observable —la queja y en qué extractos está— y la regla del "dos" la aplica
 * webResearchSource, donde se puede leer, cambiar y testear.
 */

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {string} params.country
 */
function buildExtractionPrompt({ product, country }) {
  return `Vas a recibir extractos de páginas web reales sobre un producto,
cada uno con su título y su URL. Tu única tarea es ESTRUCTURAR lo que dicen
esos extractos en el JSON pedido por el schema — NO agregues información que
no esté explícita en ellos, ni uses lo que sepas de antes sobre el producto.

Producto analizado: "${product}"
Mercado objetivo: ${country}

Reglas estrictas:
1. searchIntent: contá cuántos extractos son de cada tipo — informativos
   (explican qué es), comerciales (comparan o recomiendan) o transaccionales
   (venden). Si no hay de un tipo, usá 0.
2. socialSignals.mentions: un número solo si los extractos dan una cifra
   verificable de menciones, opiniones o reseñas. Si no la dan, usá 0 y en
   engagement escribí "NO_DISPONIBLE".
3. trendDirection: solo si algún extracto dice explícitamente que el interés
   sube, se mantiene o baja. Que haya muchas páginas no significa que crezca.
   Si nadie lo dice, usá "INDETERMINADA".
4. complaints: TODA molestia, defecto, limitación o crítica que algún extracto
   mencione sobre el producto, aunque aparezca una sola vez. Incluí también las
   críticas suaves ("tarda en ablandarse", "el talle viene chico", "pesa"). En
   mentionedIn poné los NÚMEROS de los extractos que la mencionan. No juzgues
   si es un patrón: esa regla la aplica el sistema que recibe esto.
   Si de verdad ningún extracto menciona nada negativo, array vacío.
5. competition.level: derivalo de cuántos vendedores y marcas distintas
   aparecen en los extractos. knownBrands: solo marcas nombradas.
6. priceRange: solo si los extractos dan precios concretos CON moneda, y del
   mercado analizado. Si los precios son de otro país, omití el campo entero:
   un rango equivocado es peor que ninguno.

No inventes ningún dato que no esté en los extractos.`
}

export { buildExtractionPrompt }
