// Quién puede salir del aislamiento por tenant, y con qué queda registrado.
//
// `ignoreTenant` no se puede prohibir. Hay operaciones que cruzan comercios por
// definición: el gasto de IA de la plataforma, el worker de recuperación de
// carritos, buscar un usuario por email antes de saber a qué comercio
// pertenece. Sin la salida habría que reimplementarlas peor, o —peor todavía—
// alguien apagaría el plugin entero, que es de donde este archivo viene: el
// plugin traía un `NODE_ENV === 'test'` que lo desactivaba durante las pruebas y
// volvía indetectable la única propiedad sobre la que descansa el modelo
// multi-tenant.
//
// LA CONDICIÓN QUE IMPORTA
//
// Los usos legítimos comparten algo: no hay tenant en el contexto. Un worker, un
// script y una request pre-login corren sin él. Cuando SÍ lo hay, el comercio de
// esa request ya está determinado y saltear el filtro significa ir a buscar
// datos afuera. Ese es el caso que se audita, y por eso los veintipico de usos
// legítimos que ya existen no hacen ruido.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
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

const TENANT_A = new mongoose.Types.ObjectId();
const TENANT_B = new mongoose.Types.ObjectId();

let mongod;
let Nota;
let runWithTenantContext;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const { tenantPlugin } = await import("../models/tenantPlugin.js");
  ({ runWithTenantContext } = await import("../utils/tenantRequestContext.js"));

  const schema = new mongoose.Schema({ titulo: String });
  schema.plugin(tenantPlugin);
  Nota = mongoose.model("NotaDePrueba", schema);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

// Los datos se rehacen en cada test y no una sola vez: uno de estos casos hace
// un updateMany que cruza comercios, y con una semilla compartida el resultado
// de la suite dependería del orden en que corran.
beforeEach(async () => {
  jest.clearAllMocks();

  await Nota.collection.deleteMany({});
  await Nota.collection.insertMany([
    { tenantId: TENANT_A, titulo: "de A" },
    { tenantId: TENANT_B, titulo: "de B" },
  ]);
});

// El await va ADENTRO del scope a propósito. Una query de Mongoose es perezosa:
// si el callback la devuelve sin esperarla, los hooks corren cuando el await
// externo la ejecuta, y para entonces el AsyncLocalStorage ya salió del
// contexto. El test estaría probando el caso sin tenant sin darse cuenta.
const enRequestDe = (tenantId, fn) =>
  runWithTenantContext({ tenantId }, async () => fn());

const avisos = () =>
  mockLogger.error.mock.calls.filter(([mensaje]) =>
    String(mensaje).includes("Aislamiento salteado"),
  );

describe("tenantPlugin · escapes dentro de una request", () => {
  test("saltear el aislamiento con tenant activo queda registrado", async () => {
    await enRequestDe(TENANT_A, () =>
      Nota.find({}).setOptions({ ignoreTenant: true }),
    );

    expect(avisos()).toHaveLength(1);

    const [, detalle] = avisos()[0];

    expect(detalle.model).toBe("NotaDePrueba");
    expect(detalle.tenantEnContexto).toBe(String(TENANT_A));
  });

  test("y de verdad devuelve datos de otros comercios", async () => {
    // El aviso no es teórico: esto es lo que la consulta ve.
    const filas = await enRequestDe(TENANT_A, () =>
      Nota.find({}).setOptions({ ignoreTenant: true }),
    );

    expect(filas).toHaveLength(2);
  });

  test("declarando el motivo no se registra nada", async () => {
    // `platformScope` es la forma de decir "el cruce es a propósito", escrita en
    // el mismo lugar donde ocurre, que es lo que se quiere poder leer en una
    // revisión.
    await enRequestDe(TENANT_A, () =>
      Nota.find({}).setOptions({
        ignoreTenant: true,
        platformScope: "platform:reporte-de-gasto",
      }),
    );

    expect(avisos()).toHaveLength(0);
  });

  test("un motivo vacío no alcanza para silenciarlo", async () => {
    await enRequestDe(TENANT_A, () =>
      Nota.find({}).setOptions({ ignoreTenant: true, platformScope: "   " }),
    );

    expect(avisos()).toHaveLength(1);
  });

  test("skipTenant se audita igual que ignoreTenant", async () => {
    // Son dos nombres para lo mismo; auditar uno solo dejaría el otro abierto.
    await enRequestDe(TENANT_A, () =>
      Nota.find({}).setOptions({ skipTenant: true }),
    );

    expect(avisos()).toHaveLength(1);
  });

  test("una agregación que cruza comercios también", async () => {
    // Es la vía por la que pasan los reportes de plataforma.
    await enRequestDe(TENANT_A, () =>
      Nota.aggregate([{ $group: { _id: "$tenantId" } }]).option({
        ignoreTenant: true,
      }),
    );

    expect(avisos()).toHaveLength(1);
    expect(avisos()[0][1].operation).toBe("aggregate");
  });

  test("un update que escapa el filtro también", async () => {
    await enRequestDe(TENANT_A, () =>
      Nota.updateMany({}, { $set: { titulo: "x" } }).setOptions({
        ignoreTenant: true,
      }),
    );

    expect(avisos()).toHaveLength(1);
  });
});

describe("tenantPlugin · lo que NO tiene que hacer ruido", () => {
  test("un worker sin contexto no registra nada", async () => {
    // Es el caso de aiCartRecoveryWorkerService y de los scripts de migración.
    await Nota.find({}).setOptions({ ignoreTenant: true });

    expect(avisos()).toHaveLength(0);
  });

  test("una consulta normal dentro de una request tampoco", async () => {
    await enRequestDe(TENANT_A, () => Nota.find({}));

    expect(avisos()).toHaveLength(0);
  });

  test("y esa consulta normal sigue aislada", async () => {
    // La guarda es un registro, no un cambio de comportamiento: el filtro por
    // tenant tiene que seguir aplicándose igual que antes.
    const filas = await enRequestDe(TENANT_A, () => Nota.find({}));

    expect(filas).toHaveLength(1);
    expect(filas[0].titulo).toBe("de A");
  });
});
