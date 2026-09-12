// El estado de la suscripción viene del proveedor, y se puede guardar.
//
// DOS FALLAS ENCADENADAS, contra una base real porque ninguna se ve con mocks.
//
// 1. `integrations.subscriptionMercadoPago` no estaba declarado en el schema, y
//    el schema es estricto: cada escritura se descartaba en silencio. El
//    `subscriptionId` nunca llegó a guardarse.
//
// 2. Peor: Mongoose 6 trae `strictQuery` en true, que borra del FILTRO las
//    rutas no declaradas. La búsqueda del webhook
//    —findOne({'integrations.subscriptionMercadoPago.subscriptionId': x})—
//    se convertía en findOne({}) y devolvía el PRIMER tenant de la colección.
//    Buscar por un identificador y recibir a otro: un evento de cancelación de
//    una suscripción inexistente cancelaba al comercio equivocado.
//
// Declarar el campo arregla las dos, porque una ruta declarada ya no se
// descarta ni al escribir ni al filtrar. El test lo comprueba con strictQuery
// en true, que es el peor caso.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
  "base64url",
);

let mongod;
let Tenant;
let readProviderBillingDates;
let getSubscriptionSummary;

const crearTenant = (nombre, extra = {}) =>
  Tenant.create({ name: nombre, slug: `${nombre.toLowerCase()}-${Date.now()}`, ...extra });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  Tenant = (await import("../models/tenantModel.js")).default;
  ({ readProviderBillingDates } = await import(
    "../services/subscriptionPaymentService.js"
  ));
  ({ getSubscriptionSummary } = await import(
    "../services/subscriptionMetricsService.js"
  ));
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

afterEach(async () => {
  await Tenant.collection.deleteMany({});
});

describe("suscripción · el id del proveedor se guarda de verdad", () => {
  test("los campos de Mercado Pago persisten", async () => {
    const tenant = await crearTenant("Comercio");

    await Tenant.findByIdAndUpdate(tenant._id, {
      "integrations.subscriptionMercadoPago": {
        subscriptionId: "mp-sub-1",
        status: "authorized",
        payerEmail: "duenio@comercio.com",
        planSelected: "pro",
      },
    });

    const leido = await Tenant.findById(tenant._id).lean();
    const mp = leido.integrations?.subscriptionMercadoPago;

    // Antes esto era null: el schema descartaba el objeto entero.
    expect(mp).toBeTruthy();
    expect(mp.subscriptionId).toBe("mp-sub-1");
    expect(mp.status).toBe("authorized");
    expect(mp.payerEmail).toBe("duenio@comercio.com");
  });

  test("el webhook encuentra al comercio correcto entre varios", async () => {
    const a = await crearTenant("ComercioA");
    await crearTenant("ComercioB");

    await Tenant.findByIdAndUpdate(a._id, {
      "integrations.subscriptionMercadoPago.subscriptionId": "mp-de-A",
    });

    const hallado = await Tenant.findOne({
      "integrations.subscriptionMercadoPago.subscriptionId": "mp-de-A",
    });

    expect(String(hallado._id)).toBe(String(a._id));
  });

  test("un id inexistente devuelve null, NO un comercio cualquiera", async () => {
    // El corazón del bug. Con el campo sin declarar y strictQuery en true, esta
    // misma consulta devolvía "ComercioA" — el primero de la colección.
    const previo = mongoose.get("strictQuery");
    mongoose.set("strictQuery", true);

    await crearTenant("ComercioA");
    await crearTenant("ComercioB");

    const hallado = await Tenant.findOne({
      "integrations.subscriptionMercadoPago.subscriptionId": "ID-QUE-NO-EXISTE",
    });

    mongoose.set("strictQuery", previo);

    expect(hallado).toBeNull();
  });

  test("una cancelación distingue pedida de efectiva", async () => {
    // Se puede pedir hoy una baja que recién corre al final del período pago.
    // Guardar las dos en el mismo campo perdía esa diferencia.
    const tenant = await crearTenant("Comercio");
    const pedida = new Date("2026-09-10T00:00:00.000Z");
    const efectiva = new Date("2026-10-01T00:00:00.000Z");

    await Tenant.findByIdAndUpdate(tenant._id, {
      "integrations.subscriptionMercadoPago.cancelAt": efectiva,
      "integrations.subscriptionMercadoPago.cancelledAt": pedida,
    });

    const mp = (await Tenant.findById(tenant._id).lean()).integrations
      .subscriptionMercadoPago;

    expect(mp.cancelAt.toISOString()).toBe(efectiva.toISOString());
    expect(mp.cancelledAt.toISOString()).toBe(pedida.toISOString());
  });
});

describe("suscripción · las fechas salen del proveedor", () => {
  test("sin datos del proveedor no se inventa ninguna fecha", async () => {
    // Este es el punto entero. Antes acá salía hoy+30, indistinguible de una
    // fecha real para quien la lee.
    const ciclo = readProviderBillingDates({});

    expect(ciclo.nextBillingAt).toBeNull();
    expect(ciclo.currentPeriodEnd).toBeNull();
    expect(ciclo.currentPeriodStart).toBeNull();
  });

  test("se usa next_payment_date cuando Mercado Pago lo informa", async () => {
    const ciclo = readProviderBillingDates({
      next_payment_date: "2026-10-15T10:00:00.000Z",
      auto_recurring: { start_date: "2026-09-15T10:00:00.000Z" },
    });

    expect(ciclo.nextBillingAt.toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(ciclo.currentPeriodStart.toISOString()).toBe(
      "2026-09-15T10:00:00.000Z",
    );
    // El período vigente termina cuando llega el próximo cobro. Es una
    // definición derivada del dato del proveedor, no un calendario nuestro.
    expect(ciclo.currentPeriodEnd.toISOString()).toBe(ciclo.nextBillingAt.toISOString());
  });

  test("el último cobro manda sobre la fecha de alta", async () => {
    // En una renovación, el período vigente arranca en el último cobro, no en
    // el día que el comercio se suscribió hace seis meses.
    const ciclo = readProviderBillingDates({
      auto_recurring: { start_date: "2026-03-01T00:00:00.000Z" },
      summarized: { last_charged_date: "2026-09-01T00:00:00.000Z" },
    });

    expect(ciclo.currentPeriodStart.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  test("una fecha ilegible del proveedor se descarta, no se propaga", async () => {
    const ciclo = readProviderBillingDates({ next_payment_date: "no es una fecha" });

    expect(ciclo.nextBillingAt).toBeNull();
  });
});

// ─── Lo que el panel muestra de la suscripción ───────────
//
// Las tres tarjetas de "Estado de suscripción" del dashboard salen de acá, y
// dos mentían: el ingreso recurrente venía de una tabla de precios en DÓLARES
// escrita en el servicio (26,14 y 99) que el panel formateaba con signo pesos,
// y "Próximo pago" mostraba la fecha del ÚLTIMO cobro.

describe("resumen de suscripción · lo que ve el panel", () => {
  const originales = {};

  const setEnv = (name, value) => {
    if (!(name in originales)) originales[name] = process.env[name];
    process.env[name] = value;
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(originales)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      delete originales[name];
    }
  });

  test("el ingreso recurrente es el precio vigente del plan, en pesos", async () => {
    setEnv("PLAN_PRICE_ARS_STARTER", "40000");

    const tenant = await crearTenant("ComercioPago", {
      plan: "starter",
      subscriptionStatus: "active",
    });

    const resumen = await getSubscriptionSummary(tenant._id);

    // 26.14 era el valor viejo: el precio en dólares de una lista que ya no
    // existe. Si alguien vuelve a escribir un número en el servicio, este test
    // lo agarra.
    expect(resumen.mrr).toBe(40000);
    expect(resumen.currency).toBe("ARS");
  });

  test("sin cobro activo no hay ingreso recurrente", async () => {
    setEnv("PLAN_PRICE_ARS_STARTER", "40000");

    const tenant = await crearTenant("ComercioBaja", {
      plan: "starter",
      subscriptionStatus: "cancelled",
    });

    const resumen = await getSubscriptionSummary(tenant._id);

    expect(resumen.mrr).toBe(0);
    // El plan se conserva al dar de baja: lo que cambia es el estado.
    expect(resumen.currentPlan).toBe("starter");
  });

  test("un plan sin precio configurado no inventa un ingreso", async () => {
    const tenant = await crearTenant("ComercioSinPrecio", {
      plan: "pro",
      subscriptionStatus: "active",
    });

    const resumen = await getSubscriptionSummary(tenant._id);

    expect(resumen.mrr).toBe(0);
  });

  test("el próximo cobro es el del proveedor, no el último pago", async () => {
    const tenant = await crearTenant("ComercioFechas", {
      plan: "starter",
      subscriptionStatus: "active",
    });

    await Tenant.findByIdAndUpdate(tenant._id, {
      "integrations.subscriptionMercadoPago.lastPaymentAt": new Date("2026-09-01T00:00:00.000Z"),
      "integrations.subscriptionMercadoPago.nextBillingAt": new Date("2026-10-01T00:00:00.000Z"),
    });

    const resumen = await getSubscriptionSummary(tenant._id);

    expect(new Date(resumen.nextBillingAt).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(resumen.lastPaymentAt).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  test("un comercio inexistente devuelve la misma forma, no otra", async () => {
    // Los caminos de error devolvían `nextBillingDate`, una clave que ninguna
    // otra salida producía: el panel leía undefined justo cuando algo falló.
    const resumen = await getSubscriptionSummary(new mongoose.Types.ObjectId());

    expect(Object.keys(resumen).sort()).toEqual([
      "currency",
      "currentPlan",
      "isActive",
      "lastPaymentAt",
      "mrr",
      "nextBillingAt",
      "pastDueAt",
      "status",
    ]);
  });
});
