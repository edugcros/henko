// Pantalla de gasto de IA de la plataforma.
//
// Mismo motivo que el test de PricingPage: webpack no ejecuta componentes, así
// que un build verde no dice nada sobre si la pantalla abre. Y esta en
// particular muestra números con los que se toman decisiones de plata, así que
// lo que se prueba es que las ramas que dependen de la forma de la respuesta
// se rendericen bien — sobre todo las que distinguen "no hay techo" de "el
// techo es cero", que son situaciones distintas.

import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// config/env.js valida esto al cargarse y aborta sin ella. La cadena llega acá
// por platformService → axiosConfig, así que hay que darle un valor antes de
// importar la pantalla.
process.env.REACT_APP_API_BASE_URL = "http://localhost:5000/api";

const mockGetAiSpend = jest.fn();
const mockUpdateBudget = jest.fn();
const mockUpdateTenantPolicy = jest.fn();

jest.unstable_mockModule("../services/platformService", () => ({
  getPlatformAiSpend: mockGetAiSpend,
  updatePlatformAiBudget: mockUpdateBudget,
  // Acotar o pausar a UN comercio. El mock tiene que declarar todos los
  // exports que la pantalla importa: con uno de menos, el módulo entero no
  // resuelve y la suite no corre ningún test — que es lo que pasó al agregarlo.
  updateTenantAiPolicy: mockUpdateTenantPolicy,
  getPlatformMarginReport: jest.fn(),
  default: {},
}));

const { default: PlatformAiSpendPage } = await import("./PlatformAiSpendPage.jsx");

const REPORT = {
  period: "2026-09",
  budget: {
    tokens: 200_000_000,
    configured: true,
    alertedThreshold: 0,
    source: "env",
  },
  settingHistory: [],
  consumption: {
    tokens: 24_500_000,
    percentUsed: 12.3,
    remainingTokens: 175_500_000,
    estimatedCostUsd: 33.12,
    lastActivityAt: "2026-09-09T10:00:00.000Z",
  },
  breaker: { trippedAt: null, tripped: false },
  byMetric: [
    { metric: "vision", costUsd: 24.5, tokens: 18_000_000, operations: 3600 },
    { metric: "agentTokens", costUsd: 8.62, tokens: 6_500_000, operations: 2100 },
  ],
  byModel: [
    { model: "gemini-3.6-flash", costUsd: 30.1, tokens: 22_000_000, operations: 5000, fallbackRows: 0 },
  ],
  quality: { rows: 5700, estimatedRows: 2100, fallbackRows: 0 },
};

const load = (overrides = {}) => {
  mockGetAiSpend.mockResolvedValue({ ...REPORT, ...overrides });
  return render(<PlatformAiSpendPage />);
};

beforeEach(() => {
  jest.clearAllMocks();
});

test("muestra el gasto del mes y qué lo consume", async () => {
  load();

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());

  // Las métricas se muestran con nombre legible: 'agentTokens' no le dice nada
  // a nadie que no haya leído el código.
  expect(screen.getByText("Análisis de imágenes")).toBeInTheDocument();
  expect(screen.getByText("Tokens del agente")).toBeInTheDocument();
  expect(screen.getByText("gemini-3.6-flash")).toBeInTheDocument();
});

test("sin techo configurado avisa que nada detiene el gasto", async () => {
  // No es lo mismo que un techo en cero, y el backend manda null justamente
  // para poder distinguirlos.
  load({
    budget: { tokens: null, configured: false, alertedThreshold: 0 },
    consumption: { ...REPORT.consumption, percentUsed: null, remainingTokens: null },
  });

  await waitFor(() =>
    expect(screen.getByText(/nada lo detiene/i)).toBeInTheDocument(),
  );
});

test("si el disyuntor cortó, lo dice arriba de todo", async () => {
  load({
    breaker: { trippedAt: "2026-09-20T03:00:00.000Z", tripped: true },
  });

  await waitFor(() =>
    expect(screen.getByText(/El disyuntor cortó/i)).toBeInTheDocument(),
  );
  // Y aclara que los BYOK no se ven afectados, que es lo primero que uno
  // pregunta cuando ve que se cortó.
  expect(screen.getByText(/key propia siguen funcionando/i)).toBeInTheDocument();
});

test("la calidad se lee en plata y encabeza con el porcentaje medido", async () => {
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
  });

  await waitFor(() =>
    expect(
      screen.getByText("92.3% del gasto en tokens está medido"),
    ).toBeInTheDocument(),
  );

  // Cada clase con su plata al lado: cuatro filas mal medidas de un total de
  // 132 suenan a nada hasta que se ve que son el 7,7% del gasto.
  expect(screen.getByText(/128 medidos/)).toBeInTheDocument();
  expect(screen.getByText(/4 con costo repartido/)).toBeInTheDocument();
  expect(screen.getByText(/0 sin modelo conocido/)).toBeInTheDocument();

  // Y lo que se cobra por unidad se informa aparte, no mezclado.
  expect(
    screen.getByText(/28 movimientos de precio por unidad/),
  ).toBeInTheDocument();
});

test("un reporte viejo, sin los campos de plata, no rompe la pantalla", async () => {
  // El panel puede quedar desplegado antes que el backend. Sin los campos
  // nuevos tiene que seguir mostrando lo que ya mostraba.
  load({ quality: { rows: 40, estimatedRows: 3, fallbackRows: 1 } });

  await waitFor(() =>
    expect(screen.getByText(/3 con costo repartido/)).toBeInTheDocument(),
  );

  expect(screen.getByText(/1 con tarifa de respaldo/)).toBeInTheDocument();
  // Sin measuredShare no se inventa un porcentaje.
  expect(screen.queryByText(/del gasto en tokens está medido/)).toBeNull();
});

test("marca los modelos que se cobraron con tarifa de respaldo", async () => {
  // Si eso crece, el catálogo quedó viejo y el costo mostrado está inflado.
  load({
    byModel: [
      { model: "modelo-nuevo", costUsd: 12, tokens: 900_000, operations: 40, fallbackRows: 40 },
    ],
    quality: { rows: 40, estimatedRows: 0, fallbackRows: 40 },
  });

  await waitFor(() =>
    expect(screen.getByText("40 sin tarifa")).toBeInTheDocument(),
  );
});

test("un período sin consumo no rompe la pantalla", async () => {
  load({
    consumption: { ...REPORT.consumption, tokens: 0, percentUsed: 0, estimatedCostUsd: 0 },
    byMetric: [],
    byModel: [],
    quality: { rows: 0, estimatedRows: 0, fallbackRows: 0 },
  });

  await waitFor(() =>
    expect(screen.getByText(/Todavía no hay consumo registrado/i)).toBeInTheDocument(),
  );
});

test("no deja guardar un techo nuevo sin motivo", async () => {
  // El motivo también es obligatorio en el servidor; acá evita el viaje. Y el
  // punto de fondo es que dentro de tres meses el número solo no explica por
  // qué alguien duplicó el techo un martes a las 3 de la mañana.
  const user = userEvent.setup();
  load();

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /cambiar techo/i }));

  expect(screen.getByRole("button", { name: /^guardar$/i })).toBeDisabled();

  await user.type(screen.getByLabelText(/motivo/i), "cortó por un bulk import");

  expect(screen.getByRole("button", { name: /^guardar$/i })).toBeEnabled();
});

test("guarda el techo con el motivo y muestra el reporte actualizado", async () => {
  const user = userEvent.setup();
  mockUpdateBudget.mockResolvedValue({
    ...REPORT,
    budget: { ...REPORT.budget, tokens: 400_000_000, source: "panel" },
    consumption: { ...REPORT.consumption, percentUsed: 6.1 },
  });
  load();

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /cambiar techo/i }));
  await user.type(screen.getByLabelText(/motivo/i), "cortó por un bulk import");
  await user.click(screen.getByRole("button", { name: /^guardar$/i }));

  await waitFor(() =>
    expect(mockUpdateBudget).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "cortó por un bulk import" }),
    ),
  );

  // La respuesta del PUT ya trae el reporte nuevo: la pantalla no vuelve a
  // pedirlo, así que no puede quedar mostrando lo viejo si esa segunda vuelta
  // fallara.
  await waitFor(() =>
    expect(screen.getByText(/techo fijado desde el panel/i)).toBeInTheDocument(),
  );
  expect(mockGetAiSpend).toHaveBeenCalledTimes(1);
});

test("avisa que la variable de entorno no manda cuando hay override", async () => {
  // Sin esto, "ya lo cambié en Render y no pasa nada" es media hora perdida.
  const user = userEvent.setup();
  load({ budget: { ...REPORT.budget, source: "panel" } });

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /cambiar techo/i }));

  expect(
    screen.getByText(/cambiar la variable de entorno en Render no tiene efecto/i),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /volver a la variable/i }),
  ).toBeInTheDocument();
});

test("muestra quién movió el techo y por qué", async () => {
  load({
    settingHistory: [
      {
        setting: "monthlyTokenBudget",
        value: 400_000_000,
        previousValue: 200_000_000,
        changedByEmail: "dueño@henko.com",
        reason: "cortó a las 3am por un bulk import",
        createdAt: "2026-09-20T06:00:00.000Z",
      },
    ],
  });

  await waitFor(() =>
    expect(screen.getByText("dueño@henko.com")).toBeInTheDocument(),
  );
  expect(
    screen.getByText(/cortó a las 3am por un bulk import/i),
  ).toBeInTheDocument();
});

test("un 403 explica que no tenés acceso en vez de tirar un error", async () => {
  mockGetAiSpend.mockRejectedValue({ response: { status: 403 } });

  render(<PlatformAiSpendPage />);

  await waitFor(() =>
    expect(screen.getByText(/No tenés acceso/i)).toBeInTheDocument(),
  );
});

test("muestra quién lo consume, no solo cuánto", async () => {
  // Todo el resto de la pantalla es agregado y ninguna de esas vistas contesta
  // la pregunta que uno se hace cuando el disyuntor corta: quién fue.
  load({
    budget: { ...REPORT.budget, perTenantShare: 0.5 },
    byTenant: [
      {
        tenantId: "t1", name: "Moto Norte", plan: "pro",
        tokens: 4_000_000, operations: 900, toolCalls: 40,
        platformCostUsd: 12.5, tenantProviderCostUsd: 12.5,
        keySources: ["platform"], tokenCap: 5_000_000, percentOfCap: 80,
        percentOfPlatformUsd: 25,
      },
      {
        tenantId: "t2", name: "Casa Sur", plan: "starter",
        tokens: 200_000, operations: 30, toolCalls: 0,
        platformCostUsd: 0, tenantProviderCostUsd: 0.9,
        keySources: ["tenant"], tokenCap: 5_000_000, percentOfCap: 4,
        percentOfPlatformUsd: 0,
      },
    ],
  });

  await waitFor(() =>
    expect(screen.getByText("Moto Norte")).toBeInTheDocument(),
  );

  expect(screen.getByText("Casa Sur")).toBeInTheDocument();

  // El porcentaje es de SU parte, no del techo total: es el numero que
  // anticipa el corte de ese comercio.
  expect(screen.getByText("80%")).toBeInTheDocument();

  // Un comercio con key propia se marca: ver un cero en la columna de costo
  // sin esa marca se lee como un error de carga.
  expect(screen.getByText(/key propia/i)).toBeInTheDocument();
  expect(screen.getByText(/con su key/i)).toBeInTheDocument();
});

test("sin comercios no dibuja la tabla", async () => {
  load({ byTenant: [] });

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());

  expect(screen.queryByText("Quién lo consume")).toBeNull();
});

test("un reporte sin byTenant no rompe la pantalla", async () => {
  // El panel puede quedar desplegado antes que el backend.
  const { byTenant, ...sinTenant } = REPORT;
  mockGetAiSpend.mockResolvedValue(sinTenant);
  render(<PlatformAiSpendPage />);

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  expect(screen.queryByText("Quién lo consume")).toBeNull();
});

test("el diálogo maneja los TRES frenos, no solo el de tokens", async () => {
  // El modelo y el servicio los soportaban desde siempre; lo que faltaba era
  // el endpoint y la pantalla. El techo en PLATA es el que importa: entre
  // 3.6-flash y 3.1-flash-lite hay 5x de tarifa, asi que el mismo tope de
  // tokens puede costar veinte dolares o cien.
  const user = userEvent.setup();
  load({ budget: { ...REPORT.budget, usd: 50, perTenantShare: 0.5 } });

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /cambiar techo/i }));

  expect(screen.getByLabelText(/techo en tokens/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/techo en dólares/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/reparto por comercio/i)).toBeInTheDocument();
});

test("manda SOLO el freno que se movió", async () => {
  // Un campo que no cambio no viaja, asi que el historial registra el cambio
  // que ocurrio y no tres.
  const user = userEvent.setup();
  mockUpdateBudget.mockResolvedValue(REPORT);
  load({ budget: { ...REPORT.budget, usd: 50, perTenantShare: 0.5 } });

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /cambiar techo/i }));

  const campoUsd = screen.getByLabelText(/techo en dólares/i);
  await user.clear(campoUsd);
  await user.type(campoUsd, "80");
  await user.type(screen.getByLabelText(/motivo/i), "subimos por el mes de campañas");
  await user.click(screen.getByRole("button", { name: /^guardar$/i }));

  await waitFor(() => expect(mockUpdateBudget).toHaveBeenCalled());

  const enviado = mockUpdateBudget.mock.calls[0][0];
  expect(enviado.usd).toBe(80);
  expect(enviado).not.toHaveProperty("tokens");
  expect(enviado).not.toHaveProperty("perTenantShare");
  expect(enviado.reason).toMatch(/campañas/);
});

test("un campo vacío suelta el freno, y no es lo mismo que cero", async () => {
  // Un techo en cero apaga la IA; ninguno la deja gobernada por Render. Son
  // dos decisiones distintas y la pantalla no puede confundirlas.
  const user = userEvent.setup();
  mockUpdateBudget.mockResolvedValue(REPORT);
  load({ budget: { ...REPORT.budget, usd: 50, perTenantShare: 0.5 } });

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /cambiar techo/i }));

  await user.clear(screen.getByLabelText(/techo en dólares/i));
  await user.type(screen.getByLabelText(/motivo/i), "que lo decida la variable");
  await user.click(screen.getByRole("button", { name: /^guardar$/i }));

  await waitFor(() => expect(mockUpdateBudget).toHaveBeenCalled());
  expect(mockUpdateBudget.mock.calls[0][0].usd).toBeNull();
});

// ─── GOBIERNO POR COMERCIO ───────────────────────────────────────────────────
//
// Las tres palancas anteriores son globales: para frenar a uno había que
// bajarle el reparto a todos, o sea castigar a los diez porque uno se desbocó.
// Esto acota o apaga a uno solo.

const CON_COMERCIOS = {
  byTenant: [
    {
      tenantId: "64b7f00000000000000000a1",
      name: "Tienda Grande",
      plan: "pro",
      tokens: 5_000_000,
      toolCalls: 0,
      operations: 900,
      platformCostUsd: 12.4,
      tenantProviderCostUsd: 12.4,
      keySources: ["platform"],
      tokenCap: 100_000_000,
      percentOfCap: 5,
      percentOfPlatformUsd: 24.8,
      share: null,
      suspended: false,
      suspendedReason: null,
    },
  ],
};

test("cada comercio se puede gobernar desde su propia fila", async () => {
  // La acción va donde está el número que la justifica: mandarla a otra
  // pantalla obligaría a recordar qué comercio era y cuánto llevaba.
  load(CON_COMERCIOS);

  await waitFor(() => expect(screen.getByText("Tienda Grande")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /gobernar/i })).toBeInTheDocument();
});

test("acotar a un comercio manda solo su fracción", async () => {
  const user = userEvent.setup();
  mockUpdateTenantPolicy.mockResolvedValue({ ...REPORT, ...CON_COMERCIOS });
  load(CON_COMERCIOS);

  await waitFor(() => expect(screen.getByText("Tienda Grande")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /gobernar/i }));

  await user.type(screen.getByLabelText(/su parte del techo/i), "0.1");
  await user.type(screen.getByLabelText(/^motivo$/i), "se comió el 60% en tres días");
  await user.click(screen.getByRole("button", { name: /^guardar$/i }));

  await waitFor(() => expect(mockUpdateTenantPolicy).toHaveBeenCalled());

  const enviado = mockUpdateTenantPolicy.mock.calls[0][0];
  expect(enviado.tenantId).toBe("64b7f00000000000000000a1");
  expect(enviado.share).toBe(0.1);
  // El interruptor no se tocó: no puede viajar y apagar al comercio de paso.
  expect(enviado).not.toHaveProperty("suspended");
});

test("pausar pide que se le explique al comercio", async () => {
  // Un servicio que se apaga sin decir por qué genera un ticket de soporte por
  // cada comercio afectado.
  const user = userEvent.setup();
  mockUpdateTenantPolicy.mockResolvedValue({ ...REPORT, ...CON_COMERCIOS });
  load(CON_COMERCIOS);

  await waitFor(() => expect(screen.getByText("Tienda Grande")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /gobernar/i }));

  await user.click(screen.getByLabelText(/pausar las funciones de ia/i));

  await user.type(
    screen.getByLabelText(/qué va a ver el comercio/i),
    "factura impaga desde agosto",
  );
  await user.type(screen.getByLabelText(/^motivo$/i), "mora de 40 días");
  await user.click(screen.getByRole("button", { name: /^guardar$/i }));

  await waitFor(() => expect(mockUpdateTenantPolicy).toHaveBeenCalled());

  const enviado = mockUpdateTenantPolicy.mock.calls[0][0];
  expect(enviado.suspended).toBe(true);
  expect(enviado.suspendedReason).toMatch(/factura impaga/);
});

test("sin motivo no se puede guardar", async () => {
  // Apagarle la IA a un comercio es la decisión más cara de esta pantalla y la
  // que más se va a tener que explicar dentro de tres meses.
  const user = userEvent.setup();
  load(CON_COMERCIOS);

  await waitFor(() => expect(screen.getByText("Tienda Grande")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /gobernar/i }));

  expect(screen.getByRole("button", { name: /^guardar$/i })).toBeDisabled();
});

test("un comercio pausado se ve pausado en la tabla", async () => {
  // Dejó de consumir, así que sus números son ceros: sin la marca se leería
  // como un comercio que simplemente no usó la IA.
  load({
    byTenant: [
      { ...CON_COMERCIOS.byTenant[0], suspended: true, suspendedReason: "mora" },
    ],
  });

  await waitFor(() => expect(screen.getByText("pausado")).toBeInTheDocument());
});

test("un comercio acotado muestra que tiene un tope propio", async () => {
  load({ byTenant: [{ ...CON_COMERCIOS.byTenant[0], share: 0.1 }] });

  await waitFor(() => expect(screen.getByText("acotado 10%")).toBeInTheDocument());
});

// ─── PRONÓSTICO, DEGRADACIÓN Y ANOMALÍAS ─────────────────────────────────────

test("avisa el día en que se agota el techo al ritmo actual", async () => {
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
      basis: "recent",
    },
  });

  await waitFor(() =>
    expect(screen.getByText(/el techo se agota el día 18/i)).toBeInTheDocument(),
  );
  // Y con cuál de los dos ritmos se proyectó: que el reciente venga más alto
  // que el del mes es una información distinta de la proyección misma.
  expect(screen.getByText(/últimos 7 días/i)).toBeInTheDocument();
});

test("a ritmo tranquilo no grita nada", async () => {
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
      basis: "month",
    },
  });

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  expect(screen.queryByText(/se agota el día/i)).not.toBeInTheDocument();
});

test("muestra en qué escalón de servicio está la plataforma", async () => {
  // Un asistente que de golpe contesta peor, sin nada en pantalla que lo
  // explique, se diagnostica como un bug del agente y se busca durante horas en
  // el lugar equivocado.
  load({
    degradation: { level: "economy", percentUsed: 83.4, economyAt: 80, essentialAt: 90 },
  });

  await waitFor(() => expect(screen.getByText(/modo economía/i)).toBeInTheDocument());
  expect(screen.getByText(/83.4% del techo/i)).toBeInTheDocument();
});

test("en modo normal no muestra ningún escalón", async () => {
  load({
    degradation: { level: "normal", percentUsed: 12.3, economyAt: 80, essentialAt: 90 },
  });

  await waitFor(() => expect(screen.getByText("$33.12")).toBeInTheDocument());
  expect(screen.queryByText(/modo economía/i)).not.toBeInTheDocument();
});

test("señala al comercio que se salió de su propia costumbre", async () => {
  // La tabla de consumo ordena por cuánto gastan, y el desborde típico es un
  // comercio CHICO que multiplicó por cincuenta lo suyo y sigue en la mitad de
  // abajo de esa lista.
  load({
    anomalies: [
      {
        tenantId: "64b7f00000000000000000b2",
        name: "Tienda Chica",
        todayUsd: 5,
        todayOperations: 812,
        typicalUsd: 0.1,
        factor: 50,
        baselineDays: 14,
      },
    ],
  });

  await waitFor(() => expect(screen.getByText("Tienda Chica")).toBeInTheDocument());
  expect(screen.getByText(/50× su habitual/i)).toBeInTheDocument();
});

test("el que arranca de cero no muestra un múltiplo inventado", async () => {
  // No hay división que hacer, y decir «infinitas veces más» no ayuda a nadie.
  load({
    anomalies: [
      {
        tenantId: "64b7f00000000000000000b3",
        name: "Tienda Nueva",
        todayUsd: 3,
        todayOperations: 500,
        typicalUsd: 0,
        factor: null,
        baselineDays: 14,
      },
    ],
  });

  await waitFor(() =>
    expect(screen.getByText(/no venía consumiendo nada/i)).toBeInTheDocument(),
  );
});
