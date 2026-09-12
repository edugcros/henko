// Qué puede afirmar un navegador sobre las métricas de un comercio.
//
// El endpoint /api/metrics/events es público a propósito: la tienda tiene que
// poder reportar visitas desde el navegador. Lo que no puede es que un cliente
// se declare a sí mismo como el backend.
//
// EL AGUJERO
//
// Los números económicos no filtran por tipo de evento sino por
// `source: 'system'`. aiAgentRevenueInsightsService suma `$value` de los PURCHASE
// con esa fuente para calcular la facturación atribuida a la IA, y
// aiInsightDetectionService hace lo mismo para sus señales de venta. El
// controlador tomaba `source` del cuerpo y aceptaba 'system'.
//
// O sea que un POST público con
//   { eventType: 'purchase', source: 'system', value: 999999,
//     metadata: { aiInfluenced: true } }
// entraba directo al tablero económico.
//
// LO OTRO
//
// `productId` y `orderId` también los elige el cliente, y nadie comprobaba que
// fueran del comercio que manda el evento.
//
// Va contra una base real: lo que se prueba es una consulta con filtro por
// tenant, que con mocks solo probaría que la escribí como la escribí.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
  "base64url",
);

const TENANT = new mongoose.Types.ObjectId();
const OTRO_TENANT = new mongoose.Types.ObjectId();
const PRODUCTO_PROPIO = new mongoose.Types.ObjectId();
const PRODUCTO_AJENO = new mongoose.Types.ObjectId();
const ORDEN_AJENA = new mongoose.Types.ObjectId();

let mongod;
let trackUserMetricEvent;
let UserMetricEvent;

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

const enviar = async evento => {
  const req = {
    tenantId: TENANT,
    headers: { host: "tienda.test", "user-agent": "jest" },
    body: Array.isArray(evento) ? { events: evento } : evento,
    originalUrl: "/api/metrics/events",
    socket: { remoteAddress: "1.2.3.4" },
  };
  const res = respuesta();

  await trackUserMetricEvent(req, res, err => {
    if (err) throw err;
  });

  return res;
};

const evento = (extra = {}) => ({
  eventType: "product_view",
  sessionId: "sesion-1",
  ...extra,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  ({ trackUserMetricEvent } = await import("../controller/userMetricsCtrl.js"));
  UserMetricEvent = (await import("../models/userMetricEventModel.js")).default;

  const db = mongoose.connection.db;

  await db.collection("products").insertMany([
    { _id: PRODUCTO_PROPIO, tenantId: TENANT, title: "Propio" },
    { _id: PRODUCTO_AJENO, tenantId: OTRO_TENANT, title: "Ajeno" },
  ]);
  await db
    .collection("orders")
    .insertOne({ _id: ORDEN_AJENA, tenantId: OTRO_TENANT });
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

afterEach(async () => {
  await UserMetricEvent.collection.deleteMany({});
});

const guardado = () => UserMetricEvent.collection.findOne({});

describe("métricas · fuentes reservadas", () => {
  test("un cliente NO puede declararse 'system'", async () => {
    // El evento que inflaba el tablero económico.
    const res = await enviar(
      evento({
        eventType: "purchase",
        source: "system",
        value: 999999,
        metadata: { aiInfluenced: true },
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(await guardado()).toBeNull();
  });

  test("tampoco 'admin', ni escrita de otra forma", async () => {
    for (const source of ["admin", "SYSTEM", " System "]) {
      const res = await enviar(evento({ source }));
      expect({ source, status: res.statusCode }).toEqual({ source, status: 400 });
    }
  });

  test("'agent' NO está reservada: la manda el navegador", async () => {
    // AiCartActionBridge marca con ella el agregado al carrito que originó el
    // chat, y markOrderAiInfluenced lo usa para atribuirle la compra a la IA.
    // Reservarla rompería esa atribución entera — es el caso donde la
    // clasificación obvia habría roto una función que anda.
    const res = await enviar(
      evento({
        eventType: "add_to_cart",
        source: "agent",
        productId: String(PRODUCTO_PROPIO),
      }),
    );

    expect(res.statusCode).toBe(201);
    expect((await guardado()).source).toBe("agent");
  });

  test("un lote entero se rechaza si UNO de sus eventos la reclama", async () => {
    // Quedarse con el resto sería aceptar un envío que ya se sabe manipulado.
    const res = await enviar([
      evento(),
      evento({ eventType: "purchase", source: "system", value: 500000 }),
    ]);

    expect(res.statusCode).toBe(400);
    expect(await guardado()).toBeNull();
  });

  test("las fuentes de cliente siguen funcionando", async () => {
    const res = await enviar(evento({ source: "storefront" }));

    expect(res.statusCode).toBe(201);
    expect((await guardado()).source).toBe("storefront");
  });

  test("una fuente desconocida se guarda como 'unknown', no se rechaza", async () => {
    // No es un intento de suplantación: es un cliente viejo o un typo.
    const res = await enviar(evento({ source: "algo-raro" }));

    expect(res.statusCode).toBe(201);
    expect((await guardado()).source).toBe("unknown");
  });

  test("la tienda puede seguir reportando su propia compra", async () => {
    // El checkout manda purchase y payment_approved desde el navegador. Eso no
    // se bloquea: queda con fuente 'storefront', que es analítica de cliente y
    // los agregados económicos no la miran.
    const res = await enviar(
      evento({ eventType: "purchase", source: "storefront", value: 1500 }),
    );

    expect(res.statusCode).toBe(201);
    expect((await guardado()).source).toBe("storefront");
  });
});

describe("métricas · referencias de otro comercio", () => {
  test("un producto ajeno no queda vinculado, ni como id ni como texto", async () => {
    const res = await enviar(evento({ productId: String(PRODUCTO_AJENO) }));

    expect(res.statusCode).toBe(201);

    const fila = await guardado();

    // El evento se conserva —la visita ocurrió— pero sin la referencia.
    expect(fila.productId).toBeNull();
    // `productRef` es la copia en texto del mismo id. Dejarla es dejar el id
    // del producto de otro comercio guardado igual.
    expect(fila.productRef).toBeFalsy();
  });

  test("una orden ajena tampoco", async () => {
    const res = await enviar(
      evento({ eventType: "purchase", orderId: String(ORDEN_AJENA) }),
    );

    expect(res.statusCode).toBe(201);

    const fila = await guardado();

    expect(fila.orderObjectId).toBeNull();
    // Y el string: el modelo tiene un hook que reconstruye orderObjectId desde
    // orderId cuando el primero viene vacío, así que anular solo el ObjectId lo
    // devuelve intacto antes de guardar.
    expect(fila.orderId).toBeFalsy();
  });

  test("un producto propio sí se vincula", async () => {
    const res = await enviar(evento({ productId: String(PRODUCTO_PROPIO) }));

    expect(res.statusCode).toBe(201);
    expect(String((await guardado()).productId)).toBe(String(PRODUCTO_PROPIO));
  });

  test("un id que no existe se trata como ajeno", async () => {
    const inexistente = new mongoose.Types.ObjectId();

    await enviar(evento({ productId: String(inexistente) }));

    expect((await guardado()).productId).toBeNull();
  });

  test("un lote mezclado conserva lo propio y anula lo ajeno", async () => {
    await enviar([
      evento({ sessionId: "s1", productId: String(PRODUCTO_PROPIO) }),
      evento({ sessionId: "s2", productId: String(PRODUCTO_AJENO) }),
    ]);

    const filas = await UserMetricEvent.collection.find({}).toArray();
    const porSesion = Object.fromEntries(
      filas.map(f => [f.sessionId, f.productId ? String(f.productId) : null]),
    );

    expect(porSesion).toEqual({
      s1: String(PRODUCTO_PROPIO),
      s2: null,
    });
  });
});

// ─── Lo que el tablero cuenta como actividad de la tienda ────────────────────
//
// Dos números del dashboard salían mal de acá, y ninguno se ve leyendo el
// código de a una función: hay que mirar qué hay guardado.
//
//  1. El panel de administración también escribe UserMetricEvent —cada login
//     del dueño es uno—, y el bloque de comportamiento no filtraba por fuente.
//     En producción eran 39 de 46 "logins", más la sesión del dueño contada
//     como sesión de la tienda: el divisor de la conversión.
//
//  2. Una venta deja DOS eventos purchase, el del navegador y el del backend.
//     El embudo mostraba 6 compras sobre 3 órdenes pagadas.

describe("métricas · actividad de la tienda vs. del panel", () => {
  const TENANT_STATS = new mongoose.Types.ObjectId();

  let getDashboardStats;

  const guardarEventos = async eventos => {
    const ahora = new Date();

    await UserMetricEvent.collection.insertMany(
      eventos.map((e, i) => ({
        tenantId: TENANT_STATS,
        eventType: e.eventType,
        source: e.source,
        sessionId: e.sessionId,
        occurredAt: ahora,
        createdAt: ahora,
        // En PESOS, como lo escribe commerceEventService al registrar una
        // compra: hace Money.toDecimal(amountCents) antes de guardar.
        value: e.value || 0,
        attribution: e.attribution || {},
        metadata: e.metadata || {},
        path: "/",
        eventIndex: i,
      })),
    );
  };

  beforeAll(async () => {
    ({ getDashboardStats } = await import("../services/statsService.js"));
  });

  afterEach(async () => {
    await UserMetricEvent.collection.deleteMany({ tenantId: TENANT_STATS });
  });

  test("los eventos del panel no cuentan como actividad de la tienda", async () => {
    await guardarEventos([
      { eventType: "login", source: "admin", sessionId: "sesion-del-duenio" },
      { eventType: "login", source: "admin", sessionId: "sesion-del-duenio" },
      { eventType: "login", source: "storefront", sessionId: "sesion-de-un-cliente" },
      { eventType: "page_view", source: "storefront", sessionId: "sesion-de-un-cliente" },
    ]);

    const { summary } = await getDashboardStats(String(TENANT_STATS), "30d");

    // Antes: 3 logins y 2 sesiones. El dueño entrando a su propio panel movía
    // la conversión de su tienda.
    expect(summary.logins).toBe(1);
    expect(summary.sessions).toBe(1);
  });

  test("una venta es una compra, aunque deje dos eventos", async () => {
    await guardarEventos([
      { eventType: "purchase", source: "storefront", sessionId: "sesion-de-un-cliente", value: 1000 },
      { eventType: "purchase", source: "system", sessionId: "sesion-de-un-cliente", value: 1000 },
    ]);

    const { summary } = await getDashboardStats(String(TENANT_STATS), "30d");

    // El evento server-side es el único con una emisión por venta.
    expect(summary.purchaseEvents).toBe(1);
  });
});

// ─── Unidades: pesos y centavos no son lo mismo ──────────────────────────────
//
// El valor de UserMetricEvent se guarda en PESOS. statsService le aplicaba
// Money.toDecimal —que convierte de centavos— a dos de las cifras del bloque
// "Valor generado por HENKO", así que las dividía por cien.

describe("métricas · el valor generado se informa en pesos", () => {
  const TENANT_PESOS = new mongoose.Types.ObjectId();

  let getDashboardStats;

  beforeAll(async () => {
    ({ getDashboardStats } = await import("../services/statsService.js"));
  });

  afterEach(async () => {
    await UserMetricEvent.collection.deleteMany({ tenantId: TENANT_PESOS });
  });

  test("una venta de $150.000 influenciada por IA no se muestra como $1.500", async () => {
    const ahora = new Date();

    await UserMetricEvent.collection.insertMany([
      {
        tenantId: TENANT_PESOS,
        eventType: "purchase",
        source: "system",
        sessionId: "sesion-de-la-venta",
        occurredAt: ahora,
        createdAt: ahora,
        value: 150000,
        attribution: { utmCampaign: "primavera" },
        metadata: { aiInfluenced: true },
        path: "/",
      },
    ]);

    const { summary } = await getDashboardStats(String(TENANT_PESOS), "30d");

    expect(summary.aiInfluencedRevenue).toBe(150000);
    // Misma venta, contada una sola vez: es la tarjeta grande del panel.
    expect(summary.totalGeneratedValue).toBe(150000);
  });
});
