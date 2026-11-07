// Props de MUI que dejaron de aplicarse.
//
// En @mui/material 9 `inputProps`, `InputProps`, `InputLabelProps`, `FormHelperTextProps` y
// `SelectProps` de TextField se ignoran: el campo se ve igual, pero el maxLength, el min/max/step, el
// readOnly o la etiqueta encogida que se pasaban por ahí nunca llegan al DOM (lo único que queda es
// un aviso de React en consola). Webpack y ESLint no lo detectan, así que se vigila acá: el reemplazo
// es `slotProps={{ htmlInput | input | inputLabel | formHelperText | select: { ... } }}`.
//
// Box, Stack y Typography tampoco aceptan más las props de sistema: un `justifyContent` o un
// `fontWeight` sueltos llegan al DOM y no hacen nada. El panel de gasto mostraba "0.3% del frenoAvisos
// al 50%" por eso. El reemplazo es `sx`. `width` y `height` no se vigilan: en una imagen son atributos.

import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')

// CouponForm define su propio helper `inputProps(...)` para <input> nativos: no es la prop de MUI.
// MetaPixelConfigPage se migra en el PR del rediseño de esa pantalla; cuando entre, se saca de acá.
const EXCEPCIONES = new Set([
  path.join('components', 'coupons', 'CouponForm.jsx'),
  path.join('pages', 'MetaPixelConfigPage.jsx'),
])

const PROP_DEPRECADA =
  /\b(inputProps|InputProps|InputLabelProps|FormHelperTextProps|SelectProps)=\{/

const PROPS_DE_SISTEMA = new Set(
  `m mt mb ml mr mx my margin marginTop marginBottom marginLeft marginRight marginX marginY
   p pt pb pl pr px py padding paddingTop paddingBottom paddingLeft paddingRight paddingX paddingY
   display flexDirection flexWrap justifyContent alignItems alignContent alignSelf
   gap rowGap columnGap flex flexGrow flexShrink flexBasis order
   minWidth maxWidth minHeight maxHeight position zIndex overflow whiteSpace
   textAlign textTransform fontSize fontWeight fontFamily fontStyle lineHeight letterSpacing
   bgcolor border borderRadius boxShadow`.split(/\s+/),
)

// Las props de la etiqueta de apertura, sin entrar a lo que va entre llaves: un `sx` puede tener
// cualquier nombre adentro, y una etiqueta puede ocupar varias líneas.
const propsDeLaEtiqueta = (fuente, inicio) => {
  const props = []
  let profundidad = 0
  let comilla = null

  for (let i = inicio; i < fuente.length; i++) {
    const c = fuente[i]

    if (comilla) {
      if (c === comilla) comilla = null
    } else if (c === '"' || c === "'" || c === '`') {
      comilla = c
    } else if (c === '{') {
      profundidad++
    } else if (c === '}') {
      profundidad--
    } else if (profundidad === 0 && c === '>') {
      return props
    } else if (profundidad === 0 && /\s/.test(c)) {
      const prop = /^([A-Za-z]+)=/.exec(fuente.slice(i + 1, i + 40))

      if (prop) props.push(prop[1])
    }
  }

  return props
}

const archivos = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entrada => {
    const ruta = path.join(dir, entrada.name)

    if (entrada.isDirectory()) return archivos(ruta)

    return /\.(js|jsx)$/.test(entrada.name) && !/\.test\.jsx?$/.test(entrada.name) ? [ruta] : []
  })

describe('MUI 9 · props que ya no se aplican', () => {
  test('ningún TextField usa inputProps, InputProps, InputLabelProps, FormHelperTextProps ni SelectProps', () => {
    const usos = archivos(SRC)
      .filter(ruta => !EXCEPCIONES.has(path.relative(SRC, ruta)))
      .flatMap(ruta =>
        fs
          .readFileSync(ruta, 'utf8')
          .split('\n')
          .flatMap((linea, i) =>
            PROP_DEPRECADA.test(linea)
              ? [`${path.relative(SRC, ruta)}:${i + 1}  ${linea.trim()}`]
              : [],
          ),
      )

    expect(usos).toEqual([])
  })

  test('Box, Stack y Typography no usan props de sistema', () => {
    const usos = archivos(SRC).flatMap(ruta => {
      const fuente = fs.readFileSync(ruta, 'utf8')

      return [...fuente.matchAll(/<(Box|Stack|Typography)(?=\s)/g)].flatMap(etiqueta => {
        const props = propsDeLaEtiqueta(fuente, etiqueta.index + etiqueta[0].length)
        const ignoradas = props.filter(prop => PROPS_DE_SISTEMA.has(prop))
        const linea = fuente.slice(0, etiqueta.index).split('\n').length

        return ignoradas.length
          ? [`${path.relative(SRC, ruta)}:${linea}  ${etiqueta[1]}: ${ignoradas.join(', ')}`]
          : []
      })
    })

    expect(usos).toEqual([])
  })
})
