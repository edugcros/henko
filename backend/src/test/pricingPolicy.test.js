// Política de precios: la capa que decide si una recomendación es aplicable.
//
// Es la que hace segura a la IA, así que se prueba sola y sin base: Gemini
// puede proponer cualquier número, y lo que importa es que nada fuera de los
// límites del comerciante llegue a aplicarse.

import {
  applyPricingPolicy,
  minPriceForMargin,
  roundToEnding,
  PRICING_ACTION,
  ADJUSTMENT,
} from "../services/pricing/pricingPolicyService.js";
import { parseRecommendation } from "../services/pricing/pricingAiService.js";
import { PRICING_MODE } from "../models/pricingPolicyModel.js";

const policy = (extra = {}) => ({
  mode: PRICING_MODE.MANUAL,
  minMarginPercent: 35,
  targetMarginPercent: 50,
  maxChangePercent: 10,
  autoApplyMaxPercent: 5,
  priceFloor: null,
  priceCeiling: null,
  rounding: { enabled: false, endings: [990] },
  ...extra,
});

// costo 60.000, deducciones 10% → equilibrio 66.666,67
const signals = (extra = {}) => ({
  price: 100000,
  cost: { totalUnitCost: 60000, deductionRate: 0.1 },
  ...extra,
});

describe("minPriceForMargin · generaliza el precio de equilibrio", () => {
  test("con margen 0 da el precio de equilibrio", () => {
    const r = minPriceForMargin({ totalUnitCost: 60000, deductionRate: 0.1, marginPercent: 0 });

    // 60000 / (1 - 0.1)
    expect(r).toBeCloseTo(66666.67, 1);
  });

  test("con margen 35% da el precio que lo cumple", () => {
    const r = minPriceForMargin({ totalUnitCost: 60000, deductionRate: 0.1, marginPercent: 35 });

    // 60000 / (1 - 0.1 - 0.35)
    expect(r).toBeCloseTo(109090.91, 1);
  });

  test("devuelve null cuando el margen pedido es inalcanzable", () => {
    // Deducciones 70% + margen 40% = 110%: no existe precio que lo cumpla.
    expect(
      minPriceForMargin({ totalUnitCost: 60000, deductionRate: 0.7, marginPercent: 40 }),
    ).toBeNull();
  });

  test("sin costo no calcula", () => {
    expect(minPriceForMargin({ totalUnitCost: 0, deductionRate: 0.1, marginPercent: 35 })).toBeNull();
  });
});

describe("applyPricingPolicy · topes de variación", () => {
  test("recorta una suba que excede el máximo", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "INCREASE", recommendedPrice: 200000 },
      policy: policy(),
      signals: signals(),
    });

    expect(r.finalPrice).toBe(110000);
    expect(r.adjustments).toContain(ADJUSTMENT.CLAMPED_BY_MAX_CHANGE);
  });

  test("recorta una baja que excede el máximo", () => {
    // Costo bajo para que el piso de margen no interfiera con esta prueba.
    const r = applyPricingPolicy({
      recommendation: { action: "DECREASE", recommendedPrice: 10000 },
      policy: policy(),
      signals: signals({ cost: { totalUnitCost: 10000, deductionRate: 0.1 } }),
    });

    expect(r.finalPrice).toBe(90000);
    expect(r.adjustments).toContain(ADJUSTMENT.CLAMPED_BY_MAX_CHANGE);
  });

  test("una recomendación dentro del tope pasa entera", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "INCREASE", recommendedPrice: 105000 },
      policy: policy(),
      // Costo holgado: con el del resto del archivo el piso de margen queda
      // en 109.090 y empujaría el precio, que es correcto pero no es lo que
      // esta prueba mide.
      signals: signals({ cost: { totalUnitCost: 30000, deductionRate: 0.1 } }),
    });

    expect(r.finalPrice).toBe(105000);
    expect(r.adjustments).toHaveLength(0);
    expect(r.changePercent).toBe(5);
  });
});

describe("applyPricingPolicy · el margen mínimo manda", () => {
  test("empuja el precio hacia arriba aunque supere el tope de variación", () => {
    // El tope de variación permitiría bajar hasta 90.000, pero el margen
    // mínimo exige 109.090. Un límite duro tiene que poder ganarle a uno
    // blando: bajo el mínimo se vende a pérdida elegida.
    const r = applyPricingPolicy({
      recommendation: { action: "DECREASE", recommendedPrice: 80000 },
      policy: policy(),
      signals: signals(),
    });

    expect(r.finalPrice).toBeGreaterThan(109000);
    expect(r.adjustments).toContain(ADJUSTMENT.RAISED_BY_MIN_MARGIN);
  });

  test("rechaza cuando ningún precio alcanza el margen mínimo", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "INCREASE", recommendedPrice: 120000 },
      policy: policy({ minMarginPercent: 40 }),
      signals: signals({ cost: { totalUnitCost: 60000, deductionRate: 0.7 } }),
    });

    expect(r.allowed).toBe(false);
    expect(r.adjustments).toContain(ADJUSTMENT.REJECTED_IMPOSSIBLE_MARGIN);
    expect(r.finalPrice).toBe(100000);
  });

  test("sin costo no se puede aplicar el piso de margen y no se inventa uno", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "DECREASE", recommendedPrice: 95000 },
      policy: policy(),
      signals: signals({ cost: null }),
    });

    expect(r.allowed).toBe(true);
    expect(r.finalPrice).toBe(95000);
    expect(r.adjustments).not.toContain(ADJUSTMENT.RAISED_BY_MIN_MARGIN);
  });
});

describe("applyPricingPolicy · límites absolutos", () => {
  test("respeta el techo de precio", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "INCREASE", recommendedPrice: 108000 },
      policy: policy({ priceCeiling: 104000 }),
      signals: signals(),
    });

    expect(r.finalPrice).toBe(104000);
    expect(r.adjustments).toContain(ADJUSTMENT.CLAMPED_BY_CEILING);
  });

  test("respeta el piso de precio", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "DECREASE", recommendedPrice: 92000 },
      policy: policy({ priceFloor: 96000 }),
      signals: signals({ cost: { totalUnitCost: 10000, deductionRate: 0.1 } }),
    });

    expect(r.finalPrice).toBe(96000);
    expect(r.adjustments).toContain(ADJUSTMENT.CLAMPED_BY_FLOOR);
  });
});

describe("roundToEnding · precios lindos que no pierden plata", () => {
  test("redondea a la terminación más cercana", () => {
    expect(roundToEnding(104200, [990], 0)).toBe(103990);
    expect(roundToEnding(104800, [990], 0)).toBe(104990);
  });

  test("no baja del piso aunque sea la terminación más cercana", () => {
    // 103.990 sería lo más cercano, pero rompe el piso: sube a la de arriba.
    expect(roundToEnding(104200, [990], 104000)).toBe(104990);
  });

  test("sin terminaciones configuradas devuelve el precio tal cual", () => {
    expect(roundToEnding(104200, [], 0)).toBe(104200);
  });
});

describe("applyPricingPolicy · quién puede aplicar", () => {
  const rec = { action: "INCREASE", recommendedPrice: 103000 };

  // Costo bajo a propósito: con el costo del resto del archivo el piso de
  // margen queda en 109.090 y empuja cualquier precio hacia arriba, que es
  // correcto pero tapa lo que estas pruebas quieren medir.
  const holgado = () => signals({ cost: { totalUnitCost: 30000, deductionRate: 0.1 } });

  test("en modo manual todo pide aprobación", () => {
    const r = applyPricingPolicy({ recommendation: rec, policy: policy(), signals: holgado() });

    expect(r.requiresApproval).toBe(true);
  });

  test("en semi, un cambio chico se aplica solo", () => {
    const r = applyPricingPolicy({
      recommendation: rec,
      policy: policy({ mode: PRICING_MODE.SEMI }),
      signals: holgado(),
    });

    expect(r.changePercent).toBe(3);
    expect(r.requiresApproval).toBe(false);
  });

  test("en semi, un cambio grande sigue pidiendo aprobación", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "INCREASE", recommendedPrice: 109000 },
      policy: policy({ mode: PRICING_MODE.SEMI }),
      signals: holgado(),
    });

    expect(r.requiresApproval).toBe(true);
  });

  test("en autopilot no pide aprobación", () => {
    const r = applyPricingPolicy({
      recommendation: rec,
      policy: policy({ mode: PRICING_MODE.AUTOPILOT }),
      signals: holgado(),
    });

    expect(r.requiresApproval).toBe(false);
  });

  test("el default del modelo es manual: sin configurar, nada se aplica solo", () => {
    // Un precio que se mueve solo el primer día apaga la función para siempre.
    const r = applyPricingPolicy({
      recommendation: rec,
      policy: { ...policy(), mode: undefined },
      signals: holgado(),
    });

    expect(r.requiresApproval).toBe(true);
  });
});

describe("applyPricingPolicy · casos borde", () => {
  test("HOLD devuelve el precio actual sin tocar nada", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "HOLD", recommendedPrice: 999999 },
      policy: policy(),
      signals: signals(),
    });

    expect(r.action).toBe(PRICING_ACTION.HOLD);
    expect(r.finalPrice).toBe(100000);
    expect(r.changePercent).toBe(0);
  });

  test("un precio inválido del modelo no rompe: se trata como HOLD", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "DECREASE", recommendedPrice: -5000 },
      policy: policy(),
      signals: signals(),
    });

    expect(r.action).toBe(PRICING_ACTION.HOLD);
    expect(r.finalPrice).toBe(100000);
  });

  test("un producto sin precio no se puede evaluar", () => {
    const r = applyPricingPolicy({
      recommendation: { action: "INCREASE", recommendedPrice: 120000 },
      policy: policy(),
      signals: signals({ price: 0 }),
    });

    expect(r.allowed).toBe(false);
  });
});

describe("parseRecommendation · no confiar en el modelo", () => {
  const valid = {
    action: "DECREASE",
    recommendedPrice: 37990,
    confidence: 0.91,
    reason: "El competidor bajó 8%.",
    expectedImpact: { marginPercent: 34, sellThroughChangePercent: 12 },
  };

  test("acepta una respuesta bien formada", () => {
    const r = parseRecommendation(valid);

    expect(r.action).toBe("DECREASE");
    expect(r.recommendedPrice).toBe(37990);
    expect(r.confidence).toBe(0.91);
    expect(r.expectedImpact.marginPercent).toBe(34);
  });

  test("acepta JSON como string", () => {
    expect(parseRecommendation(JSON.stringify(valid)).recommendedPrice).toBe(37990);
  });

  test("rechaza una acción inventada", () => {
    expect(parseRecommendation({ ...valid, action: "LIQUIDAR_TODO" })).toBeNull();
  });

  test("rechaza un precio negativo", () => {
    expect(parseRecommendation({ ...valid, recommendedPrice: -100 })).toBeNull();
  });

  test("una confianza fuera de rango queda en null, no se recorta", () => {
    // Acotar un 7 a 1 fabricaría una certeza que el modelo no expresó.
    expect(parseRecommendation({ ...valid, confidence: 7 }).confidence).toBeNull();
  });

  test("no explota con basura", () => {
    expect(parseRecommendation(null)).toBeNull();
    expect(parseRecommendation("no soy json")).toBeNull();
    expect(parseRecommendation(42)).toBeNull();
    expect(parseRecommendation({})).toBeNull();
  });
});

// ─── Aplicar el precio ───────────────────────────────────────────────────────
//
// El motor recomendaba y la pantalla mostraba, pero no había forma de aplicar:
// ni botón ni endpoint. El comerciante leía "precio recomendado $12.900", se
// iba a Editar producto y lo tipeaba a mano — perdiendo de paso el rastro de
// que ese cambio salió de una recomendación, que es justo lo que después
// permite medir si el motor sirve.

describe("aplicar el precio recomendado", () => {
  let mongod;
  let mongoose;
  let Product;
  let PricingPolicy;
  let ProductPriceHistory;
  let applyRecommendedPrice;
  let buildPricingSignals;
  let PRICING_FLAG;

  let TENANT;

  const crearProducto = async (extra = {}) => {
    const producto = await Product.create({
      tenantId: TENANT,
      title: "Casco AGV",
      description: "Un casco",
      categoria: "Cascos",
      subcategoria: "Integral",
      marca: "AGV",
      slug: `casco-agv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      price: 100000,
      stock: 5,
      ...extra,
    });

    return producto;
  };

  beforeAll(async () => {
    mongoose = (await import("mongoose")).default;
    const { MongoMemoryServer } = await import("mongodb-memory-server");

    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    TENANT = new mongoose.Types.ObjectId();

    Product = (await import("../models/productModel.js")).default;
    ({ buildPricingSignals, PRICING_FLAG } = await import(
      "../services/pricing/pricingSignalService.js"
    ));
    PricingPolicy = (await import("../models/pricingPolicyModel.js")).default;
    ProductPriceHistory = (await import("../models/productPriceHistoryModel.js")).default;
    ({ applyRecommendedPrice } = await import(
      "../services/pricing/pricingRecommendationService.js"
    ));
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });

  afterEach(async () => {
    await Promise.all([
      Product.collection.deleteMany({}),
      PricingPolicy.collection.deleteMany({}),
      ProductPriceHistory.collection.deleteMany({}),
    ]);
  });

  test("cambia el precio y deja el rastro de que vino de una recomendación", async () => {
    const producto = await crearProducto();

    const resultado = await applyRecommendedPrice({
      tenantId: TENANT,
      productId: producto._id,
      price: 129000,
      reason: "Margen por debajo del mínimo",
    });

    expect(resultado).toMatchObject({
      previousPrice: 100000,
      newPrice: 129000,
      changePercent: 29,
    });

    const guardado = await Product.findById(producto._id)
      .setOptions({ tenantId: TENANT })
      .lean();
    expect(guardado.price).toBe(129000);

    // El historial es lo que después permite medir si la recomendación sirvió.
    const [historia] = await ProductPriceHistory.find({ tenantId: TENANT })
      .setOptions({ tenantId: TENANT })
      .lean();

    expect(historia).toMatchObject({
      previousPrice: 100000,
      newPrice: 129000,
      source: "ai_recommendation",
      reason: "Margen por debajo del mínimo",
    });
  });

  test("las variantes se mueven en la misma proporción", async () => {
    // Si no, el precio base cambia y las variantes quedan en el viejo — que es
    // el que el comprador termina pagando.
    const producto = await crearProducto({
      hasVariants: true,
      variants: [
        { key: "m", combinacion: { talle: "M" }, price: 100000, stock: 2 },
        { key: "l", combinacion: { talle: "L" }, price: 120000, stock: 1 },
      ],
    });

    await applyRecommendedPrice({
      tenantId: TENANT,
      productId: producto._id,
      price: 50000,
    });

    const guardado = await Product.findById(producto._id)
      .setOptions({ tenantId: TENANT })
      .lean();

    expect(guardado.variants.map(v => v.price)).toEqual([50000, 60000]);
  });

  test("no deja vender por debajo del costo cargado", async () => {
    const producto = await crearProducto({ costoUnitario: 80000 });

    await expect(
      applyRecommendedPrice({
        tenantId: TENANT,
        productId: producto._id,
        price: 70000,
      }),
    ).rejects.toThrow(/por debajo del costo/i);

    const guardado = await Product.findById(producto._id)
      .setOptions({ tenantId: TENANT })
      .lean();
    expect(guardado.price).toBe(100000);
  });

  test("respeta el piso y el techo que fijó el comercio", async () => {
    await PricingPolicy.create({
      tenantId: TENANT,
      priceFloor: 90000,
      priceCeiling: 150000,
    });

    const producto = await crearProducto();

    await expect(
      applyRecommendedPrice({ tenantId: TENANT, productId: producto._id, price: 80000 }),
    ).rejects.toThrow(/precio mínimo/i);

    await expect(
      applyRecommendedPrice({ tenantId: TENANT, productId: producto._id, price: 200000 }),
    ).rejects.toThrow(/precio máximo/i);
  });

  test("un producto de otro comercio no se toca", async () => {
    const producto = await crearProducto();
    const otroComercio = new mongoose.Types.ObjectId();

    await expect(
      applyRecommendedPrice({
        tenantId: otroComercio,
        productId: producto._id,
        price: 120000,
      }),
    ).rejects.toThrow(/no encontrado/i);
  });

  // "Sin costo cargado" no justifica gastar IA.
  //
  // Un producto sin costo y sin ventas llegaba igual al modelo, que contestaba
  // "no hay datos suficientes para justificar una variación" con 20% de
  // confianza y recomendaba el mismo precio. Una llamada paga para decir algo
  // que el sistema ya sabía: falta el costo.
  test("sin costo cargado se muestra la señal pero no se llama a la IA", async () => {
    const producto = await crearProducto();

    const signals = await buildPricingSignals({
      tenantId: TENANT,
      productId: producto._id,
      policy: { minMarginPercent: 35, targetMarginPercent: 50, consider: {} },
    });

    expect(signals.flags).toContain(PRICING_FLAG.NO_COST);
    expect(signals.warrantsAnalysis).toBe(false);
  });
});
