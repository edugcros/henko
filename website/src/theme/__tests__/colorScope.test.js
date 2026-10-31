/* eslint-env jest */
// Alcance de cada color del tema.
//
// El editor de colores del panel promete dónde se aplica cada rol («Header
// iconos: iconos y contadores del header», «Precio general: fuera de cards,
// resúmenes y vista de producto», etc.). Varias pantallas usaban un rol en un
// lugar que no le correspondía, así que editar un color movía otra parte de la
// tienda. Este test fija los cruces que se corrigieron, leyendo el código: si
// alguno vuelve, falla con el motivo.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = file => readFileSync(path.join(__dirname, '..', '..', file), 'utf8')

describe('alcance de los colores del tema', () => {
  test('la vista de producto no usa colores de card (no es una card)', () => {
    expect(src('Pages/SingleProduct.js')).not.toMatch(/themeColors\.card\w+/)
  })

  test('las estrellas de calificación usan «Acento», no «Advertencia»', () => {
    for (const file of [
      'Pages/SingleProduct.js',
      'Components/ProductCard.js',
      'Components/HomeProductCard.js',
    ]) {
      expect(src(file)).not.toMatch(/color2=\{themeColors\.warning/)
    }
  })

  test('el precio en promoción de las cards usa «Precio oferta»', () => {
    for (const file of ['Components/ProductCard.js', 'Components/HomeProductCard.js']) {
      expect(src(file)).toMatch(/hasPromotion \? themeColors\.salePrice/)
    }
  })

  test('el pie de página usa sus propios colores, no el texto ni el fondo de la página', () => {
    const footer = src('Components/Footer.js')
    expect(footer).not.toMatch(/themeColors\.(text|background)\b/)
    expect(footer).toMatch(/themeColors\.footerBackground/)
    expect(footer).toMatch(/themeColors\.footerText/)
  })

  test('los contadores del header no usan la paleta de error', () => {
    expect(src('Components/CustomHeader.jsx')).not.toMatch(/<Badge[^>]*color="error"/)
  })

  test('el header solo toma colores del header', () => {
    const header = src('Components/CustomHeader.jsx')
    const used = [...header.matchAll(/themeColors\.(\w+)/g)].map(m => m[1])
    expect(used.filter(role => !role.startsWith('header'))).toEqual([])
  })

  test('el texto chico de los paneles del inicio no usa la marca (no se garantiza legible ahí)', () => {
    expect(src('Pages/Home.js')).not.toMatch(/color: themeColors\.primary/)
  })

  test('los paneles del inicio son opacos: su texto se audita contra «Card fondo»', () => {
    const home = src('Pages/Home.js')
    expect(home).not.toMatch(/alpha\(surfaceColor/)
    expect(home).not.toMatch(/alpha\(themeColors\.cardBackground/)
  })

  test('los avisos del carrito van sobre el fondo de la card, no sobre tintes o velos', () => {
    const cart = src('Pages/Cart.js')
    expect(cart).not.toMatch(/\$\{themeColors\.success\}20/)
    expect(cart).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.7\)/)
  })

  test('el fondo de la página de inicio no mezcla el botón primario', () => {
    const home = src('Pages/Home.js')
    expect(home).not.toMatch(/alpha\(primaryAction/)
    expect(home).not.toMatch(/alpha\(themeColors\.actionPrimary/)
  })
})
