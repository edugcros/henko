/**
 * shoppingSource.js
 *
 * Precios reales del mercado, vía Tavily.
 *
 * POR QUÉ UN ADAPTER Y NO UNA INTEGRACIÓN DIRECTA:
 * Este mercado de proveedores es inestable, y ya se cobró dos: MercadoLibre
 * cerró su API de búsqueda a integradores, y scrape.do agotó su cuota mensual.
 * En un benchmark de agosto 2026 solo 3 de 16 proveedores tenían un camino
 * funcional. Acoplar el análisis a uno puntual significa reescribir esta capa
 * cada vez que se cae; con el adapter, el cambio a Tavily no tocó ni el
 * scoring ni el panel.
 *
 * Cambiar de proveedor es implementar un adapter nuevo y cambiar
 * SHOPPING_PROVIDER — nada más de este paquete se entera. Eso ya se ejerció:
 * scrape.do agotó su cuota mensual y el reemplazo por Tavily no tocó ni el
 * scoring ni el panel.
 *
 * El default hoy es Tavily: un crédito por búsqueda contra los dos o tres
 * pedidos que gastaba scrape.do, con el mismo plan gratuito de 1.000 mensuales.
 * A cambio no devuelve ofertas estructuradas sino páginas con texto, así que el
 * precio se extrae de ahí y queda atado al link del que salió — verificable,
 * que es lo que lo hace defendible.
 *
 * Variables de entorno:
 *   SHOPPING_PROVIDER   'tavily' (default) | 'none' para apagarlo
 *   TAVILY_API_KEY
 */

import logger from '../../../../config/logger.js'

import { hasTavilyKey, tavilySearch, TAVILY_COUNTRY } from './tavilyClient.js'

/**
 * Todo lo ajustable sale por variable de entorno, con el default medido entre
 * paréntesis. Nada de números sueltos en medio del código: el día que Tavily
 * cambie de endpoint o haya que ampliar la muestra, no se toca un archivo de
 * lógica.
 */
const num = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const MAX_OFFERS = num('SHOPPING_MAX_OFFERS', 40)

/**
 * Cuándo vale la pena gastar el segundo crédito de búsqueda.
 *
 * ERA 3 —"debajo de esto la mediana describe anécdotas"— Y LA INTENCIÓN ESTABA
 * BIEN, PERO EL REINTENTO NO LA CUMPLÍA.
 *
 * Medido sobre 16 productos, con el gasto de herramientas ya contabilizado:
 *
 *   ofertas de la búsqueda abierta   reintentos   ganaron algo
 *   0                                    4            1  (+7 ofertas)
 *   1                                    4            0
 *
 * Todo reintento que sirvió partía de CERO. Los cuatro que partían de una
 * oferta ganaron nada: el filtro de país no busca en otro lado, filtra el
 * mismo índice, así que si la consulta abierta encontró una sola cosa, la
 * filtrada encuentra esa misma o ninguna.
 *
 * O sea que con el umbral en 3, la mitad de los reintentos eran crédito tirado
 * — y el caso que justifica la función (una consulta que no devuelve NADA y el
 * filtro de país rescata con siete precios) se sigue cubriendo igual con el
 * umbral en 1.
 *
 * El ahorro: la mitad de los créditos de reintento, sin perder una sola
 * oferta. Sobre el consumo medido —4 créditos por análisis— eso es medio
 * crédito menos en los análisis que hoy reintentan.
 *
 * Sigue siendo configurable: subirlo vuelve al comportamiento de antes si
 * alguna vez la medición cambia.
 */
const MIN_SAMPLE_FOR_RETRY = num('SHOPPING_MIN_SAMPLE', 1)

/** Muestra mínima para que el descarte de atípicos signifique algo. */
const MIN_SAMPLE_FOR_OUTLIERS = num('SHOPPING_MIN_SAMPLE_OUTLIERS', 5)

/**
 * Debajo de esta muestra no se publican cuartiles.
 *
 * Con dos precios, p25 y p75 son interpolaciones lineales entre esos dos
 * puntos y la mediana es su promedio: tres números que suenan a estadística
 * de mercado y describen una recta entre dos datos. En una corrida real
 * salieron min $78.699, p25 $86.767, mediana $94.835, p75 $102.903, max
 * $110.971 — cinco cifras distintas nacidas de dos precios, y los dos
 * equivocados.
 *
 * El mínimo, la mediana y el máximo se siguen publicando: con dos datos son
 * el más barato, el del medio y el más caro, que es exactamente lo que dicen.
 */
const MIN_SAMPLE_FOR_QUARTILES = num('SHOPPING_MIN_SAMPLE_QUARTILES', 5)

/**
 * Lo que se le agrega al nombre del producto para empujar la búsqueda hacia
 * páginas de venta y no hacia notas o reseñas, que no traen precio.
 */
const SEARCH_SUFFIX =
  String(process.env.SHOPPING_QUERY_SUFFIX || '').trim() || 'precio comprar'

/**
 * La moneda no es decoración: se usa para descartar precios que están en otra
 * moneda antes de que entren a la mediana. Un US$ 120 mezclado entre pesos
 * rompe los percentiles enteros.
 */
const MARKET_BY_COUNTRY = {
  AR: { hl: 'es', currency: 'ARS' },
  MX: { hl: 'es', currency: 'MXN' },
  CL: { hl: 'es', currency: 'CLP' },
  CO: { hl: 'es', currency: 'COP' },
  UY: { hl: 'es', currency: 'UYU' },
  PE: { hl: 'es', currency: 'PEN' },
  BR: { hl: 'pt', currency: 'BRL' },
}

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {string} params.country - ISO-2
 * @returns {Promise<ShoppingSignals>}
 *
 * @typedef {Object} ShoppingSignals
 * @property {boolean} available
 * @property {string} provider
 * @property {number} offerCount
 * @property {number} merchantCount     - vendedores únicos
 * @property {Object} priceStats        - min, p25, median, p75, max, currency
 * @property {Array} offers             - muestra para mostrar en el panel
 */
export async function getShoppingSignals({
  product,
  country,
  brand = null,
  toolUsage = null,
}) {
  const provider = (process.env.SHOPPING_PROVIDER || 'tavily').trim().toLowerCase()

  if (provider === 'none') {
    return { available: false, reason: 'NO_DISPONIBLE: SHOPPING_PROVIDER deshabilitado' }
  }

  const locale = MARKET_BY_COUNTRY[country]
  if (!locale) {
    return { available: false, reason: `NO_DISPONIBLE: país ${country} sin mercado configurado` }
  }

  const adapter = ADAPTERS[provider]
  if (!adapter) {
    return { available: false, reason: `NO_DISPONIBLE: proveedor "${provider}" no implementado` }
  }

  const offers = await adapter({ product, locale, country, brand, toolUsage })

  if (!offers) {
    return { available: false, reason: `NO_DISPONIBLE: ${provider} no devolvió resultados` }
  }

  // 0 ofertas es un DATO (nadie lo vende online en ese mercado), no una falla.
  if (offers.length === 0) {
    return {
      available: true,
      provider,
      offerCount: 0,
      merchantCount: 0,
      priceStats: null,
      offers: [],
    }
  }

  return {
    available: true,
    provider,
    offerCount: offers.length,
    merchantCount: new Set(offers.map(o => o.merchant).filter(Boolean)).size,
    priceStats: computePriceStats(offers),
    offers: offers.slice(0, 10),
  }
}

// ─── Adapters por proveedor ──────────────────────────────

/**
 * Dominio de cada mercado, para el reintento sin filtro de país.
 *
 * Medido contra la API: `country` acota muy bien —quince de diecinueve
 * resultados argentinos— pero en algunas consultas devuelve CERO resultados,
 * y "casco de moto integral" fue una de ellas. Sin el filtro siempre hay
 * respuesta, pero entran tiendas de otros países que también escriben con "$":
 * un precio mexicano o chileno leído como pesos argentinos rompe la mediana
 * igual que un dólar. De ahí que el reintento se quede solo con el dominio
 * local.
 */
const COUNTRY_TLD = {
  AR: '.ar',
  MX: '.mx',
  CL: '.cl',
  CO: '.co',
  UY: '.uy',
  PE: '.pe',
  BR: '.br',
}

const ADAPTERS = {
  /**
   * Tavily — buscador web para agentes.
   * Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
   *
   * NO devuelve ofertas estructuradas: da páginas con su URL y un fragmento de
   * texto. El precio se saca de ese fragmento y queda atado al link del que
   * salió, así que el comerciante puede abrirlo y verificarlo — que es lo que
   * hace defendible este dato y no una estimación.
   *
   * Contra Google Shopping pierde en tamaño de muestra: cinco a diez
   * observaciones contra cuarenta ofertas. Gana en costo (un crédito por
   * análisis contra dos o tres pedidos) y en que no se agota a mitad de mes.
   */
  async tavily({ product, locale, country, brand, toolUsage = null }) {
    if (!hasTavilyKey()) return null

    // El acumulador viaja hasta el cliente, que es el único que sabe cuántos
    // créditos costó cada llamada (depende de la profundidad configurada).
    const buscar = async extra =>
      tavilySearch({
        query: `${product} ${SEARCH_SUFFIX}`.trim(),
        language: locale.hl,
        source: 'shoppingSource',
        toolUsage,
        ...extra,
      })

    try {
      const pais = TAVILY_COUNTRY[country]
      const tld = COUNTRY_TLD[country]

      // El país va en la consulta, no en el filtro `country`.
      //
      // Medido contra la API sobre seis productos: con `country` puesto, CINCO
      // de las seis consultas devolvieron cero resultados —la sexta devolvió
      // doce precios, así que cuando funciona es excelente, pero es todo o
      // nada—. La consulta abierta acotada por dominio local respondió en las
      // seis y dio 22 precios contra 12.
      // El dominio local se exige SIEMPRE, venga la tanda de donde venga.
      //
      // Con el filtro `country` puesto igual entraron walmart.com a US$ 3 y
      // bodegaaurrera.com.mx a 2.450 pesos mexicanos, mezclados entre precios
      // argentinos: la mediana de la Coca-Cola se desplomó de $5.800 a $3.875.
      // El parámetro de país de Tavily no garantiza el país de la tienda.
      const soloLocales = resultados =>
        tld
          ? resultados.filter(r => (hostnameOf(r?.url) || '').endsWith(tld))
          : resultados

      const abiertos = await buscar({
        query: `${product} ${SEARCH_SUFFIX} ${pais || ''}`.trim(),
      })

      let ofertas = normalizeTavilyResults(soloLocales(abiertos), locale, product, brand)

      // Solo si la búsqueda abierta no trajo NADA. Ver MIN_SAMPLE_FOR_RETRY:
      // reintentar con una oferta encontrada no agregó ninguna en 4 de 4
      // casos medidos, porque el filtro de país recorta el mismo índice en vez
      // de buscar en otro.
      if (ofertas.length < MIN_SAMPLE_FOR_RETRY && pais) {
        const conPais = await buscar({ country: pais })
        ofertas = mergeOffers(
          ofertas,
          normalizeTavilyResults(soloLocales(conPais), locale, product, brand),
        )
      }

      return ofertas
    } catch (error) {
      logger.warn('[shoppingSource] tavily falló', {
        status: error?.response?.status,
        message: error.message,
      })
      return null
    }
  },
}

// ─── Normalización ───────────────────────────────────────

/**
 * Resultados de Tavily → la misma forma de oferta que el resto del paquete
 * espera. Nada de esto sabe que cambió el proveedor.
 *
 * El vendedor sale del dominio: si el precio lo publica tiendaoficial.com.ar,
 * eso es lo que hay que mostrar. Y una página por vendedor: diez resultados de
 * la misma tienda son una tienda, no diez competidores — contarlos como diez
 * inflaría el conteo de vendedores, que es justo lo que mide competencia.
 */
function normalizeTavilyResults(results, locale, product = '', brand = null) {
  const porDominio = new Map()
  const palabras = identifyingWords(product)

  for (const item of Array.isArray(results) ? results : []) {
    const merchant = hostnameOf(item?.url)
    if (!merchant || porDominio.has(merchant)) continue

    // Un listado de categoría o de marca no es una ficha de producto: su
    // precio es el de otra cosa que estaba en la misma página.
    if (isListingPage(item?.url)) continue

    // Si el catálogo sabe la marca, la página tiene que nombrarla.
    if (!mentionsBrand(item, brand)) continue

    // La página tiene que ser del producto, no de otro que comparta los
    // adjetivos de la consulta.
    if (!mentionsProduct(item, palabras)) continue

    // Un pack por cinco no es el precio del kilo.
    if (looksLikeBundle(item, product)) continue

    const encontrado = findPriceInText(
      `${item?.title || ''} ${item?.content || ''}`,
      locale,
    )

    if (!encontrado) continue

    porDominio.set(merchant, {
      title: String(item.title || '').slice(0, 200),
      price: encontrado.price,
      currency: encontrado.currency,
      merchant,
      rating: null,
      reviewCount: null,
      link: item.url || null,
    })
  }

  return [...porDominio.values()].slice(0, MAX_OFFERS)
}

/** Une dos tandas sin repetir tienda: el conteo de vendedores mide competencia. */
function mergeOffers(primeras, segundas) {
  const porDominio = new Map(primeras.map(o => [o.merchant, o]))

  for (const oferta of segundas) {
    if (!porDominio.has(oferta.merchant)) porDominio.set(oferta.merchant, oferta)
  }

  return [...porDominio.values()].slice(0, MAX_OFFERS)
}

/** Palabras que describen presentación o variante, no qué es la cosa. */
const NOISE_WORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'para', 'por', 'y', 'o',
  'a', 'en', 'un', 'una', 'al', 'su', 'x', 'talle', 'talles', 'medida',
  'medidas', 'color', 'colores', 'pack', 'unidad', 'unidades', 'combo', 'set',
  'kit', 'modelo', 'nuevo', 'nueva', 'original', 'importado', 'oferta',
  'promo', 'envio', 'gratis', 'cuotas', 'negro', 'blanco', 'rojo', 'azul',
  'verde', 'gris', 'amarillo', 'rosa', 'marron', 'beige', 'bicolor',
])

const sinAcentos = texto =>
  String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * El sustantivo que dice QUÉ es el producto: la primera palabra con peso del
 * título.
 *
 * Buscando "Campera De Cuero Sintético Biker Bicolor Blanco Y Suela", Tavily
 * devolvió en producción unos BOTINES "de cuero sintético suela" y una
 * pantubota "de cuero sintético gamuzado suela": los atributos coincidían con
 * la consulta, y entraron a la muestra con $18.473 y $89.999 contra una
 * campera de $157.499. Dos de tres precios eran de otra cosa.
 *
 * Los atributos no sirven para filtrar —son justo lo que comparten categorías
 * distintas—. El sustantivo sí.
 */
/**
 * Materiales y acabados. Son justo lo que comparten categorías distintas
 * —botines y camperas de "cuero sintético"— así que nunca alcanzan solos para
 * decir que una página es del producto buscado.
 */
const ATTRIBUTE_WORDS = new Set([
  'cuero', 'sintetico', 'sintetica', 'eco', 'ecocuero', 'gamuzado', 'algodon',
  'lana', 'acero', 'inoxidable', 'inox', 'plastico', 'madera', 'vidrio',
  'metal', 'aluminio', 'goma', 'tela', 'lino', 'seda', 'nylon', 'poliester',
  'suela', 'liviano', 'pesado', 'grande', 'chico', 'mediano', 'premium',
  'clasico', 'clasica', 'deportivo', 'deportiva', 'urbano', 'urbana',
])

function significantTokens(product) {
  return sinAcentos(product)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !NOISE_WORDS.has(w))
    .filter(w => !/\d/.test(w))
    .filter(w => w.length > 2)
}

/**
 * Las palabras con las que se decide si una página es del producto: el
 * sustantivo, y la que le sigue cuando no es un material.
 *
 * El sustantivo solo alcanzaba para sacar los botines, pero dejaba afuera
 * media Coca-Cola: buscando "Gaseosa Coca-Cola Original Taste", las páginas
 * tituladas "Coca Cola 2.25L" no dicen "gaseosa" y caían. La segunda palabra
 * suele ser la marca —"coca"— y ahí sí identifica. Cuando es un material
 * —"cuero"— no se acepta sola, que es exactamente lo que dejaba pasar botines
 * y pantubotas de cuero sintético.
 */
function identifyingWords(product) {
  const tokens = significantTokens(product)
  if (tokens.length === 0) return []

  const palabras = [tokens[0]]

  if (tokens[1] && !ATTRIBUTE_WORDS.has(tokens[1])) palabras.push(tokens[1])

  return palabras
}

/**
 * Packs y bultos: lo que importa es CUÁNTAS unidades trae, no si dice "pack".
 *
 * Buscando "Yerba Mate Playadito 1kg" entraron páginas de pack por cinco a
 * $27.200 y $38.000 junto a los kilos sueltos de $4.100: la mediana aguanta,
 * pero el "más caro" del mercado pasa a ser un precio de otra cosa.
 *
 * La primera versión resolvía eso con un interruptor: si la consulta pedía un
 * pack, no filtraba nada. En producción, analizando "Yerba Mate Playadito
 * Elaborada con Palo 1kg Pack x 3 Unidades", el interruptor se apagó y la
 * muestra quedó formada por un kilo suelto a $4.000, un pack de diez a $28.000
 * y uno de cinco a $25.440. Mediana $25.440, mínimo $4.000: tres precios de
 * tres productos distintos, ninguno del pack por tres. Y con tres datos Tukey
 * no corre —pide cinco—, así que el $4.000 sobrevivió hasta la tarjeta de
 * rentabilidad.
 *
 * Comparar un pack de tres contra un kilo suelto no es un outlier: es otra
 * unidad de venta. Se comparan cantidades.
 */
const BUNDLE_HINTS = /\b(pack|packs|bulto|combo|caja\s?x)\b/i

/**
 * Páginas de LISTADO, no de producto.
 *
 * Analizando "Gorra Fox Racing Negra con Logo Blanco" las dos únicas ofertas
 * fueron `motordos.com.ar/marca-fox-racing-21` —la portada de la marca, donde
 * el precio más visible era el de una campera— y
 * `listado.mercadolibre.com.ar/gorra-fox-hombre`, que son los resultados de
 * una búsqueda. De ahí salieron $110.971 y $78.699 para una gorra, y con dos
 * datos Tukey no corre.
 *
 * Una página de categoría siempre tiene un precio a la vista, así que el
 * parser encuentra uno y no falla; encuentra el precio equivocado, que es
 * peor. El precio de un listado no es el precio de nada en particular.
 *
 * Se filtra por la forma de la URL, que es la señal confiable: la primera
 * palabra del título de un listado y la de una ficha de producto se parecen
 * demasiado.
 */
const LISTING_HOST = /^(listado|listing|lista)\./i

/**
 * No se incluyen los segmentos de una sola letra —el `/b/` de eBay es su
 * ruta de categoría— porque se llevan puesta cualquier URL corta legítima:
 * agregarlos hizo fallar al instante el test de `otra.com.ar/c`. Además, esos
 * sitios ya quedan afuera por el filtro de dominio local.
 */
const LISTING_PATH =
  /(^|\/)(marcas?|categorias?|category|categories|collections?|coleccion(es)?|search|buscar|busqueda|resultados|brands?)(\/|-|$|\?)/i

/**
 * Marcas de ficha de producto, que le ganan a las de listado.
 *
 * Shopify publica el mismo producto en `/products/x` y en
 * `/collections/gorras/products/x`: las dos son la ficha. Sin esta guarda, la
 * segunda forma —que es la que suele indexarse— se descartaría por decir
 * "collections", y perderíamos precios buenos de cualquier tienda Shopify.
 */
const PRODUCT_PATH = /(^|\/)(productos?|products?|item|dp)(\/|$)|-p-\d|\/p-?\d/i

function isListingPage(url) {
  const texto = String(url || '')
  if (!texto) return false

  let parsed
  try {
    parsed = new URL(texto)
  } catch {
    return false
  }

  if (LISTING_HOST.test(parsed.hostname)) return true
  if (PRODUCT_PATH.test(parsed.pathname)) return false

  return LISTING_PATH.test(parsed.pathname)
}

/** De dónde sale el multiplicador, en orden de preferencia. */
const PACK_QTY_PATTERNS = [
  /\b(?:pack|packs|bulto|combo|caja)\s*x\s*(\d{1,3})\b/i,
  /\bx\s*(\d{1,3})\s*(?:u|un|unid|unidades)\b/i,
  /\b(\d{1,3})\s*unidades\b/i,
]

/**
 * Cuántas unidades trae el texto.
 *
 *   "Pack x 3 Unidades" → 3
 *   "1kg" (sin palabra de pack) → 1
 *   "Pack ahorro" (dice pack, no dice cuántas) → null
 *
 * El null es su propio caso: no es uno, y no es comparable con nada.
 */
function packSize(text) {
  const texto = String(text || '')

  for (const patron of PACK_QTY_PATTERNS) {
    const m = texto.match(patron)
    if (m) {
      const qty = Number(m[1])
      if (Number.isFinite(qty) && qty > 0) return qty
    }
  }

  return BUNDLE_HINTS.test(texto) ? null : 1
}

/**
 * ¿Este resultado vende otra cantidad que la consultada?
 *
 * Cuando la consulta misma es ambigua —dice "pack" sin decir cuántas— no hay
 * con qué comparar y no se filtra: es preferible una muestra ruidosa que el
 * comerciante puede mirar oferta por oferta, a cero resultados por una
 * ambigüedad del propio título.
 */
function looksLikeBundle(item, product) {
  const pedidas = packSize(product)
  if (pedidas === null) return false

  return packSize(`${item?.title || ''} ${item?.url || ''}`) !== pedidas
}

/**
 * La marca, exigida en el título o la URL.
 *
 * Es el filtro de relevancia que funciona, y el único: medido contra la API,
 * pidiendo "Gorra Fox Racing Negra con Logo Blanco" volvieron 20 páginas y
 * solo UNA era de una gorra Fox. Las otras diecinueve decían "gorra", decían
 * "negra", decían "racing" y decían "logo" —todas las palabras de la
 * consulta menos la que importa— y eran de PUMA, Alpinestars, 226ERS, Armani
 * y un sitio de stickers.
 *
 * No se busca en el cuerpo de la página: nombrar la marca al pasar es
 * demasiado fácil. En el título o en la URL es una afirmación de qué vende
 * esa página.
 *
 * Alcanza con el primer token de la marca: "Fox Racing" se publica muchas
 * veces como "Fox" a secas, y exigir "racing" dejaría afuera fichas buenas.
 */
function mentionsBrand(item, brand) {
  if (!brand) return true

  const token = sinAcentos(brand).split(/\s+/).filter(Boolean)[0]
  if (!token || token.length < 2) return true

  return sinAcentos(`${item?.title || ''} ${item?.url || ''}`).includes(token)
}

/** ¿Esta página habla del producto, o de otro que comparte los adjetivos? */
function mentionsProduct(item, palabras) {
  if (!palabras.length) return true

  const texto = sinAcentos(`${item?.title || ''} ${item?.url || ''}`)

  // Tolera el plural: "camperas" cuando se buscó "campera".
  return palabras.some(
    p => texto.includes(p) || texto.includes(p.replace(/s$/, '')),
  )
}

function hostnameOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Busca un precio dentro de un texto corrido.
 *
 * Tres decisiones que evitan que esto mienta:
 *
 *   - Exige marca de moneda. Un número suelto en una descripción puede ser un
 *     modelo, una medida o un año.
 *
 *   - Descarta las cuotas. "12 cuotas sin interés de $ 7.499" no es el precio
 *     del producto, y tomarlo hundiría la mediana a una fracción de la real.
 *
 *   - Descarta lo que esté en otra moneda que la del mercado consultado. Un
 *     US$ 120 mezclado entre precios en pesos rompe la mediana y los
 *     percentiles enteros: no son comparables y no hay tipo de cambio acá.
 */
function findPriceInText(texto, locale) {
  const limpio = String(texto || '').replace(/\s+/g, ' ')
  if (!limpio) return null

  const patron = /(us\$|u\$s|usd|ar\$|ars|r\$|\$)\s?([\d][\d.,]{1,14})/gi
  const esperada = locale?.currency || 'ARS'

  for (const match of limpio.matchAll(patron)) {
    // Solo la oración en curso. Con una ventana fija de 40 caracteres, el
    // "sin interés" de la cuota anterior seguía visible cuando llegaba el
    // precio real —"12 cuotas sin interés de $ 7.499. Precio $ 89.999"— y
    // terminaba descartando los dos.
    const ventana = limpio.slice(Math.max(0, match.index - 40), match.index)
    const corte = ventana.lastIndexOf('. ')
    const antes = corte === -1 ? ventana : ventana.slice(corte + 2)

    // "cuotas de", "12x", "por mes": no es el precio del producto.
    if (/(cuota|cuotas|x\s?\d{1,2}\s?$|sin inter[eé]s|por mes|\/mes|mensual)/i.test(antes)) {
      continue
    }

    // Umbrales y promociones. Visto en una página real: "Envios GRATIS x
    // compra de mas de $100mil" dejó un precio de CIEN PESOS en una campera,
    // y con eso el escenario "al más barato" de la rentabilidad pasa a ser
    // fantasía.
    if (
      /(env[ií]o|env[ií]os|gratis|compras? (de )?(mas|m[áa]s) de|superiores? a|a partir de|descuento|ahorr|reintegro|tope|m[íi]nimo de)/i.test(
        antes,
      )
    ) {
      continue
    }

    // "$100mil", "$2 millones": el número escrito no es el número. Antes de
    // adivinar el factor, se descarta.
    const despues = limpio.slice(match.index + match[0].length, match.index + match[0].length + 12)
    if (/^\s?(mil|millon|millones|k\b)/i.test(despues)) continue

    const marca = match[1].toLowerCase()
    const moneda =
      marca.startsWith('us') || marca === 'u$s' || marca === 'usd'
        ? 'USD'
        : marca === 'r$'
          ? 'BRL'
          : esperada

    if (moneda !== esperada) continue

    const price = parsePriceFromText(match[2])
    if (price === null) continue

    return { price, currency: moneda }
  }

  return null
}

/**
 * Precio escrito por una persona, con un solo separador ambiguo.
 *
 * `parsePrice` alcanza cuando el proveedor manda el número ya limpio, pero con
 * texto libre hay un caso que resuelve mal: "$ 89.999" es ochenta y nueve mil
 * en Argentina y lo leía como ochenta y nueve con noventa y nueve centésimas —
 * un precio mil veces menor entrando a la mediana y a la tarjeta de
 * rentabilidad.
 *
 * La regla: con un solo separador, si lo que sigue son exactamente tres
 * dígitos es separador de miles; con uno o dos, es decimal. Con los dos
 * separadores presentes manda el de más a la derecha, como antes.
 */
function parsePriceFromText(texto) {
  const limpio = String(texto || '').replace(/[^\d.,]/g, '')
  if (!limpio) return null

  const puntos = (limpio.match(/\./g) || []).length
  const comas = (limpio.match(/,/g) || []).length

  if (puntos && comas) return parsePrice(limpio)

  const separador = puntos ? '.' : comas ? ',' : null

  if (!separador) {
    const entero = Number(limpio)
    return Number.isFinite(entero) && entero > 0 ? entero : null
  }

  const partes = limpio.split(separador)
  const ultima = partes[partes.length - 1]

  // Tres dígitos al final, o más de un separador: son miles.
  const esMiles = ultima.length === 3 || partes.length > 2

  const normalizado = esMiles
    ? partes.join('')
    : `${partes.slice(0, -1).join('')}.${ultima}`

  const valor = Number(normalizado)
  return Number.isFinite(valor) && valor > 0 ? valor : null
}

function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  // "$ 189.999,00" (AR) y "$189,999.00" (US) conviven en los resultados.
  const cleaned = value.replace(/[^\d.,]/g, '')
  if (!cleaned) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  // El separador decimal es el que aparece más a la derecha.
  let normalized
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    normalized = cleaned.replace(/,/g, '')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Percentiles, no promedio.
 *
 * El promedio de precios se distorsiona con un solo outlier (un accesorio
 * barato o un pack mayorista caro mezclado en los resultados). La mediana y
 * los cuartiles describen dónde está realmente el mercado.
 */
/**
 * Descarta atípicos antes de calcular los percentiles, con la regla estándar
 * de Tukey: fuera de [p25 − 1,5·RIC, p75 + 1,5·RIC].
 *
 * No es cosmética. Buscando "casco de moto integral" entran páginas de
 * CATEGORÍA, no de producto, y de ahí sale el artículo más barato o más caro
 * del listado: en una corrida real convivieron $5.000 y $1.202.600 con una
 * mediana de $259.000. La mediana aguanta eso; "al más barato" de la tarjeta
 * de rentabilidad, no — le diría al comerciante que su competencia vende
 * cascos a cinco mil pesos.
 *
 * Solo se aplica a partir de SHOPPING_MIN_SAMPLE_OUTLIERS precios (cinco por
 * defecto): con menos, el rango intercuartil no describe nada y el descarte
 * sería arbitrario. Y las ofertas se siguen
 * mostrando completas con su link: lo que se recorta son las estadísticas, no
 * lo que el comerciante puede mirar.
 */
function withoutOutliers(sorted) {
  if (sorted.length < MIN_SAMPLE_FOR_OUTLIERS) return sorted

  const p25 = percentile(sorted, 0.25)
  const p75 = percentile(sorted, 0.75)
  const ric = p75 - p25

  if (!Number.isFinite(ric) || ric <= 0) return sorted

  const piso = p25 - 1.5 * ric
  const techo = p75 + 1.5 * ric

  const filtrados = sorted.filter(p => p >= piso && p <= techo)

  return filtrados.length >= 3 ? filtrados : sorted
}

function computePriceStats(offers) {
  const prices = withoutOutliers(
    offers.map(o => o.price).sort((a, b) => a - b),
  )

  // Los cuartiles solo cuando hay muestra que los sostenga. null es "no se
  // puede saber", que es distinto de un número interpolado entre dos precios.
  const hayCuartiles = prices.length >= MIN_SAMPLE_FOR_QUARTILES

  return {
    min: prices[0],
    p25: hayCuartiles ? percentile(prices, 0.25) : null,
    median: percentile(prices, 0.5),
    p75: hayCuartiles ? percentile(prices, 0.75) : null,
    max: prices[prices.length - 1],
    currency: offers.find(o => o.currency)?.currency || null,
    sampleSize: prices.length,
  }
}

/**
 * Expuesto solo para los tests: el parseo de precios desde texto libre es la
 * parte frágil de este archivo y necesita cobertura directa, sin salir a la
 * red. No lo consume nadie más.
 */
export const __test__ = {
  normalizeTavilyResults,
  mentionsBrand,
  findPriceInText,
  computePriceStats,
  identifyingWords,
  packSize,
  looksLikeBundle,
  isListingPage,
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}
