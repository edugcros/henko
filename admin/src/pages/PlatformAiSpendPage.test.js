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

jest.unstable_mockModule("../services/platformService", () => ({
  getPlatformAiSpend: mockGetAiSpend,
  updatePlatformAiBudget: mockUpdateBudget,
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
