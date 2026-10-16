// Pantalla pública de planes.
//
// Es el destino de «Ver planes» y «Crear mi tienda» de la landing. Lo que se vigila acá es lo
// que la pantalla AFIRMA, porque es plata: que el precio y los cupos sean los del catálogo, que
// un fallo de lectura no se disfrace de «precio a definir», que cada botón lleve al destino que
// corresponde según haya sesión o no, y que no diga nada que el producto no sostenga.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = jest.fn()
const mockGetPlanCatalog = jest.fn()
const sesion = { autenticado: false }

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector({ user: { isAuthenticated: sesion.autenticado } }),
}))

jest.unstable_mockModule('../services/subscriptionPlansService.js', () => ({
  getPlanCatalog: mockGetPlanCatalog,
}))

jest.unstable_mockModule('../config/env.js', () => ({
  env: { publicBaseDomain: 'tienda.example.test' },
}))

const { default: SubscriptionPage } = await import('./SubscriptionPage.js')

// La forma real de GET /subscriptions/plans.
const CATALOGO = {
  currency: 'ARS',
  plans: [
    {
      plan: 'starter',
      monthlyPriceArs: 19900,
      currency: 'ARS',
      limits: {
        vision: 300,
        agentMessages: 2000,
        agentTokens: 10000000,
        imageEdits: 100,
        marketAnalyses: 50,
      },
    },
    {
      plan: 'pro',
      monthlyPriceArs: 42000,
      currency: 'ARS',
      limits: {
        vision: 1500,
        agentMessages: 10000,
        agentTokens: 50000000,
        imageEdits: 500,
        marketAnalyses: 250,
      },
    },
  ],
}

const conPrecios = precios => ({
  ...CATALOGO,
  plans: CATALOGO.plans.map(p => ({ ...p, monthlyPriceArs: precios[p.plan] })),
})

// Las tarjetas aparecen cuando llega el catálogo: mientras tanto hay esqueletos.
const plan = async nombre => within(await screen.findByLabelText(`Plan ${nombre}`))

beforeEach(() => {
  jest.clearAllMocks()
  sesion.autenticado = false
  mockGetPlanCatalog.mockResolvedValue(CATALOGO)
})

describe('SubscriptionPage · lo que muestra', () => {
  test('muestra cada plan con el precio del catálogo, no uno escrito en la pantalla', async () => {
    render(<SubscriptionPage />)

    // \s y no un espacio: Intl separa el signo del número con un espacio duro.
    expect(await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)).toBeInTheDocument()
    expect((await plan('Profesional')).getByText(/\$\s*42\.000/)).toBeInTheDocument()
    expect(mockGetPlanCatalog).toHaveBeenCalledTimes(1)
  })

  test('los cupos de IA salen del catálogo, con el separador de miles argentino', async () => {
    render(<SubscriptionPage />)

    expect(await (await plan('Emprendedor')).findByText('300')).toBeInTheDocument()
    expect((await plan('Emprendedor')).getByText('2.000')).toBeInTheDocument()
    expect((await plan('Profesional')).getByText('1.500')).toBeInTheDocument()
    expect((await plan('Profesional')).getByText('10.000')).toBeInTheDocument()
  })

  test('si el catálogo cambia un cupo, la pantalla lo sigue', async () => {
    mockGetPlanCatalog.mockResolvedValue({
      ...CATALOGO,
      plans: [{ ...CATALOGO.plans[0], limits: { vision: 777 } }, CATALOGO.plans[1]],
    })

    render(<SubscriptionPage />)

    expect(await (await plan('Emprendedor')).findByText('777')).toBeInTheDocument()
    // Solo muestra los cupos que el catálogo trae.
    expect(
      (await plan('Emprendedor')).queryByText(/mensajes del asistente/),
    ).not.toBeInTheDocument()
  })

  test('el Profesional lleva la etiqueta «Más completo», no «Recomendado»', async () => {
    render(<SubscriptionPage />)

    expect(await (await plan('Profesional')).findByText('Más completo')).toBeInTheDocument()
    expect(screen.queryByText('Recomendado')).not.toBeInTheDocument()
    expect((await plan('Emprendedor')).queryByText('Más completo')).not.toBeInTheDocument()
  })

  test('no dice que el análisis de productos es exclusivo del Profesional', async () => {
    // Los dos planes lo tienen, cada uno con su cupo de análisis de imágenes. Con el cupo del
    // Emprendedor justo al lado, decir lo contrario hacía que la pantalla se contradijera.
    render(<SubscriptionPage />)

    await (await plan('Profesional')).findByText('1.500')

    expect(screen.queryByText('Analizador de productos con IA')).not.toBeInTheDocument()
    expect((await plan('Profesional')).getByText('Cupos de IA ampliados')).toBeInTheDocument()
    expect((await plan('Emprendedor')).getByText(/análisis de imágenes con IA/)).toBeInTheDocument()
    expect((await plan('Profesional')).getByText(/análisis de imágenes con IA/)).toBeInTheDocument()
  })

  test('mientras carga muestra esqueletos y ni un precio ni un botón de plan', () => {
    mockGetPlanCatalog.mockReturnValue(new Promise(() => {}))

    render(<SubscriptionPage />)

    expect(screen.queryByText(/\$\s*\d/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /elegir/i })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.hk-sub-card.is-loading')).toHaveLength(2)
  })
})

describe('SubscriptionPage · a dónde lleva cada botón', () => {
  test('sin sesión, el plan elegido pasa primero por el alta', async () => {
    const user = userEvent.setup()

    render(<SubscriptionPage />)
    await user.click(
      await (await plan('Emprendedor')).findByRole('button', { name: /elegir emprendedor/i }),
    )

    // No hay comercio al que cobrarle todavía: el alta recibe el plan y después viene el pago.
    expect(mockNavigate).toHaveBeenCalledWith('/signup?plan=starter', {
      state: { planId: 'starter' },
    })
  })

  test('con sesión, va derecho a pagar', async () => {
    sesion.autenticado = true
    const user = userEvent.setup()

    render(<SubscriptionPage />)
    await user.click(
      await (await plan('Profesional')).findByRole('button', { name: /elegir profesional/i }),
    )

    expect(mockNavigate).toHaveBeenCalledWith('/checkout?plan=pro', { state: { planId: 'pro' } })
  })

  test('el botón dice el precio mensual a quien usa lector de pantalla', async () => {
    render(<SubscriptionPage />)

    const boton = await (
      await plan('Profesional')
    ).findByRole('button', { name: /elegir profesional/i })

    expect(boton).toHaveAccessibleName(/por mes/)
    expect(boton).toHaveAccessibleName(/42\.000/)
  })
})

describe('SubscriptionPage · cuando no hay precio', () => {
  test('un precio sin cargar se ve como «A definir» y no se puede contratar', async () => {
    mockGetPlanCatalog.mockResolvedValue(conPrecios({ starter: null, pro: 0 }))
    const user = userEvent.setup()

    render(<SubscriptionPage />)

    const boton = await (
      await plan('Emprendedor')
    ).findByRole('button', { name: /precio no disponible/i })

    expect((await plan('Emprendedor')).getByText('A definir')).toBeInTheDocument()
    expect(boton).toBeDisabled()
    expect((await plan('Profesional')).getByText('A definir')).toBeInTheDocument()

    await user.click(boton)

    // Ofrecer el botón llevaría a un checkout que no puede cobrar.
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('si el catálogo no se pudo leer, lo dice y NO lo disfraza de «A definir»', async () => {
    mockGetPlanCatalog.mockRejectedValue(new Error('sin red'))

    render(<SubscriptionPage />)

    expect(await screen.findByText(/no se pudieron cargar los precios/i)).toBeInTheDocument()
    // «A definir» quiere decir «el dueño no lo cargó»; acá lo que pasó es que no se pudo leer.
    expect(screen.queryByText('A definir')).not.toBeInTheDocument()
    expect((await plan('Emprendedor')).getByText('Precio no disponible')).toBeInTheDocument()
    expect(
      (await plan('Emprendedor')).getByRole('button', { name: /no disponible/i }),
    ).toBeDisabled()
    // Ni un importe inventado de respaldo.
    expect(screen.queryByText(/\$\s*\d/)).not.toBeInTheDocument()
  })

  test('«Reintentar» vuelve a pedir el catálogo y, si responde, muestra los precios', async () => {
    mockGetPlanCatalog.mockRejectedValueOnce(new Error('sin red'))
    const user = userEvent.setup()

    render(<SubscriptionPage />)
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }))

    expect(await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)).toBeInTheDocument()
    expect(mockGetPlanCatalog).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/no se pudieron cargar los precios/i)).not.toBeInTheDocument()
  })

  test('una respuesta que llega después de desmontar la pantalla no rompe nada', async () => {
    let responder
    mockGetPlanCatalog.mockReturnValue(new Promise(resolve => (responder = resolve)))
    const errores = jest.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount } = render(<SubscriptionPage />)
    unmount()
    responder(CATALOGO)
    await Promise.resolve()

    expect(errores).not.toHaveBeenCalled()
    errores.mockRestore()
  })
})

describe('SubscriptionPage · encabezado y recorrido', () => {
  test('sin sesión ofrece ingresar y cuenta tres pasos: plan, alta y pago', async () => {
    render(<SubscriptionPage />)

    await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)

    expect(screen.getByRole('link', { name: /ingresar/i })).toHaveAttribute('href', '/login')

    const pasos = within(screen.getByRole('list', { name: 'Cómo sigue' })).getAllByRole('listitem')

    expect(pasos.map(p => p.textContent.replace(/^\d/, ''))).toEqual([
      'Elegí tu plan',
      'Creá tu cuenta y tu tienda',
      'Activá la suscripción con Mercado Pago',
    ])
  })

  test('con sesión no ofrece ingresar y se salta el alta', async () => {
    sesion.autenticado = true

    render(<SubscriptionPage />)

    await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)

    expect(screen.queryByRole('link', { name: /ingresar/i })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Cómo sigue' })).getAllByRole('listitem'),
    ).toHaveLength(2)
  })

  test('el logo es el de Henkart y vuelve al sitio', async () => {
    render(<SubscriptionPage />)

    await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)

    const enlace = screen.getByRole('link', { name: /henkart, volver al sitio/i })

    expect(within(enlace).getByAltText('Henkart')).toBeInTheDocument()
    expect(enlace.getAttribute('href')).toMatch(/^https?:\/\/tienda\.example\.test$/)
  })

  test('tiene un solo h1 y cada sección su propio encabezado', async () => {
    render(<SubscriptionPage />)

    await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /incluido en los dos planes/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /antes de elegir/i })).toBeInTheDocument()
  })
})

describe('SubscriptionPage · no afirma lo que el producto no sostiene', () => {
  test('no anuncia prueba gratis: es una decisión comercial que no está en esta pantalla', async () => {
    // El backend da 14 días de prueba a todo comercio nuevo, pero anunciarlo es del dueño.
    const { container } = render(<SubscriptionPage />)

    await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)

    expect(container.textContent).not.toMatch(/prueba (gratis|sin cargo)|14 días|sin costo|gratis/i)
  })

  test('el pago es con Mercado Pago, y las preguntas lo dicen', async () => {
    const user = userEvent.setup()

    render(<SubscriptionPage />)
    await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)

    expect(document.querySelectorAll('details')).toHaveLength(3)

    await user.click(screen.getByText('¿Cómo se paga la suscripción?'))

    expect(screen.getByText(/todos los meses, con mercado pago/i)).toBeVisible()
  })

  test('no menciona integraciones ni competidores que no existen', async () => {
    const { container } = render(<SubscriptionPage />)

    await (await plan('Emprendedor')).findByText(/\$\s*19\.900/)

    expect(container.textContent).not.toMatch(/paypal|stripe|uala|shopify|tienda ?nube/i)
  })
})
