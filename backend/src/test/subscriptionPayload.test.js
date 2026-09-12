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

const { buildMercadoPagoSubscriptionData } = await import(
  "../services/subscriptionPaymentService.js"
);

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
