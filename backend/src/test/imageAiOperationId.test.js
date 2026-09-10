// El controlador de edición de imagen frente al medidor.
//
// POR QUÉ EXISTE
//
// Este controlador cobraba en dos pasos: `reserveAiBudget` subía el contador de
// cuota y, después de generar la imagen, una segunda llamada sumaba el costo.
// Entre los dos pasos había una ida y vuelta al proveedor, y la segunda llamada
// se tragaba sus propios errores. Si no llegaba a ejecutarse, el cupo quedaba
// consumido sin su plata.
//
// Se vio en datos reales: 9 reservas de edición, 6 devoluciones y 2 consumos,
// con el contador de cuota en 3. Una edición ocupó cupo y nunca registró costo,
// y como ningún movimiento llevaba `operationId` no había forma de saber cuál.
//
// Hoy el costo viaja dentro de la reserva (es tarifa plana: ya se conoce ahí) y
// la devolución revierte las dos cosas. Lo que este test fija es lo que le toca
// al controlador: que no exista un segundo paso que cobre, y que la devolución
// use la clave de la reserva que anula.

import { jest } from "@jest/globals";

const OPERATION_ID = "op-de-la-reserva-123";
const TENANT_ID = "64b7f0000000000000000001";

const mockReserve = jest.fn();
const mockRefund = jest.fn();
const mockGenerate = jest.fn();

jest.unstable_mockModule("../services/ai/aiBudgetService.js", () => ({
  AI_METRICS: { IMAGE_EDITS: "imageEdits" },
  buildBudgetDenialMessage: () => "sin cupo",
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

const respuesta = () => ({
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
});

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

describe("imageAiCtrl · cobro de la edición", () => {
  test("una generación exitosa cobra en un solo movimiento", async () => {
    mockGenerate.mockResolvedValue({
      buffer: Buffer.from("resultado"),
      contentType: "image/png",
    });

    const res = await correr();

    expect(res.body.success).toBe(true);
    // Toda la contabilidad de una edición que salió bien es la reserva. Un
    // segundo paso que cobre es exactamente lo que se podía perder.
    expect(mockReserve).toHaveBeenCalledTimes(1);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  test("si el proveedor falla se devuelve con la clave de la reserva", async () => {
    // La devolución tiene que poder unirse con lo que anula: sin la clave son
    // dos filas sueltas, y un reintento del refund descuenta dos veces.
    mockGenerate.mockRejectedValue(new Error("replicate caído"));

    await expect(correr()).rejects.toThrow("replicate caído");

    expect(mockRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: "imageEdits",
        operationId: OPERATION_ID,
      }),
    );
  });

  test("el controlador no inventa la clave, usa la que le devuelven", async () => {
    mockGenerate.mockRejectedValue(new Error("replicate caído"));

    await expect(correr()).rejects.toThrow();

    const [[reserva]] = mockReserve.mock.calls;
    const [[devolucion]] = mockRefund.mock.calls;

    expect(reserva.operationId).toBeUndefined();
    expect(devolucion.operationId).toBe(OPERATION_ID);
  });

  test("sin cupo no se llama al proveedor ni se devuelve nada", async () => {
    mockReserve.mockResolvedValue({
      allowed: false,
      reason: "limit_reached",
      metric: "imageEdits",
    });

    const res = await correr();

    expect(res.statusCode).toBe(402);
    expect(mockGenerate).not.toHaveBeenCalled();
    // No se reservó nada, así que no hay nada que devolver.
    expect(mockRefund).not.toHaveBeenCalled();
  });
});
