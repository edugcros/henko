// Medidor de consumo de IA del comercio.
//
// Lo que se prueba acá es una sola cosa, y es la que se rompió: que el tope
// que muestra la pantalla sea el que el medidor cobra de verdad. Mientras el
// backend aplicaba el autolímite del comercio y el panel dibujaba el del plan,
// alguien con un freno de 2.000 mensajes veía "10K" y se quedaba sin asistente
// a los 2.000 sin ninguna explicación — ni él ni quien atendiera el reclamo.
//
// El resto del componente (BYOK, avisos de suscripción) no se toca acá.

import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";

// config/env.js valida esto al cargarse y aborta sin ella; llega por
// aiBudgetService → axiosConfig.
process.env.REACT_APP_API_BASE_URL = "http://localhost:5000/api";

const mockGetAiBudget = jest.fn();

jest.unstable_mockModule("../../services/aiBudgetService.js", () => ({
  getAiBudget: mockGetAiBudget,
  saveAiCredentials: jest.fn(),
  deleteAiCredentials: jest.fn(),
  default: {},
}));

const { default: AiBudgetPanel } = await import("./AiBudgetPanel.jsx");

const metrica = (used, limit, extra = {}) => ({
  used,
  limit,
  unlimited: limit === 0,
  remaining: limit === 0 ? null : Math.max(0, limit - used),
  planLimit: limit,
  selfLimited: false,
  ...extra,
});

const SNAPSHOT = {
  period: "2026-09",
  plan: "pro",
  subscription: { status: "active", entitled: true, reason: "ok" },
  credentials: {
    source: "platform",
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
};

const snapshotCon = metrics => ({
  ...SNAPSHOT,
  metrics: { ...SNAPSHOT.metrics, ...metrics },
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AiBudgetPanel · tope mostrado", () => {
  test("sin autolímite muestra el tope del plan y no habla de autolímites", async () => {
    mockGetAiBudget.mockResolvedValue(SNAPSHOT);

    render(<AiBudgetPanel />);

    expect(await screen.findByText("3 / 10K")).toBeInTheDocument();
    expect(screen.queryByText(/Autolímite tuyo/)).not.toBeInTheDocument();
  });

  test("con autolímite muestra el tope real, no el del plan", async () => {
    mockGetAiBudget.mockResolvedValue(
      snapshotCon({
        agentMessages: metrica(3, 2000, { planLimit: 10_000, selfLimited: true }),
      }),
    );

    render(<AiBudgetPanel />);

    // El número que se cobra.
    expect(await screen.findByText("3 / 2.000")).toBeInTheDocument();
    // Y el del plan NO aparece como si fuera el tope.
    expect(screen.queryByText("3 / 10K")).not.toBeInTheDocument();
  });

  test("explica de dónde sale el recorte y cuánto da el plan", async () => {
    // Un tope más bajo que el contratado, sin explicación, se lee como un
    // error de facturación.
    mockGetAiBudget.mockResolvedValue(
      snapshotCon({
        agentMessages: metrica(3, 2000, { planLimit: 10_000, selfLimited: true }),
      }),
    );

    render(<AiBudgetPanel />);

    await waitFor(() =>
      expect(screen.getByText(/Autolímite tuyo/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Tu plan permite 10K/)).toBeInTheDocument();
  });

  test("la barra se llena contra el tope real", async () => {
    // Con 1.800 de 2.000 el medidor está al 90% y tiene que avisar; contra los
    // 10.000 del plan daría 18% y verde, que es justo el aviso que no llegaba.
    mockGetAiBudget.mockResolvedValue(
      snapshotCon({
        agentMessages: metrica(1800, 2000, {
          planLimit: 10_000,
          selfLimited: true,
        }),
      }),
    );

    render(<AiBudgetPanel />);

    expect(await screen.findByText("Por agotarse")).toBeInTheDocument();
  });
});
