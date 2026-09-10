// Webhook de suscripciones de Mercado Pago.
//
// Cuatro defectos que convivían y se tapaban entre sí:
//
// 1. La URL declarada a Mercado Pago (`/api/subscriptions/webhook/mercadopago`)
//    no correspondía a ninguna ruta. La real era
//    `/api/webhooks/mercadopago/subscription`. La ruta estaba escrita dos veces
//    y las copias divergieron, así que cada suscripción quedaba registrada
//    contra un 404 y ningún evento llegaba jamás.
// 2. No se verificaba la firma. Cualquiera con la URL podía cancelar la
//    suscripción de un comercio o marcarla como pagada.
// 3. No había idempotencia: un reintento de Mercado Pago volvía a aplicar la
//    misma transición.
// 4. El `catch` devolvía 200. Eso le dice al proveedor "lo apliqué" cuando no
//    se aplicó nada, y el evento se pierde para siempre.
//
// El (1) es el que hacía invisibles a los otros tres: sin eventos llegando,
// ninguno de los demás se podía manifestar.

import { jest } from "@jest/globals";

const TENANT = { _id: "64b7f0000000000000000001", name: "Comercio", plan: "pro" };

const mockVerify = jest.fn();
const mockTenantFindOne = jest.fn();
const mockTenantUpdate = jest.fn();
const mockEventCreate = jest.fn();
const mockEventFindOne = jest.fn();
const mockEventUpdate = jest.fn();
const mockSendEmail = jest.fn();

jest.unstable_mockModule("../services/paymentWebhookService.js", () => ({
  verifyMercadoPagoWebhookSignature: mockVerify,
}));

jest.unstable_mockModule("../models/tenantModel.js", () => ({
  default: { findOne: mockTenantFindOne, findByIdAndUpdate: mockTenantUpdate },
}));

jest.unstable_mockModule("../models/subscriptionWebhookEventModel.js", () => ({
  default: {
    create: mockEventCreate,
    findOne: mockEventFindOne,
    updateOne: mockEventUpdate,
  },
  WEBHOOK_EVENT_STATUS: {
    PROCESSING: "processing",
    PROCESSED: "processed",
    FAILED: "failed",
  },
}));

jest.unstable_mockModule("../services/emailService.js", () => ({
  sendTemplateEmail: mockSendEmail,
}));

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { handleSubscriptionWebhook } = await import(
  "../controller/subscriptionWebhookCtrl.js"
);
const { default: webhookRoutes } = await import("../routes/webhookRoutes.js");
const config = await import("../config/subscriptionConfig.js");

const respuesta = () => ({
  statusCode: 0,
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

const pedido = (extra = {}) => ({
  headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "req-1" },
  originalUrl: "/api/webhooks/mercadopago/subscription",
  body: { type: "subscription_authorized", data: { id: "mp-sub-1" } },
  ...extra,
});

const correr = async req => {
  const res = respuesta();
  await handleSubscriptionWebhook(req || pedido(), res);
  return res;
};

const duplicado = error => {
  const err = new Error("E11000 duplicate key");
  err.code = 11000;
  return err;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockVerify.mockReturnValue(true);
  mockEventCreate.mockResolvedValue({ _id: "evt-1" });
  mockEventUpdate.mockResolvedValue({});
  mockTenantFindOne.mockResolvedValue(TENANT);
  mockTenantUpdate.mockResolvedValue({ ...TENANT, integrations: {} });
  mockSendEmail.mockResolvedValue({});
});

describe("webhook de suscripción · la URL declarada existe", () => {
  test("la ruta registrada es exactamente la que se le declara a Mercado Pago", () => {
    // Este es el test que faltaba. La ruta se escribía dos veces —en el router
    // y en el constructor de la URL— y nada comparaba las dos copias.
    const rutas = webhookRoutes.stack
      .filter(capa => capa.route)
      .map(capa => capa.route.path);

    expect(rutas).toContain(config.SUBSCRIPTION_WEBHOOK_ROUTE);
    expect(config.SUBSCRIPTION_WEBHOOK_PATH).toBe(
      `${config.SUBSCRIPTION_WEBHOOK_MOUNT}${config.SUBSCRIPTION_WEBHOOK_ROUTE}`,
    );
  });

  test("la URL pública termina en el path canónico", () => {
    process.env.PUBLIC_BACKEND_URL = "https://henko.onrender.com";
    process.env.API_PREFIX = "/api";

    expect(config.getWebhookUrl()).toBe(
      "https://henko.onrender.com/api/webhooks/mercadopago/subscription",
    );

    delete process.env.PUBLIC_BACKEND_URL;
  });

  test("sin URL pública HTTPS devuelve null en vez de romper el alta", () => {
    // Lanzar acá dejaría a un comercio sin poder suscribirse por una variable
    // de entorno faltante. Mercado Pago no exige notification_url.
    const previas = {
      PUBLIC_BACKEND_URL: process.env.PUBLIC_BACKEND_URL,
      BACKEND_URL: process.env.BACKEND_URL,
      WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL,
      API_BASE_URL: process.env.API_BASE_URL,
    };
    for (const clave of Object.keys(previas)) delete process.env[clave];

    expect(config.getWebhookUrl()).toBeNull();

    for (const [clave, valor] of Object.entries(previas)) {
      if (valor !== undefined) process.env[clave] = valor;
    }
  });
});

describe("webhook de suscripción · firma", () => {
  test("firma inválida devuelve 401 y no toca nada", async () => {
    mockVerify.mockReturnValue(false);

    const res = await correr();

    expect(res.statusCode).toBe(401);
    expect(mockEventCreate).not.toHaveBeenCalled();
    expect(mockTenantFindOne).not.toHaveBeenCalled();
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });

  test("la firma se valida ANTES de mirar el body", async () => {
    // Si se validara después, un body malformado de un atacante ya habría
    // recorrido código con datos que nadie autenticó.
    mockVerify.mockReturnValue(false);

    const res = await correr(pedido({ body: {} }));

    expect(res.statusCode).toBe(401);
  });

  test("body sin tipo o sin id devuelve 400", async () => {
    const res = await correr(pedido({ body: { type: "subscription_update" } }));

    expect(res.statusCode).toBe(400);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });
});

describe("webhook de suscripción · idempotencia", () => {
  test("un evento nuevo se procesa y queda marcado", async () => {
    const res = await correr();

    expect(res.statusCode).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalled();
    expect(mockEventUpdate).toHaveBeenCalledWith(
      { _id: "evt-1" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "processed" }),
      }),
    );
  });

  test("un evento ya procesado no se vuelve a aplicar", async () => {
    // Mercado Pago reintenta. La transición no puede correr dos veces.
    mockEventCreate.mockRejectedValue(duplicado());
    mockEventFindOne.mockResolvedValue({ _id: "evt-1", status: "processed" });

    const res = await correr();

    expect(res.statusCode).toBe(200);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });

  test("un evento en curso en otra instancia no se duplica", async () => {
    mockEventCreate.mockRejectedValue(duplicado());
    mockEventFindOne.mockResolvedValue({ _id: "evt-1", status: "processing" });

    const res = await correr();

    expect(res.statusCode).toBe(200);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });

  test("un evento que falló antes SÍ se reprocesa", async () => {
    // Es el reintento que se pidió devolviendo 500. Si no se reprocesara, el
    // 500 habría sido una promesa vacía.
    mockEventCreate.mockRejectedValue(duplicado());
    mockEventFindOne.mockResolvedValue({ _id: "evt-1", status: "failed" });

    const res = await correr();

    expect(res.statusCode).toBe(200);
    expect(mockTenantUpdate).toHaveBeenCalled();
  });

  test("la clave distingue eventos distintos de la misma suscripción", async () => {
    await correr();
    await correr(
      pedido({ body: { type: "subscription_canceled", data: { id: "mp-sub-1" } } }),
    );

    const [primera, segunda] = mockEventCreate.mock.calls.map(([doc]) => doc.eventId);

    expect(primera).not.toBe(segunda);
    expect(primera).toContain("mp-sub-1");
  });
});

describe("webhook de suscripción · códigos HTTP", () => {
  test("un fallo al procesar devuelve 500, no 200", async () => {
    // El 200 le decía a Mercado Pago que el cobro se había aplicado. La
    // suscripción quedaba sin actualizar y el evento se perdía para siempre.
    mockTenantUpdate.mockRejectedValue(new Error("mongo caído"));

    const res = await correr();

    expect(res.statusCode).toBe(500);
    expect(mockEventUpdate).toHaveBeenCalledWith(
      { _id: "evt-1" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  test("si no se puede ni registrar el evento devuelve 500", async () => {
    mockEventCreate.mockRejectedValue(new Error("mongo caído"));

    const res = await correr();

    expect(res.statusCode).toBe(500);
    expect(mockTenantFindOne).not.toHaveBeenCalled();
  });

  test("una suscripción sin tenant se cierra con 200 y no se reintenta", async () => {
    // Reintentar no lo va a encontrar. Se cierra el evento para que un
    // reintento no repita la búsqueda.
    mockTenantFindOne.mockResolvedValue(null);

    const res = await correr();

    expect(res.statusCode).toBe(200);
    expect(mockEventUpdate).toHaveBeenCalledWith(
      { _id: "evt-1" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "processed" }),
      }),
    );
  });
});
