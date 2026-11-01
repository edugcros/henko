// Editar producto: el stock que se vio al abrir viaja con cada variante.
//
// El formulario mandaba siempre el stock que mostraba al cargarse, y el
// backend lo asignaba tal cual: una venta ocurrida mientras se editaba se
// pisaba al guardar. Ahora cada variante existente lleva `stockBaseline` y el
// backend aplica la diferencia (ver applyStockBaselines en productCtrl.js).

import { jest } from '@jest/globals'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

jest.unstable_mockModule('react-redux', () => ({
  useSelector: () => ({}),
  useDispatch: () => jest.fn(),
}))

const { mapServerVariantToEditor, buildVariantPayload } = await import('./EditProduct.js')

const delServidor = {
  _id: 'v1',
  attributes: { talle: 'M' },
  price: 30000,
  stock: 4,
  sku: 'CASCO-M',
  isActive: true,
}

describe('Editar producto · línea de base del stock', () => {
  test('al cargar una variante del servidor se guarda el stock que se vio', () => {
    const editor = mapServerVariantToEditor(delServidor, 0)

    expect(editor.stock).toBe(4)
    expect(editor.stockBaseline).toBe(4)
  })

  test('la variante existente manda su stock nuevo y la línea de base', () => {
    const editor = { ...mapServerVariantToEditor(delServidor, 0), stock: 9 }

    const payload = buildVariantPayload(editor, 0)

    expect(payload).toMatchObject({ _id: 'v1', stock: 9, stockBaseline: 4 })
  })

  test('una variante nueva no manda línea de base: su valor va tal cual', () => {
    const nueva = {
      key: 'variant-x',
      variantId: null,
      attributes: { talle: 'XL' },
      price: 30000,
      stock: 2,
      isActive: true,
    }

    const payload = buildVariantPayload(nueva, 1)

    expect(payload.stock).toBe(2)
    expect(payload).not.toHaveProperty('stockBaseline')
    expect(payload).not.toHaveProperty('_id')
  })
})
