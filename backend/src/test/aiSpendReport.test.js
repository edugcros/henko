// El reporte de gasto, contra una base real.
//
// Una agregación no se puede verificar con mocks: lo único que probaría es que
// el pipeline se pasó tal como se escribió, no que Mongo devuelva lo que uno
// cree. Y acá el pipeline cambió de semántica.
//
// QUÉ CAMBIÓ
//
// Antes el reporte sumaba solo los 'consumed', y eso alcanzaba porque una fila
// de consumo se escribía únicamente cuando la operación ya había salido bien:
// no había nada que descontar. Desde que el costo de tarifa plana se cobra en
// el mismo movimiento que la cuota, la edición de imagen se cobra al reservar y
// se devuelve si el proveedor falla. Sin restar las devoluciones, el reporte
// contaría un gasto que se revirtió.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const TENANT = new mongoose.Types.ObjectId();
const PERIODO = "2026-09";

let mongod;
let Ledger;
let getPeriodSpendByMetric;

const fila = extra => ({
  tenantId: TENANT,
  period: PERIODO,
  event: "consumed",
  metric: "imageEdits",
  amount: 1,
  unit: "units",
  operationId: null,
  costUsd: 0,
  createdAt: new Date(),
  ...extra,
});

const insertar = async (...filas) =>
  Ledger.collection.insertMany(filas.map(fila));

const porMetrica = async metric =>
  (await getPeriodSpendByMetric(PERIODO)).find(row => row.metric === metric);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  Ledger = (await import("../models/aiConsumptionLedgerModel.js")).default;
  ({ getPeriodSpendByMetric } = await import(
    "../services/ai/aiSpendReportService.js"
  ));
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

afterEach(async () => {
  await Ledger.collection.deleteMany({});
});

describe("getPeriodSpendByMetric · devoluciones", () => {
  test("una edición cobrada y devuelta no deja gasto", async () => {
    // Es el caso real: se reservó (y con eso se cobró), el proveedor falló y se
    // devolvió. Neto cero.
    await insertar(
      { event: "consumed", costUsd: 0.02, operationId: "op-1" },
      { event: "refunded", costUsd: 0.02, operationId: "op-1" },
    );

    const imagenes = await porMetrica("imageEdits");

    expect(imagenes.costUsd).toBe(0);
    expect(imagenes.operations).toBe(0);
  });

  test("de tres cobradas y una devuelta quedan dos", async () => {
    await insertar(
      { event: "consumed", costUsd: 0.02, operationId: "op-1" },
      { event: "consumed", costUsd: 0.02, operationId: "op-2" },
      { event: "consumed", costUsd: 0.02, operationId: "op-3" },
      { event: "refunded", costUsd: 0.02, operationId: "op-3" },
    );

    const imagenes = await porMetrica("imageEdits");

    expect(imagenes.costUsd).toBe(0.04);
    expect(imagenes.operations).toBe(2);
  });

  test("las reservas siguen sin contar", async () => {
    // Una reserva es intención. Para las métricas que no se cobran por
    // adelantado sigue existiendo como evento previo al consumo.
    await insertar(
      { event: "reserved", metric: "agentMessages", costUsd: 0, operationId: "op-1" },
      {
        event: "consumed",
        metric: "agentTokens",
        unit: "tokens",
        amount: 5000,
        costUsd: 0.01,
        operationId: "op-1",
      },
    );

    const filas = await getPeriodSpendByMetric(PERIODO);

    expect(filas.find(f => f.metric === "agentMessages")).toBeUndefined();
    expect(filas.find(f => f.metric === "agentTokens").costUsd).toBe(0.01);
  });

  test("devolver un mensaje no borra los tokens que ya se gastaron", async () => {
    // El agente devuelve el mensaje cuando Google falla, pero los tokens de esa
    // llamada fallida se gastaron igual. Su fila de devolución lleva costo cero
    // justamente para que restarla no toque el gasto real.
    await insertar(
      {
        event: "consumed",
        metric: "agentTokens",
        unit: "tokens",
        amount: 8000,
        costUsd: 0.03,
        operationId: "op-1",
      },
      {
        event: "refunded",
        metric: "agentMessages",
        costUsd: 0,
        operationId: "op-1",
      },
    );

    expect((await porMetrica("agentTokens")).costUsd).toBe(0.03);
    expect((await porMetrica("agentTokens")).tokens).toBe(8000);
  });
});
