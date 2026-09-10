// Precio de los planes y el tipo de cambio del que dependen.
//
// El precio del starter estaba guardado como 26,14 USD: el RESULTADO de dividir
// 40.000 ARS por el dólar de un día concreto. Guardar el resultado y no el hecho
// hace que el comercio siga pagando 40.000 pesos mientras el motor de margen
// sigue creyendo que cobra 26,14 dólares. En Argentina esas dos cosas se separan
// en semanas, y el margen del panel se corre sin que nada avise.

import { jest } from "@jest/globals";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: mockLogger,
}));

const { getPlanMonthlyPriceUsd, getPlanPriceSource } = await import(
  "../services/ai/aiPlanPolicy.js"
);

const hoyMenos = dias => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.USD_ARS_RATE;
  delete process.env.USD_ARS_RATE_DATE;
  delete process.env.PLAN_PRICE_USD_STARTER;
});

afterAll(() => {
  delete process.env.USD_ARS_RATE;
  delete process.env.USD_ARS_RATE_DATE;
  delete process.env.PLAN_PRICE_USD_STARTER;
});

describe("conversión", () => {
  test("el starter se convierte desde pesos, no está fijado en dólares", () => {
    // 40.000 / 1530 ≈ 26,14 — el mismo número que antes, pero ahora derivado.
    process.env.USD_ARS_RATE = "1530";
    process.env.USD_ARS_RATE_DATE = hoyMenos(1);

    expect(getPlanMonthlyPriceUsd("starter")).toBeCloseTo(26.14, 2);
  });

  test("mover el tipo de cambio mueve el precio, que es el punto", () => {
    // Es lo que antes no pasaba: el peso se devaluaba y el margen seguía
    // calculándose con el dólar viejo.
    process.env.USD_ARS_RATE = "2000";
    process.env.USD_ARS_RATE_DATE = hoyMenos(1);

    expect(getPlanMonthlyPriceUsd("starter")).toBe(20);
  });

  test("los planes decididos en dólares no pasan por el cambio", () => {
    process.env.USD_ARS_RATE = "9999";
    process.env.USD_ARS_RATE_DATE = hoyMenos(1);

    expect(getPlanMonthlyPriceUsd("pro")).toBe(99);
    expect(getPlanMonthlyPriceUsd("free")).toBe(0);
  });

  test("enterprise sigue siendo null y no cero", () => {
    // Un 0 numérico se leería como margen falso en cualquier reporte.
    expect(getPlanMonthlyPriceUsd("enterprise")).toBeNull();
  });

  test("fijar el precio en dólares por entorno le gana al cambio", () => {
    // La salida para el día que se quiera un número exacto sin depender del
    // tipo de cambio.
    process.env.PLAN_PRICE_USD_STARTER = "35";
    process.env.USD_ARS_RATE = "1530";

    expect(getPlanMonthlyPriceUsd("starter")).toBe(35);
  });
});

describe("cuando el tipo de cambio queda viejo", () => {
  test("avisa, en vez de calcular en silencio", () => {
    // El fallo original no era el número: era que nadie se enteraba.
    process.env.USD_ARS_RATE = "1530";
    process.env.USD_ARS_RATE_DATE = hoyMenos(120);

    getPlanMonthlyPriceUsd("starter");

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("tipo de cambio"),
      expect.objectContaining({ rate: 1530 }),
    );
  });

  test("un tipo de cambio reciente no molesta", () => {
    process.env.USD_ARS_RATE = "1530";
    process.env.USD_ARS_RATE_DATE = hoyMenos(2);

    getPlanMonthlyPriceUsd("starter");

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test("no repite el aviso en cada llamada", () => {
    // Una advertencia por request volvería ilegible el log justo cuando hay que
    // leerlo.
    process.env.USD_ARS_RATE = "1777";
    process.env.USD_ARS_RATE_DATE = hoyMenos(200);

    getPlanMonthlyPriceUsd("starter");
    getPlanMonthlyPriceUsd("starter");
    getPlanMonthlyPriceUsd("starter");

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("de dónde salió el precio", () => {
  test("informa la moneda de origen, el cambio y su antigüedad", () => {
    // Un margen calculado con un cambio de hace tres meses no es incorrecto,
    // pero se lee distinto sabiendo con qué se calculó.
    process.env.USD_ARS_RATE = "1530";
    process.env.USD_ARS_RATE_DATE = hoyMenos(100);

    const origen = getPlanPriceSource("starter");

    expect(origen.origin).toBe("converted");
    expect(origen.currency).toBe("ARS");
    expect(origen.amount).toBe(40000);
    expect(origen.fxRate).toBe(1530);
    expect(origen.fxAgeDays).toBeGreaterThanOrEqual(99);
    expect(origen.fxStale).toBe(true);
  });

  test("distingue un precio fijado por entorno de uno convertido", () => {
    process.env.PLAN_PRICE_USD_STARTER = "35";

    expect(getPlanPriceSource("starter").origin).toBe("env");
  });
});
