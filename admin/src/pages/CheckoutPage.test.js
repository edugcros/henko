// El checkout tiene que RENDERIZAR, no solo importarse.
//
// El smoke test de pantallas comprueba que cada archivo parsee y que sus
// imports resuelvan. Eso no alcanzó: después de reemplazar el formulario propio
// por el Brick de Mercado Pago, la página importaba bien y explotaba al
// renderizar — el ErrorBoundary mostraba "Ocurrió un error inesperado" y no
// había forma de llegar al pago.
//
// Es literalmente el motivo por el que existe jest.config.js en este panel: "un
// build verde no dice nada sobre si la página abre". Un import verde tampoco.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockGet = jest.fn()
const mockPost = jest.fn()
const mockInitMercadoPago = jest.fn()
const mockNavigate = jest.fn()
let mockQuery = 'plan=starter'
let mockConfig = { mpPublicKey: 'APP_USR-abc' }

jest.unstable_mockModule('../utils/axiosConfig', () => ({
  default: { get: mockGet, post: mockPost },
}))

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(mockQuery)],
}))

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector({ user: { user: { email: 'a@b.com' } } }),
}))

// El Brick es un iframe de Mercado Pago: en jsdom no se monta. Lo que importa
// acá es que la pantalla lo pida con los datos correctos y no rompa alrededor.
jest.unstable_mockModule('@mercadopago/sdk-react', () => ({
  initMercadoPago: mockInitMercadoPago,
  // El botón permite disparar onSubmit como lo haría el Brick real, que es la
  // única forma de ejercitar lo que la pantalla hace con la respuesta.
  CardPayment: ({ initialization, onSubmit }) => (
    <div data-testid="brick">
      monto: {initialization?.amount}
      <button
        type="button"
        onClick={() => onSubmit?.({ token: 'tok-1', payer: { email: 'a@b.com' } })}
      >
        pagar
      </button>
    </div>
  ),
}))

const { default: CheckoutPage, addOneMonth, trialDaysLeft } = await import('./CheckoutPage.js')

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery = 'plan=starter'
  mockConfig = { mpPublicKey: 'APP_USR-abc' }

  mockGet.mockImplementation(url => {
    if (url.includes('/subscriptions/config')) {
      return Promise.resolve({
        data: { success: true, data: mockConfig },
      })
    }

    if (url.includes('/subscriptions/plans')) {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            currency: 'ARS',
            plans: [
              {
                plan: 'starter',
                monthlyPriceArs: 1,
                currency: 'ARS',
                // Las cuotas vienen del backend, derivadas de los mismos topes
                // que el medidor aplica.
                limits: {
                  vision: 300,
                  agentMessages: 2000,
                  agentTokens: 10000000,
                  imageEdits: 100,
                  marketAnalyses: 50,
                  marketTokens: 1250000,
                },
              },
            ],
          },
        },
      })
    }

    return Promise.resolve({ data: { success: true, data: {} } })
  })
})

describe('CheckoutPage · abre', () => {
  test('las cuotas salen del catálogo, no escritas en la pantalla', async () => {
    // Estaban escritas a mano y duplicaban DEFAULT_PLAN_LIMITS del backend. Si
    // alguien mueve un tope, la pantalla tiene que seguirlo.
    render(<CheckoutPage />)

    expect(await screen.findByText(/2\.000 mensajes del asistente\/mes/)).toBeInTheDocument()
    expect(screen.getByText(/300 análisis de imágenes\/mes/)).toBeInTheDocument()
  })

  test('renderiza sin romper', async () => {
    render(<CheckoutPage />)

    // Con que llegue a pedir la configuración ya pasó el render inicial.
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
  })

  test('inicializa Mercado Pago con la clave que sirve el backend', async () => {
    render(<CheckoutPage />)

    await waitFor(() =>
      expect(mockInitMercadoPago).toHaveBeenCalledWith('APP_USR-abc', {
        locale: 'es-AR',
      }),
    )
  })

  test('le pasa al Brick el precio del catálogo', async () => {
    // El monto que cobra Mercado Pago sale de acá. Si fuera otro, el comercio
    // pagaría algo distinto de lo que dice la pantalla.
    render(<CheckoutPage />)

    expect(await screen.findByTestId('brick')).toHaveTextContent('monto: 1')
  })
})

// UN RECHAZO NO PUEDE SER UN CALLEJÓN
//
// El cobro directo tokeniza la tarjeta y cobra en el acto. Cuando el emisor la
// rechaza, el comercio veía el error y nada más: ninguna salida desde esta
// pantalla.
//
// Medido el 19/09/2026 con un comercio real: once rechazos seguidos de una
// prepaga de Mercado Pago, con el propio panel del vendedor recomendando
// "pague con otro medio de pago". El backend ya crea la suscripción en pending
// y devuelve su init_point en data.initPoint; faltaba mostrarlo.

describe('CheckoutPage · cuando la tarjeta no pasa', () => {
  const rechazoCon = initPoint => {
    const err = new Error('rechazado')
    err.response = {
      data: {
        success: false,
        message: 'No se pudo procesar el pago de suscripción',
        data: { code: 'SUBSCRIPTION_PAYMENT_ERROR', details: 'CC_VAL_433', initPoint },
      },
    }
    return err
  }

  test('ofrece autorizar desde Mercado Pago', async () => {
    // ESTA ES LA PROPIEDAD. Antes solo aparecía el error.
    mockPost.mockRejectedValue(rechazoCon('https://mercadopago.com/autorizar/pre-1'))

    render(<CheckoutPage />)
    await userEvent.click(await screen.findByRole('button', { name: /pagar/i }))

    const enlace = await screen.findByRole('link', { name: /autorizar en mercado pago/i })
    expect(enlace).toHaveAttribute('href', 'https://mercadopago.com/autorizar/pre-1')
  })

  test('el error del cobro se sigue viendo', async () => {
    // El rodeo no puede tapar por qué falló: el comercio tiene que poder
    // llamar a su banco si prefiere.
    mockPost.mockRejectedValue(rechazoCon('https://mercadopago.com/autorizar/pre-2'))

    render(<CheckoutPage />)
    await userEvent.click(await screen.findByRole('button', { name: /pagar/i }))

    expect(await screen.findByText(/no se pudo procesar el pago/i)).toBeInTheDocument()
  })

  test('sin enlace no se inventa un botón', async () => {
    // Si el backend no pudo armar la alternativa, ofrecerla igual mandaría al
    // comercio a una pantalla que no existe.
    mockPost.mockRejectedValue(rechazoCon(null))

    render(<CheckoutPage />)
    await userEvent.click(await screen.findByRole('button', { name: /pagar/i }))

    await screen.findByText(/no se pudo procesar el pago/i)
    expect(
      screen.queryByRole('link', { name: /autorizar en mercado pago/i }),
    ).not.toBeInTheDocument()
  })
})

// ─── Rediseño: lo que la pantalla promete ────────────────────────────────

describe('CheckoutPage · cuándo se cobra', () => {
  // El backend crea la suscripción en 'authorized' y sin start_date: cobra en
  // el acto (subscriptionPaymentService). La pantalla decía "los primeros 14
  // días son gratis, después se cobrará", que era falso.
  test('dice que se cobra hoy, no que hay 14 días gratis', async () => {
    render(<CheckoutPage />)

    expect(await screen.findByText('Hoy se cobra')).toBeInTheDocument()
    expect(screen.queryByText(/14 días son gratis/i)).not.toBeInTheDocument()
  })

  test('en prueba, avisa que contratar ahora la termina', async () => {
    mockConfig = {
      mpPublicKey: 'APP_USR-abc',
      subscriptionStatus: 'trialing',
      trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    }

    render(<CheckoutPage />)

    expect(await screen.findByText(/quedan 5 días de prueba gratis/i)).toBeInTheDocument()
    expect(screen.getByText(/se cobra hoy y la prueba termina/i)).toBeInTheDocument()
  })

  test('addOneMonth no se pasa de mes', () => {
    expect(addOneMonth(new Date(2026, 0, 31)).getMonth()).toBe(1)
    expect(addOneMonth(new Date(2026, 0, 31)).getDate()).toBe(28)
    expect(addOneMonth(new Date(2026, 10, 1)).getMonth()).toBe(11)
  })

  test('trialDaysLeft solo cuenta si está en prueba y no venció', () => {
    const ahora = Date.parse('2026-11-01T12:00:00Z')

    expect(trialDaysLeft('trialing', '2026-11-03T12:00:00Z', ahora)).toBe(2)
    expect(trialDaysLeft('trialing', '2026-10-30T12:00:00Z', ahora)).toBeNull()
    expect(trialDaysLeft('active', '2026-11-03T12:00:00Z', ahora)).toBeNull()
    expect(trialDaysLeft('trialing', null, ahora)).toBeNull()
  })
})

describe('CheckoutPage · un pago pendiente no es un pago aprobado', () => {
  test('con status pending no dice "pago exitoso" ni manda al panel', async () => {
    // El backend responde 202 con success: true y status 'pending' cuando
    // Mercado Pago todavía no aprobó. Antes eso mostraba "¡Pago Exitoso!".
    mockPost.mockResolvedValue({
      data: { success: true, data: { subscriptionId: 'pre-9', status: 'pending' } },
    })

    render(<CheckoutPage />)
    await userEvent.click(await screen.findByRole('button', { name: /pagar/i }))

    expect(await screen.findByText(/Tu pago está en revisión/i)).toBeInTheDocument()
    expect(screen.queryByText(/Ya estás en el plan/i)).not.toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('aprobado, confirma la activación', async () => {
    mockPost.mockResolvedValue({
      data: { success: true, data: { subscriptionId: 'pre-1', status: 'active' } },
    })

    render(<CheckoutPage />)
    await userEvent.click(await screen.findByRole('button', { name: /pagar/i }))

    expect(await screen.findByText(/Ya estás en el plan/i)).toBeInTheDocument()
    expect(screen.getByText(/pre-1/)).toBeInTheDocument()
  })
})

describe('CheckoutPage · no se cobra dos veces ni un plan que no existe', () => {
  test('con la suscripción activa no aparece el formulario de pago', async () => {
    // Un segundo alta crearía una segunda suscripción recurrente.
    mockConfig = { mpPublicKey: 'APP_USR-abc', subscriptionStatus: 'active', currentPlan: 'pro' }

    render(<CheckoutPage />)

    expect(await screen.findByText(/Ya tenés una suscripción activa/i)).toBeInTheDocument()
    expect(screen.queryByTestId('brick')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Ir a Mi suscripción/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/admin/mi-suscripcion')
  })

  test('un plan que no se vende no muestra el formulario', async () => {
    mockQuery = 'plan=gratis'

    render(<CheckoutPage />)

    expect(await screen.findByText(/Ese plan no existe/i)).toBeInTheDocument()
    expect(screen.queryByTestId('brick')).not.toBeInTheDocument()
  })

  test('si el catálogo no carga, lo dice y deja reintentar (no "sin precio")', async () => {
    let falla = true
    const base = mockGet.getMockImplementation()
    mockGet.mockImplementation(url =>
      url.includes('/subscriptions/plans') && falla ? Promise.reject(new Error('red')) : base(url),
    )

    render(<CheckoutPage />)

    expect(await screen.findByText(/No se pudo cargar el precio/i)).toBeInTheDocument()
    expect(screen.queryByText(/no tiene precio configurado/i)).not.toBeInTheDocument()

    falla = false
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }))
    expect(await screen.findByTestId('brick')).toHaveTextContent('monto: 1')
  })
})
