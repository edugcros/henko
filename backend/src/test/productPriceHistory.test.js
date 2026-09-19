// Historial de precios.
//
// Se prueba contra una base real en memoria y no con mocks a propósito: lo que
// hay que verificar es que el hook de mongoose efectivamente DISPARE al
// guardar. Un mock del modelo probaría la aritmética y dejaría pasar el único
// fallo que importa acá — que el hook no corra y el historial quede vacío sin
// que nadie se entere.
//
// No se usa src/test/testDB.js: ese helper hace dropDatabase() sobre la URI
// configurada, que en esta máquina apunta a la base de desarrollo.

import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const TENANT = new mongoose.Types.ObjectId();
const USER = new mongoose.Types.ObjectId();

let mongod;
let Product;
let ProductPriceHistory;
let PRICE_CHANGE_SOURCE;
let withOptionalTransaction;

// Replica set de un solo nodo y no un mongod suelto: sin replica set no hay
// transacciones, y entonces la mitad de lo que hay que probar acá —que el
// precio se revierta cuando su historial no entra— no se puede ni ejecutar.
// Producción es Atlas, o sea replica set, así que además se parece más.
beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());

  Product = (await import("../models/productModel.js")).default;
  const hist = await import("../models/productPriceHistoryModel.js");
  ProductPriceHistory = hist.default;
  PRICE_CHANGE_SOURCE = hist.PRICE_CHANGE_SOURCE;
  ({ withOptionalTransaction } = await import(
    "../utils/withOptionalTransaction.js"
  ));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Product.deleteMany({}).setOptions({ ignoreTenant: true });
  await ProductPriceHistory.deleteMany({}).setOptions({ ignoreTenant: true });
});

const historyFor = productId =>
  ProductPriceHistory.find({ productId })
    .setOptions({ ignoreTenant: true })
    .sort({ createdAt: 1 })
    .lean();

const makeProduct = async (extra = {}) => {
  const doc = await Product.create({
    tenantId: TENANT,
    title: "Zapatilla running",
    slug: `zapatilla-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    description: "Zapatilla de running con amortiguación",
    marca: "Nike",
    categoria: "Calzado",
    subcategoria: "Running",
    price: 100000,
    costoUnitario: 60000,
    ...extra,
  });
  // create() no pasa por post('init'): hay que releerlo para que el snapshot
  // exista, igual que cuando un controlador trae el producto para editarlo.
  return Product.findById(doc._id).setOptions({ ignoreTenant: true });
};

describe("historial de precios · se registra el cambio", () => {
  test("un cambio de precio deja una fila con los dos valores", async () => {
    const p = await makeProduct();

    p.price = 120000;
    await p.save();

    const rows = await historyFor(p._id);

    expect(rows).toHaveLength(1);
    expect(rows[0].previousPrice).toBe(100000);
    expect(rows[0].newPrice).toBe(120000);
    expect(rows[0].changePercent).toBe(20);
  });

  test("guardar sin tocar el precio no registra nada", async () => {
    const p = await makeProduct();

    p.title = "Otro título";
    await p.save();

    expect(await historyFor(p._id)).toHaveLength(0);
  });

  test("crear un producto no genera historial: no hay precio anterior", async () => {
    const doc = await Product.create({
      tenantId: TENANT,
      title: "Nuevo",
      slug: `nuevo-${Date.now()}`,
      description: "Producto nuevo",
      marca: "Nike",
      categoria: "Calzado",
      subcategoria: "Running",
      price: 50000,
    });

    expect(await historyFor(doc._id)).toHaveLength(0);
  });

  test("dos cambios seguidos sobre la misma instancia dejan dos filas encadenadas", async () => {
    // Sin refrescar el snapshot después de guardar, el segundo cambio se
    // compararía contra el precio de dos cambios atrás.
    const p = await makeProduct();

    p.price = 110000;
    await p.save();
    p.price = 130000;
    await p.save();

    const rows = await historyFor(p._id);

    expect(rows).toHaveLength(2);
    expect(rows[0].previousPrice).toBe(100000);
    expect(rows[1].previousPrice).toBe(110000);
    expect(rows[1].newPrice).toBe(130000);
  });
});

describe("historial de precios · costo y margen del momento", () => {
  test("congela el costo vigente al momento del cambio", async () => {
    const p = await makeProduct();

    p.price = 120000;
    await p.save();

    const [row] = await historyFor(p._id);

    expect(row.unitCostAtChange).toBe(60000);
    // (120000 - 60000) / 120000
    expect(row.marginAtChange).toBeCloseTo(0.5, 4);
  });

  test("el costo queda congelado aunque después cambie", async () => {
    // Es la razón de ser del campo: mirar el costo actual contra un precio
    // viejo da un margen que nunca existió.
    const p = await makeProduct();

    p.price = 120000;
    await p.save();

    p.costoUnitario = 90000;
    p.price = 130000;
    await p.save();

    const rows = await historyFor(p._id);

    expect(rows[0].unitCostAtChange).toBe(60000);
    expect(rows[1].unitCostAtChange).toBe(90000);
  });

  test("sin costo cargado el margen es null, no cero", async () => {
    const p = await makeProduct({ costoUnitario: 0 });

    p.price = 120000;
    await p.save();

    const [row] = await historyFor(p._id);

    expect(row.unitCostAtChange).toBeNull();
    expect(row.marginAtChange).toBeNull();
  });
});

describe("historial de precios · contexto del cambio", () => {
  test("guarda quién lo cambió, por qué y desde dónde", async () => {
    const p = await makeProduct();

    p.price = 95000;
    p.$locals.priceChange = {
      userId: USER,
      source: PRICE_CHANGE_SOURCE.AI_RECOMMENDATION,
      reason: "competencia -4.2%",
    };
    await p.save();

    const [row] = await historyFor(p._id);

    expect(row.source).toBe("ai_recommendation");
    expect(row.reason).toBe("competencia -4.2%");
    expect(String(row.changedBy)).toBe(String(USER));
  });

  test("sin contexto el cambio igual se registra, como 'unknown'", async () => {
    // Perder el motivo es aceptable; perder el cambio no.
    const p = await makeProduct();

    p.price = 95000;
    await p.save();

    const [row] = await historyFor(p._id);

    expect(row.source).toBe("unknown");
    expect(row.reason).toBe("");
  });

  test("hereda el tenant del producto", async () => {
    const p = await makeProduct();

    p.price = 95000;
    await p.save();

    const [row] = await historyFor(p._id);

    expect(String(row.tenantId)).toBe(String(TENANT));
  });
});

describe("historial de precios · variantes", () => {
  test("el cambio de precio de una variante deja su propia fila", async () => {
    const p = await makeProduct({
      variants: [{ key: "talle-42", price: 100000, costoUnitario: 55000 }],
    });

    p.variants[0].price = 115000;
    await p.save();

    const rows = await historyFor(p._id);

    expect(rows).toHaveLength(1);
    expect(rows[0].variantId).toBe("talle-42");
    expect(rows[0].previousPrice).toBe(100000);
    expect(rows[0].newPrice).toBe(115000);
    expect(rows[0].unitCostAtChange).toBe(55000);
  });

  test("producto y variante en el mismo guardado dejan filas separadas", async () => {
    const p = await makeProduct({
      variants: [{ key: "talle-42", price: 100000, costoUnitario: 55000 }],
    });

    p.price = 120000;
    p.variants[0].price = 115000;
    await p.save();

    const rows = await historyFor(p._id);

    expect(rows).toHaveLength(2);
    expect(rows.filter(r => r.variantId === null)).toHaveLength(1);
    expect(rows.filter(r => r.variantId === "talle-42")).toHaveLength(1);
  });

  test("agregar una variante nueva no cuenta como cambio de precio", async () => {
    const p = await makeProduct();

    p.variants.push({ key: "talle-43", price: 105000, costoUnitario: 55000 });
    await p.save();

    expect(await historyFor(p._id)).toHaveLength(0);
  });
});

describe("historial de precios · no rompe el guardado", () => {
  test("sin transacción, si el historial falla el producto se guarda igual", async () => {
    const p = await makeProduct();
    const spy = jest
      .spyOn(ProductPriceHistory, "insertMany")
      .mockRejectedValueOnce(new Error("mongo caído"));
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});

    p.price = 140000;
    await expect(p.save()).resolves.toBeDefined();

    const saved = await Product.findById(p._id).setOptions({ ignoreTenant: true });
    expect(saved.price).toBe(140000);

    spy.mockRestore();
    quiet.mockRestore();
  });
});

// El caso que el informe externo llamaba "precio nuevo sin trazabilidad".
// Sobre un replica set el precio y su fila entran juntos o no entra ninguno.
describe("historial de precios · atomicidad con transacción", () => {
  test("el helper abre transacción de verdad sobre un replica set", async () => {
    // Esta prueba parece trivial y no lo es: withOptionalTransaction leía
    // `db.topology`, que en este driver es undefined, así que devolvía null y
    // TODOS sus callers corrían sin transacción creyendo que tenían una.
    const session = await withOptionalTransaction(async s => s);
    expect(session).not.toBeNull();
  });

  test("si el historial falla dentro de la transacción, el precio no queda", async () => {
    const p = await makeProduct();
    const spy = jest
      .spyOn(ProductPriceHistory, "insertMany")
      .mockRejectedValueOnce(new Error("mongo caído"));
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      withOptionalTransaction(session => {
        p.price = 140000;
        return p.save(session ? { session } : {});
      }),
    ).rejects.toThrow("mongo caído");

    const saved = await Product.findById(p._id).setOptions({ ignoreTenant: true });
    expect(saved.price).toBe(100000);
    expect(await historyFor(p._id)).toHaveLength(0);

    spy.mockRestore();
    quiet.mockRestore();
  });

  test("si todo va bien, precio y fila quedan los dos", async () => {
    const p = await makeProduct();

    await withOptionalTransaction(session => {
      p.price = 140000;
      return p.save(session ? { session } : {});
    });

    const saved = await Product.findById(p._id).setOptions({ ignoreTenant: true });
    expect(saved.price).toBe(140000);

    const rows = await historyFor(p._id);
    expect(rows).toHaveLength(1);
    expect(rows[0].previousPrice).toBe(100000);
    expect(rows[0].newPrice).toBe(140000);
  });
});

// Auditoría de la cadena.
//
// Borrar una fila del historial ES la simulación fiel de una escritura
// perdida: el estado que queda en la base es exactamente el mismo. Por eso
// estas pruebas borran filas de verdad en vez de mockear el fallo.
describe("historial de precios · auditoría de la cadena", () => {
  let auditPriceHistory;

  beforeAll(async () => {
    ({ auditPriceHistory } = await import(
      "../services/pricing/priceHistoryAuditService.js"
    ));
  });

  const cambiarPrecio = async (p, precio) => {
    p.price = precio;
    await p.save();
    return Product.findById(p._id).setOptions({ ignoreTenant: true });
  };

  test("una cadena completa da balanced", async () => {
    let p = await makeProduct();
    p = await cambiarPrecio(p, 140000);
    await cambiarPrecio(p, 180000);

    const a = await auditPriceHistory();

    expect(a.balanced).toBe(true);
    expect(a.gaps).toHaveLength(0);
    expect(a.chains).toBe(1);
    expect(a.rows).toBe(2);
  });

  test("si falta la última fila, el hueco se reconstruye entero", async () => {
    let p = await makeProduct();
    p = await cambiarPrecio(p, 140000);
    await cambiarPrecio(p, 180000);

    const filas = await historyFor(p._id);
    await ProductPriceHistory.deleteOne({ _id: filas[filas.length - 1]._id })
      .setOptions({ ignoreTenant: true });

    const a = await auditPriceHistory();

    expect(a.balanced).toBe(false);
    expect(a.gaps).toHaveLength(1);
    expect(a.gaps[0].kind).toBe("head-mismatch");
    // Los dos extremos que sobrevivieron: lo último registrado y el precio de hoy.
    expect(a.gaps[0].lost).toEqual({ previousPrice: 140000, newPrice: 180000 });
  });

  test("si falta una fila del medio, se detecta el corte", async () => {
    let p = await makeProduct();
    p = await cambiarPrecio(p, 140000);
    p = await cambiarPrecio(p, 180000);
    await cambiarPrecio(p, 200000);

    const filas = await historyFor(p._id);
    expect(filas).toHaveLength(3);
    await ProductPriceHistory.deleteOne({ _id: filas[1]._id })
      .setOptions({ ignoreTenant: true });

    const a = await auditPriceHistory();

    expect(a.balanced).toBe(false);
    expect(a.gaps).toHaveLength(1);
    expect(a.gaps[0].kind).toBe("broken-chain");
    expect(a.gaps[0].expectedPrevious).toBe(140000);
    expect(a.gaps[0].actualPrevious).toBe(180000);
  });

  test("el historial de un producto borrado es huérfano, no un hueco", async () => {
    let p = await makeProduct();
    await cambiarPrecio(p, 140000);

    await Product.deleteOne({ _id: p._id }).setOptions({ ignoreTenant: true });

    const a = await auditPriceHistory();

    expect(a.balanced).toBe(true);
    expect(a.gaps).toHaveLength(0);
    expect(a.orphans).toHaveLength(1);
    expect(a.orphans[0].rows).toBe(1);
  });

  // buildEntry no registra cuando el precio anterior es <= 0: sin precio
  // anterior no hay cambio, hay un alta. El corte que eso deja es legítimo y
  // tiene que ir aparte — marcarlo como error entrenaría a ignorar el aviso.
  test("el corte que deja un precio 0 va a expected, no a gaps", async () => {
    let p = await makeProduct();
    p = await cambiarPrecio(p, 0);
    await cambiarPrecio(p, 50000);

    const a = await auditPriceHistory();

    expect(a.gaps).toHaveLength(0);
    expect(a.balanced).toBe(true);
    expect(a.expected).toHaveLength(1);
    expect(a.expected[0].kind).toBe("head-mismatch");
  });

  test("la cadena de una variante es independiente de la del producto", async () => {
    const p = await makeProduct({
      hasVariants: true,
      variants: [
        { key: "talle:40", attributes: { talle: "40" }, price: 100000, stock: 5 },
      ],
    });

    p.price = 140000;
    p.variants[0].price = 120000;
    await p.save();

    const a = await auditPriceHistory();

    expect(a.chains).toBe(2);
    expect(a.balanced).toBe(true);
  });
});
