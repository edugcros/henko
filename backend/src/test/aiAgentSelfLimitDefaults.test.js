// El autolímite del comercio no puede nacer puesto.
//
// Los dos campos de `quotas` son AUTOLÍMITES: existen para que un comercio
// gaste MENOS que su plan. Un autolímite que nadie configuró no es un
// autolímite, es una cuota encubierta — y era exactamente el problema que el
// refactor de aiPlanPolicy vino a resolver, reintroducido por la puerta de
// atrás del `default` del schema.
//
// Con `default: 3000` / `default: 1000000`, un comercio Pro al que se le
// venden 10.000 mensajes y 50M de tokens recibía 3.000 y 1M sin que nada lo
// dijera: el panel mostraba el tope del plan y el medidor cobraba contra el
// default. Este test fija la invariante contra la base real, porque el valor
// lo materializa Mongoose al crear el documento y no hay forma de verlo
// mockeando el modelo.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
  "base64url",
);

const TENANT = new mongoose.Types.ObjectId();

let mongod;
let AiAgent;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  AiAgent = (await import("../models/aiAgentModel.js")).default;
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

afterEach(async () => {
  await AiAgent.deleteMany({}).setOptions({ ignoreTenant: true });
});

describe("aiAgentModel · autolímites", () => {
  test("un agente recién creado NO trae autolímite puesto", async () => {
    // Nadie tocó la configuración: solo se aprovisionó el agente.
    const agent = await AiAgent.create({ tenantId: TENANT });

    // 0 es la forma de decir "sin autolímite" en todo el resto del sistema
    // (getAgentSelfLimit lo traduce a null, el panel lo rotula "0 = sin
    // autolímite"). Cualquier otro valor acá es un freno que el comercio no
    // pidió.
    expect(agent.quotas.monthlyMessageLimit).toBe(0);
    expect(agent.quotas.monthlyAiTokenLimit).toBe(0);
  });

  test("lo que se lee de la base tampoco trae autolímite", async () => {
    // El default se aplica al crear Y al hidratar un documento viejo al que
    // le falte el campo, así que hay que mirar las dos vías.
    await AiAgent.collection.insertOne({ tenantId: TENANT });

    const agent = await AiAgent.findOne({ tenantId: TENANT }).setOptions({
      tenantId: TENANT,
    });

    expect(agent.quotas.monthlyMessageLimit).toBe(0);
    expect(agent.quotas.monthlyAiTokenLimit).toBe(0);
  });

  test("el autolímite que el comercio sí configura se guarda tal cual", async () => {
    // La contracara: sacar el default no puede romper el control real.
    const agent = await AiAgent.create({
      tenantId: TENANT,
      quotas: { monthlyMessageLimit: 500, monthlyAiTokenLimit: 250_000 },
    });

    expect(agent.quotas.monthlyMessageLimit).toBe(500);
    expect(agent.quotas.monthlyAiTokenLimit).toBe(250_000);
  });
});
