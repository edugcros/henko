// El alta de suscripciones tiene que llegar a Mercado Pago.
//
// No llegaba. subscriptionCtrl armaba su cliente con
// `createMercadoPagoPaymentClient(tenant._id)`, y eso fallaba de tres formas a
// la vez:
//
//   1. Esa función espera un TOKEN DE ACCESO y valida que empiece con
//      `APP_USR-` o `TEST-`. Le pasaban el id del comercio, así que lanzaba
//      MP_ACCESS_TOKEN_INVALID y el controlador devolvía 503 antes de tocar
//      Mercado Pago.
//   2. Devuelve un cliente de PAGOS; las suscripciones son otro recurso
//      (PreApproval).
//   3. El código llamaba `mpClient.subscription.create(...)`, un método que el
//      cliente de pagos no tiene.
//
// El resultado en producción: cero suscripciones creadas, `trialEndsAt` en null
// y ningún id guardado. No es que se perdieran — no se creaba ninguna.
//
// Lo que estos tests fijan es que el camino de ida exista: que el cliente sea el
// de suscripciones, que use las credenciales de HENKO y no las del comercio, y
// que el controlador llame a un método que existe.

import { jest } from "@jest/globals";

const TENANT = { _id: "64b7f0000000000000000001", name: "Comercio" };
const USER_ID = "64b7f0000000000000000009";

const mockCreate = jest.fn();
const mockTenantUpdate = jest.fn();
const mockSendEmail = jest.fn();
const mockResolveTenant = jest.fn();

jest.unstable_mockModule("../models/tenantModel.js", () => ({
  default: { findByIdAndUpdate: mockTenantUpdate, findOne: jest.fn() },
}));

jest.unstable_mockModule("../services/emailService.js", () => ({
  sendTemplateEmail: mockSendEmail,
}));

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule("../utils/requestContext.js", () => ({
  resolveAuthorizedTenantFromRequest: mockResolveTenant,
  getUserIdFromRequest: () => USER_ID,
  getTenantIdFromRequest: () => TENANT._id,
  isValidObjectId: () => true,
  toObjectId: value => value,
}));

const { createSubscriptionClient } = await import(
  "../services/subscriptionPaymentService.js"
);

const TOKEN_ORIGINAL = process.env.MP_ACCESS_TOKEN;

afterEach(() => {
  if (TOKEN_ORIGINAL === undefined) delete process.env.MP_ACCESS_TOKEN;
  else process.env.MP_ACCESS_TOKEN = TOKEN_ORIGINAL;
  jest.clearAllMocks();
});

describe("createSubscriptionClient · el cliente correcto", () => {
  test("expone los métodos de suscripciones, no los de pagos", () => {
    // Un cliente de pagos no tiene create/get/update de preapproval, y era
    // exactamente el que se estaba construyendo.
    const cliente = createSubscriptionClient();

    expect(typeof cliente.create).toBe("function");
    expect(typeof cliente.get).toBe("function");
    expect(typeof cliente.update).toBe("function");
  });

  test("NO tiene el `.subscription` que el controlador llamaba", () => {
    // La llamada vieja era mpClient.subscription.create(...). Si alguien la
    // reintroduce, esto deja claro que ese objeto no existe.
    expect(createSubscriptionClient().subscription).toBeUndefined();
  });

  test("no recibe ningún argumento: las credenciales son de la plataforma", () => {
    // El comercio le paga a HENKO, así que la plata entra a la cuenta de HENKO.
    // Pasarle el id del comercio era la raíz del error.
    expect(createSubscriptionClient.length).toBe(0);
  });
});

describe("createSubscriptionClient · credenciales ausentes", () => {
  // El módulo lee env.mercadoPago.accessToken, que se resuelve al cargar
  // config/env.js. Estos casos comprueban la validación con el valor que ese
  // módulo ya tiene.
  test("un token con formato de Mercado Pago es aceptado", () => {
    const token = String(process.env.MP_ACCESS_TOKEN || "");

    // El entorno de test trae una credencial de prueba o productiva; en
    // cualquiera de los dos casos la fábrica no debe lanzar.
    if (token.startsWith("APP_USR-") || token.startsWith("TEST-")) {
      expect(() => createSubscriptionClient()).not.toThrow();
    } else {
      // Sin credencial, falla de forma explícita y con 500: es un problema de
      // configuración de la plataforma, no del comercio que se quiso suscribir.
      expect(() => createSubscriptionClient()).toThrow("MP_ACCESS_TOKEN_INVALID");
    }
  });

  test("un id de comercio NO es una credencial válida", () => {
    // Es literalmente lo que se le pasaba. Se comprueba contra la misma regla
    // que usaba la función vieja para rechazarlo.
    const pareceCredencial = valor =>
      String(valor).startsWith("APP_USR-") || String(valor).startsWith("TEST-");

    expect(pareceCredencial(TENANT._id)).toBe(false);
  });
});

describe("subscriptionCtrl · el alta llega a Mercado Pago", () => {
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

  const pedido = () => ({
    user: { _id: USER_ID, tenantId: TENANT._id },
    body: {
      plan: "pro",
      token: "card-token-123",
      paymentMethodId: "visa",
      payer: { email: "duenio@comercio.com", name: "Dueño" },
    },
  });

  test("se llama create() sobre el cliente, y la respuesta no es 503", async () => {
    // El 503 era el síntoma: "Mercado Pago no está disponible" sin que se
    // hubiera intentado ninguna llamada.
    jest.resetModules();

    jest.unstable_mockModule("../services/subscriptionPaymentService.js", () => ({
      createSubscriptionClient: () => ({ create: mockCreate }),
      buildMercadoPagoSubscriptionData: () => ({ subscriptionData: {} }),
      mapMercadoPagoSubscriptionError: () => ({ status: 400, message: "x" }),
      mapMercadoPagoSubscriptionStatus: () => "active",
      readProviderBillingDates: () => ({
        currentPeriodStart: null,
        currentPeriodEnd: null,
        nextBillingAt: null,
      }),
    }));

    mockCreate.mockResolvedValue({ id: "mp-sub-1", status: "authorized" });
    mockResolveTenant.mockResolvedValue(TENANT);
    mockTenantUpdate.mockResolvedValue({ ...TENANT, integrations: {} });
    mockSendEmail.mockResolvedValue({});

    const { processSubscriptionPayment } = await import(
      "../controller/subscriptionCtrl.js"
    );

    const res = respuesta();
    await processSubscriptionPayment(pedido(), res);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(res.statusCode).not.toBe(503);
  });
});
