// Editor de imágenes con IA.
//
// Lo que se prueba es el contrato con la API y lo que el comerciante ve: qué
// archivo se manda, con qué descripción y propósito, y que una imagen que se
// agrega a un producto viaje marcada como generada por IA.

import { jest } from '@jest/globals'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockRemoveBackground = jest.fn()
const mockGenerateVariation = jest.fn()
const mockCreateStudio = jest.fn()
const mockGetStatus = jest.fn()
const mockGetAdminProducts = jest.fn()
const mockUploadProductImage = jest.fn()
const mockSnackbar = jest.fn()
const mockGetAiBudget = jest.fn()

jest.unstable_mockModule('../services/imageAiService', () => ({
  removeBackground: mockRemoveBackground,
  generateVariation: mockGenerateVariation,
  createStudioBackground: mockCreateStudio,
  getImageAiStatus: mockGetStatus,
  default: {},
}))

jest.unstable_mockModule('../features/product/productService', () => ({
  default: { getAdminProducts: mockGetAdminProducts, uploadProductImage: mockUploadProductImage },
}))

jest.unstable_mockModule('../services/aiBudgetService', () => ({
  getAiBudget: mockGetAiBudget,
  default: {},
}))

jest.unstable_mockModule('notistack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))

// El usuario logueado, para la clave de sesión de los resultados.
let mockUser = { _id: 'u1', tenantId: 't1' }

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector({ user: { user: mockUser } }),
}))

jest.unstable_mockModule('../features/auth/authSlice', () => ({
  buildSessionKey: user => (user ? `${user._id}:${user.tenantId}` : null),
}))

const {
  default: ImageAiEditor,
  checkImageFile,
  describeQuota,
  imageExtension,
  resetEditorResults,
} = await import('./ImageAiEditor.js')

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
  resetEditorResults()
  mockUser = { _id: 'u1', tenantId: 't1' }
  mockRemoveBackground.mockResolvedValue({ image: RESULT_IMAGE, size: 1234 })
  mockGenerateVariation.mockResolvedValue({ image: RESULT_IMAGE, size: 4321 })
  mockGetAdminProducts.mockResolvedValue({ data: [{ _id: 'p1', title: 'Casco AGV K1' }] })
  mockUploadProductImage.mockResolvedValue({})
  mockCreateStudio.mockResolvedValue({ image: 'data:image/jpeg;base64,/9j/4AAQ', size: 2048 })
  mockGetStatus.mockResolvedValue({ generativeBackground: { available: true, retryAt: null } })
  mockGetAiBudget.mockResolvedValue({
    metrics: { imageEdits: { used: 8, limit: 500, unlimited: false, remaining: 492 } },
  })
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

    expect(screen.getByRole('button', { name: /^Generar variación$/i }).disabled).toBe(true)
    expect(screen.getByText(/Describí el fondo para poder generarlo/i)).toBeDefined()
    expect(mockGenerateVariation).not.toHaveBeenCalled()
  })
})

describe('Editor de imágenes · archivos', () => {
  test('un archivo que no es imagen se rechaza sin llamar a la API', async () => {
    render(<ImageAiEditor />)

    await subir(foto('notas.pdf', 'application/pdf'))

    expect(screen.getByText(/Ese formato no se puede usar/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /^Quitar fondo$/i }).disabled).toBe(true)
  })

  test('una imagen de más de 10 MB se rechaza', async () => {
    render(<ImageAiEditor />)

    await subir(foto('grande.jpg', 'image/jpeg', 11 * 1024 * 1024))

    expect(screen.getByText(/no puede superar los 10 MB/i)).toBeDefined()
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

// ─── Rediseño ────────────────────────────────────────────────────────────

const quitarFondo = async () => {
  render(<ImageAiEditor />)
  await subir(foto())
  await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))
  await screen.findByAltText(/Resultado/i)
}

describe('Editor de imágenes · usar en un producto', () => {
  test('agregar a un producto sube la imagen marcada como generada por IA', async () => {
    render(<ImageAiEditor />)
    await subir(foto())
    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))
    await screen.findByAltText(/Resultado/i)

    await userEvent.click(screen.getByRole('button', { name: /Usar en un producto/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('combobox'), 'Casco')
    await userEvent.click(await screen.findByText('Casco AGV K1'))
    await userEvent.click(within(dialog).getByRole('button', { name: /Agregar al producto/i }))

    await waitFor(() => expect(mockUploadProductImage).toHaveBeenCalled())
    const [productId, file, meta] = mockUploadProductImage.mock.calls[0]
    expect(productId).toBe('p1')
    expect(file).toBeInstanceOf(File)
    expect(meta).toEqual({ aiGenerated: true, aiSource: 'remove-bg', imagePurpose: 'store' })
  })

  test('después de agregarla, el resultado dice en qué producto quedó', async () => {
    await quitarFondo()

    await userEvent.click(screen.getByRole('button', { name: /Usar en un producto/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('combobox'), 'Casco')
    await userEvent.click(await screen.findByText('Casco AGV K1'))
    await userEvent.click(within(dialog).getByRole('button', { name: /Agregar al producto/i }))

    expect(await screen.findByText(/En «Casco AGV K1»/)).toBeDefined()
  })
})

describe('Editor de imágenes · archivos que acepta el backend', () => {
  test('un GIF o un SVG se rechazan antes de subir (antes pasaba cualquier image/*)', () => {
    expect(checkImageFile(foto('a.gif', 'image/gif')).error).toMatch(/formato/)
    expect(checkImageFile(foto('a.svg', 'image/svg+xml')).error).toMatch(/formato/)
  })

  test('un HEIC sin tipo se acepta y viaja con el tipo correcto', () => {
    const { file, error } = checkImageFile(foto('IMG_0001.HEIC', ''))

    expect(error).toBeUndefined()
    expect(file.type).toBe('image/heic')
  })

  test('una foto válida pasa tal cual', () => {
    const original = foto('casco.webp', 'image/webp')

    expect(checkImageFile(original).file).toBe(original)
  })
})

describe('Editor de imágenes · no se pierden resultados', () => {
  test('cambiar de foto no borra los resultados', async () => {
    await quitarFondo()

    await subir(foto('otra.png', 'image/png'))

    expect(screen.getByAltText(/Resultado/i)).toBeDefined()
  })

  test('mientras procesa no se puede cambiar ni quitar la foto', async () => {
    mockRemoveBackground.mockReturnValue(new Promise(() => {}))
    render(<ImageAiEditor />)
    await subir(foto())

    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))

    expect(screen.getByRole('button', { name: /^Cambiar$/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /^Quitar$/i }).disabled).toBe(true)
  })

  // El panel usa BrowserRouter: irse por el menú desmonta el editor sin pasar
  // por beforeunload. Antes eso descartaba los resultados sin preguntar.
  test('irse a otra pantalla del panel y volver conserva los resultados', async () => {
    const { unmount } = render(<ImageAiEditor />)
    await subir(foto())
    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))
    await screen.findByAltText(/Resultado/i)

    unmount()
    render(<ImageAiEditor />)

    expect(screen.getByAltText(/Resultado/i)).toBeDefined()
    expect(screen.getByText('1 sin guardar')).toBeDefined()
  })

  test('otro usuario o comercio en la misma pestaña no ve esos resultados', async () => {
    const { unmount } = render(<ImageAiEditor />)
    await subir(foto())
    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))
    await screen.findByAltText(/Resultado/i)
    unmount()

    mockUser = { _id: 'u2', tenantId: 't2' }
    render(<ImageAiEditor />)

    expect(screen.queryByAltText(/Resultado/i)).toBeNull()
  })

  test('salir con resultados sin guardar pide confirmación', async () => {
    await quitarFondo()

    const event = new Event('beforeunload', { cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  test('descargado, ya no pide confirmación', async () => {
    await quitarFondo()
    await userEvent.click(screen.getByRole('button', { name: /Descargar/i }))

    const event = new Event('beforeunload', { cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByText('Descargada')).toBeDefined()
  })

  test('borrar todos con imágenes sin guardar pregunta antes', async () => {
    await quitarFondo()
    await userEvent.click(screen.getByRole('button', { name: /^Quitar fondo$/i }))
    await waitFor(() => expect(screen.getAllByAltText(/Resultado/i)).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: /^Borrar todos$/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Hay 2 imágenes/)).toBeDefined()

    await userEvent.click(within(dialog).getByRole('button', { name: /^Borrar todos$/i }))
    await waitFor(() => expect(screen.queryAllByAltText(/Resultado/i)).toHaveLength(0))
  })
})

describe('Editor de imágenes · cupo de fondos generados', () => {
  test('se ve cuánto queda antes de gastarlo', async () => {
    render(<ImageAiEditor />)

    expect(await screen.findByText('Te quedan 492 de 500 este mes')).toBeDefined()
    // Quitar fondo y fondo de estudio: los dos corren en el servidor, sin cupo.
    expect(screen.getAllByText('No usa cuota')).toHaveLength(2)
  })

  test('sin cupo no se puede generar, pero sí quitar el fondo', async () => {
    mockGetAiBudget.mockResolvedValue({
      metrics: { imageEdits: { used: 500, limit: 500, unlimited: false, remaining: 0 } },
    })
    render(<ImageAiEditor />)
    await subir(foto())
    await screen.findByText('Sin cupo este mes')

    expect(screen.getByRole('button', { name: /^Quitar fondo$/i }).disabled).toBe(false)

    await userEvent.click(screen.getByText('Generar variación'))
    await userEvent.type(screen.getByRole('textbox'), 'Sobre mármol')

    expect(screen.getByRole('button', { name: /^Generar variación$/i }).disabled).toBe(true)
    expect(screen.getByText(/Llegaste al tope de fondos generados/)).toBeDefined()
  })

  test('después de generar se vuelve a consultar el cupo', async () => {
    render(<ImageAiEditor />)
    await userEvent.click(screen.getByText('Generar variación'))
    await subir(foto())
    await userEvent.type(screen.getByRole('textbox'), 'Sobre mármol')
    await userEvent.click(screen.getByRole('button', { name: /^Generar variación$/i }))

    await waitFor(() => expect(mockGetAiBudget).toHaveBeenCalledTimes(2))
  })

  test('si no se puede consultar el cupo, la pantalla funciona igual', async () => {
    mockGetAiBudget.mockRejectedValue(new Error('403'))
    render(<ImageAiEditor />)

    expect(await screen.findByText('Usa 1 fondo del plan')).toBeDefined()
  })

  test('describeQuota', () => {
    expect(describeQuota(null)).toBeNull()
    expect(describeQuota({ unlimited: true }).text).toBe('Sin tope en tu plan')
    expect(describeQuota({ remaining: 0, limit: 100 }).exhausted).toBe(true)
    expect(describeQuota({ remaining: 1500, limit: 2000 }).text).toBe(
      'Te quedan 1.500 de 2.000 este mes',
    )
  })
})

// ─── Fondos de estudio y IA generativa no disponible ─────────────────────
//
// Medido en producción el 31/10/2026: "Generar variación" fallaba en el 100%
// de los intentos (Gemini sin cuota). Los fondos de estudio no dependen de
// ningún proveedor; y si la IA no puede, la pantalla lo dice antes.

describe('Editor de imágenes · fondo de estudio', () => {
  test('manda la foto, el fondo elegido y el propósito', async () => {
    render(<ImageAiEditor />)
    const file = foto()

    await userEvent.click(screen.getByText('Fondo de estudio'))
    await subir(file)
    await userEvent.click(screen.getByRole('radio', { name: 'Beige cálido' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Redes sociales' }))
    await userEvent.click(screen.getByRole('button', { name: /^Armar fondo de estudio$/i }))

    await waitFor(() =>
      expect(mockCreateStudio).toHaveBeenCalledWith(file, {
        style: 'beige',
        color: null,
        purpose: 'social',
      }),
    )
    expect(await screen.findByText(/Fondo de estudio · Beige cálido/)).toBeDefined()
  })

  test('el color propio exige un código válido', async () => {
    render(<ImageAiEditor />)

    await userEvent.click(screen.getByText('Fondo de estudio'))
    await subir(foto())
    await userEvent.click(screen.getByRole('radio', { name: 'Tu color' }))
    const codigo = screen.getByLabelText('Código del color')
    await userEvent.clear(codigo)
    await userEvent.type(codigo, '#12')

    expect(screen.getByText(/Usá un código como #0b6bff/)).toBeDefined()
    expect(screen.getByRole('button', { name: /^Armar fondo de estudio$/i }).disabled).toBe(true)

    await userEvent.type(codigo, '3456')
    await userEvent.click(screen.getByRole('button', { name: /^Armar fondo de estudio$/i }))

    await waitFor(() =>
      expect(mockCreateStudio.mock.calls[0][1]).toEqual({
        style: 'color',
        color: '#123456',
        purpose: undefined,
      }),
    )
  })

  test('no usa cuota de IA', async () => {
    render(<ImageAiEditor />)

    await userEvent.click(screen.getByText('Fondo de estudio'))
    await subir(foto())
    await userEvent.click(screen.getByRole('button', { name: /^Armar fondo de estudio$/i }))
    await screen.findByAltText(/Resultado con fondo de estudio/i)

    // El cupo se consultó al entrar y no se volvió a consultar.
    expect(mockGetAiBudget).toHaveBeenCalledTimes(1)
    expect(mockGenerateVariation).not.toHaveBeenCalled()
  })

  test('al producto viaja como JPEG, marcado como fondo de estudio de catálogo', async () => {
    render(<ImageAiEditor />)
    await userEvent.click(screen.getByText('Fondo de estudio'))
    await subir(foto())
    await userEvent.click(screen.getByRole('button', { name: /^Armar fondo de estudio$/i }))
    await screen.findByAltText(/Resultado con fondo de estudio/i)

    await userEvent.click(screen.getByRole('button', { name: /Usar en un producto/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('combobox'), 'Casco')
    await userEvent.click(await screen.findByText('Casco AGV K1'))
    await userEvent.click(within(dialog).getByRole('button', { name: /Agregar al producto/i }))

    await waitFor(() => expect(mockUploadProductImage).toHaveBeenCalled())
    const [, file, meta] = mockUploadProductImage.mock.calls[0]
    expect(file.name).toMatch(/\.jpg$/)
    expect(meta).toEqual({ aiGenerated: true, aiSource: 'studio', imagePurpose: 'store' })
  })

  test('imageExtension', () => {
    expect(imageExtension('data:image/jpeg;base64,xx')).toBe('jpg')
    expect(imageExtension('data:image/png;base64,xx')).toBe('png')
    expect(imageExtension(undefined)).toBe('png')
  })
})

describe('Editor de imágenes · IA generativa no disponible', () => {
  test('se avisa antes de subir nada y se ofrece el fondo de estudio', async () => {
    mockGetStatus.mockResolvedValue({
      generativeBackground: { available: false, retryAt: '2026-11-01T15:30:00.000Z' },
    })
    render(<ImageAiEditor />)

    expect(await screen.findByText('No disponible ahora')).toBeDefined()

    await userEvent.click(screen.getByText('Generar variación'))
    await subir(foto())
    await userEvent.type(screen.getByLabelText(/Descripción del fondo/i), 'Sobre mármol')

    expect(screen.getByText(/no está disponible en este momento/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /^Generar variación$/i }).disabled).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: /Usar fondo de estudio/i }))
    expect(screen.getByRole('button', { name: /^Armar fondo de estudio$/i })).toBeDefined()
  })

  test('si el backend responde que no está disponible, la opción se desactiva', async () => {
    mockGenerateVariation.mockRejectedValue({
      response: {
        data: {
          code: 'IMAGE_GENERATION_UNAVAILABLE',
          message: 'La generación de fondos no está disponible en este momento.',
          retryAt: '2026-11-01T15:30:00.000Z',
        },
      },
    })
    render(<ImageAiEditor />)

    await userEvent.click(screen.getByText('Generar variación'))
    await subir(foto())
    await userEvent.type(screen.getByLabelText(/Descripción del fondo/i), 'Sobre mármol')
    await userEvent.click(screen.getByRole('button', { name: /^Generar variación$/i }))

    expect(await screen.findByText('No disponible ahora')).toBeDefined()
    expect(screen.getByRole('button', { name: /^Generar variación$/i }).disabled).toBe(true)
  })

  test('si no se puede consultar el estado, la opción queda habilitada', async () => {
    mockGetStatus.mockRejectedValue(new Error('red'))
    render(<ImageAiEditor />)

    await userEvent.click(screen.getByText('Generar variación'))
    await subir(foto())
    await userEvent.type(screen.getByLabelText(/Descripción del fondo/i), 'Sobre mármol')

    expect(screen.getByRole('button', { name: /^Generar variación$/i }).disabled).toBe(false)
  })
})
