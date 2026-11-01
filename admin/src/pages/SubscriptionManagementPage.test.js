// Mi suscripción: plan, próximo cobro, pagos, cambio de plan y baja.
//
// Cada bloque fija un defecto que la pantalla tuvo. El primero: el comercio
// apretaba "Cambiar a este plan" y recibía "Suscripción de Mercado Pago no
// encontrada" — /subscriptions/change-plan solo sabe modificar una suscripción
// que ya existe, y el estado del comercio puede decir 'active' sin que haya
// ninguna (un plan puesto a mano).

import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

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

const {
  default: SubscriptionManagementPage,
  formatMoney,
  invoiceStatus,
  planChangeMode,
  priceDelta,
} = await import('./SubscriptionManagementPage.js')

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

const suscripcion = (mercadoPago = null, overrides = {}) => ({
  plan: 'pro',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  subscriptionPastDueAt: null,
  mercadoPago,
  ...overrides,
})

const conMercadoPago = (overrides = {}) =>
  suscripcion({ subscriptionId: 'mp-sub-1', status: 'authorized' }, overrides)

const ok = data => Promise.resolve({ data: { success: true, data } })

/**
 * Cada endpoint por su lado: `fallas` hace fallar solo los que se nombran, que
 * es justamente lo que la pantalla tiene que aguantar.
 */
const montar = async ({
  suscripcion: sub = suscripcion(null),
  facturas = [],
  catalogo = CATALOGO,
  fallas = {},
  esperar = true,
} = {}) => {
  mockGet.mockImplementation(url => {
    const clave = ['invoices', 'plans', 'current'].find(nombre => url.includes(nombre))
    if (fallas[clave]) return Promise.reject(fallas[clave])
    if (clave === 'invoices') return ok({ invoices: facturas })
    if (clave === 'plans') return ok(catalogo)
    return ok(sub)
  })

  render(<SubscriptionManagementPage />)
  if (!esperar) return
  await screen.findByLabelText('Estado de tu suscripción')
  // Los planes y los pagos cargan por su lado; se espera a que terminen.
  await waitFor(() => expect(screen.queryByText(/cargando/i)).not.toBeInTheDocument())
}

const tarjeta = async nombre => within(await screen.findByLabelText(`Plan ${nombre}`))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Mi suscripción · lógica', () => {
  test('planChangeMode: cada caso va al lugar que puede cumplirlo', () => {
    expect(planChangeMode(conMercadoPago())).toBe('mercadopago')
    expect(planChangeMode(conMercadoPago({ subscriptionStatus: 'past_due' }))).toBe('mercadopago')
    expect(planChangeMode(suscripcion(null))).toBe('manual')
    expect(
      planChangeMode(
        suscripcion(
          { subscriptionId: 'mp-pend', status: 'pending' },
          { subscriptionStatus: 'trialing' },
        ),
      ),
    ).toBe('checkout')
    expect(planChangeMode(conMercadoPago({ subscriptionStatus: 'cancelled' }))).toBe('checkout')
  })

  test('priceDelta: solo con los dos precios', () => {
    expect(priceDelta(40000, 151470)).toBe(111470)
    expect(priceDelta(151470, 40000)).toBe(-111470)
    expect(priceDelta(null, 40000)).toBeNull()
  })

  test('invoiceStatus: un rechazo no es «pendiente», y el estado viejo se entiende', () => {
    expect(invoiceStatus('failed').label).toBe('Rechazado')
    expect(invoiceStatus('retrying').label).toBe('Reintentando')
    expect(invoiceStatus('approved').label).toBe('Pagado')
    expect(invoiceStatus('cualquier-cosa').label).toBe('En proceso')
  })

  test('formatMoney: un monto que no vino es una raya, no «$ NaN»', () => {
    expect(formatMoney(undefined)).toBe('—')
    expect(formatMoney(40000)).toMatch(/\$\s?40\.000/)
  })
})

describe('Mi suscripción · plan activo sin suscripción en Mercado Pago', () => {
  // Es el plan puesto a mano. Antes el botón llevaba al checkout, y el checkout
  // bloquea a toda cuenta activa con «Ir a Mi suscripción»: un círculo.
  test('no ofrece un botón que no puede cumplir: dice a quién pedirle el cambio', async () => {
    await montar()

    expect(await screen.findByText(/lo activó el equipo de HENKO/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cambiar a este plan/i })).not.toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('no ofrece cancelar algo que no existe', async () => {
    await montar()

    expect(screen.queryByText(/cancelar la suscripción/i)).not.toBeInTheDocument()
  })

  test('no inventa una fecha ni un «fin de la prueba»', async () => {
    // Antes mostraba «Fin de la prueba: No disponible» a un comercio activo.
    await montar()

    expect(screen.getByText(/sin cobro programado/i)).toBeInTheDocument()
    expect(screen.queryByText(/fin de la prueba/i)).not.toBeInTheDocument()
  })
})

describe('Mi suscripción · con suscripción en Mercado Pago', () => {
  test('cambiar de plan pide confirmación con el monto nuevo y manda el plan', async () => {
    mockPost.mockResolvedValue({
      data: { success: true, data: { plan: 'starter', status: 'active' } },
    })
    await montar({
      suscripcion: conMercadoPago({
        mercadoPago: {
          subscriptionId: 'mp-sub-1',
          status: 'authorized',
          nextBillingAt: '2026-11-15T12:00:00.000Z',
        },
      }),
    })

    const emprendedor = await tarjeta('Emprendedor')
    expect(emprendedor.getByText(/111\.470 menos por mes/)).toBeInTheDocument()

    await userEvent.click(emprendedor.getByRole('button', { name: /cambiar a este plan/i }))

    const dialogo = within(await screen.findByRole('dialog'))
    // Lo que va a pagar y desde cuándo, antes de confirmar.
    expect(dialogo.getByText(/\$\s?40\.000 por mes en lugar de \$\s?151\.470/)).toBeInTheDocument()
    expect(dialogo.getByText(/15 de noviembre de 2026/)).toBeInTheDocument()

    await userEvent.click(dialogo.getByRole('button', { name: /sí, cambiar/i }))

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/subscriptions/change-plan', { newPlan: 'starter' }),
    )
    // La tarjeta del plan nuevo pasa a ser la actual.
    expect(await (await tarjeta('Emprendedor')).findByText('Actual')).toBeInTheDocument()
    expect(screen.getByText(/ahora estás en el plan Emprendedor/i)).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('con el pago pendiente, cambiar de plan no lo muestra al día', async () => {
    // El backend contestaba status 'active' fijo y la pantalla lo copiaba.
    mockPost.mockResolvedValue({
      data: { success: true, data: { plan: 'starter', status: 'active' } },
    })
    await montar({ suscripcion: conMercadoPago({ subscriptionStatus: 'past_due' }) })

    await userEvent.click((await tarjeta('Emprendedor')).getByRole('button'))
    await userEvent.click(await screen.findByRole('button', { name: /sí, cambiar/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(await screen.findByText('Pendiente de pago')).toBeInTheDocument()
    expect(screen.queryByText('Activa')).not.toBeInTheDocument()
  })

  test('si el cambio falla, el motivo queda en el diálogo y el plan no cambia', async () => {
    mockPost.mockRejectedValue({
      response: { data: { message: 'Error actualizando en Mercado Pago' } },
    })
    await montar({ suscripcion: conMercadoPago() })

    await userEvent.click((await tarjeta('Emprendedor')).getByRole('button'))
    await userEvent.click(await screen.findByRole('button', { name: /sí, cambiar/i }))

    expect(await screen.findByText('Error actualizando en Mercado Pago')).toBeInTheDocument()
    expect((await tarjeta('Profesional')).getByText('Actual')).toBeInTheDocument()
  })

  test('cancelar pide confirmación, cancela y la pantalla pasa a «Cancelada»', async () => {
    mockPost.mockResolvedValue({ data: { success: true } })
    await montar({ suscripcion: conMercadoPago() })

    expect(screen.getByRole('heading', { name: /cancelar la suscripción/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /cancelar suscripción/i }))
    await userEvent.click(await screen.findByRole('button', { name: /sí, cancelar/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/subscriptions/cancel'))
    expect(await screen.findByText('Cancelada')).toBeInTheDocument()
    // El plan NO cambia al cancelar: cambia el estado.
    expect(screen.getAllByText('Profesional').length).toBeGreaterThan(0)
    // Y ya no ofrece cancelar otra vez.
    expect(screen.queryByRole('button', { name: /cancelar suscripción/i })).not.toBeInTheDocument()
  })

  test('si cancelar falla, no se marca como cancelada y dice por qué', async () => {
    mockPost.mockResolvedValue({ data: { success: false, message: 'No se pudo cancelar.' } })
    await montar({ suscripcion: conMercadoPago() })

    await userEvent.click(screen.getByRole('button', { name: /cancelar suscripción/i }))
    await userEvent.click(await screen.findByRole('button', { name: /sí, cancelar/i }))

    expect(await screen.findByText('No se pudo cancelar.')).toBeInTheDocument()
    expect(screen.queryByText('Cancelada')).not.toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })

  test('un doble clic en confirmar manda un solo pedido', async () => {
    let resolver
    mockPost.mockImplementation(
      () =>
        new Promise(resolve => {
          resolver = resolve
        }),
    )
    await montar({ suscripcion: conMercadoPago() })

    await userEvent.click(screen.getByRole('button', { name: /cancelar suscripción/i }))
    const confirmar = await screen.findByRole('button', { name: /sí, cancelar/i })
    // Dos clics seguidos, sin esperar a que React vuelva a dibujar.
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)

    expect(mockPost).toHaveBeenCalledTimes(1)
    resolver({ data: { success: true } })
    expect(await screen.findByText('Cancelada')).toBeInTheDocument()
  })

  test('muestra la fecha del próximo cobro que informa Mercado Pago', async () => {
    await montar({
      suscripcion: conMercadoPago({
        mercadoPago: {
          subscriptionId: 'mp-1',
          status: 'authorized',
          nextBillingAt: '2026-10-15T10:00:00.000Z',
        },
      }),
    })

    expect(screen.getByText(/próximo pago/i)).toBeInTheDocument()
    expect(screen.getByText(/15 de octubre de 2026/i)).toBeInTheDocument()
  })
})

describe('Mi suscripción · el precio y los cupos los sirve el backend', () => {
  test('muestra el del catálogo, en pesos, no uno escrito en la pantalla', async () => {
    // La pantalla tenía 26,14 USD para el starter — el resultado congelado de
    // dividir 40.000 pesos por el dólar del 24/08/2026 — mientras el cobro salía
    // de otro número.
    await montar()

    expect((await screen.findAllByText(/\$\s?40\.000/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/26[.,]14/)).not.toBeInTheDocument()
    expect(screen.queryByText(/US\$|USD/)).not.toBeInTheDocument()
  })

  test('si el catálogo cambia el precio, la pantalla lo sigue', async () => {
    await montar({
      catalogo: {
        currency: 'ARS',
        plans: [{ ...CATALOGO.plans[0], monthlyPriceArs: 52000 }, CATALOGO.plans[1]],
      },
    })

    expect((await screen.findAllByText(/\$\s?52\.000/)).length).toBeGreaterThan(0)
  })

  test('cada plan muestra sus cupos de IA, con el separador de miles argentino', async () => {
    await montar()

    const emprendedor = await tarjeta('Emprendedor')
    expect(emprendedor.getByText('300')).toBeInTheDocument()
    expect(emprendedor.getByText('2.000')).toBeInTheDocument()

    const profesional = await tarjeta('Profesional')
    expect(profesional.getByText('1.500')).toBeInTheDocument()
    expect(profesional.getByText('10.000')).toBeInTheDocument()
  })

  test('el plan actual se marca y no ofrece cambiarse a sí mismo', async () => {
    await montar({ suscripcion: conMercadoPago() })

    const profesional = await tarjeta('Profesional')

    expect(profesional.getByText('Actual')).toBeInTheDocument()
    expect(profesional.queryByRole('button')).not.toBeInTheDocument()
    expect((await tarjeta('Emprendedor')).getByRole('button')).toBeInTheDocument()
  })

  test('un plan sin precio cargado no se puede contratar', async () => {
    await montar({
      suscripcion: conMercadoPago(),
      catalogo: { currency: 'ARS', plans: [{ plan: 'starter', monthlyPriceArs: null }] },
    })

    const boton = (await tarjeta('Emprendedor')).getByRole('button')

    expect(boton).toBeDisabled()
    expect(boton).toHaveTextContent('Precio a definir')
  })

  test('si el catálogo no carga, lo dice y deja reintentar, sin precios «a definir»', async () => {
    await montar({ fallas: { plans: new Error('Network Error') } })

    expect(await screen.findByText(/no pudimos cargar los precios/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Plan Emprendedor')).not.toBeInTheDocument()
    expect(screen.getByText('No disponible')).toBeInTheDocument()

    mockGet.mockImplementation(url => (url.includes('plans') ? ok(CATALOGO) : ok({ invoices: [] })))
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByLabelText('Plan Emprendedor')).toBeInTheDocument()
  })
})

describe('Mi suscripción · estados', () => {
  test('en prueba: lo dice, cuenta los días y deja elegir cualquier plan', async () => {
    const enCincoDias = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString()
    await montar({
      suscripcion: suscripcion(null, {
        plan: 'starter',
        subscriptionStatus: 'trialing',
        trialEndsAt: enCincoDias,
      }),
    })

    expect(screen.getByText('En prueba')).toBeInTheDocument()
    expect(screen.getByText(/tu período de prueba termina en 5 días/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /elegí tu plan/i })).toBeInTheDocument()
    // El plan de la prueba NO es un plan pagado: antes se marcaba «Actual», sin
    // botón, y el comercio en prueba no podía suscribirse al Emprendedor.
    const emprendedor = await tarjeta('Emprendedor')
    expect(emprendedor.getByText('Tu prueba')).toBeInTheDocument()
    expect(emprendedor.queryByText('Actual')).not.toBeInTheDocument()

    await userEvent.click(emprendedor.getByRole('button', { name: /suscribirme/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/checkout?plan=starter')
    expect(mockPost).not.toHaveBeenCalled()
  })

  test('en prueba con un día, lo dice en singular', async () => {
    await montar({
      suscripcion: suscripcion(null, {
        subscriptionStatus: 'trialing',
        trialEndsAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
      }),
    })

    expect(screen.getByText(/termina en 1 día\./i)).toBeInTheDocument()
  })

  test('con la prueba vencida no dice «termina en -3 días»', async () => {
    await montar({
      suscripcion: suscripcion(null, {
        subscriptionStatus: 'trialing',
        trialEndsAt: '2026-01-10T12:00:00.000Z',
      }),
    })

    expect(
      screen.getByText(/tu período de prueba terminó el 10 de enero de 2026/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/termina en -/i)).not.toBeInTheDocument()
  })

  test('en prueba no ofrece cancelar: no hay nada que cancelar', async () => {
    await montar({ suscripcion: suscripcion(null, { subscriptionStatus: 'trialing' }) })

    expect(screen.queryByText(/cancelar la suscripción/i)).not.toBeInTheDocument()
  })

  test('en prueba con una suscripción esperando autorización: va al checkout, no a change-plan', async () => {
    // Es lo que deja un cobro rechazado: una suscripción 'pending' para
    // autorizar desde Mercado Pago. Antes el botón pedía change-plan y el
    // backend contestaba «No puedes cambiar de plan en este momento».
    await montar({
      suscripcion: suscripcion(
        { subscriptionId: 'mp-pend', status: 'pending', planSelected: 'pro' },
        { plan: 'starter', subscriptionStatus: 'trialing' },
      ),
    })

    expect(
      screen.getByText(/suscripción al plan Profesional esperando autorización/i),
    ).toBeInTheDocument()

    await userEvent.click((await tarjeta('Profesional')).getByRole('button'))

    expect(mockNavigate).toHaveBeenCalledWith('/checkout?plan=pro')
    expect(mockPost).not.toHaveBeenCalled()
  })

  test('con el pago pendiente, avisa como alerta y dice desde cuándo', async () => {
    await montar({
      suscripcion: conMercadoPago({
        subscriptionStatus: 'past_due',
        subscriptionPastDueAt: '2026-10-03T12:00:00.000Z',
      }),
    })

    expect(screen.getByText('Pendiente de pago')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /tu pago está pendiente desde el 3 de octubre de 2026/i,
    )
  })

  test('cancelada: lo dice, no ofrece cancelar, y vuelve a suscribirse desde acá', async () => {
    // Antes la mandaba a la pantalla pública de planes, un paso más antes del
    // mismo checkout.
    await montar({ suscripcion: suscripcion(null, { subscriptionStatus: 'cancelled' }) })

    expect(screen.getByText('Cancelada')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /volver a suscribirte/i })).toBeInTheDocument()
    // Sin ninguna fecha, una baja no tiene un «fin de la prueba» que mostrar.
    expect(screen.queryByText(/fin de la prueba/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/cancelar la suscripción/i)).not.toBeInTheDocument()

    await userEvent.click((await tarjeta('Profesional')).getByRole('button'))

    expect(mockNavigate).toHaveBeenCalledWith('/checkout?plan=pro')
  })

  test('sin datos de suscripción, ofrece ver planes o volver al panel', async () => {
    mockGet.mockImplementation(url => {
      if (url.includes('invoices')) return ok({ invoices: [] })
      if (url.includes('plans')) return ok(CATALOGO)
      return Promise.resolve({ data: { success: false } })
    })

    render(<SubscriptionManagementPage />)

    expect(await screen.findByText(/no hay información de suscripción/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /volver al panel/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin')
  })

  test('si no se puede cargar, lo dice con el motivo y deja reintentar', async () => {
    await montar({
      fallas: { current: { response: { data: { message: 'Sesión vencida.' } } } },
      esperar: false,
    })

    expect(await screen.findByText('Sesión vencida.')).toBeInTheDocument()

    mockGet.mockImplementation(() => ok(conMercadoPago()))
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByLabelText('Estado de tu suscripción')).toBeInTheDocument()
  })
})

describe('Mi suscripción · historial de pagos', () => {
  test('sin pagos, lo dice', async () => {
    await montar()

    expect(await screen.findByText('No hay pagos registrados')).toBeInTheDocument()
  })

  test('lista los pagos con su estado, y una factura sin moneda se muestra en pesos', async () => {
    await montar({
      suscripcion: conMercadoPago(),
      facturas: [
        { id: 'f1', date: '2026-09-15T10:00:00.000Z', status: 'paid', amount: 40000 },
        {
          id: 'f2',
          date: '2026-08-15T10:00:00.000Z',
          status: 'retrying',
          amount: 40000,
          currency: 'ARS',
          retryAttempt: 2,
        },
        { id: 'f3', date: '2026-07-15T10:00:00.000Z', status: 'failed', amount: 40000 },
      ],
    })

    expect(await screen.findByText('Pagado')).toBeInTheDocument()
    expect(screen.getByText('Reintentando')).toBeInTheDocument()
    expect(screen.getByText('Rechazado')).toBeInTheDocument()
    expect(screen.getByText(/intento 3/)).toBeInTheDocument()
    expect(screen.queryByText(/US\$|USD/)).not.toBeInTheDocument()
  })

  test('el último pago aprobado aparece en el resumen', async () => {
    await montar({
      suscripcion: conMercadoPago(),
      facturas: [
        { id: 'f0', date: '2026-10-15T10:00:00.000Z', status: 'failed', amount: 151470 },
        { id: 'f1', date: '2026-09-15T10:00:00.000Z', status: 'paid', amount: 151470 },
      ],
    })

    const resumen = within(screen.getByLabelText('Estado de tu suscripción'))
    expect(await resumen.findByText(/último pago/i)).toBeInTheDocument()
    expect(resumen.getByText(/el 15 de septiembre de 2026/)).toBeInTheDocument()
  })

  test('si Mercado Pago no responde, el resto de la pantalla sigue funcionando', async () => {
    // Las tres consultas iban en un Promise.all: un 503 del historial dejaba
    // la pantalla en «No hay información de suscripción», sin plan ni botón de
    // cancelar.
    await montar({
      suscripcion: conMercadoPago(),
      fallas: { invoices: { response: { data: { message: 'Error obteniendo facturación' } } } },
    })

    expect(await screen.findByText('Error obteniendo facturación')).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar suscripción/i })).toBeInTheDocument()

    mockGet.mockImplementation(() =>
      ok({ invoices: [{ id: 'f1', date: '2026-09-15T10:00:00.000Z', status: 'paid', amount: 1 }] }),
    )
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByText('Pagado')).toBeInTheDocument()
  })

  test('con muchos pagos muestra los últimos y deja ver todos', async () => {
    const facturas = Array.from({ length: 9 }, (_, i) => ({
      id: `f${i}`,
      date: new Date(Date.UTC(2026, 9 - i, 15)).toISOString(),
      status: 'paid',
      amount: 40000,
    }))
    await montar({ suscripcion: conMercadoPago(), facturas })

    expect(await screen.findAllByText('Pagado')).toHaveLength(6)

    await userEvent.click(screen.getByRole('button', { name: /ver los 9 pagos/i }))

    expect(screen.getAllByText('Pagado')).toHaveLength(9)
  })
})

describe('Mi suscripción · estructura', () => {
  test('tiene un solo h1 y un encabezado por sección', async () => {
    await montar({ suscripcion: conMercadoPago() })

    await screen.findByLabelText('Plan Profesional')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /cambiar de plan/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /historial de pagos/i })).toBeInTheDocument()
  })
})
