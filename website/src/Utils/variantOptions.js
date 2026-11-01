// 📁 src/Utils/variantOptions.js
//
// Qué opciones ofrecer para un atributo de variante (talle, color...) según lo
// que el comprador ya eligió.
//
// Solo se ofrecen valores que EXISTEN en alguna variante compatible con la
// selección. Los valores declarados por el comercio (variantAttributes[].values)
// sirven para el ORDEN —el que eligió: S, M, L, XL en vez del alfabético L, M,
// S, XL—, nunca para agregar opciones: un valor declarado sin variante sería un
// talle que se puede elegir y no se puede comprar. Lo no declarado va después,
// en orden alfabético, que es como se ordenaba todo antes.

export const computeAvailableValues = ({
  attrName,
  selections = {},
  variants = [],
  variantAttributes = [],
  getAttributes,
}) => {
  const otherSelections = { ...selections }
  delete otherSelections[attrName]

  const present = new Set()

  for (const variant of Array.isArray(variants) ? variants : []) {
    const attrs = getAttributes(variant) || {}
    const compatible = Object.entries(otherSelections).every(
      ([key, value]) => !value || String(attrs[key] || '') === String(value || ''),
    )
    if (!compatible) continue

    const value = attrs[attrName]
    if (value) present.add(String(value))
  }

  const declared = (Array.isArray(variantAttributes) ? variantAttributes : []).find(
    attr => attr?.name === attrName,
  )?.values
  const rank = new Map(
    (Array.isArray(declared) ? declared : []).map((value, index) => [String(value), index]),
  )

  return [...present].sort((a, b) => {
    const rankA = rank.has(a) ? rank.get(a) : Number.POSITIVE_INFINITY
    const rankB = rank.has(b) ? rank.get(b) : Number.POSITIVE_INFINITY
    if (rankA !== rankB) return rankA - rankB
    return a.localeCompare(b)
  })
}
