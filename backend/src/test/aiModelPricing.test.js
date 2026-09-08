// Catálogo de precios de modelos.
//
// La razón de que las tarifas tengan vigencia es concreta: Google ya anunció
// que los modelos 3.x duplican precio el 1/1/2027. Sin fechas, ese día todas
// las operaciones históricas cambiarían de costo retroactivamente.

import {
  computeCostUsd,
  getModelPrice,
  listModelPricing,
} from "../services/ai/aiModelPricing.js";

const ANTES = new Date("2026-09-08T00:00:00.000Z");
const DESPUES = new Date("2027-03-01T00:00:00.000Z");

describe("getModelPrice · la tarifa depende de la fecha", () => {
  test("gemini-3.6-flash cuesta 0,75 / 3,75 durante 2026", () => {
    const p = getModelPrice("gemini-3.6-flash", ANTES);

    expect(p.input).toBe(0.75);
    expect(p.output).toBe(3.75);
    expect(p.fallback).toBeUndefined();
  });

  test("y el doble a partir del 1/1/2027", () => {
    const p = getModelPrice("gemini-3.6-flash", DESPUES);

    expect(p.input).toBe(1.5);
    expect(p.output).toBe(7.5);
  });

  test("el cambio entra solo, sin tocar código", () => {
    const vispera = getModelPrice("gemini-3.7-flash", new Date("2026-12-31T23:59:59.000Z"));
    const estreno = getModelPrice("gemini-3.7-flash", new Date("2027-01-01T00:00:00.000Z"));

    expect(vispera.input).toBe(0.75);
    expect(estreno.input).toBe(1.5);
  });

  test("los lite no tienen ese ajuste anunciado", () => {
    expect(getModelPrice("gemini-3.1-flash-lite", ANTES).input).toBe(0.25);
    expect(getModelPrice("gemini-3.1-flash-lite", DESPUES).input).toBe(0.25);
  });

  test("normaliza el prefijo models/ y las mayúsculas", () => {
    expect(getModelPrice("models/Gemini-3.6-Flash", ANTES).input).toBe(0.75);
  });

  test("un modelo desconocido usa la tarifa CARA, no un promedio", () => {
    // De los dos errores posibles, sobreestimar corta antes de tiempo y se
    // nota; subestimar se pasa sin avisar y llega en la factura.
    const p = getModelPrice("gemini-99-turbo", ANTES);

    expect(p.fallback).toBe(true);
    expect(p.input).toBeGreaterThanOrEqual(1.5);
  });
});

describe("computeCostUsd · costo de un consumo", () => {
  test("con entrada y salida medidas usa cada tarifa", () => {
    const r = computeCostUsd({
      model: "gemini-3.6-flash",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      at: ANTES,
    });

    expect(r.costUsd).toBeCloseTo(4.5, 6);
    expect(r.estimated).toBe(false);
  });

  test("con solo el total reparte, y lo declara", () => {
    // Casi todos los call sites reciben totalTokenCount de Gemini y nada más.
    // Un costo repartido no se puede confundir con uno medido.
    const r = computeCostUsd({
      model: "gemini-3.6-flash",
      totalTokens: 10_000,
      at: ANTES,
    });

    expect(r.estimated).toBe(true);
    expect(r.inputTokens + r.outputTokens).toBe(10_000);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  test("un total sin desglose NO se toma como cero entrada y cero salida", () => {
    // Regresión: Number(null) es 0 y 0 es finito, así que chequear con
    // Number.isFinite tomaba los defaults en null por un desglose real. El
    // precio salía correcto y el costo, cero.
    const r = computeCostUsd({
      model: "gemini-3.6-flash",
      inputTokens: null,
      outputTokens: null,
      totalTokens: 10_000,
      at: ANTES,
    });

    expect(r.costUsd).toBeGreaterThan(0);
  });

  test("la salida pesa cinco veces la entrada", () => {
    // Es lo que invalida una tarifa mezclada única: dos operaciones con el
    // mismo total de tokens cuestan distinto según su proporción.
    const entrada = computeCostUsd({
      model: "gemini-3.6-flash",
      inputTokens: 10_000,
      outputTokens: 0,
      at: ANTES,
    });
    const salida = computeCostUsd({
      model: "gemini-3.6-flash",
      inputTokens: 0,
      outputTokens: 10_000,
      at: ANTES,
    });

    expect(salida.costUsd / entrada.costUsd).toBeCloseTo(5, 1);
  });

  test("devuelve la tarifa aplicada para que el ledger la congele", () => {
    const r = computeCostUsd({ model: "gemini-3.6-flash", totalTokens: 1000, at: ANTES });

    expect(r.price.input).toBe(0.75);
    expect(r.price.output).toBe(3.75);
  });

  test("sin tokens no hay costo", () => {
    expect(computeCostUsd({ model: "gemini-3.6-flash", totalTokens: 0 }).costUsd).toBe(0);
    expect(computeCostUsd({ model: "gemini-3.6-flash", totalTokens: -5 }).costUsd).toBe(0);
    expect(computeCostUsd({}).costUsd).toBe(0);
  });
});

describe("listModelPricing · lo vigente hoy", () => {
  test("no devuelve dos tarifas para el mismo modelo", () => {
    // Dos ventanas solapadas harían que el costo dependa del orden del array.
    const modelos = listModelPricing(ANTES).map(m => m.model);

    expect(new Set(modelos).size).toBe(modelos.length);
  });

  test("en 2027 el mismo modelo aparece con la tarifa nueva", () => {
    const hoy = listModelPricing(ANTES).find(m => m.model === "gemini-3.6-flash");
    const luego = listModelPricing(DESPUES).find(m => m.model === "gemini-3.6-flash");

    expect(hoy.inputPerMillion).toBe(0.75);
    expect(luego.inputPerMillion).toBe(1.5);
  });
});
