// Resolución de costos de un producto.
//
// Lo que se verifica acá es de dónde sale cada número: si el sistema prefiere
// lo que ya sabe por sobre lo que alguien tipeó, y si se abstiene cuando no
// sabe en vez de inventar.
//
// Corre contra MongoDB en memoria porque la comisión efectiva es una
// agregación real sobre órdenes: mockearla probaría la aritmética y dejaría
// pasar un filtro mal escrito, que es el fallo probable.

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const TENANT = new mongoose.Types.ObjectId();
const OTRO_TENANT = new mongoose.Types.ObjectId();

let mongod;
let Product;
let Order;
let measurePaymentFeePercent;
let resolveProductCostInputs;
let COST_SOURCE;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  Product = (await import("../models/productModel.js")).default;
  Order = (await import("../models/orderModel.js")).default;

  const svc = await import("../services/pricing/productCostService.js");
  measurePaymentFeePercent = svc.measurePaymentFeePercent;
  resolveProductCostInputs = svc.resolveProductCostInputs;
  COST_SOURCE = svc.COST_SOURCE;
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Product.deleteMany({}).setOptions({ ignoreTenant: true });
  await Order.collection.deleteMany({});
});

// Las órdenes se insertan crudas a propósito: lo que se prueba es la
// agregación, no las validaciones del modelo de orden, que exigen carrito,
// dirección y líneas para algo que no participa del cálculo.
const seedOrders = (n, { feeCents, amountCents, tenantId = TENANT, status = "approved", daysAgo = 1 } = {}) =>
  Order.collection.insertMany(
    Array.from({ length: n }, () => ({
      tenantId,
      paymentStatus: status,
      paidAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      paymentIntent: { amountCents, providerFeeCents: feeCents },
    })),
  );

const makeProduct = (extra = {}) =>
  Product.create({
    tenantId: TENANT,
    title: "Zapatilla",
    slug: `z-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    description: "Una zapatilla",
    marca: "Nike",
    categoria: "Calzado",
    subcategoria: "Running",
    price: 100000,
    costoUnitario: 60000,
    ...extra,
  });

describe("comisión efectiva · medida sobre ventas reales", () => {
  test("con muestra suficiente devuelve la tasa y el tamaño", async () => {
    // 10 ventas de $1.000 con $60 de comisión = 6%
    await seedOrders(10, { amountCents: 100000, feeCents: 6000 });

    const r = await measurePaymentFeePercent({ tenantId: TENANT });

    expect(r.percent).toBeCloseTo(6, 2);
    expect(r.sampleSize).toBe(10);
  });

  test("con menos ventas que el mínimo se abstiene", async () => {
    // Con dos o tres ventas la tasa la domina el método de pago que se usó.
    await seedOrders(4, { amountCents: 100000, feeCents: 6000 });

    expect(await measurePaymentFeePercent({ tenantId: TENANT })).toBeNull();
  });

  test("pondera por monto, no promedia porcentajes", async () => {
    // 5 ventas chicas al 10% y 5 grandes al 2%. El promedio simple daría 6%;
    // la factura real la manda el monto.
    await seedOrders(5, { amountCents: 10000, feeCents: 1000 });
    await seedOrders(5, { amountCents: 1000000, feeCents: 20000 });

    const r = await measurePaymentFeePercent({ tenantId: TENANT });

    // (5000 + 100000) / (50000 + 5000000) = 2.08%
    expect(r.percent).toBeCloseTo(2.08, 1);
  });

  test("ignora las órdenes viejas sin comisión informada", async () => {
    // Antes de capturar fee_details no había dato. Contarlas como comisión
    // cero hundiría la tasa justo al principio, cuando casi todas son viejas.
    await seedOrders(10, { amountCents: 100000, feeCents: 6000 });
    await Order.collection.insertMany(
      Array.from({ length: 50 }, () => ({
        tenantId: TENANT,
        paymentStatus: "approved",
        paidAt: new Date(),
        paymentIntent: { amountCents: 100000 },
      })),
    );

    const r = await measurePaymentFeePercent({ tenantId: TENANT });

    expect(r.sampleSize).toBe(10);
    expect(r.percent).toBeCloseTo(6, 2);
  });

  test("ignora las que no están cobradas", async () => {
    await seedOrders(10, { amountCents: 100000, feeCents: 6000 });
    await seedOrders(10, { amountCents: 100000, feeCents: 50000, status: "pending" });

    expect((await measurePaymentFeePercent({ tenantId: TENANT })).percent).toBeCloseTo(6, 2);
  });

  test("ignora las de fuera de la ventana de 90 días", async () => {
    await seedOrders(10, { amountCents: 100000, feeCents: 6000 });
    await seedOrders(10, { amountCents: 100000, feeCents: 50000, daysAgo: 200 });

    expect((await measurePaymentFeePercent({ tenantId: TENANT })).percent).toBeCloseTo(6, 2);
  });

  test("no mira las ventas de otro comercio", async () => {
    await seedOrders(10, { amountCents: 100000, feeCents: 6000 });
    await seedOrders(50, { amountCents: 100000, feeCents: 50000, tenantId: OTRO_TENANT });

    const r = await measurePaymentFeePercent({ tenantId: TENANT });

    expect(r.sampleSize).toBe(10);
    expect(r.percent).toBeCloseTo(6, 2);
  });

  test("sin ventas devuelve null", async () => {
    expect(await measurePaymentFeePercent({ tenantId: TENANT })).toBeNull();
  });
});

describe("resolución de costos · prefiere lo que ya sabe", () => {
  test("toma el costo de la ficha del producto sin que nadie lo tipee", async () => {
    const p = await makeProduct();

    const { costs, provenance } = await resolveProductCostInputs({
      tenantId: TENANT,
      productId: p._id,
    });

    expect(costs.unitCost).toBe(60000);
    expect(provenance.unitCost).toBe(COST_SOURCE.STORED);
  });

  test("lo que manda el comerciante le gana a la ficha", async () => {
    const p = await makeProduct();

    const { costs, provenance } = await resolveProductCostInputs({
      tenantId: TENANT,
      productId: p._id,
      overrides: { unitCost: 75000 },
    });

    expect(costs.unitCost).toBe(75000);
    expect(provenance.unitCost).toBe(COST_SOURCE.OVERRIDE);
  });

  test("usa la comisión medida cuando no la mandan", async () => {
    const p = await makeProduct();
    await seedOrders(10, { amountCents: 100000, feeCents: 6000 });

    const { costs, provenance } = await resolveProductCostInputs({
      tenantId: TENANT,
      productId: p._id,
    });

    expect(costs.paymentFeePercent).toBeCloseTo(6, 2);
    expect(provenance.paymentFeePercent).toBe(COST_SOURCE.MEASURED);
    expect(provenance.paymentFeeSampleSize).toBe(10);
  });

  test("un override explícito gana incluso sobre la medición", async () => {
    // El comerciante puede estar simulando un acuerdo distinto al que tiene.
    const p = await makeProduct();
    await seedOrders(10, { amountCents: 100000, feeCents: 6000 });

    const { costs, provenance } = await resolveProductCostInputs({
      tenantId: TENANT,
      productId: p._id,
      overrides: { paymentFeePercent: 3.5 },
    });

    expect(costs.paymentFeePercent).toBe(3.5);
    expect(provenance.paymentFeePercent).toBe(COST_SOURCE.OVERRIDE);
  });

  test("sin muestra la comisión queda en cero y se declara desconocida", async () => {
    const p = await makeProduct();

    const { costs, provenance } = await resolveProductCostInputs({
      tenantId: TENANT,
      productId: p._id,
    });

    expect(costs.paymentFeePercent).toBe(0);
    expect(provenance.paymentFeePercent).toBe(COST_SOURCE.MISSING);
  });

  test("sin costo por ningún lado no devuelve costos: no se inventa", async () => {
    const p = await makeProduct({ costoUnitario: 0 });

    const { costs, provenance } = await resolveProductCostInputs({
      tenantId: TENANT,
      productId: p._id,
    });

    expect(costs).toBeNull();
    expect(provenance.unitCost).toBe(COST_SOURCE.MISSING);
  });

  test("no lee el producto de otro comercio", async () => {
    const p = await makeProduct();

    const { costs } = await resolveProductCostInputs({
      tenantId: OTRO_TENANT,
      productId: p._id,
    });

    expect(costs).toBeNull();
  });

  test("los porcentajes se topean en 100", async () => {
    const p = await makeProduct();

    const { costs } = await resolveProductCostInputs({
      tenantId: TENANT,
      productId: p._id,
      overrides: { platformFeePercent: 500, taxPercent: 300, paymentFeePercent: 900 },
    });

    expect(costs.platformFeePercent).toBe(100);
    expect(costs.taxPercent).toBe(100);
    expect(costs.paymentFeePercent).toBe(100);
  });

  test("sin productId solo se usan los overrides", async () => {
    const { costs, provenance } = await resolveProductCostInputs({
      tenantId: TENANT,
      overrides: { unitCost: 42000, shippingCost: 1000 },
    });

    expect(costs.unitCost).toBe(42000);
    expect(costs.shippingCost).toBe(1000);
    expect(provenance.unitCost).toBe(COST_SOURCE.OVERRIDE);
  });
});
