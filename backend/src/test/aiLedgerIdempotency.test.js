// Idempotencia del ledger, contra una base real.
//
// Los tests con mocks prueban que el servicio pasa la clave y que trata el
// rechazo como un reintento. Ninguno prueba lo único que de verdad impide
// contar dos veces: el índice único de la base. Eso solo se puede verificar
// insertando y viendo qué rechaza Mongo.
//
// El diseño sigue el patrón que usan las plataformas de pago: la unicidad la
// impone la base, no una comprobación previa en el código — preguntar "¿ya
// existe?" y después insertar es la misma carrera que uno quiere evitar.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const TENANT = new mongoose.Types.ObjectId();
const OTRO_TENANT = new mongoose.Types.ObjectId();

let mongod;
let Ledger;

const fila = (extra = {}) => ({
  tenantId: TENANT,
  period: "2026-09",
  event: "consumed",
  metric: "vision",
  amount: 1,
  unit: "units",
  operationId: null,
  costUsd: 0,
  createdAt: new Date(),
  ...extra,
});

const insertar = async extra => Ledger.collection.insertOne(fila(extra));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  Ledger = (await import("../models/aiConsumptionLedgerModel.js")).default;

  // Los índices declarados en el schema se construyen acá; en producción los
  // crea el arranque con autoIndex.
  await Ledger.createIndexes();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Ledger.collection.deleteMany({});
});

describe("qué rechaza el índice", () => {
  test("dos consumos de la misma operación: el segundo se rechaza", async () => {
    // Es exactamente un reintento contado dos veces, que es lo que hay que
    // impedir.
    await insertar({ operationId: "op-1" });

    await expect(insertar({ operationId: "op-1" })).rejects.toMatchObject({
      code: 11000,
    });

    expect(await Ledger.collection.countDocuments({})).toBe(1);
  });

  test("reserva y consumo de la misma operación conviven", async () => {
    // Una operación produce legítimamente las dos filas: por eso el evento
    // entra en la clave. Sin él, el consumo chocaría con su propia reserva.
    await insertar({ operationId: "op-1", event: "reserved" });
    await insertar({ operationId: "op-1", event: "consumed" });
    await insertar({ operationId: "op-1", event: "refunded" });

    expect(await Ledger.collection.countDocuments({})).toBe(3);
  });

  test("la misma clave en dos comercios distintos no colisiona", async () => {
    // El aislamiento va primero: dos comercios no comparten espacio de claves.
    await insertar({ operationId: "op-1" });
    await insertar({ operationId: "op-1", tenantId: OTRO_TENANT });

    expect(await Ledger.collection.countDocuments({})).toBe(2);
  });
});

describe("qué NO rechaza, y es lo que lo hace desplegable", () => {
  test("muchas filas sin clave conviven sin problema", async () => {
    // Todo lo escrito antes de este cambio tiene operationId en null. Con un
    // índice único común, la segunda de esas filas fallaría y el despliegue
    // rompería la contabilidad en vez de arreglarla. El filtro parcial las deja
    // afuera del índice.
    await insertar();
    await insertar();
    await insertar();

    expect(await Ledger.collection.countDocuments({})).toBe(3);
  });

  test("el índice se construye sobre datos que ya existen sin migrarlos", async () => {
    // La prueba de que esto se puede subir un martes: primero los datos viejos,
    // después el índice.
    await Ledger.collection.dropIndexes();
    await insertar();
    await insertar();

    // Si el índice no pudiera construirse sobre estos datos, esto lanzaría y
    // el test fallaría acá. Que siga es la mitad de la prueba.
    await Ledger.createIndexes();

    // Y una vez creado, sigue haciendo su trabajo con las filas nuevas.
    await insertar({ operationId: "op-nueva" });
    await expect(insertar({ operationId: "op-nueva" })).rejects.toMatchObject({
      code: 11000,
    });
  });

  test("una fila vieja sin clave no bloquea a una nueva con clave", async () => {
    await insertar();

    await expect(insertar({ operationId: "op-1" })).resolves.toBeDefined();
  });
});
