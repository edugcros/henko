// Aislamiento entre comercios.
//
// Este archivo no podía existir hasta hoy. El plugin de tenant se apagaba
// entero cuando NODE_ENV era 'test', así que ninguna prueba podía descubrir una
// fuga entre comercios — la propiedad sobre la que descansa todo el modelo de
// negocio era indetectable por construcción. Peor: un test que intentara
// verificarla fallaba contra código correcto.
//
// Se prueba contra una base real en memoria, no con mocks, por el mismo motivo
// que el historial de precios: lo que hay que verificar es que los HOOKS de
// mongoose disparen. Un modelo mockeado probaría la aritmética y dejaría pasar
// el único fallo que importa acá.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const TIENDA_A = new mongoose.Types.ObjectId();
const TIENDA_B = new mongoose.Types.ObjectId();

let mongod;
let Ledger;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Se usa el ledger de consumo de IA porque lleva el plugin y no arrastra
  // dependencias: cualquier modelo con tenantPlugin serviría igual.
  Ledger = (await import("../models/aiConsumptionLedgerModel.js")).default;
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

const movimiento = (tenantId, extra = {}) => ({
  tenantId,
  period: "2026-09",
  event: "consumed",
  metric: "vision",
  amount: 1,
  unit: "units",
  ...extra,
});

beforeEach(async () => {
  await Ledger.collection.deleteMany({});

  await Ledger.collection.insertMany([
    movimiento(TIENDA_A, { costUsd: 1, createdAt: new Date() }),
    movimiento(TIENDA_A, { costUsd: 2, createdAt: new Date() }),
    movimiento(TIENDA_B, { costUsd: 99, createdAt: new Date() }),
  ]);
});

describe("leer", () => {
  test("una tienda solo ve sus movimientos", async () => {
    const filas = await Ledger.find({}).setOptions({ tenantId: TIENDA_A });

    expect(filas).toHaveLength(2);
    expect(filas.every(f => String(f.tenantId) === String(TIENDA_A))).toBe(true);
  });

  test("un filtro vacío NO devuelve lo de todos", async () => {
    // El fallo que este archivo existe para detectar: si el plugin no
    // interviniera, esto traería las tres filas y la fuga pasaría inadvertida.
    const filas = await Ledger.find({}).setOptions({ tenantId: TIENDA_B });

    expect(filas).toHaveLength(1);
    expect(filas[0].costUsd).toBe(99);
  });

  test("pedir explícitamente el id de otro comercio se rechaza", async () => {
    // No alcanza con acotar: hay que impedir que alguien pase el id ajeno a
    // mano y se lleve el dato igual.
    await expect(
      Ledger.find({ tenantId: TIENDA_B }).setOptions({ tenantId: TIENDA_A }),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  test("una consulta sin comercio se rechaza en vez de traer todo", async () => {
    // Falla cerrado: sin contexto de tenant, la respuesta correcta es un error,
    // no el conjunto completo.
    await expect(Ledger.find({})).rejects.toMatchObject({
      code: "TENANT_INVALID",
    });
  });

  test("contar tampoco cruza comercios", async () => {
    const total = await Ledger.countDocuments({}).setOptions({
      tenantId: TIENDA_A,
    });

    expect(total).toBe(2);
  });
});

describe("escribir", () => {
  test("guardar sin comercio se rechaza", async () => {
    // Lo atrapa la validación `required` del schema antes de que llegue el hook
    // del plugin — mongoose valida primero. Da igual cuál de las dos: lo que se
    // prueba es que no se puede escribir una fila huérfana, y que hay dos
    // capas cubriéndolo en vez de una.
    const fila = new Ledger(movimiento(undefined));

    await expect(fila.save()).rejects.toThrow(/tenantId/i);
  });

  test("el hook del plugin también lo cubre, no solo el schema", async () => {
    // Si alguien quitara `required` del campo creyendo que sobra, el plugin
    // sigue rechazando. Se prueba salteando la validación del schema para
    // llegar al hook.
    const fila = new Ledger(movimiento(undefined));

    await expect(
      fila.save({ validateBeforeSave: false }),
    ).rejects.toMatchObject({ code: "TENANT_INVALID" });
  });

  test("no se puede mover un movimiento a otro comercio", async () => {
    await expect(
      Ledger.updateMany({}, { $set: { tenantId: TIENDA_B } }).setOptions({
        tenantId: TIENDA_A,
      }),
    ).rejects.toMatchObject({ code: "TENANT_MUTATION_FORBIDDEN" });
  });

  test("un borrado no alcanza a los datos de otro", async () => {
    await Ledger.deleteMany({}).setOptions({ tenantId: TIENDA_A });

    const quedan = await Ledger.collection.find({}).toArray();

    expect(quedan).toHaveLength(1);
    expect(String(quedan[0].tenantId)).toBe(String(TIENDA_B));
  });
});

describe("agregar", () => {
  test("un aggregate sin comercio se rechaza", async () => {
    await expect(
      Ledger.aggregate([{ $group: { _id: null, total: { $sum: "$costUsd" } } }]),
    ).rejects.toMatchObject({ code: "TENANT_INVALID" });
  });

  test("acotado a un comercio, suma solo lo suyo", async () => {
    const [fila] = await Ledger.aggregate([
      { $group: { _id: null, total: { $sum: "$costUsd" } } },
    ]).option({ tenantId: TIENDA_A });

    expect(fila.total).toBe(3);
  });
});

describe("la salida explícita", () => {
  test("ignoreTenant cruza comercios, y es lo que usan los reportes de plataforma", async () => {
    // La excepción existe y está bien que exista: "¿cuánto va a pagar HENKO
    // este mes?" no tiene sentido comercio por comercio. Lo que importa es que
    // haya que escribirlo, y que se lea en el lugar donde se hace.
    const filas = await Ledger.find({}).setOptions({ ignoreTenant: true });

    expect(filas).toHaveLength(3);
  });

  test("sin pedirlo, nunca se cruza", async () => {
    // La contracara del anterior: el atajo tiene que ser explícito y no un
    // default. Durante mucho tiempo lo fue —NODE_ENV === 'test' lo activaba
    // solo— y por eso este archivo no podía existir.
    await expect(Ledger.find({})).rejects.toMatchObject({
      code: "TENANT_INVALID",
    });
  });
});
