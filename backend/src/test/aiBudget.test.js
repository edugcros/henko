import { jest } from "@jest/globals";

// Clave válida de 32 bytes: el modelo Tenant importa secretCryptoService al
// cargarse y getKey() la exige aunque estos tests no cifren nada.
process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
  "base64url",
);

const {
  AI_METRICS,
  UNLIMITED,
  estimateCostUsd,
  getPlanLimit,
  getSubscriptionState,
  isByokAllowedForPlan,
  normalizePlan,
} = await import("../services/ai/aiPlanPolicy.js");

const restoreEnv = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

describe("aiPlanPolicy · topes por plan", () => {
  const originals = {};

  const setEnv = (name, value) => {
    if (!(name in originals)) originals[name] = process.env[name];
    process.env[name] = value;
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(originals)) {
      restoreEnv(name, value);
      delete originals[name];
    }
  });

  test("un plan free NO tiene el mismo derecho a gastar que uno enterprise", () => {
    // Esta era exactamente la falla: la cuota del agente salía del default del
    // schema, así que ambos planes valían 3000 mensajes contra la key propia.
    const free = getPlanLimit("free", AI_METRICS.AGENT_MESSAGES);
    const enterprise = getPlanLimit("enterprise", AI_METRICS.AGENT_MESSAGES);

    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(3000);
    expect(enterprise).toBe(UNLIMITED);
  });

  test("los topes crecen de forma monótona con el plan", () => {
    for (const metric of Object.values(AI_METRICS)) {
      const free = getPlanLimit("free", metric);
      const starter = getPlanLimit("starter", metric);
      const pro = getPlanLimit("pro", metric);

      expect(starter).toBeGreaterThan(free);
      expect(pro).toBeGreaterThan(starter);
    }
  });

  test("un plan desconocido cae a free y no a ilimitado", () => {
    expect(normalizePlan("platinum-deluxe")).toBe("free");
    expect(getPlanLimit(undefined, AI_METRICS.AGENT_MESSAGES)).toBe(
      getPlanLimit("free", AI_METRICS.AGENT_MESSAGES),
    );
  });

  test("respeta las variables de entorno viejas de la cuota de visión", () => {
    // Si el deploy actual las tiene puestas, el refactor no le puede cambiar
    // los límites a nadie por la ventana.
    setEnv("AI_MONTHLY_LIMIT_FREE", "17");
    expect(getPlanLimit("free", AI_METRICS.VISION)).toBe(17);
  });

  test("la variable nueva le gana a la vieja", () => {
    setEnv("AI_MONTHLY_LIMIT_FREE", "17");
    setEnv("AI_LIMIT_FREE_VISION", "42");
    expect(getPlanLimit("free", AI_METRICS.VISION)).toBe(42);
  });

  test("BYOK no está disponible en los planes bajos por defecto", () => {
    expect(isByokAllowedForPlan("free")).toBe(false);
    expect(isByokAllowedForPlan("pro")).toBe(true);
  });
});

describe("aiPlanPolicy · suscripción", () => {
  const originals = {};

  const setEnv = (name, value) => {
    if (!(name in originals)) originals[name] = process.env[name];
    process.env[name] = value;
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(originals)) {
      restoreEnv(name, value);
      delete originals[name];
    }
  });

  test("un trial sin fecha de vencimiento sigue habilitado", () => {
    // Todos los tenants de producción están así hoy (nadie mantuvo el campo):
    // activar el corte no le puede cortar el servicio a nadie de golpe.
    const state = getSubscriptionState({
      subscriptionStatus: "trialing",
      trialEndsAt: null,
    });

    expect(state.entitled).toBe(true);
  });

  test("un trial vencido pierde el derecho a la IA", () => {
    const state = getSubscriptionState({
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    expect(state.entitled).toBe(false);
    expect(state.reason).toBe("trial_expired");
  });

  test("una suscripción cancelada corta la IA", () => {
    const state = getSubscriptionState({ subscriptionStatus: "cancelled" });

    expect(state.entitled).toBe(false);
  });

  test("en mora se respeta el período de gracia y después corta", () => {
    setEnv("AI_SUBSCRIPTION_GRACE_DAYS", "7");

    const dentro = getSubscriptionState({
      subscriptionStatus: "past_due",
      subscriptionPastDueAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    const fuera = getSubscriptionState({
      subscriptionStatus: "past_due",
      subscriptionPastDueAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    expect(dentro.entitled).toBe(true);
    expect(fuera.entitled).toBe(false);
  });

  test("se puede desactivar el corte por entorno", () => {
    setEnv("AI_ENFORCE_SUBSCRIPTION", "false");

    const state = getSubscriptionState({ subscriptionStatus: "cancelled" });

    expect(state.entitled).toBe(true);
  });

  test("sin AI_SUBSCRIPTION_GRACE_DAYS la gracia por defecto NO es cero", () => {
    // Number('') es 0, así que leer la variable sin definir daba 0 días de
    // gracia: una mora de un minuto cortaba la IA al instante.
    restoreEnv("AI_SUBSCRIPTION_GRACE_DAYS", undefined);

    const state = getSubscriptionState({
      subscriptionStatus: "past_due",
      subscriptionPastDueAt: new Date(Date.now() - 60 * 1000),
    });

    expect(state.entitled).toBe(true);
  });
});

describe("aiPlanPolicy · costo estimado", () => {
  test("convierte tokens a dólares y no devuelve negativos", () => {
    expect(estimateCostUsd(0)).toBe(0);
    expect(estimateCostUsd(-100)).toBe(0);
    expect(estimateCostUsd("no es un número")).toBe(0);
    expect(estimateCostUsd(1_000_000)).toBeGreaterThan(0);
  });
});

// ─── Medidor ─────────────────────────────────────────────
//
// El medidor toca Mongo, así que se mockean los modelos: lo que interesa
// verificar acá es la lógica de decisión (a quién se le cobra, a quién se le
// dice que no y por qué), no que Mongoose sepa incrementar un número.

const mockAiUsage = {
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
};

const mockPlatformUsage = {
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
};

const mockProfile = jest.fn();

jest.unstable_mockModule("../models/aiUsageModel.js", () => ({
  default: mockAiUsage,
}));

jest.unstable_mockModule("../models/aiPlatformUsageModel.js", () => ({
  default: mockPlatformUsage,
}));

jest.unstable_mockModule("../services/ai/aiCredentialsService.js", () => ({
  KEY_SOURCE: { TENANT: "tenant", PLATFORM: "platform", NONE: "none" },
  loadTenantAiProfile: mockProfile,
}));

const { reserveAiBudget, DENY_REASONS } = await import(
  "../services/ai/aiBudgetService.js"
);

const TENANT_ID = "64b7f0000000000000000001";

// findOneAndUpdate(...).setOptions(...) devuelve la promesa del documento.
const chainable = result => ({
  setOptions: () => Promise.resolve(result),
});

const chainableLean = result => ({
  setOptions: () => ({ lean: () => Promise.resolve(result) }),
});

const platformProfile = (overrides = {}) => ({
  tenantId: TENANT_ID,
  plan: "free",
  subscriptionStatus: "active",
  trialEndsAt: null,
  keySource: "platform",
  apiKey: "AIzaTEST",
  ...overrides,
});

describe("aiBudgetService · reserva", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;
  });

  test("cobra el consumo y devuelve cuánto queda", async () => {
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentMessages: 5 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(5);
    expect(result.remaining).toBe(
      getPlanLimit("free", AI_METRICS.AGENT_MESSAGES) - 5,
    );
  });

  test("no gasta nada si la suscripción no está al día", async () => {
    mockProfile.mockResolvedValue(
      platformProfile({ subscriptionStatus: "cancelled" }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENY_REASONS.SUBSCRIPTION);
    // Lo importante: ni siquiera se tocó el contador.
    expect(mockAiUsage.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("el autolímite del comercio solo puede apretar, nunca aflojar", async () => {
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentMessages: 1 } }),
    );

    // Este era el agujero: el admin del tenant mandaba un tope enorme (o 0,
    // que significaba "ilimitado") desde su propio panel de configuración.
    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
      limitOverride: 999_999,
    });

    expect(result.limit).toBe(getPlanLimit("free", AI_METRICS.AGENT_MESSAGES));
  });

  test("el autolímite hacia abajo sí se respeta", async () => {
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentMessages: 1 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
      limitOverride: 10,
    });

    expect(result.limit).toBe(10);
  });

  test("sin cupo devuelve el motivo correcto y no incrementa", async () => {
    mockProfile.mockResolvedValue(platformProfile());

    const duplicateKeyError = Object.assign(new Error("E11000"), {
      code: 11000,
    });
    mockAiUsage.findOneAndUpdate.mockImplementation(() => ({
      setOptions: () => Promise.reject(duplicateKeyError),
    }));

    const limit = getPlanLimit("free", AI_METRICS.AGENT_MESSAGES);
    mockAiUsage.findOne.mockReturnValue(
      chainableLean({ counters: { agentMessages: limit } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENY_REASONS.METRIC_LIMIT);
  });

  test("un documento viejo sin el contador no bloquea al tenant para siempre", async () => {
    // Los documentos creados antes de este refactor solo tienen analysisCount.
    // Si el E11000 se interpretara siempre como "sin cupo", el comercio
    // quedaría bloqueado en una métrica que nunca usó.
    mockProfile.mockResolvedValue(platformProfile());

    const duplicateKeyError = Object.assign(new Error("E11000"), {
      code: 11000,
    });

    let call = 0;
    mockAiUsage.findOneAndUpdate.mockImplementation(() => ({
      setOptions: () => {
        call += 1;
        if (call === 1) return Promise.reject(duplicateKeyError);
        return Promise.resolve({ counters: { agentMessages: 1 } });
      },
    }));

    mockAiUsage.findOne.mockReturnValue(chainableLean({ analysisCount: 3 }));

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("ok_backfilled");
  });

  test("con key propia del comercio no se aplica el tope del plan", async () => {
    mockProfile.mockResolvedValue(
      platformProfile({ keySource: "tenant", plan: "pro" }),
    );
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    expect(result.allowed).toBe(true);
    expect(result.byok).toBe(true);
    expect(result.unlimited).toBe(true);
  });

  test("el disyuntor global corta aunque al tenant le sobre cupo", async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "1000";

    mockProfile.mockResolvedValue(platformProfile({ plan: "enterprise" }));
    mockPlatformUsage.findOne.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 5000 }),
    });

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENY_REASONS.PLATFORM_BUDGET);
  });

  test("sin ninguna API key configurada no se intenta llamar al proveedor", async () => {
    mockProfile.mockResolvedValue(
      platformProfile({ keySource: "none", apiKey: "" }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENY_REASONS.NO_API_KEY);
  });
});
