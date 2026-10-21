// Redes sociales (SocialPromotionPage).
//
// La IA escribe el texto y los hashtags de un producto para que el comercio los copie y los publique
// en Instagram desde su cuenta. No tenía tests. Lo que se fija acá:
//
//   - la búsqueda del producto y lo que se muestra al elegirlo;
//   - cómo se genera el contenido, con el dato exacto que se manda;
//   - qué se copia al portapapeles (el texto editado, los hashtags, o todo junto) y qué se avisa;
//   - qué se ve cuando la generación falla.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockDispatch = jest.fn()
const mockGetAdminProducts = jest.fn(args => ({ type: 'getAdminProducts', args }))
const mockGenerate = jest.fn()
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()

const estado = { product: {} }

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../features/product/productSlice', () => ({
  getAdminProducts: mockGetAdminProducts,
}))

jest.unstable_mockModule('../features/marketing/socialPromotionService', () => ({
  default: { generateSocialContent: mockGenerate },
}))

jest.unstable_mockModule('react-toastify', () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}))

const { default: SocialPromotionPage } = await import('./SocialPromotionPage.jsx')

const CASCO = {
  _id: 'p1',
  title: 'Casco AGV K1',
  price: 285000,
  images: [{ url: 'casco-secundaria.jpg' }, { url: 'casco.jpg', isMain: true }],
}
const GUANTES = { _id: 'p2', title: 'Guantes Alpinestars', price: 98500 }

const CONTENIDO = {
  productTitle: 'Casco AGV K1',
  caption: 'Protegé tu cabeza con estilo.',
  hashtags: ['moto', 'casco', 'agv'],
  imageUrl: 'https://cdn.test/casco.jpg',
}

const montar = (product = {}) => {
  estado.product = { adminProducts: [CASCO, GUANTES], isAdminLoading: false, ...product }

  return render(<SocialPromotionPage />)
}

const elegir = async titulo => {
  await userEvent.click(screen.getByRole('combobox', { name: /buscar producto/i }))
  await userEvent.click(await screen.findByRole('option', { name: titulo }))
}

const generar = async () => {
  await userEvent.click(screen.getByRole('button', { name: /generar contenido|regenerar/i }))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(() => ({}))
  mockGenerate.mockResolvedValue(CONTENIDO)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  })
})

describe('Redes · elegir el producto', () => {
  test('al abrir pide los productos del comercio', () => {
    montar()

    expect(mockGetAdminProducts).toHaveBeenCalledTimes(1)
  })

  test('explica que no publica nada automáticamente', () => {
    montar()

    expect(screen.getByText(/No publica nada automáticamente/)).toBeTruthy()
  })

  test('ofrece los productos para elegir', async () => {
    montar()

    await userEvent.click(screen.getByRole('combobox', { name: /buscar producto/i }))

    expect(await screen.findByRole('option', { name: 'Casco AGV K1' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Guantes Alpinestars' })).toBeTruthy()
  })

  test('al elegir uno muestra su nombre, su precio y su imagen principal', async () => {
    montar()

    await elegir('Casco AGV K1')

    expect(screen.getByText(/\$\s?285\.000/)).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Casco AGV K1' }).getAttribute('src')).toBe('casco.jpg')
    expect(screen.getByRole('button', { name: 'Generar contenido' })).toBeTruthy()
  })

  test('un producto sin imágenes no muestra imagen', async () => {
    montar()

    await elegir('Guantes Alpinestars')

    expect(screen.queryByRole('img')).toBeNull()
  })

  test('sin producto elegido no hay botón de generar', () => {
    montar()

    expect(screen.queryByRole('button', { name: /generar contenido/i })).toBeNull()
  })
})

describe('Redes · generar', () => {
  test('manda el id del producto y muestra el texto, los hashtags y la imagen', async () => {
    montar()

    await elegir('Casco AGV K1')
    await generar()

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith('p1'))
    expect(await screen.findByDisplayValue('Protegé tu cabeza con estilo.')).toBeTruthy()
    expect(screen.getByText('#moto')).toBeTruthy()
    expect(screen.getByText('#casco')).toBeTruthy()
    expect(screen.getByText('#agv')).toBeTruthy()
    expect(
      screen.getAllByRole('img').some(img => img.getAttribute('src') === CONTENIDO.imageUrl),
    ).toBe(true)
  })

  test('mientras genera el botón dice «Generando...» y queda bloqueado', async () => {
    let terminar
    mockGenerate.mockReturnValue(
      new Promise(resolve => {
        terminar = resolve
      }),
    )
    montar()

    await elegir('Casco AGV K1')
    await generar()

    const boton = await screen.findByRole('button', { name: /generando/i })

    expect(boton.disabled).toBe(true)

    terminar(CONTENIDO)
    await screen.findByDisplayValue('Protegé tu cabeza con estilo.')
  })

  test('después de generar, el botón pasa a «Regenerar»', async () => {
    montar()

    await elegir('Casco AGV K1')
    await generar()

    expect(await screen.findByRole('button', { name: 'Regenerar' })).toBeTruthy()
  })

  test('si falla, muestra el mensaje del error y no muestra contenido', async () => {
    mockGenerate.mockRejectedValue(new Error('La IA no está disponible'))
    montar()

    await elegir('Casco AGV K1')
    await generar()

    expect(await screen.findByText('La IA no está disponible')).toBeTruthy()
    expect(screen.queryByText('Contenido generado')).toBeNull()
  })

  test('elegir otro producto limpia el contenido y el error anteriores', async () => {
    montar()

    await elegir('Casco AGV K1')
    await generar()
    await screen.findByDisplayValue('Protegé tu cabeza con estilo.')

    await elegir('Guantes Alpinestars')

    expect(screen.queryByDisplayValue('Protegé tu cabeza con estilo.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Generar contenido' })).toBeTruthy()
  })

  test('regenerar reemplaza el texto, aunque se lo haya editado', async () => {
    mockGenerate
      .mockResolvedValueOnce(CONTENIDO)
      .mockResolvedValueOnce({ ...CONTENIDO, caption: 'Otro texto distinto.' })
    montar()

    await elegir('Casco AGV K1')
    await generar()

    const campo = await screen.findByDisplayValue('Protegé tu cabeza con estilo.')

    await userEvent.type(campo, ' Editado.')
    await generar()

    expect(await screen.findByDisplayValue('Otro texto distinto.')).toBeTruthy()
  })
})

describe('Redes · copiar', () => {
  const conContenido = async () => {
    montar()
    await elegir('Casco AGV K1')
    await generar()
    await screen.findByDisplayValue('Protegé tu cabeza con estilo.')
  }

  test('«Copiar caption» copia el texto y avisa', async () => {
    await conContenido()

    await userEvent.click(screen.getByRole('button', { name: /copiar caption/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Protegé tu cabeza con estilo.')
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Caption copiado al portapapeles'),
    )
  })

  test('copia el texto editado, no el original', async () => {
    await conContenido()

    await userEvent.type(
      screen.getByDisplayValue('Protegé tu cabeza con estilo.'),
      ' Envíos a todo el país.',
    )
    await userEvent.click(screen.getByRole('button', { name: /copiar caption/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Protegé tu cabeza con estilo. Envíos a todo el país.',
    )
  })

  test('«Copiar hashtags» copia los hashtags separados por espacio', async () => {
    await conContenido()

    await userEvent.click(screen.getByRole('button', { name: /copiar hashtags/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('#moto #casco #agv')
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Hashtags copiado al portapapeles'),
    )
  })

  test('«Copiar todo» copia el texto, una línea en blanco y los hashtags', async () => {
    await conContenido()

    await userEvent.click(screen.getByRole('button', { name: /copiar todo/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Protegé tu cabeza con estilo.\n\n#moto #casco #agv',
    )
  })

  test('si el navegador no deja copiar, avisa que se copie a mano', async () => {
    await conContenido()
    navigator.clipboard.writeText.mockRejectedValue(new Error('bloqueado'))

    await userEvent.click(screen.getByRole('button', { name: /copiar caption/i }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'No se pudo copiar — seleccioná el texto manualmente',
      ),
    )
  })

  test('con el texto vacío no copia nada', async () => {
    await conContenido()

    await userEvent.clear(screen.getByDisplayValue('Protegé tu cabeza con estilo.'))
    await userEvent.click(screen.getByRole('button', { name: /copiar caption/i }))

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  test('el contenido generado recuerda dónde conseguir la imagen', async () => {
    await conContenido()

    expect(
      within(screen.getByText('Contenido generado').closest('div').parentElement).getByText(
        /Descargá la imagen desde la ficha del producto/,
      ),
    ).toBeTruthy()
  })
})
