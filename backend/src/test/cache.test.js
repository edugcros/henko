// Caché con TTL, compartida cuando hay Redis.
//
// Este archivo no tenía tests, y ahora decide si el disyuntor de gasto de IA
// lee un valor compartido o una copia por proceso. Lo que se prueba acá es el
// contrato del que dependen esos tres consumidores: que Redis mande cuando
// está, que un fallo de Redis degrade a memoria en vez de romper el request, y
// que un `null` de Redis signifique "no está" y no "preguntale a la memoria".

import { jest } from "@jest/globals";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: mockLogger,
}));

const redisClient = {
  isOpen: true,
  on: jest.fn(),
  connect: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockCreateClient = jest.fn(() => redisClient);

jest.unstable_mockModule("redis", () => ({
  createClient: mockCreateClient,
  default: { createClient: mockCreateClient },
}));

/**
 * El módulo lee REDIS_URL al cargarse, así que cada escenario necesita su
 * propia carga. `resetModules` es lo que permite tener los dos modos —con y
 * sin Redis— en el mismo archivo.
 */
const loadCache = async ({ redisUrl = "" } = {}) => {
  jest.resetModules();

  if (redisUrl) process.env.REDIS_URL = redisUrl;
  else delete process.env.REDIS_URL;

  return import("../utils/cache.js");
};

beforeEach(() => {
  jest.clearAllMocks();
  redisClient.isOpen = true;
  redisClient.connect.mockResolvedValue();
  redisClient.get.mockResolvedValue(null);
  redisClient.set.mockResolvedValue("OK");
  redisClient.del.mockResolvedValue(1);
});

afterAll(() => {
  delete process.env.REDIS_URL;
});

describe("sin Redis configurado", () => {
  test("guarda y devuelve desde memoria", async () => {
    const { cacheSet, cacheGet } = await loadCache();

    await cacheSet("k", { exhausted: true }, 30);

    expect(await cacheGet("k")).toEqual({ exhausted: true });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  test("una clave que nunca se escribió devuelve null", async () => {
    const { cacheGet } = await loadCache();

    expect(await cacheGet("no-existe")).toBeNull();
  });

  test("borrar deja la clave ausente", async () => {
    const { cacheSet, cacheGet, cacheDel } = await loadCache();

    await cacheSet("k", 1, 30);
    await cacheDel("k");

    expect(await cacheGet("k")).toBeNull();
  });

  test("un valor vencido no se devuelve", async () => {
    // El TTL mínimo es 1 s, así que se adelanta el reloj en vez de esperarlo.
    const { cacheSet, cacheGet } = await loadCache();

    await cacheSet("k", "viejo", 1);

    const despues = Date.now() + 2000;
    jest.spyOn(Date, "now").mockReturnValue(despues);

    expect(await cacheGet("k")).toBeNull();

    Date.now.mockRestore();
  });
});

describe("con Redis configurado", () => {
  test("escribe en Redis con TTL y con prefijo", async () => {
    const { cacheSet } = await loadCache({ redisUrl: "redis://localhost:6379" });

    await cacheSet("ai:platform:breaker:2026-09", { exhausted: true }, 30);

    const [clave, valor, opciones] = redisClient.set.mock.calls[0];

    // El prefijo evita que dos servicios sobre el mismo Redis se pisen una
    // clave con el mismo nombre.
    expect(clave).toBe("henko:ai:platform:breaker:2026-09");
    expect(JSON.parse(valor)).toEqual({ exhausted: true });
    expect(opciones).toEqual({ EX: 30 });
  });

  test("lee de Redis y no de la memoria local", async () => {
    // Es el punto del cambio: la instancia que no vio el cruce del presupuesto
    // tiene que enterarse igual.
    const { cacheSet, cacheGet } = await loadCache({ redisUrl: "redis://x" });

    await cacheSet("k", { exhausted: false }, 30);
    redisClient.get.mockResolvedValue(JSON.stringify({ exhausted: true }));

    expect(await cacheGet("k")).toEqual({ exhausted: true });
  });

  test("un null de Redis significa ausente, no 'preguntale a la memoria'", async () => {
    // Caer a memoria acá devolvería el valor por proceso que este cambio vino
    // a eliminar: la clave venció para todos, no solo para esta instancia.
    const { cacheSet, cacheGet } = await loadCache({ redisUrl: "redis://x" });

    await cacheSet("k", { exhausted: false }, 30);
    redisClient.get.mockResolvedValue(null);

    expect(await cacheGet("k")).toBeNull();
  });

  test("un valor corrupto se trata como ausente en vez de romper", async () => {
    const { cacheGet } = await loadCache({ redisUrl: "redis://x" });

    redisClient.get.mockResolvedValue("{ esto no es json");

    expect(await cacheGet("k")).toBeNull();
  });

  test("solo se conecta una vez aunque haya muchas operaciones", async () => {
    const { cacheGet } = await loadCache({ redisUrl: "redis://x" });

    await Promise.all([cacheGet("a"), cacheGet("b"), cacheGet("c")]);

    expect(redisClient.connect).toHaveBeenCalledTimes(1);
  });

  test("registra un handler de error: sin él, un fallo tumba el proceso", async () => {
    const { cacheGet } = await loadCache({ redisUrl: "redis://x" });

    await cacheGet("k");

    expect(redisClient.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});

describe("cuando Redis falla", () => {
  test("si no conecta, sigue funcionando con memoria", async () => {
    redisClient.connect.mockRejectedValue(new Error("ECONNREFUSED"));

    const { cacheSet, cacheGet } = await loadCache({ redisUrl: "redis://x" });

    await cacheSet("k", "valor", 30);

    expect(await cacheGet("k")).toBe("valor");
  });

  test("una caída se avisa: degradar en silencio deshace el arreglo", async () => {
    // Volver a memoria NO es equivalente a tener Redis: es exactamente el
    // comportamiento por proceso que este archivo vino a resolver, y quien
    // mire los logs tiene que poder notarlo.
    redisClient.connect.mockRejectedValue(new Error("ECONNREFUSED"));

    const { cacheGet } = await loadCache({ redisUrl: "redis://x" });
    await cacheGet("k");

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("memoria por proceso"),
      expect.anything(),
    );
  });

  test("tras un fallo no se reintenta conectar en cada operación", async () => {
    // Regresión medida contra un Redis real inalcanzable: sin enfriamiento,
    // cada llamada volvía a intentar conectar y pagaba ~12 s antes de caer a
    // memoria. Degradar tiene que ser barato o deja de ser degradar: la caché
    // se convierte en el cuello de botella justo cuando ya falló.
    redisClient.connect.mockRejectedValue(new Error("ECONNREFUSED"));

    const { cacheGet } = await loadCache({ redisUrl: "redis://x" });

    await cacheGet("a");
    await cacheGet("b");
    await cacheGet("c");

    expect(redisClient.connect).toHaveBeenCalledTimes(1);
  });

  test("una lectura colgada no deja esperando al request", async () => {
    // Una caché lenta es peor que una caché fría: el techo de tiempo está para
    // que Redis nunca se convierta en la latencia de la operación.
    const { cacheSet, cacheGet } = await loadCache({ redisUrl: "redis://x" });

    await cacheSet("k", "respaldo", 30);
    redisClient.get.mockImplementation(() => new Promise(() => {}));

    await expect(cacheGet("k")).resolves.toBe("respaldo");
  });
});
