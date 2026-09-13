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
  supportsSearchGrounding,
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
    const chain = getModelChain("gemini-3.6-flash");

    expect(chain[0]).toBe("gemini-3.6-flash");
    expect(chain.filter(m => m === "gemini-3.6-flash")).toHaveLength(1);
  });

  test("normaliza el prefijo models/ que devuelve la API de Google", () => {
    const chain = getModelChain("models/gemini-3.6-flash");

    expect(chain[0]).toBe("gemini-3.6-flash");
  });
});

describe("geminiModels · saturación del proveedor (503)", () => {
  // Verificado contra la API el 07/09/2026: gemini-3.6-flash devolvía 503
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

// ─── Gemma tiene la cuota más grande y no sabe buscar ───────────────────────
//
// 14.400 pedidos por día contra los 20 de los Flash, así que es el último
// respaldo de la cadena. Pero no soporta herramientas, y mandarle `tools` no
// devuelve un error: la llamada se cuelga hasta el timeout. Eso ya pasó en
// producción — cada análisis de mercado esperaba de gusto.

describe("qué modelo puede buscar en Google", () => {
  test("Gemma queda afuera de las llamadas con búsqueda", () => {
    expect(supportsSearchGrounding("gemma-4-26b-a4b-it")).toBe(false);
    expect(supportsSearchGrounding("models/gemma-4-31b-it")).toBe(false);
  });

  test("los Gemini sí pueden", () => {
    expect(supportsSearchGrounding("gemini-3.8-flash")).toBe(true);
    expect(supportsSearchGrounding("gemini-3.1-flash-lite")).toBe(true);
  });

  test("la cadena de respaldo prioriza cuota, con Gemma al final", () => {
    const chain = getModelChain("gemini-3.8-flash");

    // Los Flash grandes tienen 20 pedidos por día; los Lite, 500.
    expect(chain).toContain("gemini-3.5-flash-lite");
    expect(chain).toContain("gemini-3.1-flash-lite");
    expect(chain[chain.length - 1]).toBe("gemma-4-26b-a4b-it");
  });

  test("una llamada con búsqueda no cae en un modelo que no la soporta", async () => {
    const { callAgentLLM } = await import("../services/aiAgent/aiAgentLLMService.js");

    const fetchOriginal = global.fetch;
    const modelosLlamados = [];

    global.fetch = async url => {
      modelosLlamados.push(String(url).match(/models\/([^:]+):/)?.[1]);
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { code: 503, message: "high demand" } }),
        text: async () => "high demand",
      };
    };

    try {
      await callAgentLLM({
        systemPrompt: "x",
        messages: [{ role: "user", content: "x" }],
        apiKey: "k",
        model: "gemini-3.8-flash",
        tools: [{ google_search: {} }],
      }).catch(() => {});
    } finally {
      global.fetch = fetchOriginal;
    }

    expect(modelosLlamados.length).toBeGreaterThan(0);
    expect(modelosLlamados.some(m => String(m).startsWith("gemma"))).toBe(false);
  }, 30000);
});
