// Medidor de consumo de IA del comercio.
//
// Lo que se prueba acá es una sola cosa, y es la que se rompió: que el tope
// que muestra la pantalla sea el que el medidor cobra de verdad. Mientras el
// backend aplicaba el autolímite del comercio y el panel dibujaba el del plan,
// alguien con un freno de 2.000 mensajes veía "10K" y se quedaba sin asistente
// a los 2.000 sin ninguna explicación — ni él ni quien atendiera el reclamo.
//
// El resto del componente (BYOK, avisos de suscripción) no se toca acá.

import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'

// config/env.js valida esto al cargarse y aborta sin ella; llega por
// aiBudgetService → axiosConfig.
process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockGetAiBudget = jest.fn()

jest.unstable_mockModule('../../services/aiBudgetService.js', () => ({
  getAiBudget: mockGetAiBudget,
  saveAiCredentials: jest.fn(),
  deleteAiCredentials: jest.fn(),
  default: {},
}))

const { default: AiBudgetPanel } = await import('./AiBudgetPanel.jsx')

const metrica = (used, limit, extra = {}) => ({
  used,
  limit,
  unlimited: limit === 0,
  remaining: limit === 0 ? null : Math.max(0, limit - used),
  planLimit: limit,
  selfLimited: false,
  ...extra,
})

const SNAPSHOT = {
  period: '2026-09',
  plan: 'pro',
  subscription: { status: 'active', entitled: true, reason: 'ok' },
  credentials: {
    source: 'platform',
    byokEnabled: false,
    byokAllowed: true,
    hasTenantKey: false,
  },
  metrics: {
    agentMessages: metrica(3, 10_000),
    agentTokens: metrica(27_000, 50_000_000),
    vision: metrica(1, 1500),
    imageEdits: metrica(8, 500),
  },
  estimatedCostUsd: 0.13,
}

const snapshotCon = metrics => ({
  ...SNAPSHOT,
  metrics: { ...SNAPSHOT.metrics, ...metrics },
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('AiBudgetPanel · tope mostrado', () => {
  test('sin autolímite muestra el tope del plan y no habla de autolímites', async () => {
    mockGetAiBudget.mockResolvedValue(SNAPSHOT)

    render(<AiBudgetPanel />)

    expect(await screen.findByText('3 / 10.000')).toBeInTheDocument()
    expect(screen.queryByText(/Autolímite tuyo/)).not.toBeInTheDocument()
  })

  test('con autolímite muestra el tope real, no el del plan', async () => {
    mockGetAiBudget.mockResolvedValue(
      snapshotCon({
        agentMessages: metrica(3, 2000, { planLimit: 10_000, selfLimited: true }),
      }),
    )

    render(<AiBudgetPanel />)

    // El número que se cobra.
    expect(await screen.findByText('3 / 2.000')).toBeInTheDocument()
    // Y el del plan NO aparece como si fuera el tope.
    expect(screen.queryByText('3 / 10.000')).not.toBeInTheDocument()
  })

  test('explica de dónde sale el recorte y cuánto da el plan', async () => {
    // Un tope más bajo que el contratado, sin explicación, se lee como un
    // error de facturación.
    mockGetAiBudget.mockResolvedValue(
      snapshotCon({
        agentMessages: metrica(3, 2000, { planLimit: 10_000, selfLimited: true }),
      }),
    )

    render(<AiBudgetPanel />)

    await waitFor(() => expect(screen.getByText(/Autolímite tuyo/)).toBeInTheDocument())
    expect(screen.getByText(/Tu plan permite 10.000/)).toBeInTheDocument()
  })

  test('la barra se llena contra el tope real', async () => {
    // Con 1.800 de 2.000 el medidor está al 90% y tiene que avisar; contra los
    // 10.000 del plan daría 18% y verde, que es justo el aviso que no llegaba.
    mockGetAiBudget.mockResolvedValue(
      snapshotCon({
        agentMessages: metrica(1800, 2000, {
          planLimit: 10_000,
          selfLimited: true,
        }),
      }),
    )

    render(<AiBudgetPanel />)

    expect(await screen.findByText('Por agotarse')).toBeInTheDocument()
  })
})

describe('AiBudgetPanel · formato de números', () => {
  test('no mezcla dos sistemas en la misma pantalla', async () => {
    // El bug: la escala corta arrancaba en 10.000, así que el tope de visión
    // (1.500) caía del otro lado y quedaba "1.500" al lado de "10K" y "50.0M".
    // Para alguien que viene leyendo abreviaturas, "1.500" es uno y medio.
    mockGetAiBudget.mockResolvedValue(SNAPSHOT)

    render(<AiBudgetPanel />)

    await screen.findByText('3 / 10.000')

    // Ningún medidor abrevia en miles.
    expect(screen.queryByText(/\d+K/)).not.toBeInTheDocument()
    expect(screen.getByText('1 / 1.500')).toBeInTheDocument()
    expect(screen.getByText('8 / 500')).toBeInTheDocument()
  })

  test('el millón sí se abrevia, y sin decimal cuando es redondo', async () => {
    // 50.000.000 completo estorba más de lo que informa, y "50 M" no se puede
    // confundir con un número con separador de miles.
    mockGetAiBudget.mockResolvedValue(SNAPSHOT)

    render(<AiBudgetPanel />)

    expect(await screen.findByText('27.000 / 50 M')).toBeInTheDocument()
  })

  test('un valor de millones no redondo conserva un decimal', async () => {
    mockGetAiBudget.mockResolvedValue(snapshotCon({ agentTokens: metrica(1_500_000, 50_000_000) }))

    render(<AiBudgetPanel />)

    // Coma decimal, que es la argentina: "1,5 M", no "1.5 M".
    expect(await screen.findByText('1,5 M / 50 M')).toBeInTheDocument()
  })
})

// Lo que el panel dice sobre la PLATA.
//
// EL CASO QUE LO ORIGINÓ, MEDIDO EN PRODUCCIÓN EL 16/10/2026
//
// El chip mostraba `USD ${estimatedCostUsd.toFixed(2)}` con la leyenda
// «estimación sobre los tokens consumidos». Dos cosas estaban mal a la vez:
//
//   1. La leyenda. En el período 2026-10 los 1.605 tokens costaron USD
//      0,000553 y cuatro llamadas a Tavily USD 0,032: los tokens eran el 1,7%
//      de un total que la leyenda les atribuía entero. Un comercio que quería
//      gastar menos miraba la palanca que no mueve nada.
//
//   2. El número. El chip solo se muestra cuando el costo es mayor que cero,
//      pero `toFixed(2)` sobre 0,004776 —un valor que existió en esta base y
//      hubo que corregir a mano— imprime «0.00». Un cartel que existe para
//      informar el costo, informando cero.
const CON_PLATA = {
  ...SNAPSHOT,
  estimatedCostUsd: 0.032553,
  estimatedCostArs: 50,
  usdToArs: 1530,
  breakdown: {
    period: '2026-09',
    totalCostUsd: 0.032553,
    byUnit: {
      tokens: { amount: 1605, costUsd: 0.000553, operations: 1 },
      toolCalls: { amount: 4, costUsd: 0.032, operations: 2 },
      units: { amount: 0, costUsd: 0, operations: 0 },
    },
    byMetric: [],
  },
}

describe('AiBudgetPanel · el costo del mes', () => {
  test('muestra pesos, que es la moneda en la que cobra el comercio', async () => {
    mockGetAiBudget.mockResolvedValue(CON_PLATA)

    render(<AiBudgetPanel />)

    expect(await screen.findByText('≈ $ 50')).toBeInTheDocument()
  })

  test('no atribuye el gasto a los tokens: los separa de las herramientas', async () => {
    mockGetAiBudget.mockResolvedValue(CON_PLATA)

    render(<AiBudgetPanel />)

    // Los dos conceptos, con su peso real. 0,032 de 0,032553 es el 98%.
    expect(await screen.findByText('Llamadas a herramientas')).toBeInTheDocument()
    expect(screen.getByText('Tokens de los modelos')).toBeInTheDocument()
    expect(screen.getByText(/98%/)).toBeInTheDocument()
    expect(screen.getByText(/2%/)).toBeInTheDocument()
  })

  test('un gasto por debajo del peso NO se muestra como cero', async () => {
    // El caso exacto del defecto: con toFixed(2) esto imprimía «USD 0.00», y
    // redondeado a pesos imprimiría «$ 0». Ninguno de los dos es admisible en
    // un cartel que solo aparece cuando hay gasto.
    mockGetAiBudget.mockResolvedValue({
      ...CON_PLATA,
      estimatedCostUsd: 0.000553,
      estimatedCostArs: 0,
      breakdown: null,
    })

    render(<AiBudgetPanel />)

    const chip = await screen.findByText(/^≈/)

    expect(chip).toBeInTheDocument()
    expect(chip.textContent).not.toMatch(/\$\s*0$/)
    expect(chip.textContent).not.toMatch(/0\.00$/)
    // Cae a dólares con los decimales que hacen falta para no decir cero.
    expect(chip.textContent).toContain('USD 0.0006')
  })

  test('sin cotización sigue informando el costo, en dólares', async () => {
    // Una respuesta vieja en caché no trae los campos nuevos. El panel no
    // puede quedarse mudo ni inventar un cero.
    mockGetAiBudget.mockResolvedValue({ ...SNAPSHOT, estimatedCostUsd: 0.13 })

    render(<AiBudgetPanel />)

    expect(await screen.findByText('≈ USD 0.13')).toBeInTheDocument()
  })

  test('sin desglose no se dibuja la sección, y el total sigue estando', async () => {
    mockGetAiBudget.mockResolvedValue({ ...CON_PLATA, breakdown: null })

    render(<AiBudgetPanel />)

    expect(await screen.findByText('≈ $ 50')).toBeInTheDocument()
    expect(screen.queryByText('De dónde sale el gasto')).not.toBeInTheDocument()
  })
})
