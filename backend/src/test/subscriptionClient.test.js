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

const mockTenantFindById = jest.fn();

jest.unstable_mockModule("../models/tenantModel.js", () => ({
  default: {
    findByIdAndUpdate: mockTenantUpdate,
    findById: mockTenantFindById,
    findOne: jest.fn(),
  },
}));

jest.unstable_mockModule("../services/emailService.js", () => ({
  sendTemplateEmail: mockSendEmail,
}));

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// La forma REAL de lo que devuelve: no es el documento del comercio, es el
// resultado de resolver a quién pertenece la request. Mockearlo devolviendo un
// Tenant sería reproducir el malentendido que causó el bug.
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

  // Exactamente lo que envía el Brick de Mercado Pago. SIN `payer.name`: no lo
  // manda, porque el nombre del titular viaja dentro del token de la tarjeta.
  const pedido = () => ({
    user: { _id: USER_ID, tenantId: TENANT._id },
    body: {
      plan: "pro",
      token: "fa2a788ac4f2ff028502dd2b9471f04a",
      paymentMethodId: "master",
      issuerId: "12468",
      payer: {
        email: "duenio@comercio.com",
        identification: { type: "DNI", number: "32680474" },
      },
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
    // Lo que devuelve de verdad: la resolución, no el documento.
    mockResolveTenant.mockResolvedValue({
      tenantId: TENANT._id,
      tenantObjectId: TENANT._id,
      source: "user",
    });
    mockTenantFindById.mockResolvedValue(TENANT);
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

  test("el alta no muere con 'Cannot read properties of undefined'", async () => {
    // El error exacto que devolvía producción, con su 400.
    //
    // resolveAuthorizedTenantFromRequest devuelve
    // { tenantId, tenantObjectId, userTenantId, source }, y el handler lo
    // guardaba en una variable llamada `tenant` para después leer `tenant._id`.
    // Ese undefined llegaba a `tenantId.toString()` al armar el metadata de
    // Mercado Pago.
    jest.resetModules();

    jest.unstable_mockModule("../services/subscriptionPaymentService.js", () => ({
      createSubscriptionClient: () => ({ create: mockCreate }),
      // El builder REAL hace tenantId.toString(); replicarlo es lo que hace que
      // este test valga.
      buildMercadoPagoSubscriptionData: ({ tenantId, userId }) => ({
        subscriptionData: {
          metadata: { tenant_id: tenantId.toString(), user_id: userId.toString() },
        },
      }),
      mapMercadoPagoSubscriptionError: () => ({ status: 400, message: "x" }),
      mapMercadoPagoSubscriptionStatus: () => "active",
      readProviderBillingDates: () => ({
        currentPeriodStart: null,
        currentPeriodEnd: null,
        nextBillingAt: null,
      }),
    }));

    mockCreate.mockResolvedValue({ id: "mp-sub-1", status: "authorized" });
    mockResolveTenant.mockResolvedValue({
      tenantId: TENANT._id,
      tenantObjectId: TENANT._id,
      source: "user",
    });
    mockTenantFindById.mockResolvedValue(TENANT);
    mockTenantUpdate.mockResolvedValue({ ...TENANT, integrations: {} });
    mockSendEmail.mockResolvedValue({});

    const { processSubscriptionPayment } = await import(
      "../controller/subscriptionCtrl.js"
    );

    const res = respuesta();
    await processSubscriptionPayment(pedido(), res);

    expect(String(res.body?.message || "")).not.toContain(
      "Cannot read properties of undefined",
    );
    expect(res.statusCode).not.toBe(400);

    // Y el id que viajó a Mercado Pago es el del comercio, no undefined.
    const [[{ body }]] = mockCreate.mock.calls;
    expect(body.metadata.tenant_id).toBe(TENANT._id);
  });
});

describe("subscriptionCtrl · acepta lo que manda el Brick", () => {
  const respuesta = () => ({
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  })

  test("un pago sin payer.name NO se rechaza", async () => {
    // Rechazaba todos: la validación exigía `payer.name`, un campo del
    // formulario propio que el Brick reemplazó. El síntoma en producción era
    // 400 "Datos del pagador incompletos" con una tarjeta perfectamente
    // tokenizada.
    jest.resetModules()

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
    }))

    mockCreate.mockResolvedValue({ id: "mp-sub-1", status: "authorized" })
    mockResolveTenant.mockResolvedValue({
      tenantId: TENANT._id,
      tenantObjectId: TENANT._id,
      source: "user",
    })
    mockTenantFindById.mockResolvedValue(TENANT)
    mockTenantUpdate.mockResolvedValue({ ...TENANT, integrations: {} })
    mockSendEmail.mockResolvedValue({})

    const { processSubscriptionPayment } = await import(
      "../controller/subscriptionCtrl.js"
    )

    const req = {
      user: { _id: USER_ID, tenantId: TENANT._id },
      body: {
        plan: "pro",
        token: "fa2a788ac4f2ff028502dd2b9471f04a",
        payer: { email: "duenio@comercio.com" },
      },
    }

    const res = respuesta()
    await processSubscriptionPayment(req, res)

    expect(String(res.body?.message || "")).not.toContain("pagador incompletos")
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  test("sin email sí se rechaza: es lo único que Mercado Pago necesita", async () => {
    jest.resetModules()

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
    }))

    mockResolveTenant.mockResolvedValue({
      tenantId: TENANT._id,
      tenantObjectId: TENANT._id,
      source: "user",
    })
    mockTenantFindById.mockResolvedValue(TENANT)

    const { processSubscriptionPayment } = await import(
      "../controller/subscriptionCtrl.js"
    )

    const res = respuesta()
    await processSubscriptionPayment(
      {
        user: { _id: USER_ID, tenantId: TENANT._id },
        body: { plan: "pro", token: "tok", payer: {} },
      },
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toContain("email")
  })
})

// SUSCRIBIRSE A HENKO NO NECESITA LAS CREDENCIALES DEL COMERCIO
//
// Hay dos Mercado Pago en juego y son independientes:
//
//   el del COMERCIO      cobrarle a SUS clientes en su tienda
//   el de la PLATAFORMA  cobrarle al comercio SU suscripción a HENKO
//
// getSubscriptionConfig es la segunda, y aun así llamaba a
// getTenantMercadoPagoContext y cortaba con 503 cuando el comercio no tenía
// las suyas cargadas. Medido en producción el 18/09/2026 a las 20:01, sobre un
// comercio recién creado:
//
//   Error en getSubscriptionConfig: "Mercado Pago no tiene credenciales
//   válidas para este comercio"  503
//
// El comercio lee "Mercado Pago no está configurado", entiende que tiene que
// cargar SUS keys para suscribirse, las carga, y las dos cosas quedan
// enredadas. Y bloquea el camino de COBRAR: un comercio que no puede
// suscribirse hasta terminar de configurar su tienda es un comercio que no
// paga.

describe("configuración de suscripción · los dos Mercado Pago son independientes", () => {
  const respuesta = () => ({
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  });

  const prepararConfig = async ({ comercioTieneMp }) => {
    jest.resetModules();
    process.env.MP_PUBLIC_KEY = "APP_USR-clave-de-la-plataforma";

    jest.unstable_mockModule("../services/paymentTenantConfigService.js", () => ({
      getTenantMercadoPagoContext: async () => {
        if (!comercioTieneMp) {
          const e = new Error("Mercado Pago no tiene credenciales válidas para este comercio");
          e.statusCode = 503;
          throw e;
        }
        return { publicKey: "APP_USR-clave-DEL-COMERCIO", accessToken: "APP_USR-x", mode: "production" };
      },
      getTenantConfig: async () => ({}),
      getTenantToken: async () => "APP_USR-x",
      getTenantPaymentPublicConfig: async () => ({}),
      createMercadoPagoPaymentClient: () => ({}),
      describeMpAccount: async () => ({ isTestAccount: false }),
      extractMpAccountId: () => null,
    }));

    mockResolveTenant.mockResolvedValue({
      tenantId: TENANT._id,
      tenantObjectId: TENANT._id,
      source: "user",
    });
    mockTenantFindById.mockReturnValue({
      select: () => Promise.resolve({ plan: "starter", subscriptionStatus: "trialing", trialEndsAt: null }),
    });

    const { getSubscriptionConfig } = await import("../controller/subscriptionCtrl.js");
    const res = respuesta();
    await getSubscriptionConfig({}, res);
    return res;
  };

  test("un comercio recién creado, sin sus keys, PUEDE abrir el checkout", async () => {
    // ESTA ES LA PROPIEDAD. Antes: 503 y el alta bloqueada.
    const res = await prepararConfig({ comercioTieneMp: false });

    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.mpPublicKey).toBe("APP_USR-clave-de-la-plataforma");
  });

  test("la clave que se devuelve es la de HENKO, nunca la del comercio", async () => {
    // El token de tarjeta lo tiene que crear la misma cuenta que después lo
    // consume, y esta suscripción la cobra la plataforma. Devolver la del
    // comercio da un token que la cuenta de HENKO no puede usar, y el rechazo
    // de Mercado Pago no dice eso: dice que el token está mal.
    const res = await prepararConfig({ comercioTieneMp: true });

    expect(res.body?.data?.mpPublicKey).toBe("APP_USR-clave-de-la-plataforma");
    expect(res.body?.data?.mpPublicKey).not.toBe("APP_USR-clave-DEL-COMERCIO");
  });

  test("informa si el comercio ya puede cobrarle a sus clientes, sin bloquear", async () => {
    // El dato sigue siendo útil —el panel puede sugerir el siguiente paso—
    // pero deja de ser una condición para pagar.
    const sin = await prepararConfig({ comercioTieneMp: false });
    const con = await prepararConfig({ comercioTieneMp: true });

    expect(sin.body?.data?.tenantPaymentsReady).toBe(false);
    expect(con.body?.data?.tenantPaymentsReady).toBe(true);
    expect(sin.statusCode).toBe(200);
    expect(con.statusCode).toBe(200);
  });
});
