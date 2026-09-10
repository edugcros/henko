// La clave de la reserva tiene que llegar a los tres movimientos.
//
// POR QUÉ EXISTE
//
// `reserveAiBudget` devuelve un `operationId`, y tanto `refundAiBudget` como
// `recordImageGenerationCost` lo aceptan y documentan que sin él un reintento
// cuenta dos veces. Este controlador no lo pasaba a ninguno de los dos.
//
// La consecuencia se vio en datos reales: en el ledger había 9 reservas de
// edición de imagen, 6 devoluciones y solo 2 consumos, con el contador de cuota
// en 3. O sea, una edición ocupó cupo y nunca registró su costo — y como todas
// las filas tenían operationId nulo, no había forma de saber cuál. El panel
// mostraba un total en dólares que no se correspondía con la cantidad de
// generaciones, sin nada que explicara la diferencia.
//
// Pasar la clave no evita que un registro se pierda; lo vuelve VISIBLE (una
// reserva sin su consumo se puede encontrar) e impide que un reintento cobre
// dos veces, porque el índice único del ledger es (tenant, operación, evento).
//
// Se prueba en el controlador y no en el servicio a propósito: el servicio
// siempre supo recibir la clave, el que no la mandaba era este.

import { jest } from "@jest/globals";

const OPERATION_ID = "op-de-la-reserva-123";
const TENANT_ID = "64b7f0000000000000000001";

const mockReserve = jest.fn();
const mockRefund = jest.fn();
const mockRecordCost = jest.fn();
const mockGenerate = jest.fn();

jest.unstable_mockModule("../services/ai/aiBudgetService.js", () => ({
  AI_METRICS: { IMAGE_EDITS: "imageEdits" },
  buildBudgetDenialMessage: () => "sin cupo",
  recordImageGenerationCost: mockRecordCost,
  refundAiBudget: mockRefund,
  reserveAiBudget: mockReserve,
}));

jest.unstable_mockModule("../services/imageAiService.js", () => ({
  generateVariation: mockGenerate,
  removeBackground: jest.fn(),
}));

jest.unstable_mockModule("../services/ai/backgroundRemoval.js", () => ({
  getBackgroundRemovalStatus: () => ({}),
}));

jest.unstable_mockModule("../services/ai/aiCredentialsService.js", () => ({
  resolveTenantAiCredentials: async () => ({ apiKey: "AIzaTEST" }),
}));

const { handleGenerateVariation } = await import(
  "../controller/imageAiCtrl.js"
);

const pedido = () => ({
  file: { buffer: Buffer.from("imagen"), mimetype: "image/png" },
  body: { prompt: "fondo blanco" },
  user: { tenantId: TENANT_ID },
});

const respuesta = () => {
  const res = {
    statusCode: 200,
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
  return res;
};

const correr = async () => {
  const res = respuesta();
  await handleGenerateVariation(pedido(), res, err => {
    if (err) throw err;
  });
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockReserve.mockResolvedValue({
    allowed: true,
    operationId: OPERATION_ID,
    metric: "imageEdits",
  });
});

describe("imageAiCtrl · trazabilidad de la operación", () => {
  test("el costo se registra con la clave de la reserva", async () => {
    mockGenerate.mockResolvedValue({
      buffer: Buffer.from("resultado"),
      contentType: "image/png",
    });

    await correr();

    expect(mockRecordCost).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OPERATION_ID }),
    );
  });

  test("la devolución también usa la clave de la reserva", async () => {
    // El proveedor falla: se devuelve el cupo, y esa devolución tiene que poder
    // unirse con la reserva que anula.
    mockGenerate.mockRejectedValue(new Error("replicate caído"));

    await expect(correr()).rejects.toThrow("replicate caído");

    expect(mockRefund).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OPERATION_ID }),
    );
  });

  test("los tres movimientos comparten la misma clave", async () => {
    // La invariante que hace útil al ledger: sin una clave común, reserva,
    // consumo y devolución son tres filas sueltas que no se pueden cruzar.
    mockGenerate.mockResolvedValue({
      buffer: Buffer.from("resultado"),
      contentType: "image/png",
    });

    await correr();

    const [[reserva]] = mockReserve.mock.calls;
    const [[costo]] = mockRecordCost.mock.calls;

    // La reserva no la genera el controlador: la pide sin clave y usa la que
    // le devuelven, que es lo que garantiza que sea la misma.
    expect(reserva.operationId).toBeUndefined();
    expect(costo.operationId).toBe(OPERATION_ID);
  });

  test("sin cupo no se registra ningún costo", async () => {
    mockReserve.mockResolvedValue({
      allowed: false,
      reason: "limit_reached",
      metric: "imageEdits",
    });

    const res = await correr();

    expect(res.statusCode).toBe(402);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockRecordCost).not.toHaveBeenCalled();
  });
});
