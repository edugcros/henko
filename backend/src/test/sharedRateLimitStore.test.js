// Almacén compartido de los limitadores de tasa.
//
// El almacén por defecto de express-rate-limit vive en la memoria del proceso:
// con N instancias, el límite efectivo pasa a ser N veces el configurado. Un
// límite que afloja solo al escalar no es un límite.
//
// Lo que se prueba es el contrato que la librería espera del almacén, porque si
// esto se equivoca el límite no falla ruidosamente — falla dejando pasar.

import { jest } from "@jest/globals";

const store = new Map();

// La caché real ya tiene sus propios tests; acá se mockea para poder controlar
// el conteo y aislar el contrato del almacén.
jest.unstable_mockModule("../utils/cache.js", () => ({
  cacheIncr: jest.fn(async key => {
    const next = (store.get(key) || 0) + 1;
    store.set(key, next);
    return next;
  }),
  cacheGet: jest.fn(async key => store.get(key) ?? null),
  cacheSet: jest.fn(async (key, value) => {
    store.set(key, value);
    return true;
  }),
  cacheDel: jest.fn(async key => {
    store.delete(key);
    return true;
  }),
  default: {},
}));

const { SharedRateLimitStore } = await import(
  "../middlewares/sharedRateLimitStore.js"
);

let limiter;

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  limiter = new SharedRateLimitStore('prueba');
  limiter.init({ windowMs: 60_000 });
});

test("cuenta desde uno y acumula por clave", async () => {
  expect((await limiter.increment("ip-a")).totalHits).toBe(1);
  expect((await limiter.increment("ip-a")).totalHits).toBe(2);
  expect((await limiter.increment("ip-a")).totalHits).toBe(3);
});

test("dos claves distintas no se pisan", async () => {
  await limiter.increment("ip-a");
  await limiter.increment("ip-a");

  expect((await limiter.increment("ip-b")).totalHits).toBe(1);
});

test("la ventana arranca con el primer golpe y no se corre", async () => {
  // Refijar el vencimiento en cada golpe haría que la ventana nunca cerrara
  // mientras hubiera tráfico — que es exactamente el tráfico que hay que
  // limitar.
  const primero = await limiter.increment("ip-a");
  await new Promise(r => setTimeout(r, 20));
  const segundo = await limiter.increment("ip-a");

  expect(segundo.resetTime.getTime()).toBe(primero.resetTime.getTime());
});

test("devuelve resetTime, que es de donde sale el Retry-After", async () => {
  const antes = Date.now();
  const { resetTime } = await limiter.increment("ip-a");

  expect(resetTime).toBeInstanceOf(Date);
  expect(resetTime.getTime()).toBeGreaterThanOrEqual(antes + 59_000);
});

test("descontar baja el conteo", async () => {
  await limiter.increment("ip-a");
  await limiter.increment("ip-a");
  await limiter.decrement("ip-a");

  expect((await limiter.increment("ip-a")).totalHits).toBe(2);
});

test("descontar nunca deja el contador en negativo", async () => {
  // Un contador negativo le daría ventana infinita a esa clave, que es el
  // fallo que más importa: no se nota, y deja pasar.
  await limiter.decrement("ip-a");
  await limiter.decrement("ip-a");

  expect((await limiter.increment("ip-a")).totalHits).toBe(1);
});

test("resetKey limpia el conteo y su vencimiento", async () => {
  await limiter.increment("ip-a");
  await limiter.increment("ip-a");
  await limiter.resetKey("ip-a");

  expect((await limiter.increment("ip-a")).totalHits).toBe(1);
});

// ─── Cada limitador cuenta lo suyo ───────────────────────
//
// Todos los almacenes usaban el mismo prefijo `ratelimit:`, así que dos
// limitadores distintos con la misma clave —la misma IP, típicamente—
// compartían contador: los golpes contra el límite global le descontaban al de
// pagos, que admite 10 por hora. Hoy no chocaban porque sus keyGenerator
// producen strings distintos, o sea por casualidad.
//
// `prefix` es además el campo por el que express-rate-limit distingue
// limitadores: sin él tomaba a todos por el mismo y avisaba ERR_ERL_DOUBLE_COUNT
// en cada request que pasa por dos, que son todas — el global cuelga de /api.

describe("SharedRateLimitStore · un contador por limitador", () => {
  const nuevo = async nombre => {
    const store = new SharedRateLimitStore(nombre);
    store.init({ windowMs: 60_000 });
    return store;
  };

  test("dos limitadores con la MISMA clave no se pisan", async () => {
    const pagos = await nuevo("pagos");
    const global = await nuevo("global");

    await pagos.increment("1.2.3.4");
    await pagos.increment("1.2.3.4");
    const enGlobal = await global.increment("1.2.3.4");

    // Si compartieran contador, acá vendría 3 y el limitador global estaría
    // castigando a alguien por lo que hizo contra otro.
    expect(enGlobal.totalHits).toBe(1);
  });

  test("expone prefix, que es como la librería los distingue", async () => {
    const store = await nuevo("pagos");

    expect(store.prefix).toBe("ratelimit:pagos:");
  });

  test("sin nombre no se construye", () => {
    // Un almacén sin nombre volvería a compartir contador en silencio. Es mejor
    // que falle al arrancar que descubrirlo por un límite que no limita.
    expect(() => new SharedRateLimitStore()).toThrow(/nombre/i);
  });
});
