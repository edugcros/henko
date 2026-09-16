// Lectura y suma del desglose de tokens del proveedor.
//
// Es la pieza que decide si el costo de una operación es medido o repartido.
// La salida cuesta cinco veces la entrada, así que un reparto supuesto se
// equivoca justo donde más duele: dos operaciones con el mismo total pueden
// costar muy distinto según su proporción.

import { readUsage } from "../services/ai/aiUsageMetadata.js";

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
    // La forma se afirma ENTERA a propósito: si un campo medido desaparece,
    // este test lo dice. Fue exactamente lo contrario —un campo del proveedor
    // que nunca se leyó, thoughtsTokenCount— lo que escondió el 21,2% del
    // costo durante meses.
    expect(readUsage(respuesta(3900, 1000, 4900))).toEqual({
      inputTokens: 3900,
      outputTokens: 1000,
      visibleTokens: 1000,
      thinkingTokens: null,
      cachedInputTokens: null,
      totalTokens: 4900,
      serviceTier: null,
      // Cero y no null: es un conteo, y "no hubo busquedas" es 0.
      groundingQueries: 0,
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

describe("consolidar llamadas · borrado a proposito", () => {
  test("el modulo ya no ofrece una forma de fusionar desgloses", async () => {
    // sumUsage vivia aca. Sumaba varias llamadas y se quedaba con el modelo de
    // la ultima que informara uno; su propio comentario lo admitia.
    //
    // Entre gemini-3.6-flash (0,75/3,75) y gemini-3.1-flash-lite (0,25/1,50)
    // hay 3x de tarifa, y quien responde lo decide la cadena de respaldo, no la
    // configuracion: medido, 72 de 122 filas no eran el modelo pedido. Un
    // millon de tokens en cada uno, costeado entero con el ultimo, no se
    // equivoca un poco.
    //
    // Se puede borrar porque la unidad contable ya no es la operacion sino
    // (operacion, llamada): cada llamada deja su fila en AiProviderCall con su
    // modelo, su tarifa y su costo. El paso siguiente es otro callId, no una
    // fusion.
    const modulo = await import("../services/ai/aiUsageMetadata.js");

    expect(modulo.sumUsage).toBeUndefined();
    expect(Object.keys(modulo.default)).toEqual(["readUsage"]);
  });
});
