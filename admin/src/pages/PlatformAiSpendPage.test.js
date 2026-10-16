// Pantalla de gasto de IA de la plataforma.
//
// Mismo motivo que el test de PricingPage: webpack no ejecuta componentes, así
// que un build verde no dice nada sobre si la pantalla abre. Y esta en
// particular muestra números con los que se toman decisiones de plata, así que
// lo que se prueba es que las ramas que dependen de la forma de la respuesta
// se rendericen bien — sobre todo las que distinguen "no hay techo" de "el
// techo es cero", que son situaciones distintas.

import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// config/env.js valida esto al cargarse y aborta sin ella. La cadena llega acá
// por platformService → axiosConfig, así que hay que darle un valor antes de
// importar la pantalla.
process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockGetAiSpend = jest.fn()
const mockGetTenantDetail = jest.fn()
const mockUpdateBudget = jest.fn()
const mockUpdateTenantPolicy = jest.fn()
const mockGetUsdRate = jest.fn()
const mockUpdateUsdRate = jest.fn()
const mockGetMargin = jest.fn()
const mockUpdateTenantStatus = jest.fn()
const mockDeleteTenant = jest.fn()

// Mil pesos por dólar: elegido para que las conversiones se puedan verificar a
// ojo en las aserciones (USD 1,23 → $1.230) en lugar de arrastrar la cuenta.
const TIPO_DE_CAMBIO = {
  rate: 1000,
  source: 'panel',
  updatedAt: new Date().toISOString(),
  updatedByEmail: 'dueno@henko.test',
  ageDays: 0,
  history: [],
}

jest.unstable_mockModule('../services/platformService', () => ({
  getPlatformAiSpend: mockGetAiSpend,
  // UN comercio día por día. Se pide al abrir su ficha y no con el reporte:
  // son treinta y un valores por comercio y la pantalla general se abre para
  // mirar el total.
  getTenantAiSpendDetail: mockGetTenantDetail,
  updatePlatformAiBudget: mockUpdateBudget,
  // Acotar o pausar a UN comercio. El mock tiene que declarar todos los
  // exports que la pantalla importa: con uno de menos, el módulo entero no
  // resuelve y la suite no corre ningún test — que es lo que pasó al agregarlo.
  updateTenantAiPolicy: mockUpdateTenantPolicy,
  // El tipo de cambio: la pantalla lo pide junto con el gasto porque sin él no
  // puede mostrar un peso. Se devuelve un valor fijo para que las aserciones de
  // montos no dependan de una cotización.
  getUsdRate: mockGetUsdRate,
  updateUsdRate: mockUpdateUsdRate,
  // El margen por comercio: la pantalla lo une al gasto por tenantId para que
  // "cuánto cuesta" y "cuánto paga" se vean en la misma fila.
  getPlatformMarginReport: mockGetMargin,
  // Suspender el comercio ENTERO, distinto de pausarle sólo la IA.
  updateTenantStatus: mockUpdateTenantStatus,
  // Dar de baja: la unica operacion de la pantalla que no se deshace.
  deleteTenant: mockDeleteTenant,
  default: {},
}))

const { default: PlatformAiSpendPage } = await import('./PlatformAiSpendPage.jsx')

const REPORT = {
  period: '2026-09',
  budget: {
    tokens: 200_000_000,
    configured: true,
    alertedThreshold: 0,
    source: 'env',
  },
  settingHistory: [],
  consumption: {
    tokens: 24_500_000,
    percentUsed: 12.3,
    remainingTokens: 175_500_000,
    estimatedCostUsd: 33.12,
    lastActivityAt: '2026-09-09T10:00:00.000Z',
  },
  breaker: { trippedAt: null, tripped: false },
  byMetric: [
    { metric: 'vision', costUsd: 24.5, tokens: 18_000_000, operations: 3600 },
    { metric: 'agentTokens', costUsd: 8.62, tokens: 6_500_000, operations: 2100 },
  ],
  byModel: [
    {
      model: 'gemini-3.6-flash',
      costUsd: 30.1,
      tokens: 22_000_000,
      operations: 5000,
      fallbackRows: 0,
    },
  ],
  quality: { rows: 5700, estimatedRows: 2100, fallbackRows: 0 },
}

const load = (overrides = {}) => {
  mockGetAiSpend.mockResolvedValue({ ...REPORT, ...overrides })
  return render(<PlatformAiSpendPage />)
}

// El mismo formato que usa la pantalla, calculado y no escrito a mano: el
// espaciado que mete Intl para ARS cambia segun la version de ICU del runtime,
// asi que un string fijo haria fallar la suite en otra maquina por una razon
// que no tiene nada que ver con el codigo.
const pesos = usd => {
  // Solo los digitos, como expresion regular. El formato de moneda de es-AR
  // separa el signo del numero con un espacio DURO (U+00A0), y compararlo como
  // string literal falla por ese caracter invisible —o por el espaciado que
  // elija otra version de ICU— sin que nada en el mensaje de error lo explique.
  // Lo que la prueba quiere verificar es el monto convertido, no como Intl
  // decide dibujar el signo peso.
  const numero = new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 0,
  }).format(usd * TIPO_DE_CAMBIO.rate)

  // El punto es el único carácter especial que puede traer un número
  // formateado (separador de miles), así que no hace falta un escapador
  // general: escaparlo a mano es más corto y no se puede equivocar.
  return new RegExp(numero.split('.').join('\\.'))
}

// El gasto del mes del reporte de prueba. Se usa como centinela de "la pantalla
// ya cargo" en casi todas las pruebas.
const GASTO_DEL_MES = 33.12

// El margen del comercio de la fixture: 'Moto Norte', con tenantId 't1'.
//
// Un comercio rentable por defecto. Las pruebas que miran el caso que pierde
// plata, o el que no tiene precio de plan, lo pisan.
const MARGEN = {
  tenants: [
    {
      tenantId: 't1',
      name: 'Moto Norte',
      plan: 'pro',
      status: 'active',
      planPriceArs: 40000,
      aiCostArs: 12500,
      estimatedMarginArs: 27500,
      marginPercent: 68.8,
      unprofitable: false,
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  // Con cambio cargado por defecto: es el estado normal de la pantalla. Las
  // pruebas que miran el caso sin cargar lo pisan.
  mockGetUsdRate.mockResolvedValue(TIPO_DE_CAMBIO)
  mockGetMargin.mockResolvedValue(MARGEN)
  // La ficha del comercio se pide al abrir el diálogo. Un jest.fn() sin valor
  // devuelve undefined y la pantalla le encadena un .then: sin este default,
  // cada prueba que abre «Gobernar» fallaría por la lectura del gráfico y no
  // por lo que esa prueba mira.
  mockGetTenantDetail.mockResolvedValue(null)
})

test('muestra el gasto del mes y qué lo consume', async () => {
  load()

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())

  // Las métricas se muestran con nombre legible: 'agentTokens' no le dice nada
  // a nadie que no haya leído el código.
  expect(screen.getByText('Análisis de imágenes')).toBeInTheDocument()
  expect(screen.getByText('Tokens del agente')).toBeInTheDocument()
  expect(screen.getByText('gemini-3.6-flash')).toBeInTheDocument()
})

test('sin techo configurado avisa que nada detiene el gasto', async () => {
  // No es lo mismo que un techo en cero, y el backend manda null justamente
  // para poder distinguirlos.
  load({
    budget: { tokens: null, configured: false, alertedThreshold: 0 },
    consumption: { ...REPORT.consumption, percentUsed: null, remainingTokens: null },
  })

  await waitFor(() => expect(screen.getByText(/nada lo detiene/i)).toBeInTheDocument())
})

test('si el disyuntor cortó, lo dice arriba de todo', async () => {
  load({
    breaker: { trippedAt: '2026-09-20T03:00:00.000Z', tripped: true },
  })

  await waitFor(() => expect(screen.getByText(/El disyuntor cortó/i)).toBeInTheDocument())
  // Y aclara que los BYOK no se ven afectados, que es lo primero que uno
  // pregunta cuando ve que se cortó.
  expect(screen.getByText(/key propia siguen funcionando/i)).toBeInTheDocument()
})

test('la calidad se lee en plata y encabeza con el porcentaje medido', async () => {
  // El numero de produccion al 16/09/2026: 132 movimientos de tokens, 4 con el
  // costo repartido, 92,3% del gasto medido. Y 28 movimientos de precio por
  // unidad que NO entran en ese porcentaje, porque no hay desglose que medir.
  load({
    quality: {
      rows: 132,
      estimatedRows: 4,
      fallbackRows: 0,
      costUsd: 0.467461,
      measured: 128,
      measuredCostUsd: 0.431609,
      estimated: 4,
      estimatedCostUsd: 0.035852,
      priceFallback: 0,
      fallbackCostUsd: 0,
      unknownModel: 0,
      unknownModelCostUsd: 0,
      measuredShare: 92.3,
      flatRate: { rows: 28, costUsd: 0.382812 },
    },
  })

  await waitFor(() =>
    expect(screen.getByText('92.3% del gasto en tokens está medido')).toBeInTheDocument(),
  )

  // Cada clase con su plata al lado: cuatro filas mal medidas de un total de
  // 132 suenan a nada hasta que se ve que son el 7,7% del gasto.
  expect(screen.getByText(/128 medidos/)).toBeInTheDocument()
  expect(screen.getByText(/4 con costo repartido/)).toBeInTheDocument()
  expect(screen.getByText(/0 sin modelo conocido/)).toBeInTheDocument()

  // Y lo que se cobra por unidad se informa aparte, no mezclado.
  expect(screen.getByText(/28 movimientos de precio por unidad/)).toBeInTheDocument()
})

test('un reporte viejo, sin los campos de plata, no rompe la pantalla', async () => {
  // El panel puede quedar desplegado antes que el backend. Sin los campos
  // nuevos tiene que seguir mostrando lo que ya mostraba.
  load({ quality: { rows: 40, estimatedRows: 3, fallbackRows: 1 } })

  await waitFor(() => expect(screen.getByText(/3 con costo repartido/)).toBeInTheDocument())

  expect(screen.getByText(/1 con tarifa de respaldo/)).toBeInTheDocument()
  // Sin measuredShare no se inventa un porcentaje.
  expect(screen.queryByText(/del gasto en tokens está medido/)).toBeNull()
})

test('marca los modelos que se cobraron con tarifa de respaldo', async () => {
  // Si eso crece, el catálogo quedó viejo y el costo mostrado está inflado.
  load({
    byModel: [
      { model: 'modelo-nuevo', costUsd: 12, tokens: 900_000, operations: 40, fallbackRows: 40 },
    ],
    quality: { rows: 40, estimatedRows: 0, fallbackRows: 40 },
  })

  await waitFor(() => expect(screen.getByText('40 sin tarifa')).toBeInTheDocument())
})

test('un período sin consumo no rompe la pantalla', async () => {
  load({
    consumption: { ...REPORT.consumption, tokens: 0, percentUsed: 0, estimatedCostUsd: 0 },
    byMetric: [],
    byModel: [],
    quality: { rows: 0, estimatedRows: 0, fallbackRows: 0 },
  })

  await waitFor(() =>
    expect(screen.getByText(/Todavía no hay consumo registrado/i)).toBeInTheDocument(),
  )
})

test('no deja guardar un techo nuevo sin motivo', async () => {
  // El motivo también es obligatorio en el servidor; acá evita el viaje. Y el
  // punto de fondo es que dentro de tres meses el número solo no explica por
  // qué alguien duplicó el techo un martes a las 3 de la mañana.
  const user = userEvent.setup()
  load()

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /cambiar techo/i }))

  expect(screen.getByRole('button', { name: /^guardar$/i })).toBeDisabled()

  await user.type(screen.getByLabelText(/motivo/i), 'cortó por un bulk import')

  expect(screen.getByRole('button', { name: /^guardar$/i })).toBeEnabled()
})

test('guarda el techo con el motivo y muestra el reporte actualizado', async () => {
  const user = userEvent.setup()
  mockUpdateBudget.mockResolvedValue({
    ...REPORT,
    budget: { ...REPORT.budget, tokens: 400_000_000, source: 'panel' },
    consumption: { ...REPORT.consumption, percentUsed: 6.1 },
  })
  load()

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /cambiar techo/i }))
  await user.type(screen.getByLabelText(/motivo/i), 'cortó por un bulk import')
  await user.click(screen.getByRole('button', { name: /^guardar$/i }))

  await waitFor(() =>
    expect(mockUpdateBudget).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'cortó por un bulk import' }),
    ),
  )

  // La respuesta del PUT ya trae el reporte nuevo: la pantalla no vuelve a
  // pedirlo, así que no puede quedar mostrando lo viejo si esa segunda vuelta
  // fallara.
  await waitFor(() => expect(screen.getByText(/techo fijado desde el panel/i)).toBeInTheDocument())
  expect(mockGetAiSpend).toHaveBeenCalledTimes(1)
})

test('avisa que la variable de entorno no manda cuando hay override', async () => {
  // Sin esto, "ya lo cambié en Render y no pasa nada" es media hora perdida.
  const user = userEvent.setup()
  load({ budget: { ...REPORT.budget, source: 'panel' } })

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /cambiar techo/i }))

  expect(
    screen.getByText(/cambiar la variable de entorno en Render no tiene efecto/i),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /volver a la variable/i })).toBeInTheDocument()
})

test('muestra quién movió el techo y por qué', async () => {
  load({
    settingHistory: [
      {
        setting: 'monthlyTokenBudget',
        value: 400_000_000,
        previousValue: 200_000_000,
        changedByEmail: 'dueño@henko.com',
        reason: 'cortó a las 3am por un bulk import',
        createdAt: '2026-09-20T06:00:00.000Z',
      },
    ],
  })

  await waitFor(() => expect(screen.getByText('dueño@henko.com')).toBeInTheDocument())
  expect(screen.getByText(/cortó a las 3am por un bulk import/i)).toBeInTheDocument()
})

test('un 403 explica que no tenés acceso en vez de tirar un error', async () => {
  mockGetAiSpend.mockRejectedValue({ response: { status: 403 } })

  render(<PlatformAiSpendPage />)

  await waitFor(() => expect(screen.getByText(/No tenés acceso/i)).toBeInTheDocument())
})

test('muestra quién lo consume, no solo cuánto', async () => {
  // Todo el resto de la pantalla es agregado y ninguna de esas vistas contesta
  // la pregunta que uno se hace cuando el disyuntor corta: quién fue.
  load({
    budget: { ...REPORT.budget, perTenantShare: 0.5 },
    byTenant: [
      {
        tenantId: 't1',
        name: 'Moto Norte',
        plan: 'pro',
        tokens: 4_000_000,
        operations: 900,
        toolCalls: 40,
        platformCostUsd: 12.5,
        tenantProviderCostUsd: 12.5,
        keySources: ['platform'],
        tokenCap: 5_000_000,
        percentOfCap: 80,
        percentOfPlatformUsd: 25,
      },
      {
        tenantId: 't2',
        name: 'Casa Sur',
        plan: 'starter',
        tokens: 200_000,
        operations: 30,
        toolCalls: 0,
        platformCostUsd: 0,
        tenantProviderCostUsd: 0.9,
        keySources: ['tenant'],
        tokenCap: 5_000_000,
        percentOfCap: 4,
        percentOfPlatformUsd: 0,
      },
    ],
  })

  await waitFor(() => expect(screen.getByText('Moto Norte')).toBeInTheDocument())

  expect(screen.getByText('Casa Sur')).toBeInTheDocument()

  // El porcentaje es de SU parte, no del techo total: es el numero que
  // anticipa el corte de ese comercio.
  expect(screen.getByText('80%')).toBeInTheDocument()

  // Un comercio con key propia se marca: ver un cero en la columna de costo
  // sin esa marca se lee como un error de carga.
  expect(screen.getByText(/key propia/i)).toBeInTheDocument()
  expect(screen.getByText(/con su key/i)).toBeInTheDocument()
})

test('sin comercios no dibuja la tabla', async () => {
  load({ byTenant: [] })

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())

  expect(screen.queryByText('Quién lo consume')).toBeNull()
})

test('un reporte sin byTenant no rompe la pantalla', async () => {
  // El panel puede quedar desplegado antes que el backend.
  const { byTenant, ...sinTenant } = REPORT
  mockGetAiSpend.mockResolvedValue(sinTenant)
  render(<PlatformAiSpendPage />)

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  expect(screen.queryByText('Quién lo consume')).toBeNull()
})

test('el diálogo maneja los TRES frenos, no solo el de tokens', async () => {
  // El modelo y el servicio los soportaban desde siempre; lo que faltaba era
  // el endpoint y la pantalla. El techo en PLATA es el que importa: entre
  // 3.6-flash y 3.1-flash-lite hay 5x de tarifa, asi que el mismo tope de
  // tokens puede costar veinte dolares o cien.
  const user = userEvent.setup()
  load({ budget: { ...REPORT.budget, usd: 50, perTenantShare: 0.5 } })

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /cambiar techo/i }))

  expect(screen.getByLabelText(/techo en tokens/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/techo en dólares/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/reparto por comercio/i)).toBeInTheDocument()
})

test('manda SOLO el freno que se movió', async () => {
  // Un campo que no cambio no viaja, asi que el historial registra el cambio
  // que ocurrio y no tres.
  const user = userEvent.setup()
  mockUpdateBudget.mockResolvedValue(REPORT)
  load({ budget: { ...REPORT.budget, usd: 50, perTenantShare: 0.5 } })

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /cambiar techo/i }))

  const campoUsd = screen.getByLabelText(/techo en dólares/i)
  await user.clear(campoUsd)
  await user.type(campoUsd, '80')
  await user.type(screen.getByLabelText(/motivo/i), 'subimos por el mes de campañas')
  await user.click(screen.getByRole('button', { name: /^guardar$/i }))

  await waitFor(() => expect(mockUpdateBudget).toHaveBeenCalled())

  const enviado = mockUpdateBudget.mock.calls[0][0]
  expect(enviado.usd).toBe(80)
  expect(enviado).not.toHaveProperty('tokens')
  expect(enviado).not.toHaveProperty('perTenantShare')
  expect(enviado.reason).toMatch(/campañas/)
})

test('un campo vacío suelta el freno, y no es lo mismo que cero', async () => {
  // Un techo en cero apaga la IA; ninguno la deja gobernada por Render. Son
  // dos decisiones distintas y la pantalla no puede confundirlas.
  const user = userEvent.setup()
  mockUpdateBudget.mockResolvedValue(REPORT)
  load({ budget: { ...REPORT.budget, usd: 50, perTenantShare: 0.5 } })

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /cambiar techo/i }))

  await user.clear(screen.getByLabelText(/techo en dólares/i))
  await user.type(screen.getByLabelText(/motivo/i), 'que lo decida la variable')
  await user.click(screen.getByRole('button', { name: /^guardar$/i }))

  await waitFor(() => expect(mockUpdateBudget).toHaveBeenCalled())
  expect(mockUpdateBudget.mock.calls[0][0].usd).toBeNull()
})

// ─── GOBIERNO POR COMERCIO ───────────────────────────────────────────────────
//
// Las tres palancas anteriores son globales: para frenar a uno había que
// bajarle el reparto a todos, o sea castigar a los diez porque uno se desbocó.
// Esto acota o apaga a uno solo.

const CON_COMERCIOS = {
  byTenant: [
    {
      tenantId: '64b7f00000000000000000a1',
      name: 'Tienda Grande',
      plan: 'pro',
      tokens: 5_000_000,
      toolCalls: 0,
      operations: 900,
      platformCostUsd: 12.4,
      tenantProviderCostUsd: 12.4,
      keySources: ['platform'],
      tokenCap: 100_000_000,
      percentOfCap: 5,
      percentOfPlatformUsd: 24.8,
      share: null,
      suspended: false,
      suspendedReason: null,
    },
  ],
}

test('cada comercio se puede gobernar desde su propia fila', async () => {
  // La acción va donde está el número que la justifica: mandarla a otra
  // pantalla obligaría a recordar qué comercio era y cuánto llevaba.
  load(CON_COMERCIOS)

  await waitFor(() => expect(screen.getByText('Tienda Grande')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: /gobernar/i })).toBeInTheDocument()
})

test('acotar a un comercio manda solo su fracción', async () => {
  const user = userEvent.setup()
  mockUpdateTenantPolicy.mockResolvedValue({ ...REPORT, ...CON_COMERCIOS })
  load(CON_COMERCIOS)

  await waitFor(() => expect(screen.getByText('Tienda Grande')).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /gobernar/i }))

  await user.type(screen.getByLabelText(/su parte del techo/i), '0.1')
  await user.type(screen.getByLabelText(/^motivo$/i), 'se comió el 60% en tres días')
  await user.click(screen.getByRole('button', { name: /^guardar$/i }))

  await waitFor(() => expect(mockUpdateTenantPolicy).toHaveBeenCalled())

  const enviado = mockUpdateTenantPolicy.mock.calls[0][0]
  expect(enviado.tenantId).toBe('64b7f00000000000000000a1')
  expect(enviado.share).toBe(0.1)
  // El interruptor no se tocó: no puede viajar y apagar al comercio de paso.
  expect(enviado).not.toHaveProperty('suspended')
})

test('pausar pide que se le explique al comercio', async () => {
  // Un servicio que se apaga sin decir por qué genera un ticket de soporte por
  // cada comercio afectado.
  const user = userEvent.setup()
  mockUpdateTenantPolicy.mockResolvedValue({ ...REPORT, ...CON_COMERCIOS })
  load(CON_COMERCIOS)

  await waitFor(() => expect(screen.getByText('Tienda Grande')).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /gobernar/i }))

  await user.click(screen.getByLabelText(/pausar las funciones de ia/i))

  await user.type(screen.getByLabelText(/qué va a ver el comercio/i), 'factura impaga desde agosto')
  await user.type(screen.getByLabelText(/^motivo$/i), 'mora de 40 días')
  await user.click(screen.getByRole('button', { name: /^guardar$/i }))

  await waitFor(() => expect(mockUpdateTenantPolicy).toHaveBeenCalled())

  const enviado = mockUpdateTenantPolicy.mock.calls[0][0]
  expect(enviado.suspended).toBe(true)
  expect(enviado.suspendedReason).toMatch(/factura impaga/)
})

test('sin motivo no se puede guardar', async () => {
  // Apagarle la IA a un comercio es la decisión más cara de esta pantalla y la
  // que más se va a tener que explicar dentro de tres meses.
  const user = userEvent.setup()
  load(CON_COMERCIOS)

  await waitFor(() => expect(screen.getByText('Tienda Grande')).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /gobernar/i }))

  expect(screen.getByRole('button', { name: /^guardar$/i })).toBeDisabled()
})

test('un comercio pausado se ve pausado en la tabla', async () => {
  // Dejó de consumir, así que sus números son ceros: sin la marca se leería
  // como un comercio que simplemente no usó la IA.
  load({
    byTenant: [{ ...CON_COMERCIOS.byTenant[0], suspended: true, suspendedReason: 'mora' }],
  })

  await waitFor(() => expect(screen.getByText('pausado')).toBeInTheDocument())
})

test('un comercio acotado muestra que tiene un tope propio', async () => {
  load({ byTenant: [{ ...CON_COMERCIOS.byTenant[0], share: 0.1 }] })

  await waitFor(() => expect(screen.getByText('acotado 10%')).toBeInTheDocument())
})

// ─── PRONÓSTICO, DEGRADACIÓN Y ANOMALÍAS ─────────────────────────────────────

test('avisa el día en que se agota el techo al ritmo actual', async () => {
  // Es lo único de la pantalla que mira adelante. El resto dice cuánto se
  // gastó, y para cuando ese número alarma, ya se gastó.
  load({
    budget: { ...REPORT.budget, usd: 50 },
    forecast: {
      dailyAvgUsd: 2.5,
      recentAvgUsd: 4.1,
      daysElapsed: 9,
      daysInPeriod: 30,
      recentWindowDays: 7,
      daily: [],
      projectedUsd: 119.6,
      projectedPercent: 239.2,
      exhaustionDay: 18,
      willExhaust: true,
      basis: 'recent',
    },
  })

  await waitFor(() => expect(screen.getByText(/el techo se agota el día 18/i)).toBeInTheDocument())
  // Y con cuál de los dos ritmos se proyectó: que el reciente venga más alto
  // que el del mes es una información distinta de la proyección misma.
  expect(screen.getByText(/últimos 7 días/i)).toBeInTheDocument()
})

test('a ritmo tranquilo no grita nada', async () => {
  // Un cartel que aparece todos los meses diciendo «vas bien» enseña a no
  // leerlo, y el porcentaje de consumo ya cubre el caso tranquilo.
  load({
    forecast: {
      dailyAvgUsd: 0.4,
      recentAvgUsd: 0.3,
      daysElapsed: 9,
      daysInPeriod: 30,
      recentWindowDays: 7,
      daily: [],
      projectedUsd: 12,
      projectedPercent: 24,
      exhaustionDay: null,
      willExhaust: false,
      basis: 'month',
    },
  })

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  expect(screen.queryByText(/se agota el día/i)).not.toBeInTheDocument()
})

test('muestra en qué escalón de servicio está la plataforma', async () => {
  // Un asistente que de golpe contesta peor, sin nada en pantalla que lo
  // explique, se diagnostica como un bug del agente y se busca durante horas en
  // el lugar equivocado.
  load({
    degradation: { level: 'economy', percentUsed: 83.4, economyAt: 80, essentialAt: 90 },
  })

  await waitFor(() => expect(screen.getByText(/modo economía/i)).toBeInTheDocument())
  expect(screen.getByText(/83.4% del techo/i)).toBeInTheDocument()
})

test('en modo normal no muestra ningún escalón', async () => {
  load({
    degradation: { level: 'normal', percentUsed: 12.3, economyAt: 80, essentialAt: 90 },
  })

  await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  expect(screen.queryByText(/modo economía/i)).not.toBeInTheDocument()
})

test('señala al comercio que se salió de su propia costumbre', async () => {
  // La tabla de consumo ordena por cuánto gastan, y el desborde típico es un
  // comercio CHICO que multiplicó por cincuenta lo suyo y sigue en la mitad de
  // abajo de esa lista.
  load({
    anomalies: [
      {
        tenantId: '64b7f00000000000000000b2',
        name: 'Tienda Chica',
        todayUsd: 5,
        todayOperations: 812,
        typicalUsd: 0.1,
        factor: 50,
        baselineDays: 14,
      },
    ],
  })

  await waitFor(() => expect(screen.getByText('Tienda Chica')).toBeInTheDocument())
  expect(screen.getByText(/50× su habitual/i)).toBeInTheDocument()
})

test('el que arranca de cero no muestra un múltiplo inventado', async () => {
  // No hay división que hacer, y decir «infinitas veces más» no ayuda a nadie.
  load({
    anomalies: [
      {
        tenantId: '64b7f00000000000000000b3',
        name: 'Tienda Nueva',
        todayUsd: 3,
        todayOperations: 500,
        typicalUsd: 0,
        factor: null,
        baselineDays: 14,
      },
    ],
  })

  await waitFor(() => expect(screen.getByText(/no venía consumiendo nada/i)).toBeInTheDocument())
})

// El tipo de cambio: el número del que depende todo lo que muestra la pantalla.
//
// Los planes se cobran en pesos y los proveedores de IA facturan en dólares, así
// que para comparar "este comercio me costó" con "me paga" hay que convertir. Si
// el valor está viejo, cada peso de la pantalla está mal — y siempre para el
// mismo lado: el peso se devalúa, el costo real sube, y el margen se ve mejor de
// lo que es. Es el modo de falla silencioso: nada se rompe, los números mienten.
describe('tipo de cambio', () => {
  test('muestra el valor, quién lo cargó y no avisa nada si es reciente', async () => {
    load()

    await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())

    // Aparece en dos lugares a propósito: el subtítulo lo menciona para que se
    // entienda en qué moneda está la pantalla, y la tarjeta lo muestra para
    // poder corregirlo. Que los dos digan lo mismo es la propiedad que importa.
    expect(screen.getAllByText(/1\.000 por dólar/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/dueno@henko\.test/)).toBeInTheDocument()
    // Recién cargado: no hay nada que advertir.
    expect(screen.queryByText(/tiene \d+ días/)).not.toBeInTheDocument()
  })

  test('avisa cuando el valor quedó viejo', async () => {
    mockGetUsdRate.mockResolvedValue({ ...TIPO_DE_CAMBIO, ageDays: 47 })
    load()

    await waitFor(() => expect(screen.getByText(/tiene 47 días/)).toBeInTheDocument())

    // Y explica para qué lado miente, que es lo que permite decidir si importa.
    expect(screen.getByText(/el margen se ve mejor de lo que es/)).toBeInTheDocument()
  })

  test('avisa cuando nadie lo cargó y viene del valor por defecto', async () => {
    mockGetUsdRate.mockResolvedValue({ ...TIPO_DE_CAMBIO, source: 'env', ageDays: null })
    load()

    await waitFor(() =>
      expect(screen.getByText(/Nadie cargó el tipo de cambio/)).toBeInTheDocument(),
    )
  })

  test('sin tipo de cambio los montos se muestran en dólares, no se inventa una conversión', async () => {
    // Que falle el pedido del cambio no puede dejar la pantalla sin el gasto,
    // que es lo que se vino a ver. Se degrada a dólares.
    mockGetUsdRate.mockRejectedValue(new Error('sin red'))
    load()

    // «USD 33.12» y no «$33.12»: el símbolo `$` lo usan las DOS monedas —Intl
    // imprime «$33.12» para dólares y «$ 33» para pesos—, así que un monto en
    // dólares marcado solo con el signo es indistinguible de uno en pesos que
    // vale 1.530 veces menos.
    await waitFor(() => expect(screen.getByText('USD 33.12')).toBeInTheDocument())

    expect(screen.getByText(/no hay tipo de cambio cargado/)).toBeInTheDocument()
  })

  test('cuando falla la cotización lo dice, y avisa que la fila mezcla monedas', async () => {
    // El fallback era SILENCIOSO: los montos pasaban a dólares y, con el mismo
    // signo `$`, nada lo delataba. Peor, la columna de margen nace en pesos y
    // se quedaba en pesos al lado de los dólares: la fila quedaba incomparable,
    // que es justo la comparación para la que existe la tabla.
    mockGetUsdRate.mockRejectedValue(new Error('sin red'))
    load()

    await waitFor(() =>
      expect(screen.getByText(/No se pudo cargar el tipo de cambio/)).toBeInTheDocument(),
    )
  })

  test('los encabezados de plata declaran su moneda, y no contradicen a sus celdas', async () => {
    mockGetUsdRate.mockResolvedValue(TIPO_DE_CAMBIO)
    // Con comercios: la tabla que lleva estos encabezados solo se dibuja
    // cuando hay filas que mostrar.
    load(CON_COMERCIOS)

    // Con cotización, las columnas convertibles están en pesos...
    await waitFor(() => expect(screen.getByText('Paga HENKO (ARS)')).toBeInTheDocument())

    // ...y el margen también, pero por otro motivo: nace en pesos. Su etiqueta
    // es fija justamente porque NO depende de la cotización.
    expect(screen.getByText('Margen (ARS)')).toBeInTheDocument()
  })

  test('sin cotización el encabezado acompaña a la celda y pasa a dólares', async () => {
    // La propiedad que importa: encabezado y celda salen del mismo contexto,
    // así que no se pueden separar. Un «(ARS)» fijo mentiría en este estado.
    mockGetUsdRate.mockRejectedValue(new Error('sin red'))
    load(CON_COMERCIOS)

    await waitFor(() => expect(screen.getByText('Paga HENKO (USD)')).toBeInTheDocument())

    // El margen NO cambia: sigue en pesos porque nunca se convirtió.
    expect(screen.getByText('Margen (ARS)')).toBeInTheDocument()
  })

  test('no se puede guardar sin decir de dónde sale el valor', async () => {
    const user = userEvent.setup()
    load()

    await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /actualizar/i }))
    await user.type(screen.getByLabelText(/pesos por dólar/i), '1650')
    await user.click(screen.getByRole('button', { name: /^guardar$/i }))

    // Dentro de tres meses, un número sin explicación no dice nada.
    await waitFor(() => expect(screen.getByText(/Indicá de dónde sacaste/)).toBeInTheDocument())
    expect(mockUpdateUsdRate).not.toHaveBeenCalled()
  })

  test('guarda el valor con su motivo', async () => {
    const user = userEvent.setup()
    mockUpdateUsdRate.mockResolvedValue(TIPO_DE_CAMBIO)
    load()

    await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /actualizar/i }))

    const campo = screen.getByLabelText(/pesos por dólar/i)
    await user.clear(campo)
    await user.type(campo, '1650')
    await user.type(screen.getByLabelText(/de dónde sale/i), 'MEP del 11/10')
    await user.click(screen.getByRole('button', { name: /^guardar$/i }))

    await waitFor(() =>
      expect(mockUpdateUsdRate).toHaveBeenCalledWith({ rate: 1650, reason: 'MEP del 11/10' }),
    )
  })
})

// El REPORT por defecto NO trae byTenant: la tabla de comercios solo aparece
// cuando una prueba lo pasa como override. Esta fila es la de esas pruebas, con
// el mismo tenantId que MARGEN para que el join por comercio tenga con que unir.
const UN_COMERCIO = [
  {
    tenantId: 't1',
    name: 'Moto Norte',
    plan: 'pro',
    tokens: 4_000_000,
    operations: 900,
    toolCalls: 40,
    platformCostUsd: 12.5,
    tenantProviderCostUsd: 12.5,
    keySources: ['platform'],
    tokenCap: 5_000_000,
    percentOfCap: 80,
    percentOfPlatformUsd: 25,
  },
]

// El margen al lado del costo, en la misma fila.
//
// Vivía en otra pantalla, y ésa es la razón por la que no servía: la decisión
// que esta tabla habilita —acotar, pausar, suspender— se toma comparando lo que
// un comercio cuesta contra lo que paga, y con los dos números en pantallas
// distintas hay que recordar uno mientras se mira el otro.
//
// No se recalcula nada: es el mismo reporte de margen, unido por tenantId. Dos
// cálculos del mismo número terminarían dando cifras distintas para el mismo
// comercio en dos pantallas del mismo panel.
describe('margen por comercio', () => {
  test('muestra el margen en pesos y en porcentaje', async () => {
    load({ byTenant: UN_COMERCIO })

    await waitFor(() => expect(screen.getByText(/27\.500/)).toBeInTheDocument())

    // El porcentaje importa tanto como los pesos: $8.000 sobre un plan de
    // $10.000 y $8.000 sobre uno de $40.000 se ven idénticos en pesos y son
    // negocios distintos.
    expect(screen.getByText(/68,8%|68\.8%/)).toBeInTheDocument()
  })

  test('marca al comercio que cuesta más de lo que paga', async () => {
    mockGetMargin.mockResolvedValue({
      tenants: [
        {
          ...MARGEN.tenants[0],
          estimatedMarginArs: -5000,
          marginPercent: -12.5,
          unprofitable: true,
        },
      ],
    })
    load({ byTenant: UN_COMERCIO })

    // Es la única fila sobre la que hay que hacer algo, y sin marcarla se pierde
    // entre las demás.
    await waitFor(() => expect(screen.getByText(/pierde plata/)).toBeInTheDocument())
  })

  test('un plan sin precio no muestra cero, que se leería como "no deja nada"', async () => {
    mockGetMargin.mockResolvedValue({
      tenants: [
        { ...MARGEN.tenants[0], planPriceArs: null, estimatedMarginArs: null, marginPercent: null },
      ],
    })
    load({ byTenant: UN_COMERCIO })

    await waitFor(() => expect(screen.getByText('sin precio')).toBeInTheDocument())
  })

  test('si falla el margen la pantalla sigue sirviendo', async () => {
    // Al revés no: sin gasto no hay nada que mirar. Pero sin margen el resto de
    // la pantalla contesta igual, así que la columna queda en guiones.
    mockGetMargin.mockRejectedValue(new Error('sin red'))
    load({ byTenant: UN_COMERCIO })

    await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
  })
})

// Suspender el comercio entero: lo único que esta pantalla puede hacerle a un
// negocio que paga.
//
// NO BORRA NADA, a propósito. Frenar a un comercio que cuesta más de lo que paga
// alcanza para el caso; borrarlo sería irreversible justo con los datos que
// harían falta si después discute un cobro.
describe('suspensión del comercio', () => {
  const abrirComercio = async user => {
    load({ byTenant: UN_COMERCIO })
    await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /gobernar/i }))
  }

  test('avisa que no se borra nada antes de confirmar', async () => {
    const user = userEvent.setup()
    await abrirComercio(user)

    await user.click(screen.getByRole('button', { name: /suspender el comercio/i }))

    // Lo que hace falta saber para decidir sin miedo.
    await waitFor(() =>
      expect(screen.getByText(/No se borra nada y se puede revertir/)).toBeInTheDocument(),
    )
  })

  test('no suspende sin motivo', async () => {
    const user = userEvent.setup()
    await abrirComercio(user)

    await user.click(screen.getByRole('button', { name: /suspender el comercio/i }))
    await user.click(screen.getByRole('button', { name: /^suspender$/i }))

    // Sin motivo ni autor no hay con qué responder si el comercio reclama.
    await waitFor(() => expect(screen.getByText(/Indicá por qué se suspende/)).toBeInTheDocument())
    expect(mockUpdateTenantStatus).not.toHaveBeenCalled()
  })

  test('suspende con su motivo', async () => {
    const user = userEvent.setup()
    mockUpdateTenantStatus.mockResolvedValue({ status: 'suspended' })
    await abrirComercio(user)

    await user.click(screen.getByRole('button', { name: /suspender el comercio/i }))
    await user.type(screen.getByLabelText(/por qué se suspende/i), 'Cuesta más de lo que paga')
    await user.click(screen.getByRole('button', { name: /^suspender$/i }))

    await waitFor(() =>
      expect(mockUpdateTenantStatus).toHaveBeenCalledWith({
        tenantId: 't1',
        suspended: true,
        reason: 'Cuesta más de lo que paga',
      }),
    )
  })

  test('a un comercio ya suspendido se le ofrece reactivar, y sin pedir motivo', async () => {
    mockGetMargin.mockResolvedValue({
      tenants: [{ ...MARGEN.tenants[0], status: 'suspended' }],
    })
    mockUpdateTenantStatus.mockResolvedValue({ status: 'active' })

    const user = userEvent.setup()
    await abrirComercio(user)

    await user.click(screen.getByRole('button', { name: /reactivar el comercio/i }))
    await user.click(screen.getByRole('button', { name: /^reactivar$/i }))

    // Volver a habilitar a alguien no hay que defenderlo ante nadie.
    await waitFor(() =>
      expect(mockUpdateTenantStatus).toHaveBeenCalledWith({
        tenantId: 't1',
        suspended: false,
        reason: '',
      }),
    )
  })
})

// Dar de baja: la única operación de la pantalla que no se deshace con un clic.
describe('baja del comercio', () => {
  const abrir = async user => {
    load({ byTenant: UN_COMERCIO })
    await waitFor(() => expect(screen.getByText(pesos(GASTO_DEL_MES))).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /gobernar/i }))
  }

  test('dice qué NO se borra, que es lo que permite decidir sin miedo', async () => {
    const user = userEvent.setup()
    await abrir(user)

    await user.click(screen.getByRole('button', { name: /^dar de baja$/i }))

    await waitFor(() => expect(screen.getByText(/no se deshace desde acá/i)).toBeInTheDocument())
    // El gasto de IA, las órdenes y la facturación quedan: hacen falta si
    // después discute un cobro.
    expect(screen.getByText(/su gasto de IA, sus órdenes y su facturación/i)).toBeInTheDocument()
  })

  test('no borra si el nombre escrito no coincide', async () => {
    const user = userEvent.setup()
    await abrir(user)

    await user.click(screen.getByRole('button', { name: /^dar de baja$/i }))
    await user.type(screen.getByLabelText(/por qué se da de baja/i), 'pidió la baja')
    await user.type(screen.getByLabelText(/para confirmar/i), 'moto norte')

    // Minúsculas no alcanza: el punto es haber mirado el nombre.
    const confirmar = screen.getAllByRole('button', { name: /^dar de baja$/i }).at(-1)
    expect(confirmar).toBeDisabled()
    expect(mockDeleteTenant).not.toHaveBeenCalled()
  })

  test('da de baja con el nombre exacto y su motivo', async () => {
    const user = userEvent.setup()
    mockDeleteTenant.mockResolvedValue({ status: 'deleted' })
    await abrir(user)

    await user.click(screen.getByRole('button', { name: /^dar de baja$/i }))
    await user.type(screen.getByLabelText(/por qué se da de baja/i), 'pidió la baja')
    await user.type(screen.getByLabelText(/para confirmar/i), 'Moto Norte')
    await user.click(screen.getAllByRole('button', { name: /^dar de baja$/i }).at(-1))

    await waitFor(() =>
      expect(mockDeleteTenant).toHaveBeenCalledWith({
        tenantId: 't1',
        confirmName: 'Moto Norte',
        reason: 'pidió la baja',
      }),
    )
  })
})

// Un comercio que ya no está sigue en la tabla, y tiene que leerse como
// historia.
//
// Esta tabla se arma desde el LIBRO y no desde la lista de comercios, así que un
// comercio borrado sigue apareciendo: esa plata HENKO ya la pagó y si la fila
// desapareciera el total del mes dejaría de cuadrar con lo que facturó el
// proveedor. Pero sin marcarla se lee como una fila viva, y la tabla le ofrecía
// "Gobernar" a algo que no existe.
describe('comercio que ya no existe', () => {
  const BORRADO_A_MANO = [{ ...UN_COMERCIO[0], tenantGone: true, name: '(comercio eliminado)' }]
  const DADO_DE_BAJA = [{ ...UN_COMERCIO[0], tenantGone: false, tenantStatus: 'deleted' }]

  test('el borrado a mano de la base se marca "no existe"', async () => {
    load({ byTenant: BORRADO_A_MANO })

    await waitFor(() => expect(screen.getByText('no existe')).toBeInTheDocument())
  })

  test('el dado de baja desde el panel se marca distinto', async () => {
    load({ byTenant: DADO_DE_BAJA })

    // Son dos estados distintos: uno lo borró alguien a mano, el otro salió por
    // la puerta y dejó su motivo.
    await waitFor(() => expect(screen.getByText('dado de baja')).toBeInTheDocument())
  })

  test('no se le ofrece gobernar, se le ofrece ver', async () => {
    load({ byTenant: BORRADO_A_MANO })

    await waitFor(() => expect(screen.getByRole('button', { name: /^ver$/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /gobernar/i })).not.toBeInTheDocument()
  })

  test('y el diálogo no le ofrece acciones: no hay nada que hacerle', async () => {
    const user = userEvent.setup()
    load({ byTenant: BORRADO_A_MANO })

    await waitFor(() => expect(screen.getByRole('button', { name: /^ver$/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^ver$/i }))

    await waitFor(() => expect(screen.getByText(/no hay nada que gobernar/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /suspender el comercio/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^dar de baja$/i })).not.toBeInTheDocument()
  })
})

// El estado del comercio lo manda la fila de gasto, no el margen.
//
// EL DEFECTO
//
// El diálogo se armaba con `{...governing, tenantStatus: margen?.status ||
// 'active'}`, y la clave explícita gana sobre el spread. El reporte de margen
// EXCLUYE los comercios dados de baja, así que para uno de ésos devolvía
// undefined y el fallback lo dejaba en 'active': la guarda no se activaba y el
// diálogo ofrecía suspender y dar de baja a un comercio que ya estaba dado de
// baja.
//
// Mis primeras pruebas no lo agarraron porque la del diálogo usaba tenantGone,
// que no se sobrescribe. Ésta ataca el otro camino.
describe('comercio dado de baja desde el panel', () => {
  const DADO_DE_BAJA = [{ ...UN_COMERCIO[0], tenantGone: false, tenantStatus: 'deleted' }]

  test('el diálogo no le ofrece acciones, aunque el margen no lo liste', async () => {
    const user = userEvent.setup()
    // Así se comporta el reporte real: un comercio dado de baja no aparece.
    mockGetMargin.mockResolvedValue({ tenants: [] })
    load({ byTenant: DADO_DE_BAJA })

    await waitFor(() => expect(screen.getByRole('button', { name: /^ver$/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^ver$/i }))

    await waitFor(() =>
      expect(screen.getByText(/está dado de baja. Su gasto sigue acá/i)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /suspender el comercio/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^dar de baja$/i })).not.toBeInTheDocument()
  })
})

// El techo en PLATA de cada comercio, que es el control que faltaba.
//
// El tope por comercio existía sólo en TOKENS, y el catálogo de precios explica
// por qué eso no controla el gasto: entre un modelo y otro de la cadena hay 5x
// de diferencia de tarifa, así que el mismo tope de tokens puede costar veinte
// dólares o cien según quién conteste. Un comercio puede ir al 40% de sus tokens
// y al 95% de su plata, y la columna de tokens no distingue los dos casos.
describe('techo en plata por comercio', () => {
  const CON_TECHO = [{ ...UN_COMERCIO[0], usdCap: 20, percentOfUsdCap: 62.5, usdCapOverride: null }]

  test('muestra cuánto lleva de su techo', async () => {
    load({ byTenant: CON_TECHO })

    await waitFor(() => expect(screen.getByText('62.5%')).toBeInTheDocument())
  })

  test('sin techo lo dice en lugar de mostrar un cero', async () => {
    // Cero se leería como "no gastó nada", que es una afirmación distinta.
    load({ byTenant: [{ ...UN_COMERCIO[0], usdCap: null, percentOfUsdCap: null }] })

    await waitFor(() => expect(screen.getByText('sin techo')).toBeInTheDocument())
  })

  test('se puede poner un techo en dólares a un comercio', async () => {
    const user = userEvent.setup()
    mockUpdateTenantPolicy.mockResolvedValue(REPORT)
    load({ byTenant: CON_TECHO })

    await waitFor(() => expect(screen.getByText('62.5%')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /gobernar/i }))

    await user.type(screen.getByLabelText(/techo en dólares/i), '5')
    await user.type(screen.getByLabelText(/^motivo$/i), 'se desbocó en tres días')
    await user.click(screen.getByRole('button', { name: /^guardar$/i }))

    await waitFor(() =>
      expect(mockUpdateTenantPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', usdCap: 5 }),
      ),
    )
  })

  test('vacío manda null para volver a su fracción', async () => {
    const user = userEvent.setup()
    mockUpdateTenantPolicy.mockResolvedValue(REPORT)
    // Arranca con un techo puesto a mano, y se lo borra.
    load({ byTenant: [{ ...CON_TECHO[0], usdCapOverride: 20 }] })

    await waitFor(() => expect(screen.getByText('62.5%')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /gobernar/i }))

    await user.clear(screen.getByLabelText(/techo en dólares/i))
    await user.type(screen.getByLabelText(/^motivo$/i), 'vuelve al reparto normal')
    await user.click(screen.getByRole('button', { name: /^guardar$/i }))

    // null y "no mandar el campo" son cosas distintas para el backend: el
    // primero devuelve el mando a la fracción, el segundo no toca nada.
    await waitFor(() =>
      expect(mockUpdateTenantPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', usdCap: null }),
      ),
    )
  })
})

// ─── CONTRA EL MES ANTERIOR ──────────────────────────────────────────────────
//
// Todas las demás columnas comparan contra un TECHO, y eso deja ciego al caso
// que más plata cuesta: el comercio que se desliza. Duplica su consumo todos
// los meses y sigue lejos de su tope, así que no enciende ninguna alarma hasta
// que ya se comió el presupuesto.

// Doce días cerrados del mes en curso contra los mismos doce del anterior.
const COMPARACION = { previousPeriod: '2026-08', days: 12, partial: true }

const TRIPLICO = [
  {
    ...UN_COMERCIO[0],
    comparableUsd: 12,
    previousComparableUsd: 4,
    previousUsd: 9,
    changePercent: 200,
  },
]

describe('tendencia contra el mes anterior', () => {
  test('un comercio que triplicó lo muestra en la tabla', async () => {
    load({ byTenant: TRIPLICO, comparison: COMPARACION })

    await waitFor(() => expect(screen.getByText('Moto Norte')).toBeInTheDocument())

    // Con el signo adelante: es lo que permite barrer la columna con la vista
    // sin leer cada número.
    expect(screen.getByText('+200%')).toBeInTheDocument()
  })

  test('una caída se muestra con su signo, sin inventarle un más', async () => {
    load({
      byTenant: [
        {
          ...UN_COMERCIO[0],
          comparableUsd: 2,
          previousComparableUsd: 4,
          previousUsd: 9,
          changePercent: -50,
        },
      ],
      comparison: COMPARACION,
    })

    await waitFor(() => expect(screen.getByText('-50%')).toBeInTheDocument())
  })

  test('un comercio que antes no gastaba se marca como nuevo', async () => {
    // Dividir por cero daría infinito. El backend manda null, y null no es un
    // 0% —que significaría que gastó lo mismo— sino "antes no gastaba".
    load({
      byTenant: [
        {
          ...UN_COMERCIO[0],
          comparableUsd: 12,
          previousComparableUsd: 0,
          previousUsd: 0,
          changePercent: null,
        },
      ],
      comparison: COMPARACION,
    })

    await waitFor(() => expect(screen.getByText('nuevo')).toBeInTheDocument())
  })

  test('un reporte sin los campos de tendencia no rompe la tabla', async () => {
    // El panel puede quedar desplegado antes que el backend, y es el caso
    // normal durante un deploy: UN_COMERCIO no trae ninguno de los campos.
    load({ byTenant: UN_COMERCIO })

    await waitFor(() => expect(screen.getByText('Moto Norte')).toBeInTheDocument())

    // La fila se dibuja igual y la celda de tendencia queda en guión: sin
    // comparación no se inventa un 0%, que significaría "gastó lo mismo".
    const fila = within(screen.getByText('Moto Norte').closest('tr'))

    expect(fila.getByText('—')).toBeInTheDocument()
    // Y el resto de la fila sigue entero: lo que falta es la comparación, no
    // el consumo.
    expect(fila.getByText('80%')).toBeInTheDocument()
  })
})

// ─── LA FICHA DEL COMERCIO ───────────────────────────────────────────────────
//
// La tabla dice que un comercio triplicó. Eso no alcanza para decidir: un
// negocio que creció de a poco se cobra, y un salto de un día es un bug o un
// abuso. Las dos cosas suman el mismo total y se resuelven distinto.

const DETALLE = {
  tenantId: 't1',
  name: 'Moto Norte',
  period: '2026-09',
  previousPeriod: '2026-08',
  // Treinta días, con el gasto concentrado en el 20: el caso del salto.
  daily: Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    costUsd: i + 1 === 20 ? 9 : 0.1,
    tokens: 1000,
    operations: 10,
  })),
  previousDaily: Array.from({ length: 31 }, (_, i) => ({
    day: i + 1,
    costUsd: 0.1,
    tokens: 100,
    operations: 1,
  })),
  totals: { costUsd: 11.9, tokens: 30000, operations: 300 },
  previousTotals: { costUsd: 3.1, tokens: 3100, operations: 31 },
  comparison: { days: 30, costUsd: 11.9, previousCostUsd: 3.1, changePercent: 283.9 },
  byMetric: [{ metric: 'vision', costUsd: 11.9, tokens: 30000, operations: 300 }],
  byModel: [],
}

describe('evolución del comercio', () => {
  test('al abrir la ficha pide el detalle y muestra el día más caro', async () => {
    const user = userEvent.setup()
    mockGetTenantDetail.mockResolvedValue(DETALLE)
    load({ byTenant: TRIPLICO, comparison: COMPARACION })

    await waitFor(() => expect(screen.getByText('Moto Norte')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /gobernar/i }))

    // Se pide con el período que se está mirando, no con el mes actual: la
    // tabla puede estar mostrando un mes cerrado.
    await waitFor(() => expect(mockGetTenantDetail).toHaveBeenCalledWith('t1', '2026-09'))

    // El día del salto, que es lo que distingue "creció" de "se desbocó".
    expect(await screen.findByText(/Día más caro: el 20/)).toBeInTheDocument()

    // Y en qué se le fue: el mismo total repartido en otra función lleva a
    // otra palanca. Se busca DENTRO del diálogo: la tabla de atrás tiene la
    // misma etiqueta y una búsqueda global encontraría las dos.
    const dialogo = within(screen.getByRole('dialog'))

    expect(dialogo.getByText('Análisis de imágenes')).toBeInTheDocument()
    // El promedio diario del mes anterior, que es contra lo que se lee cada
    // barra: sin referencia, una serie de barras es un dibujo.
    expect(dialogo.getByText(/Promedio diario de 2026-08/)).toBeInTheDocument()
  })

  test('si la evolución falla, el diálogo sigue sirviendo para acotar', async () => {
    // Lo que se viene a hacer acá es acotar o pausar, y eso no depende del
    // gráfico. Que se caiga una lectura de más no puede dejar sin la palanca.
    const user = userEvent.setup()
    mockGetTenantDetail.mockRejectedValue(new Error('timeout'))
    load({ byTenant: TRIPLICO, comparison: COMPARACION })

    await waitFor(() => expect(screen.getByText('Moto Norte')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /gobernar/i }))

    expect(await screen.findByText(/No se pudo cargar la evolución/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^motivo$/i)).toBeInTheDocument()
  })

  test('un comercio que dejó de consumir lo dice, en vez de un gráfico vacío', async () => {
    const user = userEvent.setup()
    mockGetTenantDetail.mockResolvedValue({
      ...DETALLE,
      daily: DETALLE.daily.map(d => ({ ...d, costUsd: 0, tokens: 0, operations: 0 })),
      totals: { costUsd: 0, tokens: 0, operations: 0 },
    })
    load({ byTenant: TRIPLICO, comparison: COMPARACION })

    await waitFor(() => expect(screen.getByText('Moto Norte')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /gobernar/i }))

    expect(await screen.findByText(/dejó de consumir/)).toBeInTheDocument()
  })
})
