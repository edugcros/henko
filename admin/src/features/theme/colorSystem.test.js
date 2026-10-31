// Sistema de color del tema: roles, paletas rápidas y contraste.
//
// Las paletas son lo primero que toca un comercio, y se aplican enteras: si a
// una le falta un color o tiene un par ilegible (texto blanco sobre un botón
// pastel), la tienda queda así de un toque. Esto fija que cada paleta está
// completa, es válida y se lee bien.

import {
  COLOR_PRESETS,
  COLOR_ROLE_GROUPS,
  CONTRAST_PAIRS,
  DEFAULT_THEME_COLORS,
  contrastRatio,
  resolveThemeColors,
} from './colorSystem.js'

const ROLE_KEYS = Object.keys(DEFAULT_THEME_COLORS)

describe('roles de color', () => {
  test('cada rol está en exactamente un grupo del editor', () => {
    const inGroups = COLOR_ROLE_GROUPS.flatMap(group => group.fields.map(field => field.key))

    expect([...inGroups].sort()).toEqual([...ROLE_KEYS].sort())
    expect(new Set(inGroups).size).toBe(inGroups.length)
  })

  test('cada rol dice dónde se aplica', () => {
    for (const field of COLOR_ROLE_GROUPS.flatMap(group => group.fields)) {
      expect(field.label).toBeTruthy()
      expect(field.appliesTo.length).toBeGreaterThan(10)
    }
  })

  test('el pie de página es un rol propio', () => {
    expect(ROLE_KEYS).toEqual(expect.arrayContaining(['footerBackground', 'footerText']))
  })
})

describe('paletas rápidas', () => {
  test('hay 29: las 24 de antes y 5 nuevas', () => {
    expect(COLOR_PRESETS).toHaveLength(29)
    expect(COLOR_PRESETS.map(p => p.name)).toEqual(
      expect.arrayContaining([
        'Océano Surf',
        'Terracota Mediterránea',
        'Cítrico Fresco',
        'Medianoche Azul',
        'Arena & Turquesa',
      ]),
    )
  })

  test('los nombres no se repiten', () => {
    const names = COLOR_PRESETS.map(p => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test.each(COLOR_PRESETS.map(p => [p.name, p]))(
    '«%s» define todos los roles, nada más',
    (_, preset) => {
      const keys = Object.keys(preset).filter(key => key !== 'name')
      expect(keys.sort()).toEqual([...ROLE_KEYS].sort())
    },
  )

  test.each(COLOR_PRESETS.map(p => [p.name, p]))('«%s» usa solo hex #rrggbb', (_, preset) => {
    for (const key of ROLE_KEYS) expect(preset[key]).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test.each(COLOR_PRESETS.map(p => [p.name, p]))('«%s» se lee bien en cada par', (_, preset) => {
    const failing = CONTRAST_PAIRS.filter(
      pair => contrastRatio(preset[pair.fg], preset[pair.bg]) < pair.min,
    ).map(pair => `${pair.label}: ${contrastRatio(preset[pair.fg], preset[pair.bg]).toFixed(2)}`)
    expect(failing).toEqual([])
  })
})

describe('contraste y colores efectivos', () => {
  test('contrastRatio da los valores de WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(contrastRatio('nada', '#ffffff')).toBeNull()
  })

  test('sin colores de pie, se muestran el texto y el fondo invertidos (como la tienda)', () => {
    const colors = resolveThemeColors({ text: '#222222', background: '#fafafa' })

    expect(colors.footerBackground).toBe('#222222')
    expect(colors.footerText).toBe('#fafafa')
  })

  test('con colores de pie guardados, se respetan', () => {
    const colors = resolveThemeColors({ footerBackground: '#0b2f5f', footerText: '#ffffff' })

    expect(colors.footerBackground).toBe('#0b2f5f')
    expect(colors.footerText).toBe('#ffffff')
  })
})
