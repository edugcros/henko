// Campañas del asistente (AiCampaignRulesPage).
//
// Acá el comercio arma las reglas con las que el asistente escribe solo a sus clientes: carrito
// abandonado, seguimiento, post-compra, winback. Lo que se configura acá le llega a gente real
// por WhatsApp o correo. No tenía tests. Lo que se fija:
//
//   - qué se muestra de cada regla y el aviso de por qué la recuperación no corre;
//   - lo que se manda al crear, editar y eliminar;
//   - las conversiones del formulario (el monto se pide en pesos y se guarda en centavos);
//   - qué se avisa cuando algo sale bien o mal.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockList = jest.fn()
const mockUpsert = jest.fn()
const mockDelete = jest.fn()

jest.unstable_mockModule('../services/aiCampaignRuleService.js', () => ({
  listCampaignRules: mockList,
  upsertCampaignRule: mockUpsert,
  deleteCampaignRule: mockDelete,
}))

const {
  default: AiCampaignRulesPage,
  EMPTY_FORM,
  describeTrigger,
  formatDelay,
  renderPreview,
  toPayload,
  validateRule,
} = await import('./AiCampaignRulesPage.jsx')

const CARRITO = {
  _id: 'r1',
  name: 'Recuperar carrito por WhatsApp',
  type: 'abandoned_cart',
  enabled: true,
  channel: 'whatsapp',
  messageTemplate: 'Hola {{customerName}}, te quedó {{productName}} en el carrito.',
  useAiPersonalization: true,
  trigger: {
    delayMinutes: 45,
    minCartAmountCents: 500000,
    maxAttempts: 3,
    onlyBusinessHours: true,
    businessHours: { start: '10:00', end: '19:00' },
    minHoursBetweenContacts: 8,
  },
  whatsappTemplate: { enabled: true, name: 'carrito_v1', languageCode: 'es_AR' },
  offer: { enabled: true, couponCode: 'VUELVE10' },
  stats: { sent: 12, conversions: 3 },
}
const WINBACK = {
  _id: 'r2',
  name: 'Volver a comprar',
  type: 'winback',
  enabled: false,
  channel: 'email',
  messageTemplate: 'Te extrañamos',
  trigger: {},
}

const montar = async (respuesta = { items: [CARRITO, WINBACK], readiness: { ready: true } }) => {
  mockList.mockResolvedValue(respuesta)
  render(<AiCampaignRulesPage />)
  await waitFor(() => expect(mockList).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
}

const tarjeta = nombre => screen.getByText(nombre).closest('.MuiPaper-root')
const dialogo = () => within(screen.getByRole('dialog'))
const escribir = (input, valor) => fireEvent.change(input, { target: { value: valor } })

beforeEach(() => {
  jest.clearAllMocks()
  mockUpsert.mockResolvedValue({})
  mockDelete.mockResolvedValue({})
})

describe('Campañas · lo que se ve', () => {
  test('cada regla muestra tipo, canal, estado, cupón, mensaje y su disparador', async () => {
    await montar()

    const carrito = within(tarjeta('Recuperar carrito por WhatsApp'))
    expect(carrito.getByText('Carrito abandonado')).toBeTruthy()
    expect(carrito.getByText('WhatsApp')).toBeTruthy()
    expect(carrito.getByText('Activa')).toBeTruthy()
    expect(carrito.getByText('Cupón: VUELVE10')).toBeTruthy()
    expect(carrito.getByText(/te quedó \{\{productName\}\}/)).toBeTruthy()
    expect(carrito.getByText(/45 min/)).toBeTruthy()
    expect(carrito.getByText(/10:00/)).toBeTruthy()
    expect(carrito.getByText('12 enviados · 3 convertidos')).toBeTruthy()

    const winback = within(tarjeta('Volver a comprar'))
    expect(winback.getByText('Inactiva')).toBeTruthy()
    expect(winback.getByText('Email')).toBeTruthy()
  })

  test('sin reglas lo dice', async () => {
    await montar({ items: [], readiness: null })

    expect(screen.getByText('No hay reglas de campaña configuradas.')).toBeTruthy()
  })

  test('si la recuperación no puede correr, explica por qué', async () => {
    await montar({ items: [CARRITO], readiness: { ready: false, reason: 'agent_disabled' } })

    expect(screen.getByText(/El asistente de IA está apagado/)).toBeTruthy()
  })

  test('un motivo desconocido muestra un aviso genérico', async () => {
    await montar({ items: [CARRITO], readiness: { ready: false, reason: 'otro' } })

    expect(screen.getByText(/no puede ejecutarse con la configuración actual/)).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValueOnce({ response: { data: { message: 'Sin permiso' } } })

    const { unmount } = render(<AiCampaignRulesPage />)
    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    unmount()

    mockList.mockRejectedValueOnce(new Error(''))
    render(<AiCampaignRulesPage />)
    expect(await screen.findByText('No se pudieron cargar las reglas de campaña.')).toBeTruthy()
    console.error.mockRestore()
  })

  test('«Actualizar» vuelve a pedir las reglas', async () => {
    await montar()
    mockList.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
  })
})

describe('Campañas · crear y editar', () => {
  test('crear sin nombre o sin mensaje no manda nada y avisa', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Nombre'), 'Solo nombre')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Nombre y plantilla de mensaje son obligatorios.')).toBeTruthy()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('crear manda la regla con los valores por omisión y sin id', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Nombre'), 'Carrito')
    escribir(dialogo().getByLabelText('Plantilla de mensaje'), 'Hola {{customerName}}')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1))
    const [payload, id] = mockUpsert.mock.calls[0]
    expect(id).toBeUndefined()
    expect(payload).toMatchObject({
      name: 'Carrito',
      type: 'abandoned_cart',
      channel: 'whatsapp',
      enabled: true,
      messageTemplate: 'Hola {{customerName}}',
      trigger: {
        delayMinutes: 30,
        maxAttempts: 2,
        minHoursBetweenContacts: 6,
        minCartAmountCents: 0,
        onlyBusinessHours: true,
        businessHours: { start: '09:00', end: '20:00' },
      },
      offer: { enabled: false },
      whatsappTemplate: { enabled: false, languageCode: 'es_AR' },
    })
    expect(await screen.findByText('Regla creada.')).toBeTruthy()
  })

  test('editar abre la regla con sus datos y manda su id', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Recuperar carrito por WhatsApp')).getByRole('button', { name: 'Editar' }),
    )

    expect(dialogo().getByText('Editar regla')).toBeTruthy()
    expect(dialogo().getByLabelText('Nombre').value).toBe('Recuperar carrito por WhatsApp')
    expect(dialogo().getByLabelText('Código de cupón').value).toBe('VUELVE10')

    escribir(dialogo().getByLabelText('Nombre'), 'Carrito v2')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Carrito v2', type: 'abandoned_cart' }),
        'r1',
      ),
    )
    expect(mockUpsert.mock.calls[0][0]._id).toBeUndefined()
    expect(await screen.findByText('Regla actualizada.')).toBeTruthy()
  })

  test('el monto mínimo se pide en pesos y se manda en centavos', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Recuperar carrito por WhatsApp')).getByRole('button', { name: 'Editar' }),
    )
    const monto = dialogo().getByLabelText(/Monto mín\. carrito/)
    expect(monto.value).toBe('5000')

    escribir(monto, '12000')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockUpsert.mock.calls[0][0].trigger.minCartAmountCents).toBe(1200000),
    )
  })

  test('los campos del cupón y de la plantilla de WhatsApp solo aparecen si están activados', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))

    expect(dialogo().queryByLabelText('Código de cupón')).toBeNull()
    expect(dialogo().queryByLabelText('Nombre del template')).toBeNull()

    await userEvent.click(dialogo().getByRole('switch', { name: 'Incluir cupón de descuento' }))

    expect(dialogo().getByLabelText('Código de cupón')).toBeTruthy()
  })

  test('si falla guardar avisa y el diálogo sigue abierto', async () => {
    await montar()
    mockUpsert.mockRejectedValueOnce({
      response: { data: { message: 'Horario comercial inválido. Use HH:mm' } },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Nombre'), 'Carrito')
    escribir(dialogo().getByLabelText('Plantilla de mensaje'), 'Hola')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Horario comercial inválido. Use HH:mm')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('Campañas · eliminar', () => {
  test('pide confirmar, manda el id y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    expect(dialogo().getByText(/¿Eliminar la regla "Volver a comprar"\?/)).toBeTruthy()
    expect(mockDelete).not.toHaveBeenCalled()

    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('r2'))
    expect(await screen.findByText('Regla eliminada.')).toBeTruthy()
  })

  test('cancelar no elimina', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('si falla eliminar avisa con el mensaje del servidor o uno genérico', async () => {
    await montar()
    mockDelete.mockRejectedValueOnce(new Error(''))

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('Error al eliminar.')).toBeTruthy()
  })
})

describe('Campañas · lo que no se ejecuta, dicho', () => {
  test('una regla que no es de carrito abandonado avisa que todavía no se ejecuta', async () => {
    await montar()

    const winback = within(tarjeta('Volver a comprar'))
    expect(winback.getByText('Todavía no se ejecuta')).toBeTruthy()
    expect(winback.getByText(/solo ejecuta reglas de carrito abandonado/)).toBeTruthy()

    expect(
      within(tarjeta('Recuperar carrito por WhatsApp')).queryByText('Todavía no se ejecuta'),
    ).toBeNull()
  })

  test('en el formulario, elegir un tipo que no se ejecuta lo avisa', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    expect(dialogo().queryByText(/se guarda, pero no le va a escribir a nadie/)).toBeNull()

    await userEvent.click(dialogo().getByRole('combobox', { name: 'Tipo' }))
    await userEvent.click(
      await screen.findByRole('option', { name: 'Post-compra (todavía no se ejecuta)' }),
    )

    expect(dialogo().getByText(/se guarda, pero no le va a escribir a nadie/)).toBeTruthy()
  })

  test('el disparador se lee en castellano, con el monto en pesos', async () => {
    await montar()

    expect(
      within(tarjeta('Recuperar carrito por WhatsApp')).getByText(
        /Espera 45 min · Hasta 3 intentos · Carritos desde \$\s?5\.000 · De 10:00 a 19:00 · 8 h entre contactos/,
      ),
    ).toBeTruthy()
  })

  test('el encabezado cuenta las reglas activas', async () => {
    await montar()

    expect(screen.getByText(/1 regla activa de 2\./)).toBeTruthy()
  })
})

describe('Campañas · el formulario valida antes de mandar', () => {
  const abrirNueva = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Nombre'), 'Carrito')
    escribir(dialogo().getByLabelText('Plantilla de mensaje'), 'Hola')
  }

  test('una espera de 0 minutos no se manda y avisa el rango', async () => {
    await montar()
    await abrirNueva()

    escribir(dialogo().getByLabelText('Delay (min)'), '0')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(
      await dialogo().findByText(/La espera tiene que ser de 1 a 43\.200 minutos/),
    ).toBeTruthy()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('un número vacío queda vacío mientras se escribe y no se puede guardar', async () => {
    await montar()
    await abrirNueva()

    escribir(dialogo().getByLabelText('Max intentos'), '')
    expect(dialogo().getByLabelText('Max intentos').value).toBe('')

    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(await dialogo().findByText('Los intentos tienen que ser de 1 a 5.')).toBeTruthy()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('con la plantilla de Meta activada hace falta su nombre', async () => {
    await montar()
    await abrirNueva()

    await userEvent.click(
      dialogo().getByRole('switch', { name: 'Usar template aprobado por Meta' }),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(
      await dialogo().findByText('Falta el nombre de la plantilla aprobada por Meta.'),
    ).toBeTruthy()
  })

  test('con el cupón activado hace falta el código, y se manda en mayúsculas', async () => {
    await montar()
    await abrirNueva()

    await userEvent.click(dialogo().getByRole('switch', { name: 'Incluir cupón de descuento' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))
    expect(await dialogo().findByText('Falta el código del cupón.')).toBeTruthy()

    escribir(dialogo().getByLabelText('Código de cupón'), 'vuelve10')
    expect(dialogo().getByLabelText('Código de cupón').value).toBe('VUELVE10')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockUpsert.mock.calls[0][0].offer.couponCode).toBe('VUELVE10'))
  })

  test('el error del servidor aparece dentro del diálogo y se quita al seguir escribiendo', async () => {
    await montar()
    mockUpsert.mockRejectedValueOnce(new Error('Algo falló'))
    await abrirNueva()

    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))
    expect(await dialogo().findByText('Algo falló')).toBeTruthy()

    escribir(dialogo().getByLabelText('Nombre'), 'Carrito 2')
    expect(dialogo().queryByText('Algo falló')).toBeNull()
  })
})

describe('Campañas · la plantilla del mensaje', () => {
  test('tocar una variable la inserta en la plantilla', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Plantilla de mensaje'), 'Llevás ')
    await userEvent.click(dialogo().getByRole('button', { name: '{{itemCount}}' }))

    expect(dialogo().getByLabelText('Plantilla de mensaje').value).toContain('{{itemCount}}')
  })

  test('muestra cómo le llega el mensaje, con datos de ejemplo', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Plantilla de mensaje'), 'Hola {{customerName}}')

    expect(dialogo().getByText('Hola Lucía')).toBeTruthy()
  })

  test('con canal Email no aparece la plantilla de WhatsApp', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    expect(dialogo().getByRole('switch', { name: 'Usar template aprobado por Meta' })).toBeTruthy()

    await userEvent.click(dialogo().getByRole('combobox', { name: 'Canal' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Email' }))

    expect(dialogo().queryByRole('switch', { name: 'Usar template aprobado por Meta' })).toBeNull()
  })
})

describe('Campañas · eliminar, lo nuevo', () => {
  test('mientras elimina no se puede apretar dos veces', async () => {
    await montar()
    mockDelete.mockReturnValue(new Promise(() => {}))

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar' }))

    expect(dialogo().getByRole('button', { name: 'Eliminando...' }).disabled).toBe(true)
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  test('si falla, el error aparece en el diálogo, que sigue abierto', async () => {
    await montar()
    mockDelete.mockRejectedValueOnce({ response: { data: { message: 'No existe' } } })

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar' }))

    expect(await dialogo().findByText('No existe')).toBeTruthy()
  })

  test('sin reglas, el botón de la pantalla vacía abre el formulario', async () => {
    await montar({ items: [], readiness: null })

    await userEvent.click(screen.getByRole('button', { name: 'Crear la primera regla' }))

    expect(dialogo().getByText('Nueva regla de campaña')).toBeTruthy()
  })
})

describe('Campañas · armado', () => {
  test('validateRule acepta los valores por omisión con nombre y mensaje', () => {
    expect(validateRule({ ...EMPTY_FORM, name: 'A', messageTemplate: 'B' })).toBe('')
  })

  test('validateRule rechaza un horario mal escrito', () => {
    const form = {
      ...EMPTY_FORM,
      name: 'A',
      messageTemplate: 'B',
      trigger: { ...EMPTY_FORM.trigger, businessHours: { start: '9', end: '20:00' } },
    }
    expect(validateRule(form)).toMatch(/HH:mm/)
  })

  test('toPayload limpia espacios, saca el id y pasa el cupón a mayúsculas', () => {
    const payload = toPayload({
      ...EMPTY_FORM,
      _id: 'x',
      name: '  A  ',
      messageTemplate: ' B ',
      offer: { enabled: true, couponCode: ' abc ' },
    })
    expect(payload._id).toBeUndefined()
    expect(payload.name).toBe('A')
    expect(payload.messageTemplate).toBe('B')
    expect(payload.offer.couponCode).toBe('ABC')
  })

  test('describeTrigger dice «a cualquier hora» si no se limita al horario comercial', () => {
    expect(describeTrigger({ onlyBusinessHours: false })).toContain('A cualquier hora')
    expect(describeTrigger({ maxAttempts: 1 })).toContain('1 intento')
  })

  test('renderPreview reemplaza todas las variables conocidas', () => {
    expect(renderPreview('{{customerName}} · {{cartTotal}} · {{otra}}')).toBe(
      'Lucía · $ 84.900 · {{otra}}',
    )
  })
})

describe('Campañas · en el celular', () => {
  afterEach(() => {
    delete window.matchMedia
  })

  test('el formulario ocupa toda la pantalla', async () => {
    window.matchMedia = query => ({
      matches: query === '(max-width:600px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))

    expect(screen.getByRole('dialog').className).toMatch(/MuiDialog-paperFullScreen|fullScreen/)
  })
})

describe('Campañas · esperas largas', () => {
  test('una espera larga se dice en horas o días', () => {
    expect(formatDelay(45)).toBe('45 min')
    expect(formatDelay(60)).toBe('1 hora')
    expect(formatDelay(120)).toBe('2 horas')
    expect(formatDelay(1440)).toBe('1 día')
    expect(formatDelay(43200)).toBe('30 días')
    expect(formatDelay(90)).toBe('90 min')
  })
})
