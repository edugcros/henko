// 📁 src/services/aiAgent/aiAgentPromptService.js

const clean = value => String(value || '').trim()

const formatMoney = (value, currency = 'ARS') => {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) return 'Sin precio informado'

  try {
    return amount.toLocaleString('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  } catch {
    return `$${Math.round(amount).toLocaleString('es-AR')}`
  }
}

const formatDate = value => {
  if (!value) return '-'

  try {
    return new Date(value).toLocaleDateString('es-AR')
  } catch {
    return String(value)
  }
}

const formatDiscount = promo => {
  const type = clean(promo?.discountType || promo?.type)
  const value = Number(promo?.discountValue || promo?.value || 0)

  if (!Number.isFinite(value) || value <= 0) return '-'

  if (type === 'percentage' || type === 'percent' || type === 'porcentaje') {
    return `${value}%`
  }

  return formatMoney(value, promo?.currency || 'ARS')
}

const formatProducts = (products, currency = 'ARS') => {
  if (!Array.isArray(products) || products.length === 0) {
    return 'No se encontraron productos relevantes para esta consulta.'
  }

  return products
    .slice(0, 8)
    .map((product, index) => {
      const variants = Array.isArray(product.variants)
        ? product.variants
          .slice(0, 8)
          .map(variant => {
            const attributes = variant.attributes
              ? JSON.stringify(variant.attributes)
              : '{}'

            return [
              `    - SKU: ${variant.sku || '-'}`,
              `Stock: ${variant.stock || 0}`,
              `Disponible: ${variant.available ? 'sí' : 'no'}`,
              `Precio: ${formatMoney(variant.price || product.price, currency)}`,
              `Atributos: ${attributes}`,
            ].join(' | ')
          })
          .join('\n')
        : ''

      return [
        `${index + 1}. ${product.title}`,
        `   ID visible para herramientas: ${product.id || '-'}`,
        `   SKU: ${product.sku || '-'}`,
        `   Marca: ${product.brand || '-'}`,
        `   Categoría: ${product.category || '-'}`,
        `   Subcategoría: ${product.subcategory || '-'}`,
        `   Precio: ${product.formattedPrice || formatMoney(product.price, currency)}`,
        `   Stock total: ${product.stock || 0}`,
        `   Disponible: ${product.available ? 'sí' : 'no'}`,
        `   Match búsqueda: ${product.matchScore ?? '-'}`,
        `   Coincide con consulta: ${product.matchedQuery ? 'sí' : 'no'}`,
        `   Link/slug: ${product.slug || '-'}`,
        product.description ? `   Descripción: ${product.description}` : '',
        variants ? `   Variantes:\n${variants}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

const formatApplicableProducts = promo => {
  const applicableProducts = Array.isArray(promo?.applicableProducts)
    ? promo.applicableProducts
    : []

  const applicableProductIds = Array.isArray(promo?.applicableProductIds)
    ? promo.applicableProductIds
    : []

  if (applicableProducts.length > 0) {
    return applicableProducts
      .slice(0, 12)
      .map(product => {
        return [
          `      - Producto: ${product.title || 'Producto sin nombre'}`,
          `ID: ${product.id || '-'}`,
          `Slug: ${product.slug || '-'}`,
          `SKU: ${product.sku || '-'}`,
          `Precio: ${product.formattedPrice || product.price || '-'}`,
          `Stock: ${product.stock ?? '-'}`,
          `Disponible: ${product.available ? 'sí' : 'no'}`,
        ].join(' | ')
      })
      .join('\n')
  }

  if (applicableProductIds.length > 0) {
    return applicableProductIds
      .slice(0, 12)
      .map(id => `      - Producto ID: ${id}`)
      .join('\n')
  }

  return '      - No hay productos específicos informados.'
}

const formatPromotions = (promotions, currency = 'ARS') => {
  if (!Array.isArray(promotions) || promotions.length === 0) {
    return 'No hay promociones activas disponibles.'
  }

  return promotions
    .slice(0, 8)
    .map((promo, index) => {
      const usageScope =
        promo.usageScope ||
        (Array.isArray(promo.applicableProducts) &&
        promo.applicableProducts.length > 0
          ? 'specific_products'
          : 'general_cart')

      const appliesToSpecificProducts =
        promo.appliesToSpecificProducts === true ||
        usageScope === 'specific_products'

      return [
        `${index + 1}. ${promo.name || promo.code || 'Promoción'}`,
        `   Código: ${promo.code || '-'}`,
        `   Tipo: ${promo.discountType || '-'}`,
        `   Descuento: ${formatDiscount(promo)}`,
        `   Compra mínima: ${formatMoney(promo.minPurchaseAmount, currency)}`,
        `   Tope descuento: ${
          promo.maxDiscountAmount
            ? formatMoney(promo.maxDiscountAmount, currency)
            : '-'
        }`,
        `   Vigencia desde: ${formatDate(
          promo.startsAt || promo.startDate || promo.createdAt,
        )}`,
        `   Vence: ${formatDate(promo.expiresAt || promo.endDate)}`,
        `   Alcance del cupón: ${usageScope}`,
        `   Aplica a productos específicos: ${
          appliesToSpecificProducts ? 'sí' : 'no'
        }`,
        `   Condición comercial: ${
          promo.usageText ||
          (appliesToSpecificProducts
            ? 'Válido solo para los productos específicos listados.'
            : 'Válido para compra general según condiciones del cupón.')
        }`,
        '   Productos donde aplica:',
        formatApplicableProducts(promo),
      ].join('\n')
    })
    .join('\n\n')
}

const formatKnowledge = knowledge => {
  if (!Array.isArray(knowledge) || knowledge.length === 0) {
    return 'No hay conocimiento adicional aprobado para esta consulta.'
  }

  return knowledge
    .slice(0, 8)
    .map((item, index) => {
      return [
        `${index + 1}. ${item.title || 'Información'}`,
        clean(item.content || item.description || '').slice(0, 1200),
      ].join('\n')
    })
    .join('\n\n')
}

const formatRecommendations = (recommendations, currency = 'ARS') => {
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return 'No hay recomendaciones automáticas disponibles.'
  }

  return recommendations
    .slice(0, 5)
    .map((item, index) => {
      return [
        `${index + 1}. ${item.title}`,
        `   Precio: ${item.formattedPrice || formatMoney(item.price, currency)}`,
        `   Stock: ${item.stock}`,
        `   Match búsqueda: ${item.matchScore ?? '-'}`,
        `   Link/slug: ${item.slug || '-'}`,
        `   Motivo: ${item.reason || '-'}`,
      ].join('\n')
    })
    .join('\n\n')
}

const formatCatalogSnapshot = snapshot => {
  if (!snapshot) {
    return 'No hay resumen de catálogo disponible.'
  }

  return [
    `Total productos: ${snapshot.totalProducts || 0}`,
    `Productos activos: ${snapshot.activeProducts || 0}`,
    `Productos visibles: ${snapshot.visibleProducts || 0}`,
    `Productos con stock: ${snapshot.withStock || 0}`,
    `Categorías detectadas: ${
      Array.isArray(snapshot.categories) && snapshot.categories.length
        ? snapshot.categories.join(', ')
        : '-'
    }`,
    `Marcas detectadas: ${
      Array.isArray(snapshot.brands) && snapshot.brands.length
        ? snapshot.brands.join(', ')
        : '-'
    }`,
    `Última actualización catálogo: ${snapshot.lastUpdatedAt || '-'}`,
  ].join('\n')
}

export const buildAgentSystemPrompt = ({
  agent,
  tenant,
  knowledge = [],
  products = [],
  commerceContext = {},
} = {}) => {
  const tenantName =
    tenant?.name ||
    tenant?.storeName ||
    tenant?.businessName ||
    tenant?.nombre ||
    commerceContext?.tenant?.name ||
    'la tienda'

  const currency =
    commerceContext?.tenant?.currency ||
    tenant?.currency ||
    tenant?.moneda ||
    'ARS'

  return `
Sos el asistente comercial IA de ${tenantName}.

OBJETIVO:
Ayudar a clientes del ecommerce a encontrar productos, resolver dudas, comparar opciones, entender promociones y avanzar hacia la compra.

REGLAS CRÍTICAS:
- No inventes productos.
- No inventes precios.
- No inventes stock.
- No inventes promociones.
- No inventes políticas.
- Usá solamente la información del contexto actualizado.
- Si el contexto no tiene la información, pedí una aclaración o derivá a un asesor.
- Si un producto figura sin stock, no digas que está disponible.
- Si hay variantes, usá sus atributos para responder sobre talle, color, medida o presentación.
- Si el cliente muestra intención fuerte de compra, ayudalo a avanzar hacia el producto, carrito o checkout.
- No digas que sos Gemini.
- No muestres IDs internos.
- Respondé en español argentino, claro, amable y vendedor.
- Evitá respuestas largas salvo que el cliente pida detalle.
- Moneda principal del comercio: ${currency}.
- Los productos que recibís vienen de herramientas internas del ecommerce.
- No menciones productos fuera de PRODUCTOS RELEVANTES.
- Si el usuario pide algo genérico, usá el resumen, mostrale opciones concretas solo si hay coincidencias razonables y pedí precisión.
- Si el usuario pregunta "algo más barato", compará con los productos del historial y los productos relevantes actuales.
- Si una validación interna corrige tu respuesta, aceptá el fallback.
- No generes una acción de producto si el cliente no eligió un producto concreto.
- Si la consulta es genérica, primero ayudá a comparar opciones y preguntá cuál le interesa.
- No empujes siempre el primer producto del catálogo.
- Cuando recomiendes o expliques un producto concreto, usá exactamente el título y slug del contexto de productos.
- No mezcles acciones ni enlaces de productos distintos.
- Si hablás de un producto, mantené coherencia total entre nombre, variantes, precio, stock y URL.
- Si el cliente hace una consulta genérica, no elijas automáticamente un producto único salvo que sea una recomendación explícita.
- Si los productos relevantes tienen "Coincide con consulta: no", aclaralo como opciones disponibles y no como coincidencia exacta.

REGLAS SOBRE STOCK Y VARIANTES:
- El stock total del producto no reemplaza el stock de cada variante.
- Si el cliente pregunta por color, talle, medida o presentación, revisá primero las variantes.
- Si una variante tiene stock 0, no la ofrezcas como disponible.
- Si hay variantes disponibles, mencioná las variantes más útiles para avanzar la compra.
- Si no hay stock suficiente o la información no es clara, pedí confirmación o derivá a asesor.

REGLAS SOBRE CUPONES Y PROMOCIONES:
- No presentes un cupón como descuento general si "Alcance del cupón" es "specific_products".
- Si un cupón tiene productos aplicables, debés decir explícitamente para qué producto aplica.
- Si el cliente pregunta por promociones, agrupá la respuesta por producto.
- Si el cupón aplica a un producto específico, no digas "usalo en cualquier compra".
- Si no hay productos aplicables cargados para el cupón, indicá que requiere validación antes de usarlo.
- Para recomendar un cupón, verificá que el producto consultado coincida con "Productos donde aplica".
- Si el cupón no aplica al producto que el cliente consulta, decilo claramente.
- Si el cupón es "general_cart", podés presentarlo como cupón general, respetando compra mínima, tope y vigencia.
- Si el cupón es "specific_products", usá frases como "válido solo para..." o "aplica únicamente a...".
- Nunca mezcles un cupón de un producto con otro producto.
- No sugieras copiar o usar un cupón si no corresponde al producto consultado.

PERSONALIDAD:
Tono: ${agent?.personality?.tone || 'friendly'}
Idioma: ${agent?.personality?.language || 'es-AR'}

CONTEXTO DEL COMERCIO:
${agent?.businessContext?.description || ''}

POLÍTICAS DEL COMERCIO:
Envíos: ${agent?.businessContext?.policies?.shipping || 'Consultar con el comercio.'}
Cambios/devoluciones: ${agent?.businessContext?.policies?.returns || 'Consultar con el comercio.'}
Pagos: ${agent?.businessContext?.policies?.payments || 'Consultar con el comercio.'}

DATOS ACTUALIZADOS DEL ECOMMERCE:
Generado en: ${commerceContext?.generatedAt || new Date().toISOString()}

RESUMEN DEL CATÁLOGO:
${formatCatalogSnapshot(commerceContext?.catalogSnapshot)}

RECOMENDACIONES GENERADAS POR HERRAMIENTAS:
${formatRecommendations(commerceContext?.recommendations || [], currency)}

PRODUCTOS RELEVANTES:
${formatProducts(products, currency)}

PROMOCIONES/CUPONES ACTIVOS:
${formatPromotions(commerceContext?.promotions || [], currency)}

CONOCIMIENTO APROBADO:
${formatKnowledge(knowledge)}

INSTRUCCIONES DE RESPUESTA:
- Si hay productos relevantes con coincidencia real, recomendá máximo 3.
- Incluí precio y disponibilidad cuando estén disponibles.
- Si el cliente pregunta por un talle/color/variante, revisá variantes antes de responder.
- Si hay promociones activas, mencionalas solo si pueden ayudar a esa compra concreta.
- Si una promoción aplica solo a un producto específico, nombrá el producto exacto.
- Si no hay producto relacionado, pedí más detalle: tipo de producto, talle, color, presupuesto o uso.
- Cerrá con una pregunta útil para avanzar la venta.
`.trim()
}