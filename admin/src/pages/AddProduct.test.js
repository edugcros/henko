// Alta de producto (AddProduct).
//
// Esta pantalla tiene más de 8.000 líneas y no tenía un solo test. Acá se fijan dos capas:
//
//   1. Las funciones puras que deciden qué se guarda: validaciones de envío, generación de variantes,
//      lectura de la ficha técnica y de las variantes rápidas, payload de SEO y de logística, y el
//      progreso de la carga (qué falta para publicar y en qué paso está la persona).
//   2. La pantalla montada: que abra con su estructura y que el botón de publicar no mande un producto
//      incompleto.
//
// Las pruebas de la primera capa son de caracterización: describen lo que el código hace hoy.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockDispatch = jest.fn()
const mockApiGet = jest.fn()
const mockApiPost = jest.fn()
const mockApiDelete = jest.fn()
const mockGetCategories = jest.fn()
const mockGetCategoryConfig = jest.fn()
const mockAnalyzeImage = jest.fn()
const mockHydrateAnalysis = jest.fn()
const mockResetIa = jest.fn()
const mockCreateProducts = jest.fn()
const estado = {
  user: { user: { _id: 'u1', tenantId: 't1' } },
  product: { isLoading: false, isError: false, message: '' },
}

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../hooks/useProductAnalyzer', () => ({
  default: () => ({
    iaResult: null,
    analyzeImage: mockAnalyzeImage,
    hydrateAnalysis: mockHydrateAnalysis,
    resetIa: mockResetIa,
    loading: false,
    error: null,
    lastAnalysisJobId: null,
  }),
}))

jest.unstable_mockModule('../utils/axiosConfig', () => ({
  default: { get: mockApiGet, post: mockApiPost, delete: mockApiDelete },
}))

jest.unstable_mockModule('../features/product/productSlice', () => ({
  createProducts: mockCreateProducts,
  uploadProductImage: payload => ({ type: 'product/uploadImage', payload }),
  uploadProductVideo: payload => ({ type: 'product/uploadVideo', payload }),
  resetState: () => ({ type: 'product/reset' }),
  assignVariantImage: payload => ({ type: 'product/assignVariantImage', payload }),
}))

jest.unstable_mockModule('../features/product/productService', () => ({
  default: {
    getCategories: mockGetCategories,
    getCategoryConfig: mockGetCategoryConfig,
    saveCategoryConfig: jest.fn(),
  },
}))

const {
  default: AddProduct,
  toTitleCase,
  buildVariantKey,
  buildVariantName,
  buildGeneratedVariantSku,
  normalizeNumberValue,
  normalizeOptionalNumberValue,
  normalizeSku,
  getVariantStockTotal,
  getVariantAttributesConfig,
  validateSelectedFiles,
  validateSelectedVideoFile,
  validateVariantsForSubmit,
  validateProductBasicsForSubmit,
  parseQuickVariantText,
  inferTechnicalFieldType,
  parseTechnicalFieldText,
  mergeVariantAttributeDefinitions,
  mergeSelectedVariantValues,
  generateVariantRowsFromSelection,
  normalizeDynamicFieldType,
  normalizeDynamicFieldDefinition,
  extractTemplateDynamicFields,
  normalizeDynamicFieldValues,
  buildSeoPayload,
  buildSeoFormValues,
  buildLogisticsPayload,
  buildProductReadiness,
  buildWizardSteps,
  getWizardCurrentStep,
  normalizeAiAnalysisForForm,
  buildProductPayloadFromAnalysis,
  createProductAttempt,
  runProductAttempt,
  describeProductAttemptFailure,
  resolveAiConfidencePercent,
} = await import('./AddProduct.js')

const MB = 1024 * 1024

describe('Alta de producto · textos y números', () => {
  test('toTitleCase pone mayúscula inicial a cada palabra, también tras guion y barra', () => {
    expect(toTitleCase('  casco   AGV  k1 ')).toBe('Casco Agv K1')
    expect(toTitleCase('ñandú')).toBe('Ñandú')
    expect(toTitleCase('x-y/z')).toBe('X-Y/Z')
    expect(toTitleCase('')).toBe('')
    expect(toTitleCase(null)).toBe('')
  })

  test('normalizeNumberValue nunca devuelve negativos ni valores que no son número', () => {
    expect(normalizeNumberValue('12')).toBe(12)
    expect(normalizeNumberValue(7.5)).toBe(7.5)
    expect(normalizeNumberValue(-5)).toBe(0)
    expect(normalizeNumberValue('abc')).toBe(0)
    expect(normalizeNumberValue(null)).toBe(0)
    expect(normalizeNumberValue(undefined)).toBe(0)
    expect(normalizeNumberValue(Infinity)).toBe(0)
  })

  test('normalizeOptionalNumberValue conserva «sin dato» como null y no lo vuelve 0', () => {
    expect(normalizeOptionalNumberValue(null)).toBeNull()
    expect(normalizeOptionalNumberValue(undefined)).toBeNull()
    expect(normalizeOptionalNumberValue('')).toBeNull()
    expect(normalizeOptionalNumberValue('x')).toBeNull()
    expect(normalizeOptionalNumberValue(-1)).toBeNull()
    expect(normalizeOptionalNumberValue(0)).toBe(0)
    expect(normalizeOptionalNumberValue('5')).toBe(5)
  })

  test('normalizeSku descarta los SKU que son solo un número o un contador automático', () => {
    expect(normalizeSku(' abc-1 ')).toBe('ABC-1')
    expect(normalizeSku('SKU-ABC')).toBe('SKU-ABC')
    expect(normalizeSku('12345')).toBe('')
    expect(normalizeSku('sku-12')).toBe('')
    expect(normalizeSku('SKU12')).toBe('')
    expect(normalizeSku('var-3')).toBe('')
    expect(normalizeSku('')).toBe('')
    expect(normalizeSku(null)).toBe('')
  })
})

describe('Alta de producto · claves y nombres de variantes', () => {
  test('buildVariantKey ordena por atributo, quita acentos y ignora los vacíos', () => {
    expect(buildVariantKey({ talle: 'M', Color: 'Negro Mate' })).toBe('color:negro-mate|talle:m')
    expect(buildVariantKey({ color: 'Azul', talle: '' })).toBe('color:azul')
    expect(buildVariantKey({ Tamaño: 'Ñandú' })).toBe('tamano:nandu')
    expect(buildVariantKey({})).toBe('')
  })

  test('la clave no depende del orden en que se cargaron los atributos', () => {
    expect(buildVariantKey({ color: 'Rojo', talle: 'S' })).toBe(
      buildVariantKey({ talle: 'S', color: 'Rojo' }),
    )
  })

  test('buildVariantName arma «atributo: valor» separado por barras', () => {
    expect(buildVariantName({ color: 'Negro', talle: 'M' })).toBe('color: Negro / talle: M')
    expect(buildVariantName({ color: 'Negro', talle: '' })).toBe('color: Negro')
    expect(buildVariantName({})).toBe('')
  })

  test('buildGeneratedVariantSku combina título, atributos y número de orden', () => {
    expect(buildGeneratedVariantSku('Casco AGV K1', { color: 'Negro', talle: 'M' }, 0)).toBe(
      'CASCOAGVK1-NEGRO-M-01',
    )
    expect(buildGeneratedVariantSku('Campera Térmica', {}, 9)).toBe('CAMPERATERMI-10')
    expect(buildGeneratedVariantSku('', { color: 'Rojo' }, 0)).toBe('PRODUCTO-ROJO-01')
  })

  test('buildGeneratedVariantSku nunca pasa de 64 caracteres', () => {
    const atributos = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`a${i}`, 'valorlargo' + i]),
    )

    expect(buildGeneratedVariantSku('Casco', atributos, 0).length).toBeLessThanOrEqual(64)
  })
})

describe('Alta de producto · stock y atributos de variantes', () => {
  test('getVariantStockTotal suma solo las variantes activas', () => {
    expect(
      getVariantStockTotal([
        { stock: 3 },
        { stock: '4' },
        { stock: 10, isActive: false },
        { stock: -2 },
        {},
      ]),
    ).toBe(7)
    expect(getVariantStockTotal(undefined)).toBe(0)
  })

  test('getVariantAttributesConfig solo incluye los atributos con valores elegidos', () => {
    const resultado = getVariantAttributesConfig(
      [
        { name: 'color', label: 'Color', type: 'color', values: ['Negro'], required: true },
        { name: 'talle', values: [] },
        { name: 'material' },
      ],
      { color: ['Negro', 'Blanco'], talle: ['S'] },
    )

    expect(resultado).toEqual([
      {
        name: 'color',
        label: 'Color',
        type: 'color',
        values: ['Negro', 'Blanco'],
        required: true,
        sortOrder: 0,
      },
      {
        name: 'talle',
        label: 'talle',
        type: 'select',
        values: ['S'],
        required: false,
        sortOrder: 1,
      },
    ])
  })
})

describe('Alta de producto · archivos', () => {
  test('acepta imágenes por tipo o por extensión y rechaza el resto', () => {
    expect(validateSelectedFiles([{ name: 'a.jpg', type: 'image/jpeg', size: 100 }])).toBeNull()
    expect(validateSelectedFiles([{ name: 'foto.HEIC', size: 100 }])).toBeNull()
    expect(validateSelectedFiles([{ name: 'a.gif', type: 'image/gif', size: 100 }])).toBe(
      'El archivo a.gif no tiene un formato de imagen permitido.',
    )
  })

  test('rechaza una imagen de más de 12 MB y mira el archivo dentro de originFileObj', () => {
    expect(validateSelectedFiles([{ name: 'x.jpg', type: 'image/jpeg', size: 13 * MB }])).toBe(
      'El archivo x.jpg supera 12MB.',
    )
    expect(
      validateSelectedFiles([
        { name: 'y.png', originFileObj: { type: 'image/png', size: 13 * MB } },
      ]),
    ).toBe('El archivo y.png supera 12MB.')
    expect(
      validateSelectedFiles([
        { name: 'z.png', originFileObj: { type: 'image/png', size: 1 * MB } },
      ]),
    ).toBeNull()
  })

  test('permite hasta 12 imágenes por producto', () => {
    const imagen = i => ({ name: `i${i}.jpg`, type: 'image/jpeg', size: 10 })

    expect(validateSelectedFiles(Array.from({ length: 12 }, (_, i) => imagen(i)))).toBeNull()
    expect(validateSelectedFiles(Array.from({ length: 13 }, (_, i) => imagen(i)))).toBe(
      'Podés cargar hasta 12 imágenes por producto.',
    )
    expect(validateSelectedFiles([])).toBeNull()
  })

  test('el video es opcional, solo mp4, webm o mov, y de hasta 60 MB', () => {
    expect(validateSelectedVideoFile(null)).toBeNull()
    expect(validateSelectedVideoFile({ name: 'v.mp4', type: 'video/mp4', size: 1 * MB })).toBeNull()
    expect(validateSelectedVideoFile({ name: 'v.mov', size: 1 * MB })).toBeNull()
    expect(
      validateSelectedVideoFile({ name: 'v.avi', type: 'video/x-msvideo', size: 1 * MB }),
    ).toBe('El formato de video no está permitido (mp4, webm, mov).')
    expect(validateSelectedVideoFile({ name: 'v.mp4', type: 'video/mp4', size: 61 * MB })).toBe(
      'El video supera 60MB.',
    )
  })
})

describe('Alta de producto · validación de variantes al enviar', () => {
  const variante = (extra = {}) => ({
    nombre: 'Negro / M',
    combinacion: { color: 'Negro', talle: 'M' },
    price: 100,
    stock: 1,
    sku: 'CASCO-1A',
    ...extra,
  })

  test('sin variantes generadas avisa que falta generar la combinación', () => {
    expect(validateVariantsForSubmit([])).toBe(
      'Activaste variantes, pero todavía no generaste ninguna combinación.',
    )
    expect(validateVariantsForSubmit(undefined)).toBe(
      'Activaste variantes, pero todavía no generaste ninguna combinación.',
    )
  })

  test('exige al menos una variante activa', () => {
    expect(validateVariantsForSubmit([variante({ isActive: false })])).toBe(
      'El producto necesita al menos una variante activa.',
    )
  })

  test('una variante sin combinación es inválida y se nombra por su nombre', () => {
    expect(validateVariantsForSubmit([variante({ combinacion: {} })])).toBe(
      'La variante "Negro / M" no tiene una combinación válida.',
    )
    expect(validateVariantsForSubmit([{ price: 10, combinacion: {} }])).toBe(
      'La variante "Variante" no tiene una combinación válida.',
    )
  })

  test('detecta combinaciones repetidas aunque cambie el orden de los atributos', () => {
    expect(
      validateVariantsForSubmit([
        variante(),
        variante({
          nombre: 'Repetida',
          combinacion: { talle: 'M', color: 'Negro' },
          sku: 'OTRO-1',
        }),
      ]),
    ).toBe('Hay variantes duplicadas con la misma combinación: Repetida.')
  })

  test('cada variante activa necesita un precio mayor a 0', () => {
    expect(validateVariantsForSubmit([variante({ price: 0 })])).toBe(
      'La variante "Negro / M" necesita un precio mayor a 0.',
    )
    expect(validateVariantsForSubmit([variante({ price: 'abc' })])).toBe(
      'La variante "Negro / M" necesita un precio mayor a 0.',
    )
  })

  test('detecta SKU repetidos sin distinguir mayúsculas, e ignora los automáticos numéricos', () => {
    expect(
      validateVariantsForSubmit([
        variante({ sku: 'ab-1' }),
        variante({ combinacion: { color: 'Blanco', talle: 'M' }, sku: 'AB-1' }),
      ]),
    ).toBe('Hay variantes con SKU duplicado: AB-1.')

    expect(
      validateVariantsForSubmit([
        variante({ sku: '123' }),
        variante({ combinacion: { color: 'Blanco', talle: 'M' }, sku: '123' }),
      ]),
    ).toBeNull()
  })

  test('las variantes inactivas no entran en las comprobaciones', () => {
    expect(
      validateVariantsForSubmit([
        variante(),
        variante({ isActive: false, price: 0, combinacion: {} }),
      ]),
    ).toBeNull()
  })

  test('para publicar, al menos una variante activa necesita stock', () => {
    expect(
      validateVariantsForSubmit([
        variante({ stock: 0 }),
        variante({ combinacion: { color: 'Blanco', talle: 'M' }, sku: 'CASCO-2B', stock: 0 }),
      ]),
    ).toBe('Al menos una variante activa necesita stock mayor a 0.')
  })

  test('un borrador guarda variantes sin precio ni stock, pero bien formadas', () => {
    const borrador = variantes => validateVariantsForSubmit(variantes, { publish: false })

    expect(borrador([variante({ price: 0, stock: 0 })])).toBeNull()
    expect(
      borrador([
        variante(),
        variante({ nombre: 'Repetida', combinacion: { talle: 'M', color: 'Negro' }, sku: 'X-1' }),
      ]),
    ).toBe('Hay variantes duplicadas con la misma combinación: Repetida.')
  })

  test('devuelve null cuando todo está bien', () => {
    expect(
      validateVariantsForSubmit([
        variante(),
        variante({ combinacion: { color: 'Blanco', talle: 'M' }, sku: 'CASCO-2B' }),
      ]),
    ).toBeNull()
  })
})

describe('Alta de producto · validación de los datos básicos', () => {
  const completo = {
    titulo: 'Casco AGV K1',
    descripcion: 'Casco integral',
    categoria: 'Cascos',
    subcategoria: 'Integrales',
    marca: 'AGV',
    condicion: 'nuevo',
    precio: 150000,
    cantidad: 3,
  }

  test('un producto completo pasa', () => {
    expect(validateProductBasicsForSubmit({ values: completo })).toBeNull()
  })

  test('avisa del primer campo obligatorio que falta, en este orden', () => {
    const faltante = campo =>
      validateProductBasicsForSubmit({ values: { ...completo, [campo]: '' } })

    expect(faltante('titulo')).toBe('El título es obligatorio')
    expect(faltante('descripcion')).toBe('La descripción comercial es obligatoria')
    expect(faltante('categoria')).toBe('La categoría es obligatoria')
    expect(faltante('subcategoria')).toBe('La subcategoría es obligatoria')
    expect(faltante('marca')).toBe('La marca es obligatoria')
    expect(faltante('condicion')).toBe('La condición es obligatoria')

    expect(validateProductBasicsForSubmit({ values: {} })).toBe('El título es obligatorio')
    expect(
      validateProductBasicsForSubmit({ values: { ...completo, titulo: '   ', marca: '' } }),
    ).toBe('El título es obligatorio')
  })

  test('el precio debe ser mayor a 0', () => {
    expect(validateProductBasicsForSubmit({ values: { ...completo, precio: 0 } })).toBe(
      'El precio debe ser mayor a 0.',
    )
    expect(validateProductBasicsForSubmit({ values: { ...completo, precio: -4 } })).toBe(
      'El precio debe ser mayor a 0.',
    )
  })

  test('un borrador se guarda sin precio ni stock, pero con los datos que exige el modelo', () => {
    const borrador = values => validateProductBasicsForSubmit({ values, publish: false })

    expect(borrador({ ...completo, precio: 0, cantidad: 0 })).toBeNull()
    expect(borrador({ ...completo, marca: '' })).toBe('La marca es obligatoria')
    expect(borrador({ ...completo, descripcion: ' ' })).toBe(
      'La descripción comercial es obligatoria',
    )
  })

  test('sin variantes exige stock; con variantes el stock sale de cada variante', () => {
    expect(validateProductBasicsForSubmit({ values: { ...completo, cantidad: 0 } })).toBe(
      'La cantidad en stock debe ser mayor a 0.',
    )
    expect(
      validateProductBasicsForSubmit({ values: { ...completo, cantidad: 0 }, hasVariants: true }),
    ).toBeNull()
  })
})

describe('Alta de producto · variantes rápidas', () => {
  test('lee «atributo: valores» separados por barra o salto de línea', () => {
    expect(parseQuickVariantText('Color: Negro, Blanco | Talle = S; M')).toEqual([
      {
        name: 'color',
        label: 'Color',
        type: 'color',
        values: ['Negro', 'Blanco'],
        required: false,
        sortOrder: 0,
        source: 'quick',
      },
      {
        name: 'talle',
        label: 'Talle',
        type: 'select',
        values: ['S', 'M'],
        required: false,
        sortOrder: 1,
        source: 'quick',
      },
    ])
  })

  test('también acepta un atributo por línea', () => {
    expect(
      parseQuickVariantText('Talle: S, M\nPresentación: Unidad, Pack').map(a => a.name),
    ).toEqual(['talle', 'presentacion'])
  })

  test('quita acentos del nombre, repite valores una sola vez y detecta los de color', () => {
    const [tamano, tipo] = parseQuickVariantText(
      'Tamaño: Chico, Chico, Grande | Tipo de color: rojo',
    )

    expect(tamano).toMatchObject({ name: 'tamano', label: 'Tamaño', values: ['Chico', 'Grande'] })
    expect(tipo).toMatchObject({ name: 'tipo_de_color', type: 'color' })
  })

  test('ignora las partes sin separador o sin valores, pero respeta su lugar en el orden', () => {
    const resultado = parseQuickVariantText('sin separador | vacio: , ; | Talle: S')

    expect(resultado).toHaveLength(1)
    expect(resultado[0]).toMatchObject({ name: 'talle', sortOrder: 2 })
    expect(parseQuickVariantText('')).toEqual([])
    expect(parseQuickVariantText(null)).toEqual([])
  })
})

describe('Alta de producto · ficha técnica rápida', () => {
  test('inferTechnicalFieldType adivina el tipo por cómo está escrito el valor', () => {
    expect(inferTechnicalFieldType('')).toBe('text')
    expect(inferTechnicalFieldType('sí')).toBe('boolean')
    expect(inferTechnicalFieldType('No')).toBe('boolean')
    expect(inferTechnicalFieldType('12')).toBe('number')
    expect(inferTechnicalFieldType('-3')).toBe('number')
    expect(inferTechnicalFieldType('12,5 kg')).toBe('number')
    expect(inferTechnicalFieldType('12 cm')).toBe('number')
    expect(inferTechnicalFieldType('rojo, azul')).toBe('multiselect')
    expect(inferTechnicalFieldType('Aluminio')).toBe('text')
    expect(inferTechnicalFieldType('x'.repeat(91))).toBe('textarea')
  })

  test('parseTechnicalFieldText arma los campos y sus valores', () => {
    const { fields, values } = parseTechnicalFieldText(
      'Alto: 12,5 cm | Material: Aluminio | Resistente al agua: sí | Colores: rojo, azul',
    )

    expect(values).toEqual({
      alto: 12.5,
      material: 'Aluminio',
      resistente_al_agua: true,
      colores: ['rojo', 'azul'],
    })

    expect(fields.map(f => [f.name, f.label, f.type])).toEqual([
      ['alto', 'Alto', 'number'],
      ['material', 'Material', 'text'],
      ['resistente_al_agua', 'Resistente Al Agua', 'boolean'],
      ['colores', 'Colores', 'multiselect'],
    ])

    expect(fields[0]).toMatchObject({
      unit: 'cm',
      filterable: false,
      searchable: true,
      visible: true,
      required: false,
      group: 'ficha técnica',
      source: 'quick',
      sortOrder: 0,
    })
    expect(fields[1].unit).toBe('')
    expect(fields[2].filterable).toBe(true)
    expect(fields[3]).toMatchObject({ values: ['rojo', 'azul'], filterable: true })
  })

  test('«no» y «false» quedan como false', () => {
    expect(parseTechnicalFieldText('Incluye funda: no').values).toEqual({ incluye_funda: false })
    expect(parseTechnicalFieldText('Incluye funda: false').values).toEqual({ incluye_funda: false })
  })

  test('descarta las partes sin separador o sin valor', () => {
    expect(parseTechnicalFieldText('Alto:').fields).toEqual([])
    expect(parseTechnicalFieldText('solo texto').fields).toEqual([])
    expect(parseTechnicalFieldText('')).toEqual({ fields: [], values: {} })
  })
})

describe('Alta de producto · mezcla de atributos de variantes', () => {
  test('mergeVariantAttributeDefinitions une los valores y conserva el orden y la etiqueta previos', () => {
    const resultado = mergeVariantAttributeDefinitions(
      [{ name: 'color', label: 'Color', values: ['Negro'], sortOrder: 0 }],
      [{ name: 'color', values: ['Blanco'], required: true }, { name: 'talle', values: ['S'] }, {}],
    )

    expect(resultado).toEqual([
      { name: 'color', label: 'Color', values: ['Negro', 'Blanco'], required: true, sortOrder: 0 },
      { name: 'talle', label: 'Talle', values: ['S'], required: false, sortOrder: 1 },
    ])
  })

  test('mergeSelectedVariantValues suma valores sin repetir, ignora vacíos y no modifica el original', () => {
    const actual = { color: ['Negro'] }
    const resultado = mergeSelectedVariantValues(actual, {
      color: ['Negro', 'Blanco'],
      talle: ['S', ' '],
      vacio: [],
    })

    expect(resultado).toEqual({ color: ['Negro', 'Blanco'], talle: ['S'] })
    expect(actual).toEqual({ color: ['Negro'] })
  })
})

describe('Alta de producto · generación de variantes', () => {
  const atributos = [{ name: 'color' }, { name: 'talle' }]

  test('sin valores elegidos devuelve un error y ninguna variante', () => {
    expect(generateVariantRowsFromSelection({ attributes: atributos })).toEqual({
      error: 'Agregá valores a por lo menos una opción vendible.',
      variants: [],
    })
  })

  test('arma todas las combinaciones, con clave, nombre, precio base y SKU', () => {
    const { variants, total } = generateVariantRowsFromSelection({
      attributes: atributos,
      selectedAttributes: { color: ['Negro', 'Blanco'], talle: ['S', 'M'] },
      basePrice: 100,
      productTitle: 'Casco',
    })

    expect(total).toBe(4)
    expect(variants.map(v => v.key)).toEqual([
      'color:negro|talle:s',
      'color:negro|talle:m',
      'color:blanco|talle:s',
      'color:blanco|talle:m',
    ])
    expect(variants[0]).toEqual({
      key: 'color:negro|talle:s',
      nombre: 'color: Negro / talle: S',
      combinacion: { color: 'Negro', talle: 'S' },
      price: 100,
      costoUnitario: null,
      stock: 0,
      sku: 'CASCO-NEGRO-S-01',
      isActive: true,
      imageSourceUid: null,
      uiStatus: 'new',
    })
  })

  test('al regenerar conserva lo que ya se había cargado en cada combinación', () => {
    const { variants } = generateVariantRowsFromSelection({
      attributes: atributos,
      selectedAttributes: { color: ['Negro'], talle: ['S', 'M'] },
      basePrice: 100,
      productTitle: 'Casco',
      previousVariants: [
        {
          key: 'color:negro|talle:s',
          price: 250,
          stock: 7,
          sku: 'MI-SKU',
          isActive: false,
          imageSourceUid: 'u1',
          costoUnitario: 80,
        },
      ],
    })

    expect(variants[0]).toMatchObject({
      price: 250,
      stock: 7,
      sku: 'MI-SKU',
      isActive: false,
      imageSourceUid: 'u1',
      costoUnitario: 80,
      uiStatus: 'existing',
    })
    expect(variants[1]).toMatchObject({ price: 100, stock: 0, uiStatus: 'new', isActive: true })
  })

  test('conserva un precio 0 ya cargado en vez de pisarlo con el precio base', () => {
    const { variants } = generateVariantRowsFromSelection({
      attributes: [{ name: 'color' }],
      selectedAttributes: { color: ['Negro'] },
      basePrice: 100,
      previousVariants: [{ key: 'color:negro', price: 0 }],
    })

    expect(variants[0].price).toBe(0)
  })

  test('hasta 200 combinaciones pasa; más de 200 se rechaza con el total', () => {
    const valores = n => Array.from({ length: n }, (_, i) => `v${i}`)

    const justo = generateVariantRowsFromSelection({
      attributes: [{ name: 'a' }],
      selectedAttributes: { a: valores(200) },
    })
    expect(justo.variants).toHaveLength(200)
    expect(justo.error).toBeUndefined()

    expect(
      generateVariantRowsFromSelection({
        attributes: [{ name: 'a' }],
        selectedAttributes: { a: valores(201) },
      }),
    ).toEqual({
      error: 'La selección produciría 201 variantes. El máximo permitido es 200.',
      variants: [],
      total: 201,
    })

    expect(
      generateVariantRowsFromSelection({
        attributes: [{ name: 'a' }, { name: 'b' }],
        selectedAttributes: { a: valores(15), b: valores(14) },
      }),
    ).toMatchObject({ total: 210, variants: [] })
  })
})

describe('Alta de producto · campos dinámicos de la plantilla', () => {
  test('normalizeDynamicFieldType entiende los sinónimos y cae en texto', () => {
    expect(normalizeDynamicFieldType('LongText')).toBe('textarea')
    expect(normalizeDynamicFieldType('integer')).toBe('number')
    expect(normalizeDynamicFieldType('Dropdown')).toBe('select')
    expect(normalizeDynamicFieldType('multi_select')).toBe('multiselect')
    expect(normalizeDynamicFieldType('colour')).toBe('color')
    expect(normalizeDynamicFieldType('checkbox')).toBe('boolean')
    expect(normalizeDynamicFieldType('string')).toBe('text')
    expect(normalizeDynamicFieldType('algo raro')).toBe('text')
    expect(normalizeDynamicFieldType('')).toBe('text')
  })

  test('normalizeDynamicFieldDefinition acepta un texto suelto', () => {
    expect(normalizeDynamicFieldDefinition('Peso neto', 3)).toEqual({
      name: 'peso_neto',
      label: 'Peso neto',
      type: 'text',
      values: [],
      required: false,
      sortOrder: 3,
      source: 'template',
    })
  })

  test('normalizeDynamicFieldDefinition acepta un objeto con nombres alternativos', () => {
    expect(
      normalizeDynamicFieldDefinition(
        { key: 'Cilindrada', type: 'numeric', unit: 'cc', isRequired: true, options: 'a, b;a' },
        2,
      ),
    ).toEqual({
      name: 'cilindrada',
      label: 'cilindrada',
      type: 'number',
      values: ['a', 'b'],
      unit: 'cc',
      placeholder: '',
      required: true,
      sortOrder: 2,
      source: 'template',
    })

    expect(normalizeDynamicFieldDefinition({ name: 'x', sortOrder: 5 }).sortOrder).toBe(5)
  })

  test('normalizeDynamicFieldDefinition descarta lo que no tiene nombre', () => {
    expect(normalizeDynamicFieldDefinition(null)).toBeNull()
    expect(normalizeDynamicFieldDefinition({})).toBeNull()
    expect(normalizeDynamicFieldDefinition('   ')).toBeNull()
  })

  test('extractTemplateDynamicFields lee listas y objetos de distintas claves', () => {
    const campos = extractTemplateDynamicFields({
      attributes: [{ name: 'a', values: ['x'] }],
      specs: { b: 'texto', c: 3, d: { type: 'select', values: ['p'] } },
    })

    expect(campos.map(c => [c.name, c.type])).toEqual([
      ['a', 'text'],
      ['b', 'text'],
      ['c', 'number'],
      ['d', 'select'],
    ])
    expect(campos[3].values).toEqual(['p'])
  })

  test('si un campo aparece en dos claves, junta los valores y queda requerido si alguno lo pide', () => {
    const campos = extractTemplateDynamicFields({
      attributes: [{ name: 'color', values: ['rojo'] }],
      fields: [{ name: 'color', values: ['azul'], required: true }],
      selectedSubcategory: { specs: [{ name: 'color', values: ['verde'] }] },
    })

    expect(campos).toHaveLength(1)
    expect(campos[0].values).toEqual(['rojo', 'azul', 'verde'])
    expect(campos[0].required).toBe(true)
  })

  test('sin plantilla no hay campos', () => {
    expect(extractTemplateDynamicFields(undefined)).toEqual([])
    expect(extractTemplateDynamicFields({})).toEqual([])
  })

  test('normalizeDynamicFieldValues deja solo lo que tiene valor, según el tipo', () => {
    const campos = [
      { name: 'activo', type: 'boolean' },
      { name: 'apagado', type: 'boolean' },
      { name: 'ausente', type: 'boolean' },
      { name: 'peso', type: 'number' },
      { name: 'negativo', type: 'number' },
      { name: 'vacio', type: 'number' },
      { name: 'colores', type: 'multiselect' },
      { name: 'sinColores', type: 'multiselect' },
      { name: 'nota', type: 'text' },
      { name: 'notaVacia', type: 'textarea' },
    ]

    expect(
      normalizeDynamicFieldValues(campos, {
        activo: 1,
        apagado: false,
        peso: '12',
        negativo: -3,
        vacio: '',
        colores: [' a ', '', 'b'],
        sinColores: [],
        nota: '  hola ',
        notaVacia: '   ',
      }),
    ).toEqual({
      activo: true,
      apagado: false,
      peso: 12,
      negativo: 0,
      colores: ['a', 'b'],
      nota: 'hola',
    })
  })
})

describe('Alta de producto · SEO', () => {
  const producto = {
    titulo: 'Casco AGV K1 Integral',
    descripcion: 'Casco integral de fibra para moto.',
    marca: 'AGV',
    categoria: 'Cascos',
    subcategoria: 'Integrales',
    tags: ['Moto', 'casco'],
    seoKeywords: 'casco moto, Integral',
  }

  test('arma slug, textos y palabras clave a partir del producto', () => {
    expect(buildSeoPayload(producto)).toEqual({
      slug: 'casco-agv-k1-integral',
      shortDescription: 'Casco integral de fibra para moto.',
      metaTitle: 'Casco AGV K1 Integral',
      metaDescription: 'Casco integral de fibra para moto.',
      keywords: ['casco moto', 'integral', 'agv', 'cascos', 'integrales', 'moto', 'casco'],
      focusKeyword: '',
      searchIntent: 'commercial',
      positioning: '',
      targetAudience: '',
      contentAngle: '',
      faq: [],
      contentPillars: [],
    })
  })

  test('el slug sale sin acentos y un slug escrito a mano tiene prioridad', () => {
    expect(buildSeoPayload({ titulo: 'Campera Térmica Ñandú' }).slug).toBe('campera-termica-nandu')
    expect(buildSeoPayload({ titulo: 'Casco', slug: 'Mi Slug_raro' }).slug).toBe('mi-slug-raro')
    expect(buildSeoPayload({ titulo: '!!!' }).slug).toBeUndefined()
  })

  test('recorta el título a 70 y las descripciones a 240 y 160 caracteres', () => {
    const largo = 'a'.repeat(300)
    const seo = buildSeoPayload({ titulo: largo, descripcion: largo })

    expect(seo.metaTitle).toHaveLength(70)
    expect(seo.shortDescription).toHaveLength(240)
    expect(seo.metaDescription).toHaveLength(160)
  })

  test('los textos escritos a mano no se pisan', () => {
    const seo = buildSeoPayload({
      ...producto,
      metaTitle: 'Título SEO',
      metaDescription: 'Descripción SEO',
      shortDescription: 'Corta',
    })

    expect(seo).toMatchObject({
      metaTitle: 'Título SEO',
      metaDescription: 'Descripción SEO',
      shortDescription: 'Corta',
    })
  })

  test('sin descripción comercial usa la técnica', () => {
    expect(
      buildSeoPayload({ titulo: 'Casco', descripcionTecnica: 'Fibra de vidrio' }).metaDescription,
    ).toBe('Fibra de vidrio')
  })

  test('las palabras clave son únicas, en minúscula y no pasan de 18', () => {
    const muchas = Array.from({ length: 30 }, (_, i) => `Clave ${i}`)

    expect(buildSeoPayload({ titulo: 'x', seoKeywords: muchas }).keywords).toHaveLength(18)
    expect(
      buildSeoPayload({ titulo: 'x', seoKeywords: ['Moto', 'MOTO', ' moto '] }).keywords,
    ).toEqual(['moto'])
  })

  test('las preguntas frecuentes y los pilares aceptan texto o lista', () => {
    const seo = buildSeoPayload({
      titulo: 'x',
      seoFaq: 'a\nb|c',
      seoContentPillars: 'uno, dos;tres',
    })

    expect(seo.faq).toEqual(['a', 'b', 'c'])
    expect(seo.contentPillars).toEqual(['uno', 'dos', 'tres'])
    expect(buildSeoPayload({ titulo: 'x', seoFaq: ['p'], seoContentPillars: ['q'] })).toMatchObject(
      {
        faq: ['p'],
        contentPillars: ['q'],
      },
    )
  })

  test('buildSeoFormValues devuelve lo mismo con los nombres de los campos del formulario', () => {
    const seo = buildSeoPayload(producto)

    expect(buildSeoFormValues(producto)).toEqual({
      slug: seo.slug,
      shortDescription: seo.shortDescription,
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      seoKeywords: seo.keywords,
      seoFocusKeyword: seo.focusKeyword,
      seoSearchIntent: seo.searchIntent,
      seoPositioning: seo.positioning,
      seoTargetAudience: seo.targetAudience,
      seoContentAngle: seo.contentAngle,
      seoFaq: seo.faq,
      seoContentPillars: seo.contentPillars,
    })
  })
})

describe('Alta de producto · logística', () => {
  test('sin datos usa envío estándar y todo en 0', () => {
    const logistica = buildLogisticsPayload({})

    expect(logistica).toEqual({
      weightKg: 0,
      dimensions: { length: 0, width: 0, height: 0, unit: 'cm' },
      package: { length: 0, width: 0, height: 0, unit: 'cm' },
      shipping: { type: 'standard', requiresShipping: true },
      warranty: '',
      countryOfOrigin: '',
    })
  })

  test('toma medidas, peso, garantía y origen', () => {
    expect(
      buildLogisticsPayload({
        weightKg: '1.5',
        packageLengthCm: 30,
        packageWidthCm: '20',
        packageHeightCm: 10,
        shippingType: 'fragile',
        warranty: ' 12 meses ',
        countryOfOrigin: ' Argentina ',
      }),
    ).toMatchObject({
      weightKg: 1.5,
      dimensions: { length: 30, width: 20, height: 10, unit: 'cm' },
      shipping: { type: 'fragile', requiresShipping: true },
      warranty: '12 meses',
      countryOfOrigin: 'Argentina',
    })
  })

  test('un producto digital no requiere envío', () => {
    expect(buildLogisticsPayload({ shippingType: 'digital' }).shipping).toEqual({
      type: 'digital',
      requiresShipping: false,
    })
  })

  test('un peso negativo se guarda como 0', () => {
    expect(buildLogisticsPayload({ weightKg: -2 }).weightKg).toBe(0)
  })
})

describe('Alta de producto · progreso de la carga', () => {
  const completo = {
    imageCount: 2,
    title: 'Casco',
    description: 'Casco integral',
    category: 'Cascos',
    subcategory: 'Integrales',
    price: 1500,
    stock: 3,
    brand: 'AGV',
  }

  test('con la carga vacía no hay nada hecho y no se puede publicar', () => {
    const progreso = buildProductReadiness({})

    expect(progreso.requiredChecks).toHaveLength(8)
    expect(progreso.doneRequired).toBe(0)
    expect(progreso.percent).toBe(0)
    expect(progreso.isReady).toBe(false)
  })

  test('con todo lo obligatorio completo se puede publicar', () => {
    const progreso = buildProductReadiness(completo)

    expect(progreso.doneRequired).toBe(8)
    expect(progreso.percent).toBe(100)
    expect(progreso.isReady).toBe(true)
  })

  test('el porcentaje cuenta solo lo obligatorio', () => {
    const progreso = buildProductReadiness({
      imageCount: 1,
      title: 'Casco',
      description: 'Descripción',
    })

    expect(progreso.doneRequired).toBe(3)
    expect(progreso.percent).toBe(38)
    expect(progreso.isReady).toBe(false)
  })

  test('un texto con solo espacios o un precio en 0 no cuentan', () => {
    const progreso = buildProductReadiness({ ...completo, title: '   ', price: 0 })
    const hecho = clave => progreso.checks.find(check => check.key === clave).done

    expect(hecho('title')).toBe(false)
    expect(hecho('price')).toBe(false)
    expect(progreso.isReady).toBe(false)
  })

  test('la ficha y las variantes no frenan la publicación', () => {
    const progreso = buildProductReadiness({
      ...completo,
      useTechnicalSheet: true,
      technicalFieldCount: 0,
      hasVariants: false,
    })

    expect(progreso.checks.find(check => check.key === 'ficha').done).toBe(false)
    expect(progreso.isReady).toBe(true)
  })

  // El guardado ya la exigía (y el modelo también): la barra llegaba al 100%
  // con un producto que después no se podía guardar.
  test('la marca es obligatoria, igual que al guardar', () => {
    const progreso = buildProductReadiness({ ...completo, brand: '' })

    expect(progreso.checks.find(check => check.key === 'marca')).toMatchObject({
      done: false,
      required: true,
    })
    expect(progreso.isReady).toBe(false)
  })

  test('con variantes el stock sale de las variantes y no del campo de stock', () => {
    const sinStock = buildProductReadiness({
      ...completo,
      stock: 50,
      hasVariants: true,
      variants: [{ stock: 0 }],
    })
    const conStock = buildProductReadiness({
      ...completo,
      stock: 0,
      hasVariants: true,
      variants: [{ stock: 0 }, { stock: 4 }],
    })
    const clave = (progreso, key) => progreso.checks.find(check => check.key === key)

    expect(clave(sinStock, 'stock')).toMatchObject({ done: false, label: 'Stock por variantes' })
    expect(sinStock.isReady).toBe(false)
    expect(clave(conStock, 'stock').done).toBe(true)
    expect(conStock.isReady).toBe(true)
  })

  test('una variante desactivada no cuenta como stock', () => {
    const progreso = buildProductReadiness({
      ...completo,
      hasVariants: true,
      variants: [{ stock: 4, isActive: false }, { stock: 0 }],
    })

    expect(progreso.checks.find(check => check.key === 'stock').done).toBe(false)
  })

  test('activar variantes sin generar ninguna deja pendiente el chequeo de variantes', () => {
    const progreso = buildProductReadiness({ ...completo, hasVariants: true, variants: [] })

    expect(progreso.checks.find(check => check.key === 'variantes').done).toBe(false)
  })
})

describe('Alta de producto · pasos de la barra de arriba', () => {
  const pasos = (datos, opciones = {}) => {
    const readiness = buildProductReadiness(datos)

    return buildWizardSteps({
      readiness,
      useTechnicalSheet: opciones.useTechnicalSheet ?? false,
      hasVariants: opciones.hasVariants ?? false,
    })
  }
  const estadoDe = (lista, clave) => lista.find(paso => paso.key === clave).status
  const completo = {
    imageCount: 1,
    title: 'Casco',
    description: 'Casco integral',
    category: 'Cascos',
    subcategory: 'Integrales',
    price: 1500,
    stock: 3,
    brand: 'AGV',
  }

  test('son seis, en orden, y cada uno apunta a su sección', () => {
    const lista = pasos({})

    expect(lista.map(p => p.key)).toEqual([
      'imagenes',
      'informacion',
      'ficha',
      'variantes',
      'precio',
      'publicar',
    ])
    expect(lista[0].sectionId).toBe('add-product-section-imagenes')
    expect(lista[5].sectionId).toBe('add-product-section-publicar')
    expect(lista.filter(p => p.optional).map(p => p.key)).toEqual(['ficha', 'variantes'])
  })

  // Regresión: los pasos buscaban las verificaciones por claves que no existían ('imagenes',
  // 'titulo', 'descripcion', 'precio'), así que «Imágenes» nunca se completaba aunque hubiera fotos.
  test('subir una imagen completa el paso «Imágenes»', () => {
    expect(estadoDe(pasos({ imageCount: 0 }), 'imagenes')).toBe('process')
    expect(estadoDe(pasos({ imageCount: 1 }), 'imagenes')).toBe('finish')
  })

  test('«Información» pide título, descripción, categoría y subcategoría', () => {
    expect(estadoDe(pasos({ title: 'Casco' }), 'informacion')).toBe('process')
    expect(
      estadoDe(
        pasos({ title: 'Casco', description: 'd', category: 'c', subcategory: 's' }),
        'informacion',
      ),
    ).toBe('finish')
    expect(
      estadoDe(pasos({ title: 'Casco', description: 'd', category: 'c' }), 'informacion'),
    ).toBe('process')
  })

  test('«Precio y SEO» pide precio y stock', () => {
    expect(estadoDe(pasos({ price: 100 }), 'precio')).toBe('process')
    expect(estadoDe(pasos({ price: 100, stock: 2 }), 'precio')).toBe('finish')
  })

  test('la ficha y las variantes quedan en espera mientras no se activan', () => {
    const lista = pasos(completo)

    expect(estadoDe(lista, 'ficha')).toBe('wait')
    expect(estadoDe(lista, 'variantes')).toBe('wait')
  })

  test('activada la ficha técnica, se completa al tener al menos un campo', () => {
    expect(
      estadoDe(
        pasos(
          { ...completo, useTechnicalSheet: true, technicalFieldCount: 0 },
          { useTechnicalSheet: true },
        ),
        'ficha',
      ),
    ).toBe('process')
    expect(
      estadoDe(
        pasos(
          { ...completo, useTechnicalSheet: true, technicalFieldCount: 2 },
          { useTechnicalSheet: true },
        ),
        'ficha',
      ),
    ).toBe('finish')
  })

  test('activadas las variantes, se completa al generar alguna', () => {
    expect(
      estadoDe(
        pasos({ ...completo, hasVariants: true, variants: [] }, { hasVariants: true }),
        'variantes',
      ),
    ).toBe('process')
    expect(
      estadoDe(
        pasos({ ...completo, hasVariants: true, variants: [{ stock: 1 }] }, { hasVariants: true }),
        'variantes',
      ),
    ).toBe('finish')
  })

  test('«Publicar» se completa solo cuando todo lo obligatorio está listo', () => {
    expect(estadoDe(pasos({ ...completo, imageCount: 0 }), 'publicar')).toBe('wait')
    expect(estadoDe(pasos(completo), 'publicar')).toBe('finish')
  })

  test('el paso actual es el primero obligatorio sin terminar, salteando los opcionales', () => {
    expect(getWizardCurrentStep(pasos({}))).toBe(0)
    expect(getWizardCurrentStep(pasos({ imageCount: 1 }))).toBe(1)
    expect(
      getWizardCurrentStep(
        pasos({ imageCount: 1, title: 'a', description: 'b', category: 'c', subcategory: 'd' }),
      ),
    ).toBe(4)
  })

  test('con todo listo el paso actual es el último', () => {
    const lista = pasos(completo)

    expect(getWizardCurrentStep(lista)).toBe(lista.length - 1)
  })
})

describe('Alta de producto · la pantalla', () => {
  // La pantalla tiene miles de líneas de formulario: en jsdom tarda varios segundos en montarse.
  jest.setTimeout(60000)

  beforeAll(() => {
    window.matchMedia =
      window.matchMedia ||
      (query => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }))
    window.scrollTo = () => {}
    // El formulario de Ant difiere sus avisos con un MessageChannel, que jsdom no trae.
    global.MessageChannel =
      global.MessageChannel ||
      class {
        constructor() {
          const canal = this
          this.port1 = { onmessage: null }
          this.port2 = {
            postMessage: dato => setTimeout(() => canal.port1.onmessage?.({ data: dato }), 0),
          }
        }
      }
    Element.prototype.scrollIntoView = () => {}
    global.ResizeObserver =
      global.ResizeObserver ||
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockApiGet.mockResolvedValue({ data: { data: [] } })
    mockGetCategories.mockResolvedValue({ data: [] })
    mockGetCategoryConfig.mockResolvedValue({ data: null })
    mockDispatch.mockImplementation(action => ({
      unwrap: () => Promise.resolve(action),
    }))
    mockCreateProducts.mockImplementation(payload => ({ type: 'product/create', payload }))
  })

  const montar = () => render(<AddProduct />)

  test('abre con el encabezado, las seis secciones y el botón de publicar', async () => {
    montar()

    expect(screen.getByRole('heading', { level: 1, name: /creá tu producto/i })).toBeTruthy()

    for (const titulo of ['Imágenes', 'Información', 'Ficha técnica', 'Variantes', 'Publicar']) {
      expect(screen.getAllByText(new RegExp(titulo, 'i')).length).toBeGreaterThan(0)
    }

    expect(screen.getByRole('button', { name: /publicar producto/i })).toBeTruthy()
    await waitFor(() => expect(mockGetCategories).toHaveBeenCalled())
  })

  test('el interruptor pasa de «Visible» a «Borrador» y cambia el botón', async () => {
    montar()

    const interruptor = screen.getByRole('switch', { name: /visible/i })

    expect(interruptor.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(interruptor)

    expect(await screen.findByRole('button', { name: /guardar como borrador/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /publicar producto/i })).toBeNull()
  })

  test('publicar con el formulario vacío no crea nada', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: /publicar producto/i }))

    expect((await screen.findAllByText(/el título es obligatorio/i)).length).toBeGreaterThan(0)
    expect(mockCreateProducts).not.toHaveBeenCalled()
  })

  test('el formulario vacío muestra el progreso en 0 y lo que falta', async () => {
    montar()

    expect((await screen.findAllByText(/faltan:/i)).length).toBeGreaterThan(0)
  })
})

// La IA no conoce el inventario: la visión nunca devuelve stock y el formulario
// caía en `|| 1`, así que todo producto armado desde una foto salía con una
// unidad que nadie había contado.
describe('Alta de producto · la IA no inventa stock', () => {
  const analisis = (extra = {}) => ({
    titulo: 'Casco integral',
    descripcion: 'Casco con visor',
    categoria: 'Accesorios',
    subcategoria: 'Cascos',
    marca: 'AGV',
    precio: 250000,
    ...extra,
  })

  test('el formulario queda con la cantidad vacía para que la cargue el comercio', () => {
    expect(normalizeAiAnalysisForForm(analisis()).fields.cantidad).toBeNull()
  })

  test('aunque el análisis traiga un número, la cantidad no lo toma', () => {
    expect(
      normalizeAiAnalysisForForm(analisis({ cantidad: 7, stock: 3 })).fields.cantidad,
    ).toBeNull()
  })

  test('el guardado automático sin cantidad cargada crea el producto con stock 0, no 1', () => {
    const payload = buildProductPayloadFromAnalysis({
      analysis: analisis(),
      job: { _id: 'j1', originalFilename: 'casco.jpg' },
      user: { _id: 'u1' },
    })

    expect(payload.stock).toBe(0)
  })
})

describe('Alta de producto · reintentar no duplica', () => {
  const pasos = registro => [
    { key: 'image:1', run: jest.fn(async () => registro.push('image:1')) },
    { key: 'image:2', run: jest.fn(async () => registro.push('image:2')) },
  ]

  test('crea el borrador una vez, corre los pasos en orden y publica al final', async () => {
    const registro = []
    const attempt = createProductAttempt('alta-test-0001')
    const createDraft = jest.fn(async () => {
      registro.push('crear')
      return { data: { _id: 'p1' } }
    })
    const publish = jest.fn(async () => registro.push('publicar'))

    await runProductAttempt({ attempt, createDraft, steps: pasos(registro), publish })

    expect(createDraft).toHaveBeenCalledWith('alta-test-0001')
    expect(registro).toEqual(['crear', 'image:1', 'image:2', 'publicar'])
    expect(publish).toHaveBeenCalledWith('p1')
  })

  test('si falla un paso, el reintento sigue desde ahí sin volver a crear ni a subir', async () => {
    const registro = []
    const attempt = createProductAttempt()
    const createDraft = jest.fn(async () => ({ data: { _id: 'p1' } }))
    const publish = jest.fn(async () => {})
    let falla = true
    const steps = [
      { key: 'image:1', run: jest.fn(async () => registro.push('image:1')) },
      {
        key: 'image:2',
        run: jest.fn(async () => {
          if (falla) throw new Error('timeout de Cloudinary')
          registro.push('image:2')
        }),
      },
    ]

    await expect(runProductAttempt({ attempt, createDraft, steps, publish })).rejects.toThrow(
      'timeout de Cloudinary',
    )
    expect(publish).not.toHaveBeenCalled()

    falla = false
    await runProductAttempt({ attempt, createDraft, steps, publish })

    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(registro).toEqual(['image:1', 'image:2'])
    expect(publish).toHaveBeenCalledTimes(1)
  })

  test('el análisis se cierra después de publicar: si publicar falla, sigue abierto', async () => {
    const registro = []
    const attempt = createProductAttempt()
    let fallaPublicar = true
    const correr = () =>
      runProductAttempt({
        attempt,
        createDraft: async () => ({ _id: 'p3' }),
        steps: [{ key: 'image', run: async () => registro.push('image') }],
        publish: async () => {
          if (fallaPublicar) throw new Error('503')
          registro.push('publicar')
        },
        finalSteps: [{ key: 'link-job', run: async () => registro.push('cerrar análisis') }],
      })

    await expect(correr()).rejects.toThrow('503')
    expect(registro).toEqual(['image'])

    fallaPublicar = false
    await correr()

    expect(registro).toEqual(['image', 'publicar', 'cerrar análisis'])
  })

  test('sin publicar, el producto queda como borrador', async () => {
    const attempt = createProductAttempt()

    await runProductAttempt({
      attempt,
      createDraft: async () => ({ _id: 'p2' }),
      steps: [],
      publish: null,
    })

    expect(attempt.productId).toBe('p2')
    expect(attempt.done.has('publish')).toBe(false)
  })

  test('cada alta lleva un identificador distinto que el backend acepta', () => {
    const a = createProductAttempt().clientRequestId
    const b = createProductAttempt().clientRequestId

    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9:_-]{8,100}$/)
  })

  test('el mensaje de error dice si el producto ya quedó guardado', () => {
    const error = { response: { data: { message: 'Imagen muy pesada' } } }

    expect(describeProductAttemptFailure(createProductAttempt(), error, 'Error')).toBe(
      'Imagen muy pesada',
    )

    const aMitad = { ...createProductAttempt(), productId: 'p1' }
    const mensaje = describeProductAttemptFailure(aMitad, error, 'Error')
    expect(mensaje).toMatch(/quedó guardado como borrador/)
    expect(mensaje).toMatch(/no se va a duplicar/)
  })
})

describe('Alta de producto · confianza de la IA en el panel', () => {
  // Se calculaba con `||` y un 85 por defecto: un 0 de la IA se mostraba como 85%.
  test('un 0 de la IA se muestra como 0%, no como 85%', () => {
    expect(resolveAiConfidencePercent({ confidence: 0 })).toBe(0)
  })

  test('sin dato de confianza no se inventa uno', () => {
    expect(resolveAiConfidencePercent({})).toBeNull()
    expect(resolveAiConfidencePercent({ confidence: null })).toBeNull()
    expect(resolveAiConfidencePercent({ confidence: 'alta' })).toBeNull()
    expect(resolveAiConfidencePercent(null)).toBeNull()
  })

  test('lee la escala de 0 a 1 y también un porcentaje', () => {
    expect(resolveAiConfidencePercent({ confidence: 0.724 })).toBe(72)
    expect(resolveAiConfidencePercent({ confidence: 85 })).toBe(85)
    expect(resolveAiConfidencePercent({ confianza: 0.5 })).toBe(50)
  })
})
