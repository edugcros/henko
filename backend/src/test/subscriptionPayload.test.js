// El cuerpo que se le manda a /preapproval.
//
// EL CONTRATO, VERIFICADO
//
// PreApprovalRequest (clients/preApproval/commonTypes.d.ts del SDK) acepta
// exactamente: auto_recurring, back_url, card_token_id, external_reference,
// payer_email, preapproval_plan_id, reason y status. El SDK serializa el body
// con JSON.stringify tal cual, así que lo que no está en esa lista viaja igual
// y Mercado Pago lo ignora.
//
// Lo que se mandaba tenía dos defectos que no se ven mirando el código:
//
//   1. El email iba anidado en `payer: { email }`. Ese objeto no es parte del
//      contrato, así que el email del suscriptor NUNCA llegaba — y es el campo
//      con el que Mercado Pago identifica a quién le cobra.
//   2. Faltaba `status`. Sin él la suscripción queda en 'pending' esperando que
//      el comprador la autorice a mano, en un checkout que ya le pidió la
//      tarjeta y le prometió el cobro.

import { jest } from "@jest/globals";

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// fetchPlatformPayment lee env.mercadoPago.accessToken, y config/env.js captura
// process.env al importarse: esto tiene que estar antes.
process.env.MP_ACCESS_TOKEN = "APP_USR-token-de-plataforma-para-pruebas";

const {
  buildMercadoPagoSubscriptionData,
  mapMercadoPagoSubscriptionError,
  resolveSubscriptionEventTarget,
} = await import("../services/subscriptionPaymentService.js");

// Los planes ya no traen precio en el código: el dueño lo configura. Para probar
// el cuerpo hay que fijar uno, igual que en producción hay que configurarlo
// antes de poder vender.
beforeEach(() => {
  process.env.PLAN_PRICE_ARS_STARTER = "40000";
});

afterAll(() => {
  delete process.env.PLAN_PRICE_ARS_STARTER;
});

const armar = (extra = {}) =>
  buildMercadoPagoSubscriptionData({
    plan: "starter",
    tenantId: "64b7f0000000000000000001",
    userId: "64b7f0000000000000000009",
    email: "Duenio@Comercio.COM",
    token: "tok-de-mercadopago",
    payer: { name: "Eduardo" },
    ...extra,
  }).subscriptionData;

describe("payload de suscripción · el contrato", () => {
  test("el email del suscriptor va en payer_email, no anidado", () => {
    const body = armar();

    expect(body.payer_email).toBe("duenio@comercio.com");
    // El objeto `payer` no existe en PreApprovalRequest: mandarlo era mandar el
    // email a un campo que nadie lee.
    expect(body.payer).toBeUndefined();
  });

  test("pide el cobro, no una autorización pendiente", () => {
    expect(armar().status).toBe("authorized");
  });

  test("cobra en pesos", () => {
    const body = armar();

    expect(body.auto_recurring.currency_id).toBe("ARS");
    expect(body.auto_recurring.transaction_amount).toBe(40000);
  });

  test("el token de tarjeta viaja como card_token_id", () => {
    expect(armar().card_token_id).toBe("tok-de-mercadopago");
  });

  test("sin token no se inventa uno", () => {
    expect(armar({ token: undefined }).card_token_id).toBeUndefined();
    expect(armar({ token: "undefined" }).card_token_id).toBeUndefined();
  });

  test("no viaja nada fuera del contrato", () => {
    // metadata e issuer_id no son campos de /preapproval. La correlación con el
    // comercio y el usuario va en external_reference, que sí lo es.
    const body = armar({ issuerId: 310 });

    expect(body.metadata).toBeUndefined();
    expect(body.issuer_id).toBeUndefined();
    expect(body.external_reference).toContain("64b7f0000000000000000001");
    expect(body.external_reference).toContain("64b7f0000000000000000009");
  });

  test("un email inválido se rechaza antes de llamar a Mercado Pago", () => {
    expect(() => armar({ email: "no-es-un-email" })).toThrow("PAYER_EMAIL_INVALID");
  });

  test("un plan sin precio configurado se rechaza", () => {
    // No hay monto que cobrar, y un plan sin precio no se vende. Antes este
    // caso se producía con 'enterprise', que era a medida por definición; ese
    // plan ya no existe, así que ahora se produce como se produce de verdad:
    // un plan del catálogo al que todavía nadie le puso precio.
    expect(() => armar({ plan: "pro" })).toThrow("SUBSCRIPTION_PLAN_INVALID");
  });
});

// ─── Lo que manda el Brick, tal cual ─────────────────────
//
// El checkout dejó de tener formulario propio: los datos del pago los arma el
// Brick de Mercado Pago. Estos casos usan exactamente la forma que envía, para
// que una validación pensada para la pantalla vieja no vuelva a rechazar un
// pago bueno.

describe("payload · con lo que envía el Brick", () => {
  const DEL_BRICK = {
    token: "fa2a788ac4f2ff028502dd2b9471f04a",
    payment_method_id: "master",
    issuer_id: "12468",
    payer: {
      email: "duenio@comercio.com",
      identification: { type: "DNI", number: "32680474" },
    },
  };

  test("alcanza con el token y el email: no hace falta un nombre", () => {
    // `payer.name` era obligatorio y el Brick no lo manda — el nombre del
    // titular viaja dentro del token. Todo pago se rechazaba con "Datos del
    // pagador incompletos".
    const body = buildMercadoPagoSubscriptionData({
      plan: "starter",
      tenantId: "64b7f0000000000000000001",
      userId: "64b7f0000000000000000009",
      email: DEL_BRICK.payer.email,
      token: DEL_BRICK.token,
    }).subscriptionData;

    expect(body.payer_email).toBe("duenio@comercio.com");
    expect(body.card_token_id).toBe(DEL_BRICK.token);
  });

  test("el medio de pago y el emisor no viajan: ya están en el token", () => {
    const body = buildMercadoPagoSubscriptionData({
      plan: "starter",
      tenantId: "64b7f0000000000000000001",
      userId: "64b7f0000000000000000009",
      email: DEL_BRICK.payer.email,
      token: DEL_BRICK.token,
    }).subscriptionData;

    expect(body.payment_method_id).toBeUndefined();
    expect(body.issuer_id).toBeUndefined();
  });
});

describe("payload · fechas", () => {
  test("NO se manda start_date", () => {
    // Se mandaba `new Date().toISOString()`. Para cuando Mercado Pago lo lee ya
    // es pasado, y contesta "cannot be a past date". Es una carrera imposible de
    // ganar: cualquier instante que uno escriba llega viejo.
    //
    // El campo es opcional y omitirlo arranca la suscripción de inmediato.
    const body = buildMercadoPagoSubscriptionData({
      plan: "starter",
      tenantId: "64b7f0000000000000000001",
      userId: "64b7f0000000000000000009",
      email: "duenio@comercio.com",
      token: "tok",
    }).subscriptionData;

    expect(body.auto_recurring.start_date).toBeUndefined();
    // Y lo que sí tiene que viajar sigue viajando.
    expect(body.auto_recurring.frequency).toBe(1);
    expect(body.auto_recurring.frequency_type).toBe("months");
  });
});

// CLASIFICAR EL RECHAZO DEL PROVEEDOR
//
// El error del SDK expone `status`, `error` y `causes` — este último armado
// desde `body.cause` de la respuesta pero guardado en PLURAL. Ver
// node_modules/mercadopago/dist/utils/errors/index.js.
//
// El mapeador leía `cause`, que en ese objeto no existe. El array quedaba
// siempre vacío, ninguna rama podía disparar por el detalle del proveedor, y
// todo caía en el mensaje genérico.
//
// Medido: entre el 18 y el 19/09/2026 hubo diez rechazos seguidos y en los
// logs no había con qué distinguir una tarjeta rechazada de un problema de
// credenciales. Se investigó a ciegas por eso.

describe("clasificación del rechazo · el detalle del proveedor se lee", () => {
  test("una causa en `causes` se clasifica, no cae en el genérico", () => {
    // ESTA ES LA PROPIEDAD. Con el campo mal leído, esto devolvía
    // SUBSCRIPTION_PAYMENT_ERROR — el mensaje que no dice nada.
    const mapeado = mapMercadoPagoSubscriptionError({
      message: "Bad request",
      status: 400,
      causes: [{ description: "Invalid card token" }],
    });

    expect(mapeado.code).toBe("CARD_TOKEN_INVALID");
  });

  test("el código del proveedor también cuenta", () => {
    // Viaja en `error`, aparte del mensaje. Un rechazo cuyo motivo solo está
    // ahí se clasificaba como genérico.
    const mapeado = mapMercadoPagoSubscriptionError({
      message: "Bad request",
      status: 400,
      error: "invalid_card_token",
      causes: [],
    });

    expect(mapeado.code).toBe("CARD_TOKEN_INVALID");
  });

  test("un `cause` en singular sigue funcionando", () => {
    // Respaldo por si otra versión del SDK lo expone así. Leer los dos no
    // cuesta nada; equivocarse de campo otra vez sí.
    const mapeado = mapMercadoPagoSubscriptionError({
      message: "Bad request",
      status: 400,
      cause: [{ description: "security_code inválido" }],
    });

    expect(mapeado.code).toBe("CARD_CVV_INVALID");
  });

  test("sin detalle sigue habiendo un genérico honesto", () => {
    // Es el caso de CC_VAL_433: Mercado Pago no manda causas. El genérico está
    // bien ACÁ — lo que estaba mal era que todo terminara acá.
    const mapeado = mapMercadoPagoSubscriptionError({
      message: "CC_VAL_433 Credit card validation has failed",
      status: 400,
      causes: [],
    });

    expect(mapeado.code).toBe("SUBSCRIPTION_PAYMENT_ERROR");
    expect(mapeado.details).toContain("CC_VAL_433");
  });
});

// DE DONDE SE SACA EL ID DE LA SUSCRIPCION EN UN AVISO DE PAGO
//
// En los avisos `payment` y `subscription_authorized_payment`, data.id es el
// id de un PAGO. El id de la suscripcion viaja adentro del pago, en
// `point_of_interaction.transaction_data.subscription_id`.
//
// NO en `metadata`: medido sobre el pago 179806584762 del 19/09/2026, metadata
// llega vacio —`{}`— y el id esta solo en esa ruta. La primera version de esto
// leia metadata.preapproval_id y resolvia null siempre, asi que el webhook
// seguia descartando todas las renovaciones.

describe("aviso de pago · resolver a que suscripcion pertenece", () => {
  const pagoReal = {
    status: "rejected",
    status_detail: "cc_rejected_high_risk",
    payment_type_id: "prepaid_card",
    metadata: {},
    point_of_interaction: {
      transaction_data: { subscription_id: "415150e308f74399b2b44fc9c7f1a75d" },
    },
  };

  const conFetch = async (respuesta, evento) => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => respuesta }));
    return resolveSubscriptionEventTarget(evento);
  };

  test("lo saca de point_of_interaction, que es donde esta", async () => {
    // ESTA ES LA PROPIEDAD. Leyendo metadata devolvia null y el webhook
    // descartaba el evento.
    const r = await conFetch(pagoReal, { type: "payment", dataId: "179806584762" });

    expect(r.preapprovalId).toBe("415150e308f74399b2b44fc9c7f1a75d");
    expect(r.payment.status).toBe("rejected");
  });

  test("tambien lo acepta en metadata, por si otro evento lo trae asi", async () => {
    const r = await conFetch(
      { status: "approved", metadata: { preapproval_id: "desde-metadata" } },
      // `payment`, no `subscription_authorized_payment`: ese otro tipo va por
      // /authorized_payments, donde preapproval_id es de primer nivel y no
      // hace falta ningun respaldo.
      { type: "payment", dataId: "1" },
    );

    expect(r.preapprovalId).toBe("desde-metadata");
  });

  test("en un aviso de suscripcion, data.id YA es el id y no se consulta nada", async () => {
    // Pedirle el pago a Mercado Pago cuando el id ya sirve seria una llamada
    // de red por evento, para nada.
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const r = await resolveSubscriptionEventTarget({
      type: "subscription_canceled",
      dataId: "85f9b9519ee64fe78a03032061d5a42a",
    });

    expect(r.preapprovalId).toBe("85f9b9519ee64fe78a03032061d5a42a");
    expect(r.payment).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("si el pago no se puede leer, devuelve null en vez de romper", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));

    const r = await resolveSubscriptionEventTarget({ type: "payment", dataId: "9" });

    expect(r.preapprovalId).toBeNull();
    expect(r.payment).toBeNull();
  });
});

// EL COBRO RECURRENTE VIVE EN OTRO RECURSO
//
// Los avisos `subscription_authorized_payment` traen un id que NO existe en
// /v1/payments: devuelve 404. Esta en /authorized_payments. Comprobado el
// 19/09/2026 con el id 7032067277 — 404 en el primero, 200 en el segundo.
//
// Ahi el dato viene mejor: preapproval_id es de primer nivel y el cobro real
// viaja anidado en `payment` con su propio status. El envoltorio tiene su
// propio status ('processed') que dice que el AVISO se proceso, no que el
// cobro haya salido: confundirlos activaria comercios por cobros rechazados.

describe("cobro recurrente · sale de /authorized_payments", () => {
  test("pide el recurso correcto y saca el preapproval de primer nivel", async () => {
    // ESTA ES LA PROPIEDAD. Pidiendo /v1/payments daba 404 y el aviso se
    // descartaba con "no se pudo resolver".
    const urls = [];
    global.fetch = jest.fn(async url => {
      urls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          preapproval_id: "a97143a921a44a3ab0f8cb148edb79b1",
          status: "processed",
          payment: { id: 179809310096, status: "approved", status_detail: "accredited" },
        }),
      };
    });

    const r = await resolveSubscriptionEventTarget({
      type: "subscription_authorized_payment",
      dataId: "7032067277",
    });

    expect(urls[0]).toContain("/authorized_payments/7032067277");
    expect(urls[0]).not.toContain("/v1/payments");
    expect(r.preapprovalId).toBe("a97143a921a44a3ab0f8cb148edb79b1");
  });

  test("devuelve el pago ANIDADO, no el envoltorio", async () => {
    // El envoltorio dice status 'processed' —el aviso se proceso— y el cobro
    // real puede haber sido rechazado. Devolver el envoltorio activaria al
    // comercio sin que hubiera pagado.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        preapproval_id: "pre-1",
        status: "processed",
        payment: { status: "rejected", status_detail: "cc_rejected_high_risk" },
      }),
    }));

    const r = await resolveSubscriptionEventTarget({
      type: "subscription_authorized_payment",
      dataId: "1",
    });

    expect(r.payment.status).toBe("rejected");
  });
});
