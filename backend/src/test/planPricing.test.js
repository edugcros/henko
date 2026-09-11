// El precio de los planes: uno solo, en pesos, y configurable.
//
// Vivía en cuatro lugares con tres copias del tipo de cambio: acá, en
// SubscriptionPage, en SubscriptionManagementPage y en CheckoutPage. El del
// panel decía 26,14 USD — el resultado congelado de dividir 40.000 pesos por el
// dólar del 24/08/2026. Cuatro copias de un número que cambia terminan mostrando
// cosas distintas, y no hay forma de saber cuál es la buena.
//
// Y ya no hay precio en dólares. HENKO cobra en pesos a través de una cuenta de
// Mercado Pago argentina, que además solo admite ARS en una suscripción. El
// dólar nunca fue el precio: era una traducción para mostrar, y guardar la
// traducción en vez del hecho es lo que hacía que el margen se corriera solo.

import { jest } from "@jest/globals";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: mockLogger,
}));

const mockOverride = jest.fn();

jest.unstable_mockModule("../services/ai/platformAiSettingService.js", () => ({
  getPlatformAiOverride: mockOverride,
  PLATFORM_AI_SETTINGS: {
    MONTHLY_TOKEN_BUDGET: "monthlyTokenBudget",
    PER_TENANT_SHARE: "perTenantShare",
    PLAN_PRICE_STARTER: "planPriceStarterArs",
    PLAN_PRICE_PRO: "planPriceProArs",
  },
}));

const {
  getPlanMonthlyPriceArs,
  getPlanPriceSource,
  getPlanCatalog,
  getUsdToArsRate,
} = await import("../services/ai/aiPlanPolicy.js");

const CLAVES = [
  "PLAN_PRICE_ARS_STARTER",
  "PLAN_PRICE_ARS_PRO",
  "USD_ARS_RATE",
];

beforeEach(() => {
  jest.clearAllMocks();
  mockOverride.mockReturnValue(null);
  for (const clave of CLAVES) delete process.env[clave];
});

afterAll(() => {
  for (const clave of CLAVES) delete process.env[clave];
});

describe("precio de plan · en pesos y sin conversión", () => {
  test("el starter vale lo que se decidió: 40.000 pesos", () => {
    expect(getPlanMonthlyPriceArs("starter")).toBe(40000);
  });

  test("el pro también está en pesos", () => {
    // 151.470 es exactamente lo que valían los 99 USD anteriores al cambio que
    // el propio código usaba. No es una decisión de precio nueva: es el
    // equivalente arrastrado para no inventar uno.
    expect(getPlanMonthlyPriceArs("pro")).toBe(151470);
  });

  test("free es cero y enterprise es null, no cero", () => {
    // Un 0 en enterprise se leería como margen cero en cualquier reporte; null
    // dice "precio a medida", que es la verdad.
    expect(getPlanMonthlyPriceArs("free")).toBe(0);
    expect(getPlanMonthlyPriceArs("enterprise")).toBeNull();
  });

  test("no existe ninguna función que devuelva un precio en dólares", async () => {
    const policy = await import("../services/ai/aiPlanPolicy.js");

    expect(policy.getPlanMonthlyPriceUsd).toBeUndefined();
  });

  test("mover el tipo de cambio NO mueve ningún precio", async () => {
    // Era el comportamiento anterior y el origen del problema: el precio se
    // derivaba del dólar, así que cambiaba solo.
    const antes = getPlanMonthlyPriceArs("starter");

    process.env.USD_ARS_RATE = "3000";

    expect(getPlanMonthlyPriceArs("starter")).toBe(antes);
  });
});

describe("precio de plan · quién manda", () => {
  test("el panel gana sobre todo lo demás", () => {
    process.env.PLAN_PRICE_ARS_STARTER = "45000";
    mockOverride.mockImplementation(setting =>
      setting === "planPriceStarterArs" ? 52000 : null,
    );

    expect(getPlanMonthlyPriceArs("starter")).toBe(52000);
    expect(getPlanPriceSource("starter")).toBe("panel");
  });

  test("sin panel, manda la variable de entorno", () => {
    process.env.PLAN_PRICE_ARS_STARTER = "45000";

    expect(getPlanMonthlyPriceArs("starter")).toBe(45000);
    expect(getPlanPriceSource("starter")).toBe("env");
  });

  test("sin nada, el default, y se puede distinguir", () => {
    // Importa poder decir "esto lo decidió alguien" de "esto quedó así".
    expect(getPlanPriceSource("starter")).toBe("default");
  });

  test("un override de cero se respeta: un plan puede volverse gratis", () => {
    // Con `|| null` en vez de una comprobación explícita, un 0 caería al default
    // y el plan seguiría cobrando.
    mockOverride.mockImplementation(setting =>
      setting === "planPriceProArs" ? 0 : null,
    );

    expect(getPlanMonthlyPriceArs("pro")).toBe(0);
  });
});

describe("catálogo de planes", () => {
  test("trae los cuatro planes, en pesos, con su procedencia", () => {
    const catalogo = getPlanCatalog();

    expect(catalogo.map(p => p.plan)).toEqual([
      "free",
      "starter",
      "pro",
      "enterprise",
    ]);
    expect(catalogo.every(p => p.currency === "ARS")).toBe(true);
    expect(catalogo.find(p => p.plan === "starter").monthlyPriceArs).toBe(40000);
  });

  test("es lo que consume el panel, así que refleja el override", () => {
    mockOverride.mockImplementation(setting =>
      setting === "planPriceStarterArs" ? 52000 : null,
    );

    const starter = getPlanCatalog().find(p => p.plan === "starter");

    expect(starter.monthlyPriceArs).toBe(52000);
    expect(starter.source).toBe("panel");
  });
});

describe("tipo de cambio · solo para costos", () => {
  test("existe, porque los costos sí llegan en dólares", () => {
    // Google, Replicate, SendGrid y Meta facturan en USD. El reporte de margen
    // resta costos a ingresos y necesita una sola unidad.
    expect(getUsdToArsRate()).toBe(1530);
  });

  test("se puede corregir por entorno", () => {
    process.env.USD_ARS_RATE = "1800";

    expect(getUsdToArsRate()).toBe(1800);
  });
});
