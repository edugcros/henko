// Props de MUI que dejaron de aplicarse.
//
// En @mui/material 9 `inputProps`, `InputProps`, `InputLabelProps`, `FormHelperTextProps` y
// `SelectProps` de TextField se ignoran: el campo se ve igual, pero el maxLength, el min/max/step, el
// readOnly o la etiqueta encogida que se pasaban por ahí nunca llegan al DOM (lo único que queda es
// un aviso de React en consola). Webpack y ESLint no lo detectan, así que se vigila acá: el reemplazo
// es `slotProps={{ htmlInput | input | inputLabel | formHelperText | select: { ... } }}`.

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
})
