// Comisión real de la pasarela y su efecto en el margen.
//
// Hasta ahora el margen de un producto se calculaba con un porcentaje de
// comisión cargado a mano. Estos dos cambios lo reemplazan por el número que
// Mercado Pago efectivamente descontó, y separan esa comisión de la de la
// plataforma, que es otra negociación.

import {
  extractMercadoPagoFees,
  checkOrderInternals,
  checkOrderAgainstProvider,
} from "../services/paymentOrderService.js";
import { calculateProfitability } from "../services/marketIntelligence/scoring/profitabilityEngine.js";

describe("extractMercadoPagoFees · comisión real", () => {
  test("toma la comisión del vendedor y el neto recibido", () => {
    const r = extractMercadoPagoFees({
      fee_details: [{ type: "mercadopago_fee", amount: 45.32, fee_payer: "collector" }],
      transaction_details: { net_received_amount: 954.68 },
    });

    expect(r.providerFeeCents).toBe(4532);
    expect(r.netReceivedCents).toBe(95468);
  });

  test("NO cuenta las comisiones que paga el comprador", () => {
    // El costo de financiación de las cuotas lo absorbe el comprador. Sumarlo
    // inflaría el costo del comercio con plata que nunca puso.
    const r = extractMercadoPagoFees({
      fee_details: [
        { type: "mercadopago_fee", amount: 45.32, fee_payer: "collector" },
        { type: "financing_fee", amount: 120.00, fee_payer: "payer" },
      ],
    });

    expect(r.providerFeeCents).toBe(4532);
  });

  test("suma varias comisiones del vendedor", () => {
    const r = extractMercadoPagoFees({
      fee_details: [
        { type: "mercadopago_fee", amount: 45.32, fee_payer: "collector" },
        { type: "application_fee", amount: 10.5, fee_payer: "collector" },
      ],
    });

    expect(r.providerFeeCents).toBe(5582);
  });

  test("una comisión sin fee_payer se cuenta como del vendedor", () => {
    const r = extractMercadoPagoFees({
      fee_details: [{ type: "mercadopago_fee", amount: 20 }],
    });

    expect(r.providerFeeCents).toBe(2000);
  });

  test("sin fee_details devuelve null, no cero", () => {
    // Cero afirmaría que no hubo comisión; null dice que no se sabe.
    const r = extractMercadoPagoFees({ status: "approved" });

    expect(r.providerFeeCents).toBeNull();
    expect(r.netReceivedCents).toBeNull();
  });

  test("fee_details presente que suma cero SÍ es un cero real", () => {
    const r = extractMercadoPagoFees({
      fee_details: [{ type: "mercadopago_fee", amount: 0, fee_payer: "collector" }],
    });

    expect(r.providerFeeCents).toBe(0);
  });

  test("no explota con entradas inesperadas", () => {
    const vacio = { providerFeeCents: null, netReceivedCents: null };

    expect(extractMercadoPagoFees(null)).toEqual(vacio);
    expect(extractMercadoPagoFees(undefined)).toEqual(vacio);
    expect(extractMercadoPagoFees("texto")).toEqual(vacio);
    expect(extractMercadoPagoFees({ fee_details: "no es array" })).toEqual(vacio);
    expect(extractMercadoPagoFees({ fee_details: [{ amount: "abc" }] }).providerFeeCents).toBe(0);
  });

  test("el neto se toma aunque no haya comisiones informadas", () => {
    // Son dos datos independientes: el neto puede llegar antes que el detalle.
    const r = extractMercadoPagoFees({
      transaction_details: { net_received_amount: 800 },
    });

    expect(r.providerFeeCents).toBeNull();
    expect(r.netReceivedCents).toBe(80000);
  });
});

describe("profitabilityEngine · comisión de pasarela separada de la de plataforma", () => {
  const base = { unitCost: 20000, shippingCost: 2000 };

  test("las dos comisiones se suman a la deducción", () => {
    const r = calculateProfitability(
      { ...base, platformFeePercent: 2, paymentFeePercent: 6 },
      null,
    );

    expect(r.viable).toBe(true);
    expect(r.deductionRate).toBeCloseTo(0.08, 6);
    // 22000 / (1 - 0.08)
    expect(r.breakEvenPrice).toBeCloseTo(23913.04, 2);
  });

  test("compatibilidad: quien manda solo platformFeePercent sigue igual", () => {
    const antes = calculateProfitability({ ...base, platformFeePercent: 8 }, null);
    const ahora = calculateProfitability(
      { ...base, platformFeePercent: 2, paymentFeePercent: 6 },
      null,
    );

    expect(antes.breakEvenPrice).toBeCloseTo(ahora.breakEvenPrice, 6);
  });

  test("la de pasarela sola también cuenta", () => {
    const r = calculateProfitability({ ...base, paymentFeePercent: 6 }, null);

    expect(r.deductionRate).toBeCloseTo(0.06, 6);
  });

  test("los impuestos se siguen sumando a las dos comisiones", () => {
    const r = calculateProfitability(
      { ...base, platformFeePercent: 2, paymentFeePercent: 6, taxPercent: 21 },
      null,
    );

    expect(r.deductionRate).toBeCloseTo(0.29, 6);
  });

  test("si entre las tres se llevan todo, declara que no hay precio viable", () => {
    const r = calculateProfitability(
      { ...base, platformFeePercent: 40, paymentFeePercent: 40, taxPercent: 21 },
      null,
    );

    expect(r.viable).toBe(false);
    expect(r.reason).toBe("DEDUCCIONES_EXCEDEN_INGRESO");
  });

  test("sigue negándose a calcular sin costo, en vez de inventarlo", () => {
    expect(calculateProfitability({ paymentFeePercent: 6 }, null)).toBeNull();
  });
});

// Reconciliación financiera de órdenes.
//
// Las dos comprobaciones son funciones puras sobre un documento y una
// respuesta del proveedor, así que se prueban sin base ni red. Lo que hay que
// verificar es el criterio, no la plomería.

const ordenSana = (extra = {}) => ({
  _id: "orden1",
  paymentStatus: "approved",
  refundStatus: "none",
  paidAt: new Date("2026-09-01"),
  products: [{ subtotalCents: 100000 }],
  paymentIntent: {
    provider: "mercadopago",
    providerPaymentId: "9999",
    originalAmountCents: 100000,
    discountAmountCents: 0,
    amountCents: 100000,
    providerFeeCents: 8000,
    netReceivedCents: 90000,
  },
  ...extra,
});

const tipos = hallazgos => hallazgos.map(h => h.kind);

describe("reconciliación · comprobaciones internas", () => {
  test("una orden coherente no deja hallazgos", () => {
    expect(checkOrderInternals(ordenSana())).toEqual([]);
  });

  test("detecta que las líneas no suman el importe original", () => {
    const o = ordenSana();
    o.products = [{ subtotalCents: 90000 }];

    expect(tipos(checkOrderInternals(o))).toContain("products-vs-original");
  });

  test("detecta que el cobrado no es original menos descuento", () => {
    const o = ordenSana();
    o.paymentIntent.discountAmountCents = 10000;
    // amountCents sigue en 100000 cuando debería ser 90000.

    expect(tipos(checkOrderInternals(o))).toContain("amount-mismatch");
  });

  test("un pago aprobado sin id del proveedor es un hallazgo", () => {
    // Es plata que entró sin forma de volver a encontrarla del otro lado.
    const o = ordenSana();
    o.paymentIntent.providerPaymentId = null;

    expect(tipos(checkOrderInternals(o))).toContain("approved-without-provider-id");
  });

  test("efectivo contra entrega no necesita id del proveedor", () => {
    const o = ordenSana();
    o.paymentIntent.provider = "cod";
    o.paymentIntent.providerPaymentId = null;
    o.paymentIntent.providerFeeCents = null;
    o.paymentIntent.netReceivedCents = null;

    expect(checkOrderInternals(o)).toEqual([]);
  });

  test("el neto más la comisión no pueden superar lo cobrado", () => {
    const o = ordenSana();
    o.paymentIntent.netReceivedCents = 95000; // 95000 + 8000 > 100000

    expect(tipos(checkOrderInternals(o))).toContain("net-plus-fee-exceeds-amount");
  });

  test("un neto MENOR que cobrado menos comisión es válido: hay retenciones", () => {
    const o = ordenSana();
    o.paymentIntent.netReceivedCents = 80000; // 80000 + 8000 < 100000

    expect(checkOrderInternals(o)).toEqual([]);
  });

  test("comisión o neto sin informar no inventan un hallazgo", () => {
    // null es "no lo sé", que es distinto de cero.
    const o = ordenSana();
    o.paymentIntent.providerFeeCents = null;
    o.paymentIntent.netReceivedCents = null;

    expect(checkOrderInternals(o)).toEqual([]);
  });
});

describe("reconciliación · contra Mercado Pago", () => {
  const pagoSano = (extra = {}) => ({
    status: "approved",
    transaction_amount: 1000,
    transaction_amount_refunded: 0,
    transaction_details: { net_received_amount: 900 },
    ...extra,
  });

  test("un pago que coincide no deja hallazgos", () => {
    expect(checkOrderAgainstProvider(ordenSana(), pagoSano())).toEqual([]);
  });

  test("detecta que el importe cobrado no es el que dice el proveedor", () => {
    const h = checkOrderAgainstProvider(
      ordenSana(),
      pagoSano({ transaction_amount: 1200 }),
    );

    expect(tipos(h)).toContain("provider-amount-mismatch");
    expect(h.find(x => x.kind === "provider-amount-mismatch")).toMatchObject({
      henko: 100000,
      proveedor: 120000,
    });
  });

  test("detecta que el estado no coincide", () => {
    const h = checkOrderAgainstProvider(ordenSana(), pagoSano({ status: "refunded" }));

    expect(tipos(h)).toContain("provider-status-mismatch");
  });

  // EL CASO QUE MOTIVA TODO ESTO.
  //
  // Mercado Pago deja el pago en 'approved' y solo mueve
  // transaction_amount_refunded, así que el webhook —que mira el status— no ve
  // absolutamente nada. Sin esta comprobación, una devolución parcial hecha
  // desde el panel del proveedor es invisible para HENKO.
  test("ve una devolución PARCIAL que el webhook no puede ver", () => {
    const pago = pagoSano({
      status: "approved",
      transaction_amount_refunded: 300,
    });

    const h = checkOrderAgainstProvider(ordenSana(), pago);

    expect(tipos(h)).toContain("provider-refund-unrecorded");
    expect(h.find(x => x.kind === "provider-refund-unrecorded")).toMatchObject({
      devueltoEnProveedor: 30000,
      cobrado: 100000,
      total: false,
    });
    // El estado NO cambió en el proveedor: por eso nadie más lo detecta.
    expect(tipos(h)).not.toContain("provider-status-mismatch");
  });

  test("una devolución total marcada acá y allá no es un hallazgo", () => {
    const orden = ordenSana({ paymentStatus: "refunded", refundStatus: "refunded" });
    const pago = pagoSano({ status: "refunded", transaction_amount_refunded: 1000 });

    expect(checkOrderAgainstProvider(orden, pago)).toEqual([]);
  });

  test("devuelta acá pero no en el proveedor también es un hallazgo", () => {
    const orden = ordenSana({ paymentStatus: "refunded", refundStatus: "refunded" });

    const h = checkOrderAgainstProvider(orden, pagoSano());

    expect(tipos(h)).toContain("refunded-without-provider-refund");
  });

  test("el proveedor no puede haber devuelto más de lo que cobró", () => {
    const h = checkOrderAgainstProvider(
      ordenSana(),
      pagoSano({ transaction_amount_refunded: 1500 }),
    );

    expect(tipos(h)).toContain("provider-refund-exceeds-payment");
  });

  test("un neto sin informar de nuestro lado no se compara", () => {
    const o = ordenSana();
    o.paymentIntent.netReceivedCents = null;

    expect(tipos(checkOrderAgainstProvider(o, pagoSano()))).not.toContain(
      "provider-net-mismatch",
    );
  });
});
