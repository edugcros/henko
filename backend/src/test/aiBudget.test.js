import { jest } from "@jest/globals";

// Clave válida de 32 bytes: el modelo Tenant importa secretCryptoService al
// cargarse y getKey() la exige aunque estos tests no cifren nada.
process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
  "base64url",
);

const {
  AI_METRICS,
  UNLIMITED,
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

  test("el tope de tokens alcanza para los mensajes que promete el plan", () => {
    // Medido: 2.617 tokens para el mensaje más barato posible (catálogo
    // vacío, un saludo). Si el tope de tokens no cubre mensajes x ese piso,
    // el panel promete una cantidad de mensajes que el medidor no entrega.
    const PISO_TOKENS_POR_MENSAJE = 2617;

    for (const plan of ["free", "starter", "pro"]) {
      const mensajes = getPlanLimit(plan, AI_METRICS.AGENT_MESSAGES);
      const tokens = getPlanLimit(plan, AI_METRICS.AGENT_TOKENS);

      expect(tokens).toBeGreaterThanOrEqual(mensajes * PISO_TOKENS_POR_MENSAJE);
    }
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

  test("por defecto el corte está APAGADO", () => {
    // userCtrl da de alta con trialEndsAt a 14 días y nada en el backend pasa
    // nunca subscriptionStatus a 'active': no hay facturación todavía. Con el
    // corte encendido por defecto, todo comercio nuevo perdía la IA a los 14
    // días sin forma de recuperarla. Se enciende cuando exista cobranza.
    restoreEnv("AI_ENFORCE_SUBSCRIPTION", undefined);

    const vencido = getSubscriptionState({
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    const cancelado = getSubscriptionState({ subscriptionStatus: "cancelled" });

    expect(vencido.entitled).toBe(true);
    expect(cancelado.entitled).toBe(true);
  });

  test("un trial vencido pierde el derecho a la IA", () => {
    setEnv("AI_ENFORCE_SUBSCRIPTION", "true");

    const state = getSubscriptionState({
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    expect(state.entitled).toBe(false);
    expect(state.reason).toBe("trial_expired");
  });

  test("una suscripción cancelada corta la IA", () => {
    setEnv("AI_ENFORCE_SUBSCRIPTION", "true");

    const state = getSubscriptionState({ subscriptionStatus: "cancelled" });

    expect(state.entitled).toBe(false);
  });

  test("en mora se respeta el período de gracia y después corta", () => {
    setEnv("AI_ENFORCE_SUBSCRIPTION", "true");
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
    setEnv("AI_ENFORCE_SUBSCRIPTION", "true");
    restoreEnv("AI_SUBSCRIPTION_GRACE_DAYS", undefined);

    const state = getSubscriptionState({
      subscriptionStatus: "past_due",
      subscriptionPastDueAt: new Date(Date.now() - 60 * 1000),
    });

    expect(state.entitled).toBe(true);
  });
});

// La cobertura de costeo se mudó a aiModelPricing.test.js junto con la
// función: acá probaba la tarifa mezclada única que el catálogo reemplazó.

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

const mockLedger = { create: jest.fn() };

jest.unstable_mockModule("../models/aiConsumptionLedgerModel.js", () => ({
  default: mockLedger,
  LEDGER_EVENT: {
    RESERVED: "reserved",
    CONSUMED: "consumed",
    REFUNDED: "refunded",
  },
}));

jest.unstable_mockModule("../services/ai/aiCredentialsService.js", () => ({
  KEY_SOURCE: { TENANT: "tenant", PLATFORM: "platform", NONE: "none" },
  loadTenantAiProfile: mockProfile,
}));

// El desglose del aviso hace un aggregate real sobre el ledger. Acá interesa
// que el aviso se emita una sola vez y con los datos correctos, no que Mongo
// sepa agrupar.
const mockSpendByMetric = jest.fn();

jest.unstable_mockModule("../services/ai/aiSpendReportService.js", () => ({
  getPeriodSpendByMetric: mockSpendByMetric,
  getPeriodSpendByModel: jest.fn(),
}));

// El aviso de presupuesto ES una línea de log: si no se puede afirmar qué se
// logueó y con qué nivel, no se está probando la funcionalidad.
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: mockLogger,
}));

// El cache del disyuntor es un Map de módulo con TTL de 30 s. Sin aislarlo,
// el resultado de un test sobrevive al siguiente y la suite pasa o falla
// según el orden en que corran.
const cacheStore = new Map();

jest.unstable_mockModule("../utils/cache.js", () => ({
  cacheGet: async key => (cacheStore.has(key) ? cacheStore.get(key) : null),
  cacheSet: async (key, value) => {
    cacheStore.set(key, value);
    return true;
  },
  cacheDel: async key => {
    cacheStore.delete(key);
    return true;
  },
}));

const {
  reserveAiBudget,
  refundAiBudget,
  recordAiConsumption,
  recordTokenSpend,
  DENY_REASONS,
} = await import("../services/ai/aiBudgetService.js");

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
    mockLedger.create.mockResolvedValue({});
    cacheStore.clear();
    delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;
    delete process.env.AI_PLATFORM_PER_TENANT_SHARE;
    delete process.env.AI_ENFORCE_SUBSCRIPTION;
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
    process.env.AI_ENFORCE_SUBSCRIPTION = "true";

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

  test("un tenant ilimitado sobre la key compartida NO es realmente ilimitado", async () => {
    // Un enterprise sin key propia podía consumir el presupuesto entero y
    // hacer saltar el disyuntor, que corta para todos los que comparten esa
    // key: el grande no perdía nada y los chicos se quedaban sin asistente.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";
    process.env.AI_PLATFORM_PER_TENANT_SHARE = "0.5";

    mockProfile.mockResolvedValue(
      platformProfile({ plan: "enterprise", keySource: "platform" }),
    );
    mockPlatformUsage.findOne.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentTokens: 10 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
    });

    expect(result.allowed).toBe(true);
    expect(result.unlimited).toBe(false);
    expect(result.limit).toBe(10_000_000);

    delete process.env.AI_PLATFORM_PER_TENANT_SHARE;
  });

  test("visión sobre la key compartida deja de ser ilimitada", async () => {
    // Era el único gasto sin techo por tenant: se mide en unidades, así que
    // quedaba fuera de la regla de los tokens. Y desde que visión reporta sus
    // tokens, esos tokens pegan contra el disyuntor — un solo enterprise podía
    // llevarse el presupuesto entero y dejar sin IA a todos los demás.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";
    process.env.AI_PLATFORM_PER_TENANT_SHARE = "0.5";
    process.env.AI_VISION_TOKENS_PER_CALL = "5000";

    mockProfile.mockResolvedValue(
      platformProfile({ plan: "enterprise", keySource: "platform" }),
    );
    mockPlatformUsage.findOne.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 3 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
    });

    expect(result.allowed).toBe(true);
    expect(result.unlimited).toBe(false);
    // La misma mitad del presupuesto, expresada en análisis: 10M / 5.000.
    expect(result.limit).toBe(2000);

    delete process.env.AI_PLATFORM_PER_TENANT_SHARE;
    delete process.env.AI_VISION_TOKENS_PER_CALL;
  });

  test("con key propia la visión sigue siendo ilimitada de verdad", async () => {
    // El techo existe porque el gasto es de otro. Si el comercio paga su
    // propia key, no hay presupuesto de plataforma que racionar.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";

    mockProfile.mockResolvedValue(
      platformProfile({ plan: "enterprise", keySource: "tenant" }),
    );
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
    });

    expect(result.allowed).toBe(true);
    expect(result.unlimited).toBe(true);
  });

  test("el techo derivado no pisa la cuota finita de visión de un plan", async () => {
    // 50 análisis para un free es una decisión de producto, no un accidente:
    // el techo derivado solo aparece donde el plan dice "ilimitado".
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";

    mockProfile.mockResolvedValue(platformProfile({ plan: "free" }));
    mockPlatformUsage.findOne.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
    });

    expect(result.limit).toBe(50);
  });

  test("las ediciones de imagen quedan afuera a propósito", async () => {
    // Se pagan por imagen a otro proveedor y no consumen tokens: derivarles un
    // techo de un presupuesto medido en tokens no significaría nada.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";

    mockProfile.mockResolvedValue(
      platformProfile({ plan: "enterprise", keySource: "platform" }),
    );
    mockPlatformUsage.findOne.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
    });

    expect(result.unlimited).toBe(true);
  });

  test("el techo por tenant también aplica a los tokens de mercado", async () => {
    // Regresión: getSharedKeyTenantCap declaraba las dos métricas en un array
    // y después dejaba viva la guarda vieja que comparaba solo contra
    // AGENT_TOKENS, así que market intelligence pasaba de largo sin techo.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";
    process.env.AI_PLATFORM_PER_TENANT_SHARE = "0.5";

    mockProfile.mockResolvedValue(
      platformProfile({ plan: "enterprise", keySource: "platform" }),
    );
    mockPlatformUsage.findOne.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { marketTokens: 10 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.MARKET_TOKENS,
    });

    expect(result.allowed).toBe(true);
    expect(result.unlimited).toBe(false);
    expect(result.limit).toBe(10_000_000);

    delete process.env.AI_PLATFORM_PER_TENANT_SHARE;
  });

  test("con key propia sí es ilimitado de verdad", async () => {
    // El techo por tenant existe porque el gasto es de otro. Cuando el
    // comercio paga el suyo, no hay nada que racionar.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";

    mockProfile.mockResolvedValue(
      platformProfile({ plan: "enterprise", keySource: "tenant" }),
    );
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
    });

    expect(result.allowed).toBe(true);
    expect(result.unlimited).toBe(true);
  });

  test("sin disyuntor configurado no hay fracción que aplicar", async () => {
    delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;

    mockProfile.mockResolvedValue(
      platformProfile({ plan: "enterprise", keySource: "platform" }),
    );
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentTokens: 1 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
    });

    expect(result.allowed).toBe(true);
    expect(result.unlimited).toBe(true);
  });

  test("el techo compartido no toca los topes finitos de un plan", async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "20000000";

    mockProfile.mockResolvedValue(platformProfile({ plan: "free" }));
    mockPlatformUsage.findOne.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentTokens: 5 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
    });

    expect(result.limit).toBe(getPlanLimit("free", AI_METRICS.AGENT_TOKENS));
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

// ─── Reembolso ───────────────────────────────────────────
//
// "Reservar antes de gastar, devolver si el proveedor falló" es una de las
// cuatro reglas de diseño de AI_COST_CONTAINMENT.md, se usa en cuatro caminos
// de producción (visión, editor de imágenes, agente, promociones) y no tenía
// una sola prueba. Una caída de Google no la paga el comercio.

describe("aiBudgetService · reembolso", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLedger.create.mockResolvedValue({});
    cacheStore.clear();
  });

  test("devuelve la reserva descontando del contador de la métrica", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await refundAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    const [filtro, update] = mockAiUsage.findOneAndUpdate.mock.calls[0];

    expect(filtro.tenantId).toBe(TENANT_ID);
    expect(update.$inc["counters.agentMessages"]).toBe(-1);
  });

  test("en visión también devuelve analysisCount, que es lo que lee el panel", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await refundAiBudget({ tenantId: TENANT_ID, metric: AI_METRICS.VISION });

    const [, update] = mockAiUsage.findOneAndUpdate.mock.calls[0];

    expect(update.$inc["counters.vision"]).toBe(-1);
    expect(update.$inc.analysisCount).toBe(-1);
  });

  test("no puede dejar el contador en negativo", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable(null));

    await refundAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      amount: 3,
    });

    const [filtro] = mockAiUsage.findOneAndUpdate.mock.calls[0];

    // El $gte en el filtro es lo que impide devolver más de lo reservado: si
    // el contador no llega, el documento no matchea y no se decrementa nada.
    expect(filtro["counters.vision"]).toEqual({ $gte: 3 });
  });

  test("devuelve la cantidad pedida, no siempre uno", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await refundAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: 2500,
    });

    const [, update] = mockAiUsage.findOneAndUpdate.mock.calls[0];

    expect(update.$inc["counters.agentTokens"]).toBe(-2500);
  });

  test("con métrica inválida o sin tenant no toca la base", async () => {
    await refundAiBudget({ tenantId: TENANT_ID, metric: "inventada" });
    await refundAiBudget({ tenantId: "", metric: AI_METRICS.VISION });

    expect(mockAiUsage.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("si la base falla, el reembolso no propaga el error", async () => {
    // El reembolso corre dentro del catch del fallo del proveedor. Si lanzara,
    // taparía el error original de Gemini con uno de Mongo.
    mockAiUsage.findOneAndUpdate.mockImplementation(() => {
      throw new Error("mongo caído");
    });

    await expect(
      refundAiBudget({ tenantId: TENANT_ID, metric: AI_METRICS.VISION }),
    ).resolves.toBeUndefined();
  });
});

// ─── Ledger ──────────────────────────────────────────────
//
// AiUsage responde "¿cuánto le queda?". El ledger responde "¿cuánto costó,
// con qué modelo y cuándo?". Lo que se prueba acá es que ninguna operación de
// presupuesto pase sin dejar rastro, y que un fallo del libro no tumbe una
// operación que salió bien.

describe("aiBudgetService · ledger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLedger.create.mockResolvedValue({});
    cacheStore.clear();
    delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;
    delete process.env.AI_ENFORCE_SUBSCRIPTION;
  });

  const entry = () => mockLedger.create.mock.calls[0][0];

  test("una reserva concedida deja su rastro", async () => {
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );

    await reserveAiBudget({ tenantId: TENANT_ID, metric: AI_METRICS.VISION });

    expect(entry().event).toBe("reserved");
    expect(entry().metric).toBe("vision");
    expect(entry().plan).toBe("free");
  });

  test("una reserva denegada no deja rastro: no hubo movimiento", async () => {
    mockProfile.mockResolvedValue(platformProfile({ keySource: "none", apiKey: "" }));

    await reserveAiBudget({ tenantId: TENANT_ID, metric: AI_METRICS.VISION });

    expect(mockLedger.create).not.toHaveBeenCalled();
  });

  test("el consumo guarda costo, modelo y el precio del momento", async () => {
    // Congelar el precio es el punto: los modelos 3.x duplican tarifa el
    // 1/1/2027, y sin esto una operación vieja cambiaría de costo sola.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 1000 }),
    });

    await recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: 10000,
      model: "gemini-3.6-flash",
    });

    const row = entry();

    expect(row.event).toBe("consumed");
    expect(row.model).toBe("gemini-3.6-flash");
    expect(row.priceInputPerMillion).toBe(0.75);
    expect(row.priceOutputPerMillion).toBe(3.75);
    expect(row.costUsd).toBeGreaterThan(0);
    // 8000 entrada + 2000 salida con la proporción asumida.
    expect(row.inputTokens + row.outputTokens).toBe(10000);
    // El reparto se supuso a partir del total: queda declarado.
    expect(row.costEstimated).toBe(true);
  });

  test("si el llamador mide entrada y salida, el costo NO se reparte", async () => {
    // usageMetadata trae promptTokenCount y candidatesTokenCount. Descartarlos
    // y repartir 80/20 teniendo el dato al lado es inventar un número.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 1000 }),
    });

    await recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: 5000,
      model: "gemini-3.6-flash",
      inputTokens: 4500,
      outputTokens: 500,
    });

    const row = entry();

    expect(row.costEstimated).toBe(false);
    expect(row.inputTokens).toBe(4500);
    expect(row.outputTokens).toBe(500);
    // 4500 × 0,75/1M + 500 × 3,75/1M — bastante menos que el reparto 80/20.
    expect(row.costUsd).toBeCloseTo(0.005250, 6);
  });

  test("el modelo se guarda en forma canónica", async () => {
    // El nombre viaja al catálogo y al ledger. Con dos criterios distintos,
    // 'models/Gemini-3.6-Flash' y 'gemini-3.6-flash' quedan como dos gastos
    // separados en el reporte por modelo.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 1000 }),
    });

    await recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: 5000,
      model: "models/Gemini-3.6-Flash",
    });

    expect(entry().model).toBe("gemini-3.6-flash");
    // Y se cobra a la tarifa correcta, no a la conservadora de desconocido.
    expect(entry().priceInputPerMillion).toBe(0.75);
  });

  test("un modelo de respaldo se cobra a SU tarifa, no a la del configurado", async () => {
    // Es la razón de que el modelo se pase: la cadena de respaldo cruza
    // tarifas que difieren hasta 5x, y un costo con el modelo equivocado sale
    // plausible y no se nota en ningún lado.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 1000 }),
    });

    await recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: 10000,
      model: "gemini-3.1-flash-lite",
    });

    expect(entry().priceInputPerMillion).toBe(0.25);
    expect(entry().priceOutputPerMillion).toBe(1.5);
  });

  test("un consumo BYOK se registra con costo cero: no lo paga HENKO", async () => {
    mockProfile.mockResolvedValue(platformProfile({ keySource: "tenant" }));
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: 10000,
    });

    expect(entry().costUsd).toBe(0);
    expect(entry().keySource).toBe("tenant");
  });

  test("los tokens de análisis de mercado también cuestan", async () => {
    // Regresión: isTokenMetric comparaba solo contra AGENT_TOKENS, así que el
    // consumo de market intelligence no sumaba costo ni llegaba al disyuntor
    // de plataforma — el techo duro de gasto no veía esa vía entera.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 1000 }),
    });

    await recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.MARKET_TOKENS,
      amount: 10000,
    });

    expect(entry().costUsd).toBeGreaterThan(0);
    // Y llega al contador de plataforma, que es lo que alimenta el disyuntor.
    expect(mockPlatformUsage.findOneAndUpdate).toHaveBeenCalled();
  });

  test("un reembolso que no descontó nada no se anota", async () => {
    // El filtro lleva un $gte que puede no matchear. Anotar igual metería una
    // devolución que nunca pasó, y el gasto real se calcula restando refunded.
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable(null));

    await refundAiBudget({ tenantId: TENANT_ID, metric: AI_METRICS.VISION });

    expect(mockLedger.create).not.toHaveBeenCalled();
  });

  test("un reembolso efectivo sí se anota", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({ counters: {} }));

    await refundAiBudget({ tenantId: TENANT_ID, metric: AI_METRICS.VISION });

    expect(entry().event).toBe("refunded");
  });

  test("si el ledger falla, la operación sigue adelante", async () => {
    // El libro registra lo que YA pasó: su fallo no puede tumbar una operación
    // que salió bien.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );
    mockLedger.create.mockRejectedValue(new Error("mongo caído"));

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
    });

    expect(result.allowed).toBe(true);
  });
});

// ─── Gasto de tokens de operaciones por unidad ────────────
//
// Visión se le cobra al comercio como una unidad, pero los tokens que gasta le
// cuestan plata a HENKO igual. Nadie los contaba: el disyuntor, que es el único
// techo duro de la factura, no veía la operación más cara por llamada.

describe("aiBudgetService · recordTokenSpend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLedger.create.mockResolvedValue({});
    cacheStore.clear();
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 5000 }),
    });
    delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;
  });

  const entry = () => mockLedger.create.mock.calls[0][0];

  test("los tokens de visión llegan al disyuntor de plataforma", async () => {
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await recordTokenSpend({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      model: "gemini-3.6-flash",
      inputTokens: 3900,
      outputTokens: 1000,
    });

    expect(mockPlatformUsage.findOneAndUpdate).toHaveBeenCalled();

    const [, update] = mockPlatformUsage.findOneAndUpdate.mock.calls[0];
    expect(update.$inc.tokens).toBe(4900);
    expect(update.$inc.estimatedCostUsd).toBeGreaterThan(0);
  });

  test("NO toca el contador de cuota del tenant", async () => {
    // Su unidad ya se descontó en la reserva. Sumarle 4.900 a un contador que
    // cuenta análisis agotaría un plan de 50 en el primero.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await recordTokenSpend({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      inputTokens: 3900,
      outputTokens: 1000,
    });

    const [, update] = mockAiUsage.findOneAndUpdate.mock.calls[0];

    expect(update.$inc.estimatedCostUsd).toBeGreaterThan(0);
    expect(Object.keys(update.$inc)).toEqual(["estimatedCostUsd"]);
  });

  test("con el desglose medido el costo NO es estimado", async () => {
    // Es el único lugar del sistema donde tenemos usageMetadata real, así que
    // el costo de visión es exacto y no un reparto 80/20.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await recordTokenSpend({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      model: "gemini-3.6-flash",
      inputTokens: 3900,
      outputTokens: 1000,
      totalTokens: 4900,
    });

    const row = entry();

    expect(row.costEstimated).toBe(false);
    expect(row.unit).toBe("tokens");
    expect(row.inputTokens).toBe(3900);
    expect(row.outputTokens).toBe(1000);
    // 3900 × 0,75/1M + 1000 × 3,75/1M
    expect(row.costUsd).toBeCloseTo(0.006675, 6);
  });

  test("registra el modelo de respaldo, que puede tener otra tarifa", async () => {
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await recordTokenSpend({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      model: "gemini-3.1-flash-lite",
      inputTokens: 3900,
      outputTokens: 1000,
    });

    expect(entry().model).toBe("gemini-3.1-flash-lite");
    expect(entry().priceInputPerMillion).toBe(0.25);
  });

  test("con key propia no toca el disyuntor: no es la factura de HENKO", async () => {
    mockProfile.mockResolvedValue(platformProfile({ keySource: "tenant" }));
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));

    await recordTokenSpend({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      inputTokens: 3900,
      outputTokens: 1000,
    });

    expect(mockPlatformUsage.findOneAndUpdate).not.toHaveBeenCalled();
    // Pero sí queda registrado, para que su panel lo vea.
    expect(entry().costUsd).toBe(0);
    expect(entry().unit).toBe("tokens");
  });

  test("sin tokens no se registra nada", async () => {
    mockProfile.mockResolvedValue(platformProfile());

    await recordTokenSpend({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      totalTokens: 0,
    });

    expect(mockLedger.create).not.toHaveBeenCalled();
    expect(mockPlatformUsage.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ─── Aviso anticipado de presupuesto ─────────────────────
//
// El disyuntor avisaba recién al cortar, o sea cuando el asistente ya dejó de
// contestar para todos los que comparten la key. Estos avisos existen para que
// haya margen de reacción antes de eso.

describe("aiBudgetService · aviso de presupuesto", () => {
  // El $inc devuelve el estado del período; el segundo findOneAndUpdate es el
  // que reclama el escalón. Se encadenan con mockReturnValueOnce en ese orden.
  const platformState = ({ tokens, alertedThreshold = 0, costUsd = 0 }) => {
    mockPlatformUsage.findOneAndUpdate
      .mockReturnValueOnce({
        lean: () =>
          Promise.resolve({
            tokens,
            alertedThreshold,
            estimatedCostUsd: costUsd,
            breakerTrippedAt: null,
          }),
      })
      .mockReturnValueOnce({
        // El reclamo del escalón: null = otro proceso llegó primero.
        lean: () => Promise.resolve({ period: "2026-09" }),
      });
  };

  const consume = tokens =>
    recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: tokens,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks NO vacía las colas de mockReturnValueOnce. Los tests que no
    // llegan a reclamar el escalón consumen un solo valor de los dos que encola
    // platformState, y el sobrante se lo comía el test siguiente: pasaban de a
    // uno y fallaban en conjunto. mockReset sí las vacía.
    mockPlatformUsage.findOneAndUpdate.mockReset();
    mockPlatformUsage.findOne.mockReset();
    mockLedger.create.mockResolvedValue({});
    mockSpendByMetric.mockResolvedValue([]);
    cacheStore.clear();
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "1000";
  });

  afterEach(() => {
    delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;
  });

  test("por debajo del primer escalón no avisa nada", async () => {
    platformState({ tokens: 400 });

    await consume(100);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  test("al 50% avisa como advertencia", async () => {
    platformState({ tokens: 520 });

    await consume(100);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("50%"),
      expect.objectContaining({ tokens: 520, budget: 1000 }),
    );
  });

  test("al 80% sube a error: ya queda poco margen", async () => {
    platformState({ tokens: 850 });

    await consume(100);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("80%"),
      expect.anything(),
    );
  });

  test("un salto grande anuncia el 80 y no el 50 que quedó viejo", async () => {
    platformState({ tokens: 900, alertedThreshold: 0 });

    await consume(900);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("80%"),
      expect.anything(),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test("un escalón ya anunciado no se repite", async () => {
    // Sin esto, cada request del resto del mes escribiría la misma línea, y un
    // aviso que aparece diez mil veces deja de ser un aviso.
    platformState({ tokens: 600, alertedThreshold: 50 });

    await consume(100);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    // Y ni siquiera intenta reclamarlo: la salida barata evita ir a la base.
    expect(mockPlatformUsage.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test("si otro proceso ya reclamó el escalón, este no duplica el aviso", async () => {
    mockPlatformUsage.findOneAndUpdate
      .mockReturnValueOnce({
        lean: () =>
          Promise.resolve({ tokens: 520, alertedThreshold: 0, breakerTrippedAt: null }),
      })
      .mockReturnValueOnce({
        // El filtro condicionado no matcheó: otra instancia ganó la carrera.
        lean: () => Promise.resolve(null),
      });

    await consume(100);

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test("el aviso trae el desglose de qué se lo está comiendo", async () => {
    // Un aviso que dice "vas por el 80%" abre una investigación; uno que dice
    // además "el 70% es visión" ya trae la respuesta.
    mockSpendByMetric.mockResolvedValue([
      { metric: "vision", costUsd: 18.4, tokens: 2_400_000, operations: 500 },
      { metric: "agentTokens", costUsd: 3.1, tokens: 900_000, operations: 1200 },
    ]);
    platformState({ tokens: 850 });

    await consume(100);

    const [, payload] = mockLogger.error.mock.calls[0];

    expect(payload.topSpend[0].metric).toBe("vision");
    expect(payload.topSpend[0].costUsd).toBe(18.4);
  });

  test("si el desglose falla, el aviso sale igual", async () => {
    // El número solo vale más que ningún aviso.
    mockSpendByMetric.mockRejectedValue(new Error("mongo caído"));
    platformState({ tokens: 850 });

    await consume(100);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("80%"),
      expect.objectContaining({ topSpend: [] }),
    );
  });

  test("sin disyuntor configurado no hay porcentaje que avisar", async () => {
    delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;
    platformState({ tokens: 999_999 });

    await consume(100);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
