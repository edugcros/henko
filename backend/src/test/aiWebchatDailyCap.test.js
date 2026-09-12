// Tope diario del chat público.
//
// Lo que se prueba es la propiedad que motiva el middleware: que la cuota
// mensual de un comercio no se pueda vaciar en un rato desde afuera, y que el
// freno no se convierta él mismo en una forma de dejar sin chat a una tienda.

import { jest } from "@jest/globals";

const mockCacheIncr = jest.fn();
const mockProfile = jest.fn();

jest.unstable_mockModule("../utils/cache.js", () => ({
  cacheIncr: mockCacheIncr,
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
  cacheDel: jest.fn(),
  default: {},
}));

jest.unstable_mockModule("../services/ai/aiCredentialsService.js", () => ({
  KEY_SOURCE: { TENANT: "tenant", PLATFORM: "platform", NONE: "none" },
  loadTenantAiProfile: mockProfile,
}));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: mockLogger,
}));

const { aiWebchatDailyCap, resolveDailyCap } = await import(
  "../middlewares/aiWebchatDailyCap.js"
);

const TENANT_ID = "64b7f0000000000000000001";

const run = async ({ used = 1, plan = "starter", keySource = "platform" } = {}) => {
  mockProfile.mockResolvedValue({ plan, keySource });
  mockCacheIncr.mockResolvedValue(used);

  const req = { tenantId: TENANT_ID };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();

  await aiWebchatDailyCap(req, res, next);

  return { res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AI_WEBCHAT_DAILY_BURST_FACTOR;
  delete process.env.AI_WEBCHAT_DAILY_MIN;
  delete process.env.AI_WEBCHAT_DAILY_MAX;
});

describe("de dónde sale el tope", () => {
  test("el plan más chico no puede vaciar su mes en menos de diez días", async () => {
    // 2.000 mensajes al mes, factor 3 sobre el promedio diario: 200 por día.
    // Es la garantía que motiva todo el middleware, y sale del tope del plan:
    // no hay un número escrito acá que se pueda desincronizar.
    expect(resolveDailyCap("starter")).toBe(200);
  });

  test("escala con el plan sin una tabla nueva que mantener", async () => {
    // Sale de getPlanLimit, así que cambiar la cuota de un plan mueve el tope
    // diario solo. Dos números que hay que acordarse de sincronizar terminan
    // desincronizados.
    expect(resolveDailyCap("pro")).toBeGreaterThan(resolveDailyCap("starter"));
  });

  test("un plan con mensajes ilimitados igual tiene techo diario", async () => {
    // No hay de dónde derivarlo, y dejarlo sin tope sería el agujero que esto
    // vino a tapar, solo que en el plan que más gasta. Ningún plan del catálogo
    // viene ilimitado, así que el caso se produce como se produce en la
    // realidad: con el tope puesto en 0 por entorno.
    process.env.AI_LIMIT_PRO_AGENT_MESSAGES = "0";

    expect(resolveDailyCap("pro")).toBe(500);

    delete process.env.AI_LIMIT_PRO_AGENT_MESSAGES;
  });

  test("un plan chico no queda con un tope inusable", async () => {
    process.env.AI_WEBCHAT_DAILY_BURST_FACTOR = "0.1";

    expect(resolveDailyCap("starter")).toBe(10);
  });
});

describe("qué hace en cada caso", () => {
  test("por debajo del tope deja pasar", async () => {
    const { next, res } = await run({ used: 5 });

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  test("justo en el tope todavía pasa", async () => {
    // El límite es "hasta 200", no "menos de 200": el mensaje 200 es legítimo.
    const { next } = await run({ used: 200 });

    expect(next).toHaveBeenCalled();
  });

  test("pasado el tope corta con 429 y un mensaje que se puede mostrar", async () => {
    const { next, res } = await run({ used: 201 });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe("AI_WEBCHAT_DAILY_LIMIT");
    // Lo lee un visitante de la tienda, no un desarrollador.
    expect(res.body.message).toMatch(/mañana/i);
  });

  test("con key propia del comercio no se aplica", async () => {
    // El gasto no es de la plataforma: el comercio puede regalar su
    // presupuesto si quiere.
    const { next } = await run({ used: 9999, keySource: "tenant" });

    expect(next).toHaveBeenCalled();
    expect(mockCacheIncr).not.toHaveBeenCalled();
  });

  test("cuenta por comercio y por día", async () => {
    await run({ used: 1 });

    const [clave, ttl] = mockCacheIncr.mock.calls[0];

    expect(clave).toContain(TENANT_ID);
    expect(clave).toMatch(/\d{4}-\d{2}-\d{2}$/);
    // Más que el día que cuenta, para que un reloj corrido no lo borre antes.
    expect(ttl).toBeGreaterThan(24 * 3600);
  });

  test("si la caché falla, la tienda no se queda sin chat", async () => {
    // Un freno que se rompe hacia el lado de negar deja sin asistente a un
    // comercio que no hizo nada. Por debajo siguen el limitador por minuto y
    // la cuota mensual, que es el freno duro.
    mockProfile.mockResolvedValue({ plan: "starter", keySource: "platform" });
    mockCacheIncr.mockRejectedValue(new Error("redis caído"));

    const req = { tenantId: TENANT_ID };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await aiWebchatDailyCap(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
