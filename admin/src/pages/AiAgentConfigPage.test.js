// Configuración del asistente (AiAgentConfigPage).
//
// Es la pantalla que prende el asistente, conecta WhatsApp y decide qué puede hacer: recomendar,
// armar carritos, ofrecer descuentos, cuándo derivar a una persona. No tenía tests. Lo que se fija:
//
//   - qué se carga en el formulario a partir de lo que devuelve el backend;
//   - lo que se manda al guardar, y sobre todo que los secretos de WhatsApp (que el backend nunca
//     devuelve) no se pisan con un texto vacío;
//   - la prueba de conexión con Meta, que no manda mensajes.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockCheck = jest.fn()

jest.unstable_mockModule('../services/aiAgentConfigService.js', () => ({
  getAiAgentConfig: mockGet,
  updateAiAgentConfig: mockUpdate,
  checkWhatsappConnection: mockCheck,
}))
jest.unstable_mockModule('../config/env.js', () => ({
  env: { apiBaseUrl: 'https://api.ejemplo.test/api/' },
}))
jest.unstable_mockModule('../components/aiBudget/AiBudgetPanel.jsx', () => ({
  default: () => <div>Panel de consumo</div>,
}))

const { default: AiAgentConfigPage } = await import('./AiAgentConfigPage.jsx')

const AGENTE = {
  name: 'Sofi',
  enabled: true,
  channels: {
    webchat: { enabled: true },
    whatsapp: { enabled: false, phoneNumberId: '1234567890', businessAccountId: '998877' },
  },
  personality: { tone: 'formal', language: 'es-AR', signature: 'Equipo Ejemplo' },
  behavior: {
    canRecommendProducts: true,
    canCreateCartLinks: true,
    canOfferDiscounts: false,
    requireHumanForPayments: true,
    requireHumanForClaims: true,
    maxMessagesBeforeHuman: 10,
    minConfidenceToAnswer: 0.6,
  },
  businessContext: {
    description: 'Tienda de mochilas',
    policies: {
      shipping: 'Envíos a todo el país',
      returns: '',
      payments: '',
      warranty: '',
      privacy: '',
    },
  },
  guardrails: {
    blockedTopics: ['política', 'religión'],
    humanHandoffKeywords: ['abogado'],
    optOutKeywords: [],
  },
  learning: { enabled: true, requireApproval: true },
  quotas: { monthlyMessageLimit: 0, monthlyAiTokenLimit: 0 },
}

const montar = async (agente = AGENTE) => {
  mockGet.mockResolvedValue(agente)
  render(<AiAgentConfigPage />)
  await screen.findByLabelText('Nombre del asistente')
}

const escribir = (campo, valor) => fireEvent.change(campo, { target: { value: valor } })
const guardar = () => userEvent.click(screen.getAllByRole('button', { name: 'Guardar cambios' })[0])
const enviado = () => mockUpdate.mock.calls.at(-1)[0]

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockImplementation(async payload => ({ ...AGENTE, ...payload }))
})

describe('Configuración del asistente · carga', () => {
  test('llena el formulario con lo guardado', async () => {
    await montar()

    expect(screen.getByLabelText('Nombre del asistente').value).toBe('Sofi')
    expect(screen.getByLabelText('Phone Number ID').value).toBe('1234567890')
    expect(screen.getByLabelText('Firma').value).toBe('Equipo Ejemplo')
    expect(screen.getByLabelText('Temas bloqueados').value).toBe('política, religión')
    expect(screen.getByLabelText('Envíos').value).toBe('Envíos a todo el país')
  })

  test('los secretos arrancan vacíos aunque haya datos de WhatsApp', async () => {
    await montar()

    expect(screen.getByLabelText('Access Token').value).toBe('')
    expect(screen.getByLabelText('App Secret').value).toBe('')
  })

  test('muestra la URL del webhook armada con la base del backend', async () => {
    await montar()

    expect(screen.getByDisplayValue('https://api.ejemplo.test/api/whatsapp/webhook')).toBeTruthy()
  })

  test('si falla la carga deja reintentar', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockGet.mockRejectedValueOnce(new Error('Sin conexión'))
    render(<AiAgentConfigPage />)

    expect(await screen.findByText('Sin conexión')).toBeTruthy()

    mockGet.mockResolvedValue(AGENTE)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByLabelText('Nombre del asistente')).toBeTruthy()
    console.error.mockRestore()
  })

  test('un agente recién creado arranca con defaults seguros', async () => {
    await montar({})

    expect(screen.getByLabelText('Máx. mensajes antes de derivar').value).toBe('14')
    expect(screen.getByLabelText('Confianza mínima para responder').value).toBe('0.55')
    expect(screen.getByLabelText('Autolímite de mensajes por mes').value).toBe('0')
  })
})

describe('Configuración del asistente · guardar', () => {
  test('manda la configuración con las listas separadas por coma', async () => {
    await montar()

    escribir(screen.getByLabelText('Palabras que derivan a humano'), 'abogado,  estafa , ')
    await guardar()

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(enviado()).toMatchObject({
      name: 'Sofi',
      enabled: true,
      personality: { tone: 'formal', language: 'es-AR', signature: 'Equipo Ejemplo' },
      behavior: { maxMessagesBeforeHuman: 10, minConfidenceToAnswer: 0.6 },
      guardrails: {
        blockedTopics: ['política', 'religión'],
        humanHandoffKeywords: ['abogado', 'estafa'],
        optOutKeywords: [],
      },
    })
  })

  test('sin escribir un secreto nuevo no lo manda (no borra el guardado)', async () => {
    await montar()
    await guardar()

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(enviado().channels.whatsapp).toEqual({
      enabled: false,
      phoneNumberId: '1234567890',
      businessAccountId: '998877',
    })
  })

  test('si se escribe un secreto nuevo, lo manda sin espacios', async () => {
    await montar()

    escribir(screen.getByLabelText('Access Token'), '  token-ficticio  ')
    await guardar()

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(enviado().channels.whatsapp.accessToken).toBe('token-ficticio')
    expect(enviado().channels.whatsapp).not.toHaveProperty('appSecret')
  })

  test('al guardar avisa y vacía otra vez los secretos', async () => {
    await montar()

    escribir(screen.getByLabelText('App Secret'), 'secreto-ficticio')
    await guardar()

    expect(await screen.findByText('Configuración guardada.')).toBeTruthy()
    expect(screen.getByLabelText('App Secret').value).toBe('')
  })

  test('si falla, muestra el motivo y no pierde lo escrito', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockUpdate.mockRejectedValueOnce({ response: { data: { message: 'Sesión vencida' } } })

    escribir(screen.getByLabelText('Nombre del asistente'), 'Sofía')
    await guardar()

    expect(await screen.findByText('Sesión vencida')).toBeTruthy()
    expect(screen.getByLabelText('Nombre del asistente').value).toBe('Sofía')
    console.error.mockRestore()
  })

  test('los interruptores viajan en el payload', async () => {
    await montar()

    await userEvent.click(screen.getByRole('switch', { name: 'Puede ofrecer descuentos' }))
    await guardar()

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(enviado().behavior.canOfferDiscounts).toBe(true)
  })
})

describe('Configuración del asistente · probar la conexión', () => {
  test('muestra cada punto revisado y el token de verificación', async () => {
    await montar()
    mockCheck.mockResolvedValue({
      connected: false,
      verifyToken: 'verif-ficticio',
      checks: {
        accessToken: { ok: true, detail: 'El token funciona.' },
        phoneNumberId: { ok: true, detail: 'Número +54 11 0000-0000 (Ejemplo).' },
        appSecret: { ok: false, detail: 'Falta el App Secret.' },
        webhook: { ok: false, detail: 'El webhook no está suscripto.' },
      },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Probar la conexión' }))

    expect(await screen.findByText('El token funciona.')).toBeTruthy()
    expect(screen.getByText('Falta el App Secret.')).toBeTruthy()
    expect(screen.getByDisplayValue('verif-ficticio')).toBeTruthy()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('si falla, dice por qué', async () => {
    await montar()
    mockCheck.mockRejectedValueOnce(new Error('Meta no responde'))

    await userEvent.click(screen.getByRole('button', { name: 'Probar la conexión' }))

    expect(await screen.findByText('Meta no responde')).toBeTruthy()
  })
})
