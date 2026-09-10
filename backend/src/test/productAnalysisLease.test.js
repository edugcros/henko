// Permiso de procesamiento de los jobs de análisis.
//
// Contra una base real en memoria y no con mocks: lo que hay que verificar es
// si un filtro MATCHEA un documento, y afirmar la forma del filtro probaría que
// escribí lo que escribí. Acá se insertan jobs en los estados que importan y se
// pregunta cuáles vuelven.
//
// Lo que está en juego es concreto: sin permiso, un proceso que muere entre
// reclamar el job y terminarlo lo dejaba en PROCESSING para siempre, porque el
// barrido solo miraba SCHEDULED. Y al revés, un permiso mal puesto hace que dos
// instancias analicen la misma imagen y HENKO le pague dos veces a Google.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const TENANT = new mongoose.Types.ObjectId();
const OTRO_TENANT = new mongoose.Types.ObjectId();

let mongod;
let ProductAnalysisJob;
let buildClaimFilter;
let buildDueFilter;

const HACE_UNA_HORA = new Date(Date.now() - 3600_000);
const DENTRO_DE_UNA_HORA = new Date(Date.now() + 3600_000);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  ProductAnalysisJob = (await import("../models/productAnalysisJobModel.js")).default;
  const lease = await import("../services/productAnalysisLease.js");
  buildClaimFilter = lease.buildClaimFilter;
  buildDueFilter = lease.buildDueFilter;
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await ProductAnalysisJob.deleteMany({}).setOptions({ ignoreTenant: true });
});

const crearJob = async (campos = {}) => {
  const [job] = await ProductAnalysisJob.collection.insertMany([
    {
      tenantId: TENANT,
      status: "scheduled",
      scheduledAt: HACE_UNA_HORA,
      createdAt: new Date(),
      ...campos,
    },
  ]).then(r => Object.values(r.insertedIds));

  return job;
};

/** Corre el filtro contra la base, que es lo que hace el código real. */
const reclamables = async filtro =>
  ProductAnalysisJob.collection.find(filtro).toArray();

describe("reclamar un job", () => {
  test("uno programado se puede tomar", async () => {
    const id = await crearJob();

    const encontrados = await reclamables(
      buildClaimFilter({ jobId: id, tenantId: TENANT }),
    );

    expect(encontrados).toHaveLength(1);
  });

  test("uno que ya está siendo procesado NO se puede tomar", async () => {
    // Es la mitad que evita el doble cobro: mientras el permiso vale, el job es
    // de quien lo tomó.
    const id = await crearJob({
      status: "processing",
      processingLeaseExpiresAt: DENTRO_DE_UNA_HORA,
    });

    const encontrados = await reclamables(
      buildClaimFilter({ jobId: id, tenantId: TENANT }),
    );

    expect(encontrados).toHaveLength(0);
  });

  test("uno trabado con el permiso vencido vuelve a estar disponible", async () => {
    // Es la mitad que evita el job zombi. Sin esto quedaba en PROCESSING para
    // siempre y su cuota de visión, reservada y perdida.
    const id = await crearJob({
      status: "processing",
      processingLeaseExpiresAt: HACE_UNA_HORA,
    });

    const encontrados = await reclamables(
      buildClaimFilter({ jobId: id, tenantId: TENANT }),
    );

    expect(encontrados).toHaveLength(1);
  });

  test("uno fallado se puede reintentar", async () => {
    const id = await crearJob({ status: "failed" });

    expect(
      await reclamables(buildClaimFilter({ jobId: id, tenantId: TENANT })),
    ).toHaveLength(1);
  });

  test("uno borrado no se toca", async () => {
    const id = await crearJob({ deletedAt: new Date() });

    expect(
      await reclamables(buildClaimFilter({ jobId: id, tenantId: TENANT })),
    ).toHaveLength(0);
  });

  test("uno ya completado no se vuelve a analizar", async () => {
    const id = await crearJob({ status: "completed" });

    expect(
      await reclamables(buildClaimFilter({ jobId: id, tenantId: TENANT })),
    ).toHaveLength(0);
  });

  test("no se puede reclamar el job de otro comercio", async () => {
    const id = await crearJob();

    expect(
      await reclamables(buildClaimFilter({ jobId: id, tenantId: OTRO_TENANT })),
    ).toHaveLength(0);
  });
});

describe("barrido de pendientes", () => {
  test("trae los programados que ya vencieron", async () => {
    await crearJob();
    await crearJob({ scheduledAt: DENTRO_DE_UNA_HORA });

    const encontrados = await reclamables(buildDueFilter());

    expect(encontrados).toHaveLength(1);
  });

  test("trae también los trabados con permiso vencido", async () => {
    // Sin esta rama el barrido solo miraba SCHEDULED y nada devolvía a la cola
    // un job cuyo proceso murió.
    await crearJob({ status: "processing", processingLeaseExpiresAt: HACE_UNA_HORA });

    expect(await reclamables(buildDueFilter())).toHaveLength(1);
  });

  test("no trae los que están corriendo con permiso vigente", async () => {
    await crearJob({
      status: "processing",
      processingLeaseExpiresAt: DENTRO_DE_UNA_HORA,
    });

    expect(await reclamables(buildDueFilter())).toHaveLength(0);
  });

  test("un job viejo sin el campo de permiso no se toma como vencido", async () => {
    // Los documentos anteriores a este cambio no tienen processingLeaseExpiresAt.
    // Si un campo ausente contara como permiso vencido, el primer barrido
    // después del despliegue se llevaría por delante todo lo que estuviera
    // corriendo en ese momento.
    await crearJob({ status: "processing" });

    expect(await reclamables(buildDueFilter())).toHaveLength(0);
  });

  test("acotado a un comercio, no ve los de los demás", async () => {
    await crearJob();
    await crearJob({ tenantId: OTRO_TENANT });

    const encontrados = await reclamables(buildDueFilter({ tenantId: TENANT }));

    expect(encontrados).toHaveLength(1);
    expect(String(encontrados[0].tenantId)).toBe(String(TENANT));
  });
});
