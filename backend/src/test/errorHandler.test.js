// Qué sale del backend cuando algo falla.
//
// El errorHandler ya ocultaba el stack en producción, pero seguía devolviendo
// `err.message` y `err.name` de CUALQUIER error. En un 500 ese mensaje no lo
// escribió nadie: es el de Mongo, el del driver o el del sistema de archivos, y
// trae adentro el host del clúster, una ruta interna o un pedazo de consulta.
//
// La distinción que se prueba acá es 4xx contra 5xx, no producción contra
// desarrollo. Un 4xx lo lanza nuestro propio código con un mensaje escrito PARA
// el cliente; taparlo no protege nada y vuelve la API inusable.

import { jest } from "@jest/globals";

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule("../utils/frontendUrl.js", () => ({
  buildFrontendUrl: () => "https://tienda.test/",
}));

const { errorHandler } = await import("../middlewares/errorHandler.js");
const { requestId } = await import("../middlewares/requestId.js");

const REQUEST_ID = "11111111-2222-3333-4444-555555555555";

const respuesta = () => ({
  statusCode: 200,
  body: null,
  headersSent: false,
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
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
  id: REQUEST_ID,
  method: "POST",
  originalUrl: "/api/products",
  headers: {},
});

const manejar = err => {
  const res = respuesta();
  errorHandler(err, pedido(), res, () => {});
  return res;
};

const conStatus = (mensaje, statusCode) => {
  const err = new Error(mensaje);
  err.statusCode = statusCode;
  return err;
};

const NODE_ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = NODE_ENV;
});

describe("errorHandler · fallos internos en producción", () => {
  const FUGA =
    "connect ECONNREFUSED cluster0-shard-00-02.hzi3iou.mongodb.net:27017";

  test("un 500 no devuelve el mensaje interno", async () => {
    process.env.NODE_ENV = "production";

    const res = manejar(new Error(FUGA));

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("mongodb.net");
    expect(JSON.stringify(res.body)).not.toContain("ECONNREFUSED");
    expect(res.body.code).toBe("INTERNAL_SERVER_ERROR");
  });

  test("tampoco devuelve el nombre del error, que dice qué falló", async () => {
    process.env.NODE_ENV = "production";

    const err = new Error(FUGA);
    err.name = "MongoNetworkError";

    const res = manejar(err);

    expect(JSON.stringify(res.body)).not.toContain("MongoNetworkError");
  });

  test("el stack nunca sale en producción", async () => {
    process.env.NODE_ENV = "production";

    expect(manejar(new Error(FUGA)).body.stack).toBeNull();
  });

  test("en desarrollo sí se ve todo, que es para lo que sirve", async () => {
    process.env.NODE_ENV = "development";

    const res = manejar(new Error(FUGA));

    expect(res.body.message).toContain("ECONNREFUSED");
    expect(res.body.stack).toBeTruthy();
  });
});

describe("errorHandler · errores dirigidos al cliente", () => {
  test("un 400 conserva su mensaje también en producción", async () => {
    // Lo escribió nuestro código para que el comercio lo lea. Ocultarlo deja a
    // la API sin forma de explicar qué mandó mal.
    process.env.NODE_ENV = "production";

    const res = manejar(conStatus("El plan starter no tiene precio definido", 400));

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("El plan starter no tiene precio definido");
  });

  test("un 402 de cuota también", async () => {
    process.env.NODE_ENV = "production";

    const res = manejar(
      conStatus("Se alcanzó el límite mensual de tu plan.", 402),
    );

    expect(res.body.message).toContain("límite mensual");
  });

  test("un índice único sigue devolviendo 409", async () => {
    process.env.NODE_ENV = "production";

    const err = new Error("E11000 duplicate key error collection: henko.products");
    err.code = 11000;

    const res = manejar(err);

    expect(res.statusCode).toBe(409);
    // El mensaje es nuestro, no el de Mongo: el de Mongo trae el nombre de la
    // base y de la colección.
    expect(JSON.stringify(res.body)).not.toContain("henko.products");
  });
});

describe("errorHandler · identificador de traza", () => {
  test("toda respuesta de error lo lleva", async () => {
    process.env.NODE_ENV = "production";

    const casos = {
      interno: new Error("interno"),
      cliente: conStatus("malo", 400),
      duplicado: Object.assign(new Error("dup"), { code: 11000 }),
      csrf: Object.assign(new Error("csrf"), { code: "EBADCSRFTOKEN" }),
    };

    for (const [nombre, err] of Object.entries(casos)) {
      expect({ [nombre]: manejar(err).body.requestId }).toEqual({
        [nombre]: REQUEST_ID,
      });
    }
  });

  test("es lo que reemplaza al mensaje que se dejó de mostrar", async () => {
    process.env.NODE_ENV = "production";

    const res = manejar(new Error("detalle interno"));

    expect(res.body.requestId).toBe(REQUEST_ID);
    expect(res.body.message).toContain("identificador");
  });
});

describe("requestId · procedencia", () => {
  const correr = headers => {
    const req = { headers };
    const res = respuesta();
    requestId(req, res, () => {});
    return { req, res };
  };

  test("se reutiliza el del cliente cuando tiene forma inofensiva", () => {
    const { req } = correr({ "x-request-id": "abc-123-def-456" });

    expect(req.id).toBe("abc-123-def-456");
  });

  test("un encabezado con saltos de línea NO se copia", () => {
    // Copiarlo parte el log en dos y permite fabricar entradas falsas; y va
    // también a un encabezado de respuesta.
    const { req } = correr({
      "x-request-id": "abc\r\nSet-Cookie: session=robada",
    });

    expect(req.id).not.toContain("Set-Cookie");
    expect(req.id).not.toContain("\n");
  });

  test("sin encabezado se genera uno", () => {
    const { req, res } = correr({});

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers["X-Request-Id"]).toBe(req.id);
  });
});
