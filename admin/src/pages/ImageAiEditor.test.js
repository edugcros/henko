// Editor de imágenes con IA.
//
// Lo que se prueba es el contrato con la API y lo que el comerciante ve: qué
// archivo se manda, con qué descripción y propósito, y que una imagen que se
// agrega a un producto viaje marcada como generada por IA.

import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockRemoveBackground = jest.fn()
const mockGenerateVariation = jest.fn()
const mockGetAdminProducts = jest.fn()
const mockUploadProductImage = jest.fn()
const mockSnackbar = jest.fn()

jest.unstable_mockModule('../services/imageAiService', () => ({
  removeBackground: mockRemoveBackground,
  generateVariation: mockGenerateVariation,
  default: {},
}))

jest.unstable_mockModule('../features/product/productService', () => ({
  default: { getAdminProducts: mockGetAdminProducts, uploadProductImage: mockUploadProductImage },
}))

jest.unstable_mockModule('notistack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))

const { default: ImageAiEditor } = await import('./ImageAiEditor.js')

const RESULT_IMAGE = 'data:image/png;base64,iVBORw0KGgo='

const foto = (name = 'casco.jpg', type = 'image/jpeg', size = 2048) => {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const fileInput = () => document.querySelector('input[type="file"]')

beforeAll(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:preview')
  global.URL.revokeObjectURL = jest.fn()
  global.fetch = jest.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/png' }) }))
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRemoveBackground.mockResolvedValue({ image: RESULT_IMAGE, size: 1234 })
  mockGenerateVariation.mockResolvedValue({ image: RESULT_IMAGE, size: 4321 })
  mockGetAdminProducts.mockResolvedValue({ data: [{ _id: 'p1', title: 'Casco AGV K1' }] })
  mockUploadProductImage.mockResolvedValue({})
})

const subir = async file => {
  // applyAccept: false para poder probar archivos que el selector filtraría.
  await userEvent.upload(fileInput(), file, { applyAccept: false })
}

describe('Editor de imágenes · lo que se manda', () => {
  test('quitar fondo manda el archivo elegido', async () => {
    render(<ImageAiEditor />)
    const file = foto()

    await subir(file)
    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))

    await waitFor(() => expect(mockRemoveBackground).toHaveBeenCalledWith(file))
  })

  test('sin foto no se puede procesar', () => {
    render(<ImageAiEditor />)

    expect(screen.getByRole('button', { name: /^Quitar fondo$/i }).disabled).toBe(true)
  })

  test('generar un fondo manda la descripción y el propósito', async () => {
    render(<ImageAiEditor />)
    const file = foto()

    await userEvent.click(screen.getByText('Generar variación'))
    await userEvent.click(screen.getByText('Redes sociales'))
    await subir(file)
    await userEvent.type(screen.getByRole('textbox'), '  Sobre mármol blanco  ')
    await userEvent.click(screen.getByRole('button', { name: /^Generar variación$/i }))

    await waitFor(() =>
      expect(mockGenerateVariation).toHaveBeenCalledWith(file, 'Sobre mármol blanco', 'social'),
    )
  })

  test('sin descripción no se genera nada', async () => {
    render(<ImageAiEditor />)

    await userEvent.click(screen.getByText('Generar variación'))
    await subir(foto())
    await userEvent.click(screen.getByRole('button', { name: /^Generar variación$/i }))

    expect(mockGenerateVariation).not.toHaveBeenCalled()
  })
})

describe('Editor de imágenes · archivos', () => {
  test('un archivo que no es imagen se rechaza sin llamar a la API', async () => {
    render(<ImageAiEditor />)

    await subir(foto('notas.pdf', 'application/pdf'))

    expect(mockSnackbar).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Quitar fondo$/i }).disabled).toBe(true)
  })

  test('una imagen de más de 10 MB se rechaza', async () => {
    render(<ImageAiEditor />)

    await subir(foto('grande.jpg', 'image/jpeg', 11 * 1024 * 1024))

    expect(mockSnackbar.mock.calls[0][0]).toMatch(/10 MB/)
    expect(screen.getByRole('button', { name: /^Quitar fondo$/i }).disabled).toBe(true)
  })
})

describe('Editor de imágenes · resultados', () => {
  test('el resultado aparece y el error del backend se muestra tal cual', async () => {
    render(<ImageAiEditor />)
    await subir(foto())
    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))

    expect(await screen.findByAltText(/Resultado/i)).toBeDefined()

    mockRemoveBackground.mockRejectedValueOnce({
      response: { data: { message: 'Alcanzaste el límite temporal de eliminación de fondos.' } },
    })
    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))

    await waitFor(() =>
      expect(mockSnackbar).toHaveBeenCalledWith(
        'Alcanzaste el límite temporal de eliminación de fondos.',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
  })
})
