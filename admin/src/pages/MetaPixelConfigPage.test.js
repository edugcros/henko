// Configuración de Meta Pixel (MetaPixelConfigPage).
//
// Donde el comercio conecta su Pixel de Meta y su token de Conversions API para medir las campañas de
// Facebook e Instagram. No tenía tests. Lo que se fija acá:
//
//   - lo que se carga y lo que se muestra de lo ya guardado (el token NUNCA vuelve al navegador:
//     solo se sabe si existe);
//   - lo que se manda al guardar (el token solo si se escribió, sin espacios);
//   - qué se avisa cuando algo sale bien o mal;
//   - la guía paso a paso y las preguntas frecuentes, que son buena parte de la pantalla.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockGet = jest.fn()
const mockUpdate = jest.fn()

jest.unstable_mockModule('../services/metaPixelConfigService.js', () => ({
  getMetaPixelConfig: mockGet,
  updateMetaPixelConfig: mockUpdate,
}))

const { default: MetaPixelConfigPage } = await import('./MetaPixelConfigPage.jsx')

const CONFIG = {
  meta: {
    pixelId: '123456789012345',
    isEnabled: true,
    hasAccessToken: true,
    connectedAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-12T12:00:00.000Z',
  },
}

const montar = async (config = CONFIG) => {
  mockGet.mockResolvedValue(config)

  render(<MetaPixelConfigPage />)

  await screen.findByRole('textbox', { name: /id de pixel/i })
}

const campo = nombre => screen.getByLabelText(nombre, { exact: false })

const guardar = () => screen.getAllByRole('button', { name: /guardar cambios/i })[0]

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockImplementation(async payload => ({
    meta: { ...CONFIG.meta, ...payload.meta },
  }))
})

describe('Meta Pixel · carga', () => {
  test('mientras carga muestra un indicador', () => {
    mockGet.mockReturnValue(new Promise(() => {}))

    render(<MetaPixelConfigPage />)

    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor y permite reintentar', async () => {
    mockGet.mockRejectedValueOnce({ response: { data: { message: 'No hay conexión' } } })
    jest.spyOn(console, 'error').mockImplementation(() => {})

    render(<MetaPixelConfigPage />)

    expect(await screen.findByText('No hay conexión')).toBeTruthy()

    mockGet.mockResolvedValue(CONFIG)
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByRole('textbox', { name: /id de pixel/i })).toBeTruthy()
    console.error.mockRestore()
  })

  test('un error sin mensaje muestra uno genérico', async () => {
    mockGet.mockRejectedValue(new Error(''))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    render(<MetaPixelConfigPage />)

    expect(
      await screen.findByText('No se pudo cargar la configuración de Meta Pixel.'),
    ).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Meta Pixel · lo que se muestra de lo guardado', () => {
  test('carga el ID de Pixel y el estado de activación', async () => {
    await montar()

    expect(campo('ID de Pixel').value).toBe('123456789012345')
    expect(screen.getByRole('switch', { name: /meta pixel activado/i }).checked).toBe(true)
  })

  test('el token nunca se carga en el campo', async () => {
    await montar()

    expect(campo('Conversions API Access Token').value).toBe('')
  })

  test('con token guardado lo dice y avisa que se puede dejar en blanco', async () => {
    await montar()

    expect(screen.getByText('Token configurado')).toBeTruthy()
    expect(
      screen.getByText('Ya hay un token guardado. Dejá en blanco para no cambiarlo.'),
    ).toBeTruthy()
  })

  test('sin token lo dice y pide pegarlo', async () => {
    await montar({ meta: { ...CONFIG.meta, hasAccessToken: false } })

    expect(screen.getByText('Sin token')).toBeTruthy()
    expect(screen.getByText('Pegá el Access Token de Conversions API de tu Pixel.')).toBeTruthy()
  })

  test('muestra la fecha en que se conectó', async () => {
    await montar()

    expect(screen.getByText('Conectado: 10/10/2026')).toBeTruthy()
  })

  test('desactivado dice «Meta Pixel desactivado»', async () => {
    await montar({ meta: { ...CONFIG.meta, isEnabled: false } })

    expect(screen.getByRole('switch', { name: /meta pixel desactivado/i }).checked).toBe(false)
  })

  test('una cuenta sin configurar arranca desactivada, sin ID y sin token', async () => {
    await montar({})

    expect(campo('ID de Pixel').value).toBe('')
    expect(screen.getByRole('switch', { name: /desactivado/i }).checked).toBe(false)
    expect(screen.getByText('Sin token')).toBeTruthy()
  })
})

describe('Meta Pixel · guardar', () => {
  test('sin escribir el token, no lo manda', async () => {
    await montar()

    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith({
      meta: { pixelId: '123456789012345', isEnabled: true },
    })
  })

  test('el token viaja solo si se escribió, sin espacios', async () => {
    await montar()

    await userEvent.type(campo('Conversions API Access Token'), '  EAAB-secreto  ')
    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith({
      meta: { pixelId: '123456789012345', isEnabled: true, accessToken: 'EAAB-secreto' },
    })
  })

  test('un token de solo espacios cuenta como vacío', async () => {
    await montar()

    await userEvent.type(campo('Conversions API Access Token'), '    ')
    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0][0].meta.accessToken).toBeUndefined()
  })

  test('manda el ID de Pixel sin espacios y la activación que se eligió', async () => {
    await montar()

    await userEvent.clear(campo('ID de Pixel'))
    await userEvent.type(campo('ID de Pixel'), ' 999888777666 ')
    await userEvent.click(screen.getByRole('switch', { name: /meta pixel activado/i }))
    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith({
      meta: { pixelId: '999888777666', isEnabled: false },
    })
  })

  test('al guardar avisa, vacía el token escrito y refleja lo que devolvió el servidor', async () => {
    await montar({ meta: { ...CONFIG.meta, hasAccessToken: false } })
    mockUpdate.mockResolvedValue({ meta: { ...CONFIG.meta, hasAccessToken: true } })

    await userEvent.type(campo('Conversions API Access Token'), 'EAAB-secreto')
    await userEvent.click(guardar())

    expect(await screen.findByText('Configuración de Meta Pixel guardada.')).toBeTruthy()
    expect(campo('Conversions API Access Token').value).toBe('')
    expect(screen.getByText('Token configurado')).toBeTruthy()
  })

  test('mientras guarda, los dos botones quedan bloqueados', async () => {
    await montar()
    let terminar
    mockUpdate.mockImplementation(
      () =>
        new Promise(resolve => {
          terminar = resolve
        }),
    )

    await userEvent.click(guardar())

    await waitFor(() => {
      const botones = screen.getAllByRole('button', { name: /guardando/i })

      expect(botones).toHaveLength(2)
      botones.forEach(boton => expect(boton.disabled).toBe(true))
    })
    expect(mockUpdate).toHaveBeenCalledTimes(1)

    terminar({ meta: CONFIG.meta })
    await screen.findByText('Configuración de Meta Pixel guardada.')
  })

  test('si falla, muestra el mensaje del servidor y conserva lo escrito', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockUpdate.mockRejectedValue({ response: { data: { message: 'Token inválido' } } })

    await userEvent.type(campo('Conversions API Access Token'), 'malo')
    await userEvent.click(guardar())

    expect(await screen.findByText('Token inválido')).toBeTruthy()
    expect(campo('Conversions API Access Token').value).toBe('malo')
    console.error.mockRestore()
  })

  test('un error sin mensaje muestra uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockUpdate.mockRejectedValue(new Error(''))

    await userEvent.click(guardar())

    expect(await screen.findByText('No se pudo guardar la configuración.')).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Meta Pixel · guía y preguntas frecuentes', () => {
  test('la guía tiene siete pasos, y el de pegar los datos es el único «En HENKO»', async () => {
    await montar()

    const guia = screen.getByText('Creá tu cartera de negocios').closest('div[class*="MuiStack"]')

    expect(guia).toBeTruthy()
    expect(screen.getAllByText('En Meta')).toHaveLength(6)
    expect(screen.getAllByText('En HENKO')).toHaveLength(1)
    expect(screen.getByText('Pegá tus datos acá arriba')).toBeTruthy()
  })

  test('los enlaces a Meta se abren en otra pestaña', async () => {
    await montar()

    const enlace = screen.getByRole('link', { name: 'business.facebook.com' })

    expect(enlace.getAttribute('href')).toBe('https://business.facebook.com')
    expect(enlace.getAttribute('target')).toBe('_blank')
    expect(enlace.getAttribute('rel')).toContain('noopener')
  })

  test('los pasos que traen una advertencia la muestran', async () => {
    await montar()

    expect(screen.getByText(/Meta no te deja avanzar sin esto/)).toBeTruthy()
    expect(screen.getByText(/requisito de seguridad de Meta/)).toBeTruthy()
  })

  test('hay cinco preguntas frecuentes y cada una se despliega', async () => {
    await montar()

    const preguntas = screen.getAllByRole('button', { expanded: false })

    expect(preguntas.length).toBeGreaterThanOrEqual(5)

    await userEvent.click(screen.getByRole('button', { name: /llave de acceso no está activada/i }))

    expect(await screen.findByText(/Es el paso 3 — la passkey/)).toBeTruthy()
  })

  test('la pregunta sobre Gmail aclara que es distinto del dominio de correo de la tienda', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: /usar Gmail o Hotmail/i }))

    expect(await screen.findByText(/dominio de envío de correo de la tienda/)).toBeTruthy()
  })
})
