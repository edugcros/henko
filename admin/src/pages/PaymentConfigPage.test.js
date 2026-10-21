// Configuración de pagos (PaymentConfigPage).
//
// La pantalla donde el comercio conecta su cuenta de Mercado Pago: es de donde sale el dinero de las
// ventas, y maneja credenciales. No tenía tests. Lo que se fija acá:
//
//   - lo que se carga y lo que se muestra de lo ya guardado (el token y la clave del webhook NUNCA
//     vuelven al navegador: solo se sabe si existen);
//   - lo que se manda al guardar: los secretos solo viajan si se escribieron, y sin espacios;
//   - qué se le avisa a quien configura cuando algo sale bien o mal.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockGet = jest.fn()
const mockUpdate = jest.fn()

jest.unstable_mockModule('../services/paymentConfigService.js', () => ({
  getPaymentConfig: mockGet,
  updatePaymentConfig: mockUpdate,
}))

const { default: PaymentConfigPage } = await import('./PaymentConfigPage.jsx')

const CONFIG = {
  mercadopago: {
    mode: 'test',
    publicKey: 'TEST-1234-abcd',
    isEnabled: true,
    hasAccessToken: true,
    hasWebhookSecret: false,
    connectedAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-12T12:00:00.000Z',
  },
}

const montar = async (config = CONFIG) => {
  mockGet.mockResolvedValue(config)

  render(<PaymentConfigPage />)

  await screen.findByRole('textbox', { name: /public key/i })
}

const campo = nombre => screen.getByLabelText(nombre, { exact: false })

const guardar = () => screen.getAllByRole('button', { name: /guardar cambios/i })[0]

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockImplementation(async payload => ({
    mercadopago: { ...CONFIG.mercadopago, ...payload.mercadopago },
  }))
})

describe('Pagos · carga', () => {
  test('mientras carga muestra un indicador', () => {
    mockGet.mockReturnValue(new Promise(() => {}))

    render(<PaymentConfigPage />)

    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor y permite reintentar', async () => {
    mockGet.mockRejectedValueOnce({ response: { data: { message: 'No hay conexión' } } })
    jest.spyOn(console, 'error').mockImplementation(() => {})

    render(<PaymentConfigPage />)

    expect(await screen.findByText('No hay conexión')).toBeTruthy()

    mockGet.mockResolvedValue(CONFIG)
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByRole('textbox', { name: /public key/i })).toBeTruthy()
    console.error.mockRestore()
  })

  test('un error sin mensaje muestra uno genérico', async () => {
    mockGet.mockRejectedValue(new Error(''))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    render(<PaymentConfigPage />)

    expect(await screen.findByText('No se pudo cargar la configuración de pagos.')).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Pagos · lo que se muestra de lo guardado', () => {
  test('carga el modo, la Public Key y el estado de activación', async () => {
    await montar()

    expect(campo('Modo').textContent).toBe('Test (sandbox)')
    expect(campo('Public Key').value).toBe('TEST-1234-abcd')
    expect(screen.getByRole('switch', { name: /mercado pago activado/i }).checked).toBe(true)
  })

  test('el token y la clave del webhook nunca se cargan en los campos', async () => {
    await montar()

    expect(campo('Access Token').value).toBe('')
    expect(campo('Clave secreta del webhook').value).toBe('')
  })

  test('con token guardado lo dice y avisa que se puede dejar en blanco', async () => {
    await montar()

    expect(screen.getByText('Token configurado')).toBeTruthy()
    expect(
      screen.getByText('Ya hay un token guardado. Dejá en blanco para no cambiarlo.'),
    ).toBeTruthy()
  })

  test('sin token lo dice y pide pegarlo', async () => {
    await montar({ mercadopago: { ...CONFIG.mercadopago, hasAccessToken: false } })

    expect(screen.getByText('Sin token')).toBeTruthy()
    expect(screen.getByText('Pegá el Access Token de tu aplicación de Mercado Pago.')).toBeTruthy()
  })

  test('sin clave del webhook explica para qué sirve; con clave avisa que ya hay una', async () => {
    await montar()

    expect(
      screen.getByText(/Sin ella, Mercado Pago puede avisar un pago y la tienda ignorarlo/),
    ).toBeTruthy()
  })

  test('con clave del webhook guardada lo dice', async () => {
    await montar({ mercadopago: { ...CONFIG.mercadopago, hasWebhookSecret: true } })

    expect(
      screen.getByText('Ya hay una clave guardada. Dejá en blanco para no cambiarla.'),
    ).toBeTruthy()
  })

  test('muestra la fecha en que se conectó', async () => {
    await montar()

    expect(screen.getByText('Conectado: 10/10/2026')).toBeTruthy()
  })

  test('desactivado dice «Mercado Pago desactivado»', async () => {
    await montar({ mercadopago: { ...CONFIG.mercadopago, isEnabled: false } })

    expect(screen.getByRole('switch', { name: /mercado pago desactivado/i }).checked).toBe(false)
  })

  test('el ejemplo de la Public Key cambia con el modo', async () => {
    await montar()

    expect(campo('Public Key').getAttribute('placeholder')).toMatch(/^TEST-/)

    await userEvent.click(campo('Modo'))
    await userEvent.click(await screen.findByRole('option', { name: 'Producción' }))

    expect(campo('Public Key').getAttribute('placeholder')).toMatch(/^APP_USR-/)
  })

  test('una cuenta sin configurar arranca en modo de prueba y desactivada', async () => {
    await montar({})

    expect(campo('Modo').textContent).toBe('Test (sandbox)')
    expect(screen.getByRole('switch', { name: /desactivado/i }).checked).toBe(false)
    expect(screen.getByText('Sin token')).toBeTruthy()
  })
})

describe('Pagos · guardar', () => {
  test('sin escribir secretos, no los manda', async () => {
    await montar()

    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith({
      mercadopago: { mode: 'test', publicKey: 'TEST-1234-abcd', isEnabled: true },
    })
  })

  test('el token y la clave del webhook viajan solo si se escribieron, sin espacios', async () => {
    await montar()

    await userEvent.type(campo('Access Token'), '  APP_USR-secreto  ')
    await userEvent.type(campo('Clave secreta del webhook'), ' clave-webhook ')
    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith({
      mercadopago: {
        mode: 'test',
        publicKey: 'TEST-1234-abcd',
        isEnabled: true,
        accessToken: 'APP_USR-secreto',
        webhookSecret: 'clave-webhook',
      },
    })
  })

  test('un token de solo espacios cuenta como vacío', async () => {
    await montar()

    await userEvent.type(campo('Access Token'), '    ')
    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0][0].mercadopago.accessToken).toBeUndefined()
  })

  test('manda el modo, la Public Key sin espacios y la activación que se eligieron', async () => {
    await montar()

    await userEvent.click(campo('Modo'))
    await userEvent.click(await screen.findByRole('option', { name: 'Producción' }))
    await userEvent.clear(campo('Public Key'))
    await userEvent.type(campo('Public Key'), '  APP_USR-1111  ')
    await userEvent.click(screen.getByRole('switch', { name: /mercado pago activado/i }))
    await userEvent.click(guardar())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate).toHaveBeenCalledWith({
      mercadopago: { mode: 'production', publicKey: 'APP_USR-1111', isEnabled: false },
    })
  })

  test('al guardar avisa, vacía los campos secretos y refleja lo que devolvió el servidor', async () => {
    await montar({ mercadopago: { ...CONFIG.mercadopago, hasAccessToken: false } })
    mockUpdate.mockResolvedValue({
      mercadopago: { ...CONFIG.mercadopago, hasAccessToken: true, hasWebhookSecret: true },
    })

    await userEvent.type(campo('Access Token'), 'APP_USR-secreto')
    await userEvent.click(guardar())

    expect(await screen.findByText('Configuración de pagos guardada.')).toBeTruthy()
    expect(campo('Access Token').value).toBe('')
    expect(screen.getByText('Token configurado')).toBeTruthy()
    expect(
      screen.getByText('Ya hay una clave guardada. Dejá en blanco para no cambiarla.'),
    ).toBeTruthy()
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

    terminar({ mercadopago: CONFIG.mercadopago })
    await screen.findByText('Configuración de pagos guardada.')
  })

  test('si falla, muestra el mensaje del servidor y conserva lo escrito', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockUpdate.mockRejectedValue({ response: { data: { message: 'Access Token inválido' } } })

    await userEvent.type(campo('Access Token'), 'malo')
    await userEvent.click(guardar())

    expect(await screen.findByText('Access Token inválido')).toBeTruthy()
    expect(campo('Access Token').value).toBe('malo')
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

  test('la ayuda explica cómo conseguir las credenciales', async () => {
    await montar()

    const ayuda = screen.getByText(/mercadopago.com.ar\/developers/).closest('ol')

    expect(within(ayuda).getAllByRole('listitem')).toHaveLength(5)
  })
})
