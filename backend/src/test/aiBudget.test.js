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
  // El servicio separa "crear el documento del período" e "inicializar el
  // contador" del incremento que reserva: así un filtro de cuota que no
  // matchea no termina en un upsert que crea el documento salteándose el
  // límite. Los dos pasos usan updateOne y ninguno devuelve nada que se lea.
  updateOne: jest.fn(),
};

const mockPlatformUsage = {
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
};

// Los dos `ensure*` no leen el resultado, pero encadenan .setOptions(), así que
// necesitan algo que resuelva. Se define una sola vez: jest.clearAllMocks()
// limpia las llamadas registradas, no las implementaciones.
mockAiUsage.updateOne.mockImplementation(() => ({
  setOptions: () => Promise.resolve({ acknowledged: true }),
}));
mockPlatformUsage.updateOne.mockImplementation(() =>
  Promise.resolve({ acknowledged: true }),
);

const mockProfile = jest.fn();

jest.unstable_mockModule("../models/aiUsageModel.js", () => ({
  default: mockAiUsage,
}));

jest.unstable_mockModule("../models/aiPlatformUsageModel.js", () => ({
  default: mockPlatformUsage,
}));

// El snapshot lee los autolímites que el comercio configuró en su panel, para
// mostrar el MISMO tope que después cobra el medidor.
const mockAiAgent = { findOne: jest.fn() };

jest.unstable_mockModule("../models/aiAgentModel.js", () => ({
  default: mockAiAgent,
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

const mockNotify = jest.fn();

jest.unstable_mockModule("../services/ai/aiBudgetNotifier.js", () => ({
  notifyBudgetPressure: mockNotify,
  EMAIL_THRESHOLD: 80,
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
  getAiBudgetSnapshot,
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

  test("el autolímite del comercio también aprieta la métrica de guarda", async () => {
    // El comercio configura DOS autolímites en su panel: mensajes y tokens. El
    // de tokens se guardaba y no lo leía nadie a la hora de cobrar — un control
    // que se puede tocar y no hace nada es peor que no ofrecerlo, porque el
    // comercio cree que puso un freno.
    mockProfile.mockResolvedValue(platformProfile({ plan: "pro" }));
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable(null));
    mockAiUsage.findOne.mockReturnValue(
      chainableLean({ counters: { agentMessages: 0, agentTokens: 5000 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
      guards: [AI_METRICS.AGENT_TOKENS],
      guardOverrides: { [AI_METRICS.AGENT_TOKENS]: 4000 },
    });

    // Con el tope del plan pro (50M) habría pasado; con el autolímite de 4.000
    // y 5.000 ya gastados, no.
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(DENY_REASONS.GUARD_LIMIT);
    expect(result.limit).toBe(4000);
  });

  test("el autolímite de guarda solo aprieta, nunca afloja", async () => {
    // Misma regla que el de la métrica principal: nadie se amplía la cuota
    // desde su propio panel.
    mockProfile.mockResolvedValue(platformProfile({ plan: "free" }));
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentMessages: 1 } }),
    );

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
      guards: [AI_METRICS.AGENT_TOKENS],
      guardOverrides: { [AI_METRICS.AGENT_TOKENS]: 999_000_000 },
    });

    const [filtro] = mockAiUsage.findOneAndUpdate.mock.calls[0];
    const guarda = filtro.$expr.$and.find(e =>
      JSON.stringify(e).includes("agentTokens"),
    );

    // El tope del plan free, no el número inflado que mandó el comercio.
    expect(JSON.stringify(guarda)).toContain(
      String(getPlanLimit("free", AI_METRICS.AGENT_TOKENS)),
    );
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
    // El rechazo llega como un findOneAndUpdate que no matchea: la condición
    // de cuota vive en el filtro, así que sin cupo simplemente no hay
    // documento que actualizar y devuelve null. Antes esto se detectaba por un
    // E11000, porque la operación llevaba upsert y Mongo chocaba con el índice
    // único; separar la creación del documento del incremento eliminó ese
    // camino, y con él la posibilidad de crear un documento salteándose el
    // límite.
    mockProfile.mockResolvedValue(platformProfile());

    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable(null));

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
    expect(result.used).toBe(limit);
  });

  test("la condición de cuota exige que ENTRE la cantidad pedida, no solo que sobre lugar", async () => {
    // La versión anterior filtraba con { contador: { $lt: limite } }, que solo
    // es correcto reservando de a uno: con amount = N, un contador en
    // limite - 1 pasaba el filtro y terminaba en limite + N - 1. Ahora la
    // condición compara used + amount contra el límite.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentMessages: 3 } }),
    );

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
      amount: 3,
    });

    const [filtro] = mockAiUsage.findOneAndUpdate.mock.calls[0];
    const [comparacion] = filtro.$expr.$and;

    // $lte: [ { $add: [ contador, amount ] }, limite ]
    expect(comparacion.$lte[0].$add[1]).toBe(3);
    expect(comparacion.$lte[1]).toBe(
      getPlanLimit("free", AI_METRICS.AGENT_MESSAGES),
    );
  });

  test("un documento viejo sin el contador no bloquea al tenant para siempre", async () => {
    // Los documentos creados antes del refactor de contadores solo tienen
    // analysisCount. Antes esto se resolvía interpretando un E11000 y
    // reintentando; ahora el contador se inicializa antes de reservar, con un
    // update condicionado a que el campo NO exista, así que la migración es
    // idempotente y no pisa un valor real.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
    });

    expect(result.allowed).toBe(true);

    const inicializacion = mockAiUsage.updateOne.mock.calls.find(
      ([filtro]) => filtro["counters.vision"]?.$exists === false,
    );

    expect(inicializacion).toBeDefined();

    // Y arrastra el valor histórico en vez de arrancar de cero: un comercio
    // que ya gastó 40 análisis no vuelve a tener el cupo entero.
    const [, pipeline] = inicializacion;
    expect(pipeline[0].$set["counters.vision"]).toEqual({
      $ifNull: ["$analysisCount", 0],
    });
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
    // Ahora va como $expr con $ifNull, que además trata un contador ausente
    // como cero en vez de no matchear.
    expect(filtro.$expr.$gte).toEqual([
      { $ifNull: ["$counters.vision", 0] },
      3,
    ]);
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

  test("la reserva devuelve la clave de la operación", async () => {
    // Es lo que permite que el consumo y la devolución usen la MISMA: sin
    // devolverla, cada paso generaría la suya y las tres filas quedarían sin
    // relación entre sí.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
    });

    expect(result.operationId).toEqual(expect.any(String));
    expect(entry().operationId).toBe(result.operationId);
  });

  test("una clave provista por el llamador se respeta", async () => {
    // Los llamadores que pueden derivar una clave estable —el hash de una
    // imagen, el id de un job— la pasan, y esa es la que hace idempotente el
    // reintento. Generar una nueva acá lo rompería.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      operationId: "vision:tenant:hash-abc:2026-09",
    });

    expect(result.operationId).toBe("vision:tenant:hash-abc:2026-09");
    expect(entry().operationId).toBe("vision:tenant:hash-abc:2026-09");
  });

  test("un movimiento repetido se descarta en silencio, no como error", async () => {
    // El índice único de (comercio, operación, evento) rechaza el duplicado con
    // un 11000. Eso NO es un fallo: es la respuesta correcta a un reintento, y
    // la primera fila —la que vale— queda intacta. Loguearlo como error
    // entrenaría a ignorar el log justo donde hay que mirarlo.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );
    mockLedger.create.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 }),
    );

    const result = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.VISION,
      operationId: "repetida",
    });

    expect(result.allowed).toBe(true);
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("repetido"),
      expect.objectContaining({ operationId: "repetida" }),
    );
  });

  test("un fallo real del ledger sí se registra como error", async () => {
    // La contracara: descartar el duplicado no puede volverse un silenciador
    // general. Un libro contable que falla callado es peor que no tenerlo.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { vision: 1 } }),
    );
    mockLedger.create.mockRejectedValue(new Error("mongo caído"));

    await reserveAiBudget({ tenantId: TENANT_ID, metric: AI_METRICS.VISION });

    expect(mockLogger.error).toHaveBeenCalled();
  });

  test("reserva y consumo de una misma operación conviven", async () => {
    // El evento entra en la clave única porque una operación produce
    // legítimamente las dos filas. Lo que no puede haber son dos consumos.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(chainable({}));
    mockAiUsage.updateOne.mockReturnValue({
      setOptions: () => Promise.resolve({}),
    });
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });

    await recordAiConsumption({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: 1000,
      operationId: "misma-operacion",
    });

    await refundAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
      operationId: "misma-operacion",
    });

    const eventos = mockLedger.create.mock.calls.map(([row]) => row.event);
    const claves = mockLedger.create.mock.calls.map(([row]) => row.operationId);

    expect(eventos).toEqual(["consumed", "refunded"]);
    expect(new Set(claves)).toEqual(new Set(["misma-operacion"]));
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

    // El costo se suma con updateOne, después de garantizar el documento del
    // período; lo que importa es que el único $inc sea el del costo.
    const escrituras = mockAiUsage.updateOne.mock.calls.filter(
      ([, update]) => update?.$inc,
    );

    expect(escrituras).toHaveLength(1);

    const [, update] = escrituras[0];

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

  test("la edición de imagen deja fila de consumo en el ledger", async () => {
    // El costo entraba a los contadores y no al ledger. Como el total del panel
    // sale del contador y el desglose sale del ledger, la diferencia entre
    // ambos era exactamente lo gastado en imágenes.
    mockProfile.mockResolvedValue(platformProfile());
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { imageEdits: 3 } }),
    );
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
      amount: 3,
    });

    const row = mockLedger.create.mock.calls[0][0];

    // 'consumed' y no 'reserved': con tarifa plana, reservar y gastar son el
    // mismo acto, y el reporte suma los consumos.
    expect(row.event).toBe("consumed");
    expect(row.metric).toBe("imageEdits");
    expect(row.unit).toBe("units");
    expect(row.amount).toBe(3);
    expect(row.costUsd).toBeGreaterThan(0);
    // No lo cobra Google por token: no hay tarifa del catálogo que congelar.
    expect(row.model).toBeNull();
    expect(row.costEstimated).toBe(true);
  });

  test("con key propia la edición no cuesta nada a la plataforma", async () => {
    mockProfile.mockResolvedValue(platformProfile({ keySource: "tenant" }));

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
      amount: 3,
    });

    // El gasto lo paga el comercio contra su propio proveedor.
    expect(mockPlatformUsage.findOneAndUpdate).not.toHaveBeenCalled();
    const cobros = mockLedger.create.mock.calls.filter(
      ([row]) => Number(row.costUsd) > 0,
    );
    expect(cobros).toHaveLength(0);
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
    mockNotify.mockResolvedValue({ sent: true });
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

  test("el 50% NO manda mail: un aviso mensual normal enseña a ignorarlos", async () => {
    platformState({ tokens: 520 });

    await consume(100);

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("el 80% sí manda mail, con el desglose adentro", async () => {
    mockSpendByMetric.mockResolvedValue([
      { metric: "vision", costUsd: 18.4, tokens: 2_400_000, operations: 500 },
    ]);
    platformState({ tokens: 850, costUsd: 21.5 });

    await consume(100);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: 850,
        budget: 1000,
        estimatedCostUsd: 21.5,
        topSpend: [expect.objectContaining({ metric: "vision" })],
      }),
    );
  });

  test("si el mail falla, el consumo se registra igual", async () => {
    // El aviso es sobre un consumo que YA ocurrió: su fallo no puede voltear la
    // operación que lo disparó.
    mockNotify.mockRejectedValue(new Error("SMTP caído"));
    platformState({ tokens: 850 });

    await expect(consume(100)).resolves.toBeUndefined();
    expect(mockPlatformUsage.findOneAndUpdate).toHaveBeenCalled();
  });

  test("cuando el disyuntor corta, el aviso sale marcado como corte", async () => {
    // Es el único evento que deja sin IA a todos los comercios de la key
    // compartida, y el mail tiene que decir eso y no un porcentaje más.
    mockPlatformUsage.findOneAndUpdate
      .mockReturnValueOnce({
        lean: () =>
          Promise.resolve({
            tokens: 1200,
            alertedThreshold: 80,
            estimatedCostUsd: 30,
            breakerTrippedAt: null,
          }),
      })
      .mockReturnValueOnce({ lean: () => Promise.resolve({}) });
    mockPlatformUsage.updateOne = jest.fn().mockResolvedValue({});

    await consume(100);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ tripped: true, percent: "100" }),
    );
  });
});

// ─── Snapshot del panel ──────────────────────────────────
//
// El panel del comercio y el medidor tienen que decir el mismo número. Cuando
// no coinciden, el comercio ve "10K" y se queda sin asistente en 2.000 sin
// ninguna explicación — y el que atiende el reclamo tampoco la tiene.

const chainableSelectLean = result => ({
  select: () => ({
    setOptions: () => ({ lean: () => Promise.resolve(result) }),
  }),
});

describe("aiBudgetService · snapshot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile.mockResolvedValue(platformProfile({ plan: "pro" }));
    mockAiUsage.findOne.mockReturnValue(
      chainableLean({ counters: { agentMessages: 3, agentTokens: 27000 } }),
    );
    mockAiAgent.findOne.mockReturnValue(chainableSelectLean(null));
  });

  test("sin autolímite muestra el tope del plan", async () => {
    const snapshot = await getAiBudgetSnapshot(TENANT_ID);

    expect(snapshot.metrics.agentMessages.limit).toBe(
      getPlanLimit("pro", AI_METRICS.AGENT_MESSAGES),
    );
    expect(snapshot.metrics.agentMessages.selfLimited).toBe(false);
  });

  test("con autolímite muestra el tope que de verdad se cobra", async () => {
    // Este es el bug: el comercio se pone 2.000 mensajes, reserveAiBudget corta
    // en 2.000 y el panel seguía mostrando los 10.000 del plan.
    mockAiAgent.findOne.mockReturnValue(
      chainableSelectLean({
        quotas: { monthlyMessageLimit: 2000, monthlyAiTokenLimit: 3_000_000 },
      }),
    );

    const snapshot = await getAiBudgetSnapshot(TENANT_ID);

    expect(snapshot.metrics.agentMessages.limit).toBe(2000);
    expect(snapshot.metrics.agentTokens.limit).toBe(3_000_000);
  });

  test("el tope mostrado es el mismo que aplica la reserva", async () => {
    // La invariante, comprobada contra el otro camino en vez de contra un
    // número escrito a mano: si mañana cambia la regla de los autolímites y
    // solo se toca uno de los dos lados, esto falla.
    const AUTOLIMITE = 2000;

    mockAiAgent.findOne.mockReturnValue(
      chainableSelectLean({ quotas: { monthlyMessageLimit: AUTOLIMITE } }),
    );
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentMessages: 1 } }),
    );

    const snapshot = await getAiBudgetSnapshot(TENANT_ID);
    const reserva = await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
      limitOverride: AUTOLIMITE,
    });

    expect(snapshot.metrics.agentMessages.limit).toBe(reserva.limit);
  });

  test("el autolímite no puede aflojar el tope del plan tampoco en el panel", async () => {
    // Si el snapshot no aplicara la misma regla, el panel sería la forma de
    // averiguar que el número inflado "funcionó" — no funciona.
    mockAiAgent.findOne.mockReturnValue(
      chainableSelectLean({ quotas: { monthlyMessageLimit: 999_999 } }),
    );

    const snapshot = await getAiBudgetSnapshot(TENANT_ID);

    expect(snapshot.metrics.agentMessages.limit).toBe(
      getPlanLimit("pro", AI_METRICS.AGENT_MESSAGES),
    );
    expect(snapshot.metrics.agentMessages.selfLimited).toBe(false);
  });

  test("el panel puede explicar de dónde sale el recorte", async () => {
    mockAiAgent.findOne.mockReturnValue(
      chainableSelectLean({ quotas: { monthlyMessageLimit: 2000 } }),
    );

    const metrica = (await getAiBudgetSnapshot(TENANT_ID)).metrics
      .agentMessages;

    expect(metrica.selfLimited).toBe(true);
    expect(metrica.planLimit).toBe(
      getPlanLimit("pro", AI_METRICS.AGENT_MESSAGES),
    );
    // Y el restante se cuenta contra el tope real, no contra el del plan.
    expect(metrica.remaining).toBe(2000 - 3);
  });
});

// ─── Atomicidad del cobro por adelantado ─────────────────
//
// El contador de cuota y el de plata viven los dos en el documento de AiUsage.
// Mientras se escribieron por separado podían separarse, y se separaron: en
// datos reales quedó el contador en 3 y el dinero en 2, sin nada que dijera
// cuál de las tres ediciones faltaba.
//
// Un $inc sobre un solo documento es atómico en Mongo. Lo que estos tests fijan
// es que las dos cifras viajen ahí y no en dos llamadas.

describe("aiBudgetService · cuota y plata en un solo movimiento", () => {
  const incDeLaReserva = () => mockAiUsage.findOneAndUpdate.mock.calls[0][1].$inc;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile.mockResolvedValue(platformProfile({ plan: "pro" }));
    // Sin esto el bloque depende de que otro describe haya dejado puesta la
    // implementación: clearAllMocks borra las llamadas, no las implementaciones,
    // así que el test pasaba de a uno pero solo por orden de ejecución.
    mockLedger.create.mockResolvedValue({});
    mockPlatformUsage.findOneAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ tokens: 0 }),
    });
  });

  test("reservar una edición mueve cuota y costo en el mismo $inc", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { imageEdits: 1 } }),
    );

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
    });

    const inc = incDeLaReserva();

    // La afirmación es sobre el MISMO objeto: no que las dos cosas ocurran,
    // sino que ocurran juntas. Dos $inc separados pasarían un test que solo
    // mirara los valores finales.
    expect(inc).toEqual(
      expect.objectContaining({
        "counters.imageEdits": 1,
        estimatedCostUsd: expect.any(Number),
      }),
    );
    expect(inc.estimatedCostUsd).toBeGreaterThan(0);
  });

  test("devolverla revierte las dos en el mismo $inc", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { imageEdits: 0 } }),
    );

    await refundAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
    });

    const inc = mockAiUsage.findOneAndUpdate.mock.calls[0][1].$inc;

    expect(inc["counters.imageEdits"]).toBe(-1);
    expect(inc.estimatedCostUsd).toBeLessThan(0);
  });

  test("reservar y devolver deja las dos cifras en cero", async () => {
    // La invariante completa: lo que entra por un lado sale por el otro, en la
    // misma proporción. Si alguien cambia una de las dos ramas y no la otra,
    // esto falla.
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { imageEdits: 1 } }),
    );

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
      amount: 4,
    });
    await refundAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
      amount: 4,
    });

    const [reserva, devolucion] = mockAiUsage.findOneAndUpdate.mock.calls.map(
      call => call[1].$inc,
    );

    expect(reserva["counters.imageEdits"] + devolucion["counters.imageEdits"]).toBe(0);
    expect(reserva.estimatedCostUsd + devolucion.estimatedCostUsd).toBe(0);
  });

  test("las métricas de tokens NO se cobran por adelantado", async () => {
    // Su costo se mide después, con el usageMetadata que devuelve Google.
    // Cobrarlas al reservar sería inventar el número.
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { agentMessages: 1 } }),
    );

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.AGENT_MESSAGES,
    });

    expect(incDeLaReserva()).not.toHaveProperty("estimatedCostUsd");
  });

  test("la reserva de una edición también carga el costo a la plataforma", async () => {
    // Es el disyuntor: si el gasto de imágenes no llega acá, el techo duro no
    // lo ve.
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { imageEdits: 1 } }),
    );

    await reserveAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
    });

    const [, update] = mockPlatformUsage.findOneAndUpdate.mock.calls[0];

    expect(update.$inc.estimatedCostUsd).toBeGreaterThan(0);
    // Cero tokens: Replicate no cobra por token y el disyuntor se mide en tokens.
    expect(update.$inc.tokens).toBe(0);
  });

  test("la devolución revierte también el costo de plataforma", async () => {
    mockAiUsage.findOneAndUpdate.mockReturnValue(
      chainable({ counters: { imageEdits: 0 } }),
    );

    await refundAiBudget({
      tenantId: TENANT_ID,
      metric: AI_METRICS.IMAGE_EDITS,
    });

    const [, update] = mockPlatformUsage.findOneAndUpdate.mock.calls[0];

    expect(update.$inc.estimatedCostUsd).toBeLessThan(0);
    // Los tokens no se devuelven nunca: ya se gastaron contra Google.
    expect(update.$inc.tokens).toBe(0);
  });
});
