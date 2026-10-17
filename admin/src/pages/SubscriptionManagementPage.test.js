// Mi suscripción: el botón de plan cuando todavía no hay suscripción.
//
// El comercio entraba a esta pantalla, veía su plan "activo", apretaba "Cambiar
// a este plan" y recibía "Suscripción de Mercado Pago no encontrada". El mensaje
// era correcto —no existía ninguna suscripción— pero el botón no podía hacer
// otra cosa que fallar: /subscriptions/change-plan le pide a Mercado Pago que
// modifique el monto de una suscripción EXISTENTE.
//
// El estado del comercio puede decir 'active' sin que haya suscripción alguna:
// es lo que pasa cuando el plan se puso a mano. La pantalla miraba solo ese
// estado para habilitar los botones.

import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from 'antd'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

// jsdom no trae ResizeObserver y la tabla de Ant Design lo necesita.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockGet = jest.fn()
const mockPost = jest.fn()
const mockNavigate = jest.fn()

// El alias @utils lo reescribe babel-plugin-module-resolver ANTES de que Jest
// vea el import, así que hay que mockear la ruta ya resuelta, no el alias.
jest.unstable_mockModule('../utils/axiosConfig', () => ({
  default: { get: mockGet, post: mockPost },
}))

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

const { default: SubscriptionManagementPage } = await import('./SubscriptionManagementPage.js')

const suscripcion = (mercadoPago = null) => ({
  plan: 'pro',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  subscriptionPastDueAt: null,
  mercadoPago,
})

const montar = async mercadoPago => {
  mockGet.mockImplementation(url => {
    if (url.includes('invoices')) {
      return Promise.resolve({ data: { success: true, data: { invoices: [] } } })
    }

    // Los precios ya no están en la pantalla: los sirve el backend.
    if (url.includes('plans')) {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            currency: 'ARS',
            plans: [
              { plan: 'starter', monthlyPriceArs: 40000, currency: 'ARS' },
              { plan: 'pro', monthlyPriceArs: 151470, currency: 'ARS' },
            ],
          },
        },
      })
    }

    return Promise.resolve({
      data: { success: true, data: suscripcion(mercadoPago) },
    })
  })

  render(<SubscriptionManagementPage />)

  // La pantalla arranca en loading; se espera a que el plan esté en pantalla.
  await waitFor(() => expect(mockGet).toHaveBeenCalled())

  return screen.findByRole('button', { name: /Cambiar a este plan/i })
}

beforeEach(() => {
  jest.clearAllMocks()
})

// Los diálogos de confirmación de Ant Design (Modal.confirm) viven fuera del árbol que RTL limpia:
// el que abrió una prueba seguía en el documento y se sumaba al de la siguiente.
afterEach(async () => {
  Modal.destroyAll()
  await waitFor(() => expect(document.querySelector('.ant-modal-root')).toBeNull())
})

describe('Mi suscripción · elegir plan sin suscripción previa', () => {
  test('lleva al checkout en vez de pedir un cambio imposible', async () => {
    const boton = await montar(null)

    await userEvent.click(boton)

    expect(mockNavigate).toHaveBeenCalledWith('/checkout?plan=starter')
    // Y NO se llama al endpoint que solo sabe modificar una suscripción que
    // ya existe.
    expect(mockPost).not.toHaveBeenCalled()
  })

  test('no ofrece cancelar algo que no existe', async () => {
    await montar(null)

    expect(screen.queryByText(/Zona de peligro/i)).not.toBeInTheDocument()
  })
})

describe('Mi suscripción · con suscripción real', () => {
  test('sí pide el cambio de plan a Mercado Pago', async () => {
    // La contracara: sacar el botón roto no puede sacar también el que sirve.
    const boton = await montar({ subscriptionId: 'mp-sub-1', status: 'authorized' })

    await userEvent.click(boton)

    // El cambio pasa por una confirmación; lo que importa acá es que NO se haya
    // desviado al checkout.
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('ofrece cancelar', async () => {
    await montar({ subscriptionId: 'mp-sub-1', status: 'authorized' })

    expect(await screen.findByText(/Zona de peligro/i)).toBeInTheDocument()
  })
})

describe('Mi suscripción · el precio lo sirve el backend', () => {
  test('muestra el del catálogo, no uno escrito en la pantalla', async () => {
    // La pantalla tenía 26,14 USD para el starter — el resultado congelado de
    // dividir 40.000 pesos por el dólar del 24/08/2026 — mientras el cobro salía
    // de otro número. Si alguien vuelve a escribir un precio acá, esto falla.
    await montar(null)

    expect(await screen.findByText(/\$\s?40\.000/)).toBeInTheDocument()
    expect(screen.queryByText(/26[.,]14/)).not.toBeInTheDocument()
    expect(screen.queryByText(/US\$|USD/)).not.toBeInTheDocument()
  })

  test('si el catálogo cambia el precio, la pantalla lo sigue', async () => {
    // Es la prueba de que no hay copia local: el número sale de la respuesta.
    mockGet.mockImplementation(url => {
      if (url.includes('invoices')) {
        return Promise.resolve({ data: { success: true, data: { invoices: [] } } })
      }
      if (url.includes('plans')) {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              currency: 'ARS',
              plans: [{ plan: 'starter', monthlyPriceArs: 52000, currency: 'ARS' }],
            },
          },
        })
      }
      return Promise.resolve({ data: { success: true, data: suscripcion(null) } })
    })

    render(<SubscriptionManagementPage />)

    expect(await screen.findByText(/\$\s?52\.000/)).toBeInTheDocument()
  })
})

// ─── La fecha del próximo cobro ──────────────────────────────────────────────
//
// La tarjeta decía "Próximo pago" y mostraba trialEndsAt: el fin del período
// de prueba. En un comercio que ya paga eso es una fecha vieja que no tiene
// nada que ver con el próximo cobro, y el dato bueno venía en la respuesta sin
// que nadie lo leyera.

describe('Mi suscripción · próximo cobro', () => {
  test('muestra la fecha que informa Mercado Pago, no el fin de la prueba', async () => {
    await montar({
      subscriptionId: 'mp-1',
      status: 'authorized',
      nextBillingAt: '2026-10-15T10:00:00.000Z',
    })

    expect(await screen.findByText(/Próximo pago/i)).toBeInTheDocument()
    // formatDate usa mes en palabras (es-AR).
    expect(screen.getByText(/15 de octubre de 2026/i)).toBeInTheDocument()
  })

  test('sin suscripción, la tarjeta dice de qué fecha habla', async () => {
    await montar(null)

    expect(screen.queryByText(/Próximo pago/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Fin de la prueba/i)).toBeInTheDocument()
  })
})

// ─── Rediseño: estados, cupos, cambio y cancelación ───────────────────────────

const CATALOGO = {
  currency: 'ARS',
  plans: [
    {
      plan: 'starter',
      monthlyPriceArs: 40000,
      currency: 'ARS',
      limits: { vision: 300, agentMessages: 2000, imageEdits: 100, marketAnalyses: 50 },
    },
    {
      plan: 'pro',
      monthlyPriceArs: 151470,
      currency: 'ARS',
      limits: { vision: 1500, agentMessages: 10000, imageEdits: 500, marketAnalyses: 250 },
    },
  ],
}

const montarCon = async ({
  suscripcion: sub = suscripcion(null),
  facturas = [],
  catalogo = CATALOGO,
  falla = null,
} = {}) => {
  mockGet.mockImplementation(url => {
    if (falla) return Promise.reject(falla)
    if (url.includes('invoices')) {
      return Promise.resolve({ data: { success: true, data: { invoices: facturas } } })
    }
    if (url.includes('plans')) {
      return Promise.resolve({ data: { success: true, data: catalogo } })
    }
    return Promise.resolve({ data: { success: true, data: sub } })
  })

  render(<SubscriptionManagementPage />)
  await waitFor(() => expect(mockGet).toHaveBeenCalled())
}

const tarjeta = async nombre => within(await screen.findByLabelText(`Plan ${nombre}`))

describe('Mi suscripción · planes y cupos', () => {
  test('cada plan muestra sus cupos de IA, con el separador de miles argentino', async () => {
    await montarCon()

    const emprendedor = await tarjeta('Emprendedor')
    expect(emprendedor.getByText('300')).toBeInTheDocument()
    expect(emprendedor.getByText('2.000')).toBeInTheDocument()

    const profesional = await tarjeta('Profesional')
    expect(profesional.getByText('1.500')).toBeInTheDocument()
    expect(profesional.getByText('10.000')).toBeInTheDocument()
  })

  test('los cupos salen del catálogo: si cambian, la pantalla los sigue', async () => {
    await montarCon({
      catalogo: {
        currency: 'ARS',
        plans: [{ ...CATALOGO.plans[0], limits: { vision: 777 } }, CATALOGO.plans[1]],
      },
    })

    expect((await tarjeta('Emprendedor')).getByText('777')).toBeInTheDocument()
  })

  test('el plan actual se marca y no ofrece cambiarse a sí mismo', async () => {
    await montarCon()

    const profesional = await tarjeta('Profesional')

    expect(profesional.getByText('Actual')).toBeInTheDocument()
    expect(profesional.queryByRole('button')).not.toBeInTheDocument()
    expect((await tarjeta('Emprendedor')).getByRole('button')).toBeInTheDocument()
  })

  test('un plan sin precio cargado no se puede contratar', async () => {
    await montarCon({
      catalogo: { currency: 'ARS', plans: [{ plan: 'starter', monthlyPriceArs: null }] },
    })

    const boton = (await tarjeta('Emprendedor')).getByRole('button')

    expect(boton).toBeDisabled()
    expect(boton).toHaveTextContent('Precio a definir')
  })
})

describe('Mi suscripción · estados', () => {
  test('en prueba: lo dice, cuenta los días y deja elegir plan', async () => {
    const enCincoDias = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString()
    await montarCon({
      suscripcion: {
        ...suscripcion(null),
        plan: 'starter',
        subscriptionStatus: 'trialing',
        trialEndsAt: enCincoDias,
      },
    })

    expect(await screen.findByText('En prueba')).toBeInTheDocument()
    expect(screen.getByText(/tu período de prueba termina en 5 días/i)).toBeInTheDocument()
    // Antes se le decía que su suscripción ya estaba «cancelada o expirada» y no veía planes.
    expect(screen.queryByText(/ya está cancelada o expirada/i)).not.toBeInTheDocument()
    expect(await tarjeta('Profesional')).toBeTruthy()
  })

  test('en prueba, elegir un plan lleva al checkout (no hay suscripción que cambiar)', async () => {
    await montarCon({
      suscripcion: {
        ...suscripcion(null),
        plan: 'starter',
        subscriptionStatus: 'trialing',
        trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      },
    })

    await userEvent.click((await tarjeta('Profesional')).getByRole('button'))

    expect(mockNavigate).toHaveBeenCalledWith('/checkout?plan=pro')
    expect(mockPost).not.toHaveBeenCalled()
  })

  test('en prueba no ofrece cancelar: no hay nada que cancelar', async () => {
    await montarCon({
      suscripcion: { ...suscripcion(null), subscriptionStatus: 'trialing' },
    })

    await screen.findByText('En prueba')

    expect(screen.queryByText(/Zona de peligro/i)).not.toBeInTheDocument()
  })

  test('con el pago pendiente, avisa como alerta', async () => {
    await montarCon({
      suscripcion: {
        ...suscripcion({ subscriptionId: 'mp-1' }),
        subscriptionStatus: 'past_due',
      },
    })

    expect(await screen.findByText('Pendiente de pago')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/tu pago está pendiente/i)
  })

  test('cancelada: lo dice, no ofrece cambiar ni cancelar, y lleva a los planes', async () => {
    await montarCon({
      suscripcion: { ...suscripcion(null), subscriptionStatus: 'cancelled' },
    })

    expect(await screen.findByText(/tu suscripción ya está cancelada o expirada/i)).toBeVisible()
    expect(screen.queryByLabelText('Plan Emprendedor')).not.toBeInTheDocument()
    // Sin ninguna fecha, una baja no tiene un «fin de la prueba» que mostrar.
    expect(screen.queryByText(/fin de la prueba/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Zona de peligro/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /ver planes/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/subscripcion')
  })

  test('sin datos de suscripción, ofrece ver planes o volver al panel', async () => {
    mockGet.mockImplementation(url => {
      if (url.includes('invoices')) {
        return Promise.resolve({ data: { success: true, data: { invoices: [] } } })
      }
      if (url.includes('plans')) {
        return Promise.resolve({ data: { success: true, data: CATALOGO } })
      }
      return Promise.resolve({ data: { success: false } })
    })

    render(<SubscriptionManagementPage />)

    expect(await screen.findByText(/no hay información de suscripción/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /volver al panel/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin')
  })

  test('si no se puede cargar, lo dice con el motivo', async () => {
    await montarCon({
      falla: { response: { data: { message: 'Sesión vencida.' } } },
    })

    expect(await screen.findByText('Sesión vencida.')).toBeInTheDocument()
  })
})

describe('Mi suscripción · acciones con suscripción en Mercado Pago', () => {
  const conMercadoPago = () => ({
    ...suscripcion({ subscriptionId: 'mp-sub-1', status: 'authorized' }),
    plan: 'pro',
  })

  test('cambiar de plan pide confirmación y manda el plan nuevo', async () => {
    mockPost.mockResolvedValue({
      data: { success: true, data: { plan: 'starter', status: 'active' } },
    })
    await montarCon({ suscripcion: conMercadoPago() })

    await userEvent.click((await tarjeta('Emprendedor')).getByRole('button'))
    await userEvent.click(await screen.findByRole('button', { name: /sí, cambiar/i }))

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/subscriptions/change-plan', { newPlan: 'starter' }),
    )
    // La tarjeta del plan nuevo pasa a ser la actual.
    expect(await (await tarjeta('Emprendedor')).findByText('Actual')).toBeInTheDocument()
  })

  test('cancelar pide confirmación, cancela y la pantalla pasa a «Cancelada»', async () => {
    mockPost.mockResolvedValue({ data: { success: true } })
    await montarCon({ suscripcion: conMercadoPago() })

    await userEvent.click(await screen.findByRole('button', { name: /cancelar suscripción/i }))
    await userEvent.click(await screen.findByRole('button', { name: /sí, cancelar/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/subscriptions/cancel'))
    expect(await screen.findByText('Cancelada')).toBeInTheDocument()
    // El plan NO cambia al cancelar: cambia el estado.
    expect(screen.getAllByText('Profesional').length).toBeGreaterThan(0)
  })

  test('si cancelar falla, no se marca como cancelada', async () => {
    mockPost.mockResolvedValue({ data: { success: false, message: 'No se pudo cancelar.' } })
    await montarCon({ suscripcion: conMercadoPago() })

    await userEvent.click(await screen.findByRole('button', { name: /cancelar suscripción/i }))
    await userEvent.click(await screen.findByRole('button', { name: /sí, cancelar/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(screen.queryByText('Cancelada')).not.toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })
})

describe('Mi suscripción · historial de pagos', () => {
  test('sin pagos, lo dice', async () => {
    await montarCon()

    expect(await screen.findByText('No hay pagos registrados')).toBeInTheDocument()
  })

  test('lista los pagos, y una factura sin moneda se muestra en pesos, no en dólares', async () => {
    await montarCon({
      facturas: [
        {
          id: 'f1',
          date: '2026-09-15T10:00:00.000Z',
          status: 'approved',
          amount: 40000,
          reason: 'Plan Emprendedor',
        },
        {
          id: 'f2',
          date: '2026-08-15T10:00:00.000Z',
          status: 'pending',
          amount: 40000,
          currency: 'ARS',
          reason: 'Plan Emprendedor',
        },
      ],
    })

    expect(await screen.findByText('Pagado')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getAllByText(/\$\s?40\.000/).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/US\$|USD/)).not.toBeInTheDocument()
  })
})

describe('Mi suscripción · estructura', () => {
  test('tiene un solo h1 y un encabezado por sección', async () => {
    await montarCon()

    await screen.findByLabelText('Plan Profesional')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /cambiar de plan/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /historial de pagos/i })).toBeInTheDocument()
  })
})
