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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const {
  default: AiAgentConfigPage,
  toForm,
  toPayload,
  validateForm,
} = await import('./AiAgentConfigPage.jsx')

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
    escribir(screen.getByLabelText('Firma'), 'Equipo Ejemplo SA')
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

const seccion = nombre => within(screen.getByRole('region', { name: nombre }))
const barraDeGuardar = () =>
  within(
    screen.getByRole('button', { name: /Guardar cambios|Guardando/ }).closest('.MuiPaper-root'),
  )
const CONECTADO = {
  connected: true,
  verifyToken: 'verif-ficticio',
  checks: {
    accessToken: { ok: true },
    phoneNumberId: { ok: true },
    appSecret: { ok: true },
    webhook: { ok: true },
  },
}

describe('Configuración del asistente · números que el backend cambiaba sin avisar', () => {
  test('una confianza mínima de 0 se manda como 0, no como 0,55', async () => {
    await montar()

    escribir(screen.getByLabelText('Confianza mínima para responder'), '0')
    await guardar()

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(enviado().behavior.minConfidenceToAnswer).toBe(0)
  })

  test('un valor fuera de rango se marca y no se guarda', async () => {
    await montar()

    escribir(screen.getByLabelText('Máx. mensajes antes de derivar'), '200')

    expect(screen.getByText('Tiene que ser entre 1 y 80, sin decimales.')).toBeTruthy()
    await guardar()

    expect(barraDeGuardar().getByText('Revisá 1 campo marcado antes de guardar.')).toBeTruthy()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('validateForm copia los rangos del backend', () => {
    const base = toForm(AGENTE)

    expect(validateForm(base)).toEqual({})
    for (const [campo, valor] of [
      ['minConfidenceToAnswer', '1.2'],
      ['minConfidenceToAnswer', ''],
      ['maxMessagesBeforeHuman', '2.5'],
      ['maxMessagesBeforeHuman', '0'],
      ['monthlyMessageLimit', '-1'],
      ['monthlyAiTokenLimit', '1000000001'],
      ['name', '   '],
    ]) {
      expect(validateForm({ ...base, [campo]: valor })).toHaveProperty(campo)
    }
  })

  test('más de 80 palabras en una lista se avisa: el resto se perdería', async () => {
    await montar()

    const muchas = Array.from({ length: 81 }, (_, i) => `palabra${i}`).join(', ')
    escribir(screen.getByLabelText('Temas bloqueados'), muchas)

    expect(screen.getByText(/Hay 81 palabras y se guardan hasta 80/)).toBeTruthy()
  })

  test('toPayload no cambia un 0 por el default', () => {
    const payload = toPayload({
      ...toForm(AGENTE),
      minConfidenceToAnswer: '0',
      monthlyMessageLimit: '0',
    })

    expect(payload.behavior.minConfidenceToAnswer).toBe(0)
    expect(payload.quotas.monthlyMessageLimit).toBe(0)
  })
})

describe('Configuración del asistente · cambios sin guardar', () => {
  test('sin cambios no deja guardar y dice que está todo guardado', async () => {
    await montar()

    expect(screen.getByRole('button', { name: 'Guardar cambios' }).disabled).toBe(true)
    expect(screen.getByText('Todo guardado.')).toBeTruthy()
  })

  test('al cambiar algo lo avisa, y descartar vuelve a lo guardado', async () => {
    await montar()

    escribir(screen.getByLabelText('Nombre del asistente'), 'Otra')
    expect(screen.getByText('Tenés cambios sin guardar.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))

    expect(screen.getByLabelText('Nombre del asistente').value).toBe('Sofi')
    expect(screen.getByText('Todo guardado.')).toBeTruthy()
  })

  test('el nombre vacío se marca recién al intentar guardar', async () => {
    await montar()

    escribir(screen.getByLabelText('Nombre del asistente'), '')
    expect(screen.queryByText(/Poné un nombre/)).toBeNull()

    await guardar()

    expect(screen.getByText(/Poné un nombre/)).toBeTruthy()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('el error de guardado aparece junto al botón', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockUpdate.mockRejectedValueOnce(new Error('Sin conexión'))

    escribir(screen.getByLabelText('Firma'), 'Otra firma')
    await guardar()

    expect(await barraDeGuardar().findByText('Sin conexión')).toBeTruthy()
    console.error.mockRestore()
  })

  test('mientras guarda no se puede mandar dos veces', async () => {
    await montar()
    mockUpdate.mockReturnValue(new Promise(() => {}))

    escribir(screen.getByLabelText('Firma'), 'Otra firma')
    await guardar()

    expect(screen.getByRole('button', { name: 'Guardando…' }).disabled).toBe(true)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('Configuración del asistente · WhatsApp', () => {
  test('con credenciales sin guardar no deja probar y explica por qué', async () => {
    await montar()

    escribir(screen.getByLabelText('Access Token'), 'token-ficticio')

    expect(screen.getByRole('button', { name: 'Probar la conexión' }).disabled).toBe(true)
    expect(screen.getByText(/Guardá los cambios antes de probar/)).toBeTruthy()
  })

  test('cambiar otra cosa no bloquea la prueba', async () => {
    await montar()

    escribir(screen.getByLabelText('Firma'), 'Otra firma')

    expect(screen.getByRole('button', { name: 'Probar la conexión' }).disabled).toBe(false)
  })

  test('el error de la prueba sale dentro de la sección de WhatsApp', async () => {
    await montar()
    mockCheck.mockRejectedValueOnce(new Error('Meta no responde'))

    await userEvent.click(screen.getByRole('button', { name: 'Probar la conexión' }))

    expect(await seccion('WhatsApp').findByText('Meta no responde')).toBeTruthy()
  })

  test('el resumen pasa a "Conectado" después de una prueba buena', async () => {
    const whatsapp = { ...AGENTE.channels.whatsapp, enabled: true }
    await montar({ ...AGENTE, channels: { ...AGENTE.channels, whatsapp } })
    mockCheck.mockResolvedValue(CONECTADO)

    expect(seccion('Estado del asistente').getByText('Sin probar')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Probar la conexión' }))

    expect(await seccion('Estado del asistente').findByText('Conectado')).toBeTruthy()
    expect(screen.getByText(/Conectado: el asistente puede recibir/)).toBeTruthy()
  })

  test('cuenta los puntos que fallan', async () => {
    await montar()
    mockCheck.mockResolvedValue({
      connected: false,
      checks: {
        accessToken: { ok: false, detail: 'El token no sirve o venció.' },
        phoneNumberId: { ok: true },
        appSecret: { ok: false },
        webhook: { ok: true },
      },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Probar la conexión' }))

    expect(await screen.findByText('2 puntos para revisar.')).toBeTruthy()
  })

  test('la guía arranca cerrada si ya hay número', async () => {
    await montar()

    const guia = screen.getByRole('button', { name: /Cómo conectar WhatsApp/ })
    expect(guia.getAttribute('aria-expanded')).toBe('false')
  })

  test('sin número cargado la guía arranca abierta', async () => {
    await montar({ ...AGENTE, channels: { webchat: { enabled: true }, whatsapp: {} } })

    const guia = screen.getByRole('button', { name: /Cómo conectar WhatsApp/ })
    expect(guia.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('Configuración del asistente · lo que se muestra es verdad', () => {
  test('la firma, la confianza y la aprobación dicen que todavía no se usan', async () => {
    await montar()

    expect(
      screen.getAllByText(/Se guarda, pero el asistente todavía no lo tiene en cuenta/),
    ).toHaveLength(3)
  })

  test('el resumen muestra lo guardado, no lo que se está escribiendo', async () => {
    await montar()

    expect(seccion('Estado del asistente').getAllByText('Activo')).toHaveLength(2)
    await userEvent.click(screen.getByRole('switch', { name: 'Agente activado' }))

    expect(seccion('Estado del asistente').getAllByText('Activo')).toHaveLength(2)
  })
})

describe('Configuración del asistente · el estado no promete de más', () => {
  test('sin webhook suscripto no dice "Conectado", aunque el backend diga connected', async () => {
    const whatsapp = { ...AGENTE.channels.whatsapp, enabled: true }
    await montar({ ...AGENTE, channels: { ...AGENTE.channels, whatsapp } })
    mockCheck.mockResolvedValue({
      ...CONECTADO,
      checks: { ...CONECTADO.checks, webhook: { ok: false, detail: 'Sin suscripción.' } },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Probar la conexión' }))

    expect(await seccion('Estado del asistente').findByText('Con problemas')).toBeTruthy()
    expect(screen.getByText('1 punto para revisar.')).toBeTruthy()
  })

  test('al guardar credenciales nuevas se olvida la prueba anterior', async () => {
    const whatsapp = { ...AGENTE.channels.whatsapp, enabled: true }
    const agente = { ...AGENTE, channels: { ...AGENTE.channels, whatsapp } }
    await montar(agente)
    mockUpdate.mockResolvedValue(agente)
    mockCheck.mockResolvedValue(CONECTADO)

    await userEvent.click(screen.getByRole('button', { name: 'Probar la conexión' }))
    expect(await seccion('Estado del asistente').findByText('Conectado')).toBeTruthy()

    escribir(screen.getByLabelText('Access Token'), 'otro-token-ficticio')
    await guardar()

    expect(await seccion('Estado del asistente').findByText('Sin probar')).toBeTruthy()
  })

  test('el aprendizaje dice "Con revisión" aunque se haya apagado la aprobación', async () => {
    await montar({ ...AGENTE, learning: { enabled: true, requireApproval: false } })

    expect(seccion('Estado del asistente').getByText('Con revisión')).toBeTruthy()
  })
})
