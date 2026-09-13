// Lectura y suma del desglose de tokens del proveedor.
//
// Es la pieza que decide si el costo de una operación es medido o repartido.
// La salida cuesta cinco veces la entrada, así que un reparto supuesto se
// equivoca justo donde más duele: dos operaciones con el mismo total pueden
// costar muy distinto según su proporción.

import { readUsage, sumUsage } from "../services/ai/aiUsageMetadata.js";

const respuesta = (prompt, candidates, total, model = "gemini-3.6-flash") => ({
  model,
  usageMetadata: {
    promptTokenCount: prompt,
    candidatesTokenCount: candidates,
    totalTokenCount: total,
  },
});

describe("readUsage", () => {
  test("lee entrada, salida y modelo", () => {
    expect(readUsage(respuesta(3900, 1000, 4900))).toEqual({
      inputTokens: 3900,
      outputTokens: 1000,
      totalTokens: 4900,
      model: "gemini-3.6-flash",
    });
  });

  test("sin usageMetadata devuelve null, no un cero", () => {
    // "No vino el dato" y "vino en cero" son cosas distintas: cero entrada y
    // cero salida es un desglose válido y significa otra cosa.
    expect(readUsage({ content: "hola" })).toBeNull();
    expect(readUsage(null)).toBeNull();
  });

  test("una respuesta sin tokens no cuenta como consumo", () => {
    expect(readUsage(respuesta(0, 0, 0))).toBeNull();
  });

  test("si falta el total lo deriva de las partes", () => {
    const usage = readUsage({
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    expect(usage.totalTokens).toBe(150);
  });

  test("si vino el total pero no el desglose, lo informa igual", () => {
    // El total sí es correcto; lo que no se sabe es cómo se reparte. Dejar el
    // desglose en null hace que el costo se marque como estimado en vez de
    // mentir con precisión.
    const usage = readUsage({ usageMetadata: { totalTokenCount: 5000 } });

    expect(usage.totalTokens).toBe(5000);
    expect(usage.inputTokens).toBeNull();
    expect(usage.outputTokens).toBeNull();
  });
});

describe("sumUsage", () => {
  test("suma dos llamadas manteniendo el desglose", () => {
    // El caso real: el grounding de mercado hace dos llamadas y el consumo se
    // registra una sola vez al final.
    const total = sumUsage(
      readUsage(respuesta(1000, 200, 1200)),
      readUsage(respuesta(500, 300, 800)),
    );

    expect(total).toEqual({
      inputTokens: 1500,
      outputTokens: 500,
      totalTokens: 2000,
      model: "gemini-3.6-flash",
    });
  });

  test("si a una llamada le falta el desglose, se informa el total sin inventar el reparto", () => {
    // Sumar solo las que tienen desglose daría un total menor al real y el
    // costo saldría bajo. Mejor un costo marcado como estimado que uno
    // preciso y equivocado.
    const total = sumUsage(
      readUsage(respuesta(1000, 200, 1200)),
      readUsage({ usageMetadata: { totalTokenCount: 800 } }),
    );

    expect(total.totalTokens).toBe(2000);
    expect(total.inputTokens).toBeNull();
    expect(total.outputTokens).toBeNull();
  });

  test("ignora las llamadas que no gastaron nada", () => {
    const total = sumUsage(readUsage(respuesta(100, 50, 150)), null, undefined);

    expect(total.totalTokens).toBe(150);
  });

  test("sin ninguna llamada devuelve null", () => {
    expect(sumUsage(null, undefined)).toBeNull();
  });

  test("conserva el último modelo informado", () => {
    // Si dos pasos corrieron en modelos distintos, el costo del conjunto queda
    // calculado con uno. Es una aproximación conocida, y mejor que repartir el
    // total entero con una proporción inventada.
    const total = sumUsage(
      readUsage(respuesta(100, 50, 150, "gemini-3.6-flash")),
      readUsage(respuesta(100, 50, 150, "gemini-3.1-flash-lite")),
    );

    expect(total.model).toBe("gemini-3.1-flash-lite");
  });
});
