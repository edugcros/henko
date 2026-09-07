// Comisión real de la pasarela y su efecto en el margen.
//
// Hasta ahora el margen de un producto se calculaba con un porcentaje de
// comisión cargado a mano. Estos dos cambios lo reemplazan por el número que
// Mercado Pago efectivamente descontó, y separan esa comisión de la de la
// plataforma, que es otra negociación.

import { extractMercadoPagoFees } from "../services/paymentOrderService.js";
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
