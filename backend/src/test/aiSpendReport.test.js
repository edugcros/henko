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
let getPeriodQuality;

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
  ({ getPeriodSpendByMetric, getPeriodQuality } = await import(
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

describe("calidad de la contabilidad", () => {
  const tokens = extra =>
    fila({ metric: "agentTokens", unit: "tokens", model: "gemini-3.1-flash-lite", ...extra });

  test("las cuatro clases SUMAN el total, no se pisan", async () => {
    // Es la propiedad que hace utilizable el reporte: si las clases se
    // solaparan, una fila estimada Y con tarifa de respaldo sumaria dos veces
    // y el desglose no cerraria contra el gasto.
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      tokens({ amount: 1000, costUsd: 0.02, costEstimated: true }),
      tokens({ amount: 1000, costUsd: 0.04, priceFallback: true }),
      tokens({ amount: 1000, costUsd: 0.08, model: null }),
      // La peor combinacion: estimada Y con tarifa de respaldo Y sin modelo.
      // Cae en UNA sola clase, la mas grave.
      tokens({
        amount: 1000,
        costUsd: 0.16,
        costEstimated: true,
        priceFallback: true,
        model: null,
      }),
    ]);

    const q = await getPeriodQuality(PERIODO);

    expect(q.measured + q.estimated + q.priceFallback + q.unknownModel).toBe(q.rows);
    expect(
      q.measuredCostUsd + q.estimatedCostUsd + q.fallbackCostUsd + q.unknownModelCostUsd,
    ).toBeCloseTo(q.costUsd, 6);

    // Y cada una donde corresponde: la de tres defectos cuenta como sin modelo.
    expect(q.measured).toBe(1);
    expect(q.estimated).toBe(1);
    expect(q.priceFallback).toBe(1);
    expect(q.unknownModel).toBe(2);
    expect(q.unknownModelCostUsd).toBeCloseTo(0.24, 6);
  });

  test("lo que se cobra por unidad no ensucia el porcentaje", async () => {
    // ESTE ERA EL BUG DEL REPORTE VIEJO. Medido en produccion sobre 2026-09:
    //
    //   todos los movimientos  160 filas · 27 estimadas (17%)
    //   solo las de tokens     132 filas ·  4 estimadas  (3%)
    //
    // La diferencia son ediciones de imagen: llevan costEstimated porque el
    // precio es por imagen y se cobra al reservar, y no llevan modelo porque
    // las sirve Replicate. Contarlas inflaba el defecto cuatro veces.
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      fila({ metric: "imageEdits", unit: "units", amount: 1, costUsd: 0.02, costEstimated: true }),
      fila({ metric: "imageEdits", unit: "units", amount: 1, costUsd: 0.02, costEstimated: true }),
    ]);

    const q = await getPeriodQuality(PERIODO);

    // Antes: rows 3, estimatedRows 2. Ahora la pregunta se hace donde tiene
    // sentido.
    expect(q.rows).toBe(1);
    expect(q.estimated).toBe(0);
    expect(q.unknownModel).toBe(0);
    expect(q.measuredShare).toBe(100);

    // Y no desaparecen: se informan aparte.
    expect(q.flatRate).toEqual({ rows: 2, costUsd: 0.04 });
  });

  test("el porcentaje mide PLATA, no filas", async () => {
    // Una fila cara mal medida importa mas que diez baratas bien medidas, y un
    // porcentaje por filas diria lo contrario.
    await Ledger.collection.insertMany([
      ...Array.from({ length: 9 }, () => tokens({ amount: 10, costUsd: 0.001 })),
      tokens({ amount: 100000, costUsd: 0.991, costEstimated: true }),
    ]);

    const q = await getPeriodQuality(PERIODO);

    expect(q.measured).toBe(9);
    expect(q.estimated).toBe(1);
    // 9 de 10 filas estan medidas, pero solo el 0,9% del gasto.
    expect(q.measuredShare).toBeCloseTo(0.9, 1);
  });

  test("sin gasto, el porcentaje es null y no 0%", async () => {
    // "No hubo gasto" y "el gasto es todo supuesto" son cosas distintas, y una
    // pantalla que muestre 0% donde no hubo nada asusta sin motivo.
    const q = await getPeriodQuality(PERIODO);

    expect(q.rows).toBe(0);
    expect(q.measuredShare).toBeNull();
    expect(q.costUsd).toBe(0);
  });

  test("las devoluciones no entran: la calidad se mide sobre lo consumido", async () => {
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      tokens({ event: "refunded", amount: 1000, costUsd: 0, costEstimated: true }),
      tokens({ event: "reserved", amount: 1000, costUsd: 0, costEstimated: true }),
    ]);

    const q = await getPeriodQuality(PERIODO);

    expect(q.rows).toBe(1);
    expect(q.estimated).toBe(0);
  });

  test("el panel sigue leyendo los nombres que ya leia", async () => {
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      tokens({ amount: 1000, costUsd: 0.02, costEstimated: true }),
      tokens({ amount: 1000, costUsd: 0.04, priceFallback: true }),
    ]);

    const q = await getPeriodQuality(PERIODO);

    expect(q.rows).toBe(3);
    expect(q.estimatedRows).toBe(1);
    expect(q.fallbackRows).toBe(1);
  });
});
