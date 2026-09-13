// Cadena de modelos de Gemini.
//
// Este archivo existe por un defecto concreto: los tres nombres de
// FALLBACK_MODELS quedaron idénticos tras un reemplazo global, getModelChain
// deduplicaba a UN modelo, y todo el aparato de cooldowns y descartes de
// geminiModels.js quedó sin efecto — no había a dónde caer. Nadie lo notó
// porque no había un solo test sobre este archivo.
//
// El primer test es la guarda de regresión de eso.

import {
  extractErrorStatus,
  getModelChain,
  getModelHealth,
  isModelDead,
  isModelUnavailable,
  isOverloadError,
  isQuotaError,
  markModelDead,
  resetDeadModels,
} from "../services/ai/geminiModels.js";

beforeEach(() => {
  resetDeadModels();
});

describe("geminiModels · la cadena puede respaldar de verdad", () => {
  test("hay al menos dos modelos DISTINTOS para caer", () => {
    const chain = getModelChain();
    const unicos = new Set(chain);

    // Con un solo modelo único, un 429 o un 503 dejan la IA sin salida.
    expect(unicos.size).toBeGreaterThanOrEqual(2);
    expect(unicos.size).toBe(chain.length);
  });

  test("el modelo preferido va primero y no se duplica", () => {
    const chain = getModelChain("gemma-4-26b-a4b-it");

    expect(chain[0]).toBe("gemma-4-26b-a4b-it");
    expect(chain.filter(m => m === "gemma-4-26b-a4b-it")).toHaveLength(1);
  });

  test("normaliza el prefijo models/ que devuelve la API de Google", () => {
    const chain = getModelChain("models/gemma-4-26b-a4b-it");

    expect(chain[0]).toBe("gemma-4-26b-a4b-it");
  });
});

describe("geminiModels · saturación del proveedor (503)", () => {
  // Verificado contra la API el 07/09/2026: gemma-4-26b-a4b-it devolvía 503
  // sostenido mientras gemini-3.7-flash respondía normal. Sin este caso el
  // 503 se propagaba como error y la IA fallaba entera teniendo alternativas.

  test("un 503 cuenta como motivo para pasar al siguiente modelo", () => {
    expect(isOverloadError(503)).toBe(true);
    expect(isModelUnavailable(503, "high demand")).toBe(true);
  });

  test("un 503 saca al modelo de la cadena y deja los demás", () => {
    const antes = getModelChain();

    markModelDead(antes[0], "high demand", 503);
    const despues = getModelChain();

    expect(despues).not.toContain(antes[0]);
    expect(despues.length).toBeGreaterThan(0);
  });

  test("un 503 PAUSA el modelo, no lo mata: el modelo existe y va a volver", () => {
    const [modelo] = getModelChain();

    markModelDead(modelo, "high demand", 503);
    const salud = getModelHealth();

    expect(salud.dead).not.toContain(modelo);
    expect(salud.coolingDown.map(c => c.model)).toContain(modelo);
  });
});

describe("geminiModels · permanente vs temporal", () => {
  test("un 404 sí descarta el modelo de forma permanente", () => {
    const [modelo] = getModelChain();

    markModelDead(modelo, "404 Not Found", 404);

    expect(getModelHealth().dead).toContain(modelo);
    expect(isModelDead(modelo)).toBe(true);
  });

  test("un 429 con texto de cuota pausa, no mata", () => {
    const [modelo] = getModelChain();

    expect(isQuotaError(429, "quota exceeded")).toBe(true);
    markModelDead(modelo, "429: quota exceeded for this plan", 429);

    expect(getModelHealth().dead).not.toContain(modelo);
    expect(getModelHealth().coolingDown.map(c => c.model)).toContain(modelo);
  });

  test("sin status se asume permanente, como antes", () => {
    const [modelo] = getModelChain();

    markModelDead(modelo, "algo salió mal");

    expect(getModelHealth().dead).toContain(modelo);
  });

  test("nunca devuelve una lista vacía, aunque estén todos descartados", () => {
    getModelChain().forEach(m => markModelDead(m, "404", 404));

    expect(getModelChain().length).toBeGreaterThan(0);
  });
});

describe("geminiModels · extracción del status", () => {
  // markModelDead necesita el número para elegir entre pausa y descarte. Cada
  // capa lo reporta distinto, y dos de los tres llamadores no lo pasaban: un
  // 429 o un 503 los marcaba como muertos permanentes.

  test("lo saca de .status, de .statusCode y del texto del SDK", () => {
    expect(extractErrorStatus({ status: 503 })).toBe(503);
    expect(extractErrorStatus({ statusCode: 429 })).toBe(429);
    expect(extractErrorStatus({ message: "[404 Not Found] modelo inexistente" })).toBe(404);
  });

  test("devuelve undefined si no hay forma de saberlo", () => {
    expect(extractErrorStatus(null)).toBeUndefined();
    expect(extractErrorStatus({ message: "sin código" })).toBeUndefined();
  });

  test("un error de saturación del SDK termina pausando y no matando", () => {
    const [modelo] = getModelChain();
    const error = { message: "[503 Service Unavailable] high demand" };

    markModelDead(modelo, error.message, extractErrorStatus(error));

    expect(getModelHealth().dead).not.toContain(modelo);
    expect(getModelHealth().coolingDown.map(c => c.model)).toContain(modelo);
  });
});

// ─── Un 429 de la búsqueda con Google no es un 429 del modelo ───────────────
//
// Verificado contra la API con la key de producción: la misma llamada sin
// `tools` devuelve 200 y con `tools: [{ google_search: {} }]` devuelve 429
// RESOURCE_EXHAUSTED, en todos los modelos de la cadena. La búsqueda se mide
// aparte de los tokens.
//
// El cliente no distinguía, así que recorría la cadena entera cobrando el
// mismo 429 en cada modelo y dejaba a todos en cooldown 15 minutos. Ese
// cooldown lo comparten el agente de ventas, el análisis de producto y los
// insights: un análisis de mercado degradaba a toda la plataforma por algo que
// no tenía nada que ver con ellos.

describe("cuota de búsqueda con Google", () => {
  const CUOTA = {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota, please check your plan and billing details.",
    },
  };

  let callAgentLLM;
  let fetchOriginal;
  let llamadas;

  beforeAll(async () => {
    ({ callAgentLLM } = await import("../services/aiAgent/aiAgentLLMService.js"));
  });

  beforeEach(() => {
    resetDeadModels();
    llamadas = 0;
    fetchOriginal = global.fetch;

    global.fetch = async () => {
      llamadas += 1;
      return {
        ok: false,
        status: 429,
        json: async () => CUOTA,
        text: async () => JSON.stringify(CUOTA),
      };
    };
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  test("no deja a los modelos en cooldown ni prueba toda la cadena", async () => {
    await expect(
      callAgentLLM({
        systemPrompt: "x",
        messages: [{ role: "user", content: "x" }],
        apiKey: "test-key",
        tools: [{ google_search: {} }],
      }),
    ).rejects.toMatchObject({ code: "AI_GROUNDING_QUOTA" });

    expect(getModelHealth().coolingDown).toHaveLength(0);
    expect(getModelHealth().dead).toHaveLength(0);

    // Un intento por modelo × la cadena entera era lo que pasaba antes.
    expect(llamadas).toBeLessThanOrEqual(getModelChain().length);
  }, 30000);

  test("sin búsqueda, un 429 sigue pausando el modelo como siempre", async () => {
    await expect(
      callAgentLLM({
        systemPrompt: "x",
        messages: [{ role: "user", content: "x" }],
        apiKey: "test-key",
      }),
    ).rejects.toBeDefined();

    expect(getModelHealth().coolingDown.length).toBeGreaterThan(0);
  }, 30000);
});
