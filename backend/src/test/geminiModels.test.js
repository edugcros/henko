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
