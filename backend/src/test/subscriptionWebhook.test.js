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

const mockResolveTarget = jest.fn();

// resolveSubscriptionEventTarget sale a la API de Mercado Pago para traducir
// un id de PAGO al id de la suscripcion. Acá se controla su respuesta: lo que
// se prueba es qué hace el webhook con ella, no cómo se obtiene.
jest.unstable_mockModule("../services/subscriptionPaymentService.js", () => ({
  resolveSubscriptionEventTarget: mockResolveTarget,
  readProviderBillingDates: () => ({
    nextBillingAt: null,
    currentPeriodEnd: null,
    currentPeriodStart: null,
  }),
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
  // Por defecto: un aviso de suscripción, donde data.id YA es el preapproval.
  mockResolveTarget.mockResolvedValue({ preapprovalId: "mp-sub-1", payment: null });
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

  test("la ruta está exenta de CSRF, o el webhook nunca llega al controlador", async () => {
    // LA CUARTA COPIA DE LA MISMA RUTA.
    //
    // Estaba en el router y en getWebhookUrl —esas dos ya se comparan arriba—
    // pero faltaba en csrfExemptRoutes de app.js. Un webhook servidor-a-servidor
    // no trae cookies, así que el CSRF lo cortaba con 403 ANTES de llegar al
    // controlador: la firma, la idempotencia y los códigos HTTP que prueba el
    // resto de este archivo no se ejecutaban nunca en producción.
    //
    // Medido contra api.henkart.com.ar: POST a esta ruta devolvía 403 mientras
    // que /api/payments/webhook/mercadopago —que sí estaba en la lista—
    // devolvía 200. Arreglar la URL en el panel de Mercado Pago no habría
    // servido de nada.
    const { csrfExemptRoutes } = await import(
      "../middlewares/csrfMiddleware.js"
    );

    const exenta = csrfExemptRoutes.some(
      ruta =>
        ruta.method === "POST" &&
        ruta.path.endsWith(config.SUBSCRIPTION_WEBHOOK_PATH),
    );

    expect(exenta).toBe(true);
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

// EMPEZAR A PAGAR TERMINA LA PRUEBA, Y LA FECHA NO SE BORRABA
//
// `trialEndsAt` es el fin del período de prueba. Al activarse una suscripción
// no se pisa con una fecha nueva —eso la convertiría en "próximo cobro", que
// es otro concepto y vive en nextBillingAt— pero tampoco se borraba, así que
// un comercio que paga se quedaba con la fecha encima para siempre.
// subscriptionCtrl y tenantSettingsCtrl la exponen al panel tal cual.
//
// Medido: Henko en plan pro, subscriptionStatus 'active', con trialEndsAt el
// mismo día. El panel anunciaba el vencimiento y eso disparó seis intentos de
// pago seguidos por algo que no hacía falta. No cortaba el servicio —el gate
// de aiPlanPolicy solo mira trialEndsAt cuando el estado es 'trialing'— pero
// decía lo contrario de lo que pasaba.

describe("webhook de suscripción · activar termina la prueba", () => {
  test("al pasar a activo, trialEndsAt se borra", async () => {
    await correr();

    const [, cambios] = mockTenantUpdate.mock.calls[0];

    expect(cambios.subscriptionStatus).toBe("active");
    expect(cambios.trialEndsAt).toBeNull();
  });

  test("y NO se reemplaza por una fecha futura", async () => {
    // Escribirle hoy+30 haría que el corte por suscripción apague la IA de un
    // comercio que está pagando. La fecha del próximo cobro es otra cosa y
    // sale de lo que informe el proveedor.
    await correr();

    const [, cambios] = mockTenantUpdate.mock.calls[0];

    expect(cambios.trialEndsAt).not.toEqual(expect.any(Date));
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

// LOS AVISOS DE PAGO SON LAS RENOVACIONES, Y SE DESCARTABAN TODOS
//
// En `payment` y `subscription_authorized_payment`, data.id es el id de un
// PAGO. El webhook lo usaba tal cual contra
// integrations.subscriptionMercadoPago.subscriptionId, que guarda un id de
// preapproval — 32 caracteres hex contra 10 dígitos. No coinciden nunca.
//
// Medido en producción el 19/09/2026 a las 04:05:
//
//   type=payment  data.id=179804496028
//   -> "Tenant no encontrado para suscripción de MP"
//
// Y ese pago traía metadata.preapproval_id = 89dc868afe674fd39f84664aea5b5f28,
// más el motivo del rechazo: cc_rejected_high_risk sobre una prepaid_card.
// Todo el dato estaba; no se miraba.
//
// Encima esos tipos tampoco estaban en el switch: aunque el comercio se
// resolviera, caían en "Tipo de evento no procesado".

describe("webhook de suscripción · los avisos de pago se aplican", () => {
  const avisoDePago = () => ({
    headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "req-pago" },
    originalUrl: "/api/webhooks/mercadopago/subscription",
    body: { type: "payment", data: { id: "179804496028" } },
  });

  test("resuelve el comercio desde el pago, no desde data.id", async () => {
    // ESTA ES LA PROPIEDAD. Antes: "Tenant no encontrado" y evento descartado.
    mockResolveTarget.mockResolvedValue({
      preapprovalId: "89dc868afe674fd39f84664aea5b5f28",
      payment: { status: "approved" },
    });

    const res = await correr(avisoDePago());

    expect(res.statusCode).toBe(200);
    expect(mockTenantFindOne).toHaveBeenCalledWith({
      "integrations.subscriptionMercadoPago.subscriptionId":
        "89dc868afe674fd39f84664aea5b5f28",
    });
    // Y se aplicó: un cobro aprobado deja la suscripción activa.
    expect(mockTenantUpdate).toHaveBeenCalled();
  });

  test("un cobro rechazado NO se aplica como aprobado", async () => {
    // El caso real: cc_rejected_high_risk sobre una tarjeta prepaga. Tratarlo
    // como aprobado dejaría al comercio activo sin haber pagado.
    mockResolveTarget.mockResolvedValue({
      preapprovalId: "89dc868afe674fd39f84664aea5b5f28",
      payment: {
        status: "rejected",
        status_detail: "cc_rejected_high_risk",
        payment_method_id: "master",
        payment_type_id: "prepaid_card",
      },
    });

    const res = await correr(avisoDePago());

    expect(res.statusCode).toBe(200);

    const estados = mockTenantUpdate.mock.calls.map(
      ([, cambios]) => cambios?.subscriptionStatus,
    );
    expect(estados).not.toContain("active");
  });

  test("sin poder consultar el pago no se decide nada", async () => {
    // Marcar un cobro como aprobado o rechazado sin saberlo es peor que no
    // hacer nada: una caída de la API de Mercado Pago daría de baja o de alta
    // a comercios por adivinanza.
    mockResolveTarget.mockResolvedValue({
      preapprovalId: "89dc868afe674fd39f84664aea5b5f28",
      payment: null,
    });

    const res = await correr(avisoDePago());

    expect(res.statusCode).toBe(200);
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });

  test("si el pago no dice de qué suscripción es, no se toca a nadie", async () => {
    mockResolveTarget.mockResolvedValue({ preapprovalId: null, payment: null });

    const res = await correr(avisoDePago());

    expect(res.statusCode).toBe(200);
    expect(mockTenantFindOne).not.toHaveBeenCalled();
    expect(mockTenantUpdate).not.toHaveBeenCalled();
  });
});
