import { computeAvailableValues } from './variantOptions'

const getAttributes = variant => variant.attributes || {}

const variantes = [
  { attributes: { talle: 'XL', color: 'Negro' } },
  { attributes: { talle: 'M', color: 'Negro' } },
  { attributes: { talle: 'S', color: 'Blanco' } },
  { attributes: { talle: 'L', color: 'Negro' } },
]

const declarados = [
  { name: 'talle', values: ['S', 'M', 'L', 'XL', 'XXL'] },
  { name: 'color', values: ['Negro', 'Blanco'] },
]

describe('opciones de variante en la ficha', () => {
  test('el orden es el que declaró el comercio, no el alfabético', () => {
    expect(
      computeAvailableValues({
        attrName: 'talle',
        variants: variantes,
        variantAttributes: declarados,
        getAttributes,
      }),
    ).toEqual(['S', 'M', 'L', 'XL'])
  })

  test('un valor declarado sin variante no se ofrece (no se podría comprar)', () => {
    const valores = computeAvailableValues({
      attrName: 'talle',
      variants: variantes,
      variantAttributes: declarados,
      getAttributes,
    })

    expect(valores).not.toContain('XXL')
  })

  test('solo ofrece lo compatible con lo que ya se eligió', () => {
    expect(
      computeAvailableValues({
        attrName: 'talle',
        selections: { color: 'Negro' },
        variants: variantes,
        variantAttributes: declarados,
        getAttributes,
      }),
    ).toEqual(['M', 'L', 'XL'])
  })

  test('un producto sin valores declarados se ordena alfabético, como antes', () => {
    expect(
      computeAvailableValues({
        attrName: 'talle',
        variants: variantes,
        variantAttributes: [{ name: 'talle' }],
        getAttributes,
      }),
    ).toEqual(['L', 'M', 'S', 'XL'])
  })

  test('lo no declarado va después de lo declarado', () => {
    expect(
      computeAvailableValues({
        attrName: 'talle',
        variants: [...variantes, { attributes: { talle: 'Único', color: 'Negro' } }],
        variantAttributes: declarados,
        getAttributes,
      }),
    ).toEqual(['S', 'M', 'L', 'XL', 'Único'])
  })
})
