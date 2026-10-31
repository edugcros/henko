// Colores del tema: los dos del pie de página (footerBackground, footerText).
//
// Se agregaron después de los otros 30 roles. El schema de colores es estricto,
// así que una clave que no esté declarada se descarta en silencio al guardar:
// esto fija que se guardan, que se validan como el resto, y que no tienen
// default (el storefront usa texto/fondo invertidos cuando faltan, para que las
// tiendas existentes no vean cambiar su footer).

import ThemeConfig from '../features/theme/themeConfigModel.js'

const base = {
  tenantId: '64b7f0000000000000000001',
  name: 'Tema de prueba',
}

describe('Colores del tema · pie de página', () => {
  test('footerBackground y footerText se guardan como el resto de los colores', () => {
    const theme = new ThemeConfig({
      ...base,
      colors: { footerBackground: '#0b2f5f', footerText: '#ffffff' },
    })

    expect(theme.colors.footerBackground).toBe('#0b2f5f')
    expect(theme.colors.footerText).toBe('#ffffff')
    expect(theme.validateSync()?.errors?.['colors.footerBackground']).toBeUndefined()
  })

  test('un color de pie inválido se rechaza', () => {
    const theme = new ThemeConfig({ ...base, colors: { footerText: 'no-es-un-color' } })

    expect(theme.validateSync()?.errors?.['colors.footerText']).toBeDefined()
  })

  test('sin valor no se completan con un default', () => {
    const theme = new ThemeConfig({ ...base, colors: { text: '#222222' } })

    expect(theme.colors.footerBackground).toBeUndefined()
    expect(theme.colors.footerText).toBeUndefined()
  })
})
