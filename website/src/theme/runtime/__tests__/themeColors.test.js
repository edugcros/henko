/* eslint-env jest */
// Colores del tema en el storefront: cada rol se aplica solo donde el editor dice.
//
// Se fija acá:
//   - el pie de página tiene sus propios colores, y una tienda que todavía no
//     los eligió sigue viendo su footer como antes (texto y fondo invertidos);
//   - un <Link> de MUI sin color toma «Links generales», no «Marca primaria».

import { createStoreTheme } from '../themeMapper'
import { getThemeColors } from '../themeRuntime'

describe('getThemeColors · pie de página', () => {
  test('sin colores de pie, usa texto y fondo invertidos (como antes)', () => {
    const colors = getThemeColors({ colors: { text: '#222222', background: '#fafafa' } })

    expect(colors.footerBackground).toBe('#222222')
    expect(colors.footerText).toBe('#fafafa')
  })

  test('con colores de pie, usa esos y no los de la página', () => {
    const colors = getThemeColors({
      colors: {
        text: '#222222',
        background: '#fafafa',
        footerBackground: '#0b2f5f',
        footerText: '#dbeafe',
      },
    })

    expect(colors.footerBackground).toBe('#0b2f5f')
    expect(colors.footerText).toBe('#dbeafe')
  })
})

describe('createStoreTheme · links', () => {
  const theme = createStoreTheme({ colors: { primary: '#111111', link: '#0b5cad' } }, 'test-links')
  const linkStyle = ownerState => theme.components.MuiLink.styleOverrides.root({ ownerState })

  test('un Link sin color (o con primary) usa «Links generales»', () => {
    expect(linkStyle({}).color).toBe('#0b5cad')
    expect(linkStyle({ color: 'primary' }).color).toBe('#0b5cad')
  })

  test('un Link que pide otro color (inherit, en el header) no se toca', () => {
    expect(linkStyle({ color: 'inherit' })).toEqual({})
  })

  test('la marca primaria sigue siendo palette.primary', () => {
    expect(theme.palette.primary.main).toBe('#111111')
  })
})

describe('createStoreTheme · pie de página en el tema normalizado', () => {
  test('sin colores de pie, cae en texto y fondo', () => {
    const theme = createStoreTheme(
      { colors: { text: '#101010', background: '#f0f0f0' } },
      'test-footer',
    )

    expect(theme.storeTheme.colors.footerBackground).toBe('#101010')
    expect(theme.storeTheme.colors.footerText).toBe('#f0f0f0')
  })
})
