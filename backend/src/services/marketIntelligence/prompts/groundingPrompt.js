/**
 * groundingPrompt.js
 *
 * Prompt template para geminiGroundingSource.js. Separado del cliente para
 * poder iterar el texto sin tocar lógica de parsing/schema, y para poder
 * versionarlo/testearlo independientemente.
 *
 * Principio: el prompt NO le pide al modelo que calcule ningún score. Solo
 * le pide señales observables y trazables (con fuente). El cálculo ocurre
 * en scoring/demandScoreEngine.js.
 */

function buildGroundingPrompt({ product, country }) {
  return `Actuás como analista de investigación de mercado con acceso a
búsqueda real (Google Search grounding). Tu tarea es INVESTIGAR el
siguiente producto y escribir un resumen en prosa de lo que encontrás
realmente buscando — no estimes ni calcules ningún puntaje.

Producto a analizar: "${product}"
Mercado objetivo: ${country}

Buscá y reportá en prosa clara:
1. Qué tipo de consultas ves sobre este producto (informativas tipo "qué
   es X", comerciales tipo "mejor X", o transaccionales tipo "comprar X").
2. Qué se dice en redes/foros sobre este producto — menciones, quejas
   recurrentes, entusiasmo o desinterés.
3. Si el interés parece estar creciendo, estable, o decreciendo según lo
   que encontrás.
4. Quejas o problemas que se repitan en al menos dos fuentes distintas —
   una queja aislada no es un patrón, no la reportes como tal.
5. Qué marcas o vendedores compiten en esta categoría en ese mercado, y qué
   tan saturada parece según lo que encontrás.
6. Rango de precios que ves publicado, con la moneda. Si los precios que
   encontrás son de otro país, decilo en vez de convertirlos.

Si no encontrás evidencia real para alguno de estos puntos, decilo
explícitamente ("no encontré evidencia de...") en vez de inventar. No
agregues ningún puntaje numérico ni clasificación final — eso lo hace
otro proceso a partir de tu texto.`
}

/**
 * Prompt del paso 2: NO tiene acceso a tools/búsqueda. Su única tarea es
 * tomar el texto grounded del paso 1 (ya con evidencia real citada) y
 * estructurarlo en el JSON schema pedido. No debe agregar información
 * nueva que no esté en el texto de entrada.
 */
function buildExtractionPrompt() {
  return `Vas a recibir un resumen de investigación de mercado ya
redactado por otro proceso con acceso a búsqueda real. Tu única tarea es
ESTRUCTURAR ese texto en el JSON pedido por el schema de respuesta —
NO agregues información que no esté explícita en el texto recibido.

Reglas estrictas:
1. searchIntent: contá cuántas menciones de cada tipo de consulta
   (informational/commercial/transactional) aparecen explícitas en el
   texto. Si el texto no menciona un tipo, usá 0.
2. socialSignals.mentions: usá un número solo si el texto da una cifra o
   descripción cuantificable; si el texto dice "no encontré evidencia" o
   es ambiguo, usá 0 y en engagement escribí "NO_DISPONIBLE".
3. trendDirection: derivalo únicamente de lo que el texto dice
   explícitamente sobre la dirección del interés. Si el texto no lo
   menciona, usá "INDETERMINADA".
4. recurringComplaints: solo las quejas que el texto marca como
   repetidas en múltiples fuentes. Si el texto no reporta ninguna, devolvé
   un array vacío.
5. competition.level: derivalo de lo que el texto dice sobre cantidad de
   competidores y saturación. Si el texto no lo menciona, usá
   "INDETERMINADA". knownBrands: solo marcas nombradas explícitamente.
6. priceRange: solo si el texto da precios concretos CON moneda. Si los
   precios son de otro mercado que el analizado, o no hay cifras, omití el
   campo entero — un rango de precios equivocado es peor que ninguno.

No inventes ningún dato que no esté en el texto de entrada.`
}

export { buildGroundingPrompt, buildExtractionPrompt }
