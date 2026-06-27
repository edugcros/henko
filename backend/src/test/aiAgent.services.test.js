import { buildAgentActions } from "../services/aiAgent/aiAgentActionService.js";
import { validateAgentCommerceResponse } from "../services/aiAgent/aiAgentResponseValidatorService.js";
import { buildDefaultAiAgentPayload } from "../services/aiAgent/aiAgentProvisioningService.js";

const productWithVariants = {
  id: "product-1",
  title: "Zapatilla Urbana",
  slug: "zapatilla-urbana",
  available: true,
  stock: 8,
  price: 120000,
  variants: [
    {
      id: "variant-red-40",
      sku: "URB-RED-40",
      stock: 4,
      price: 120000,
      attributes: { color: "Rojo", talle: "40" },
    },
    {
      id: "variant-black-42",
      sku: "URB-BLK-42",
      stock: 4,
      price: 125000,
      attributes: { color: "Negro", talle: "42" },
    },
  ],
};

describe("AI agent production contracts", () => {
  test("selects the requested variant instead of the first available variant", () => {
    const actions = buildAgentActions({
      text: "Quiero comprar la Zapatilla Urbana negra talle 42",
      responseText: "La Zapatilla Urbana negra talle 42 está disponible.",
      products: [productWithVariants],
    });

    const cartAction = actions.find((action) => action.type === "add_to_cart");

    expect(cartAction).toBeDefined();
    expect(cartAction.variantId).toBe("variant-black-42");
    expect(cartAction.variantSku).toBe("URB-BLK-42");
    expect(cartAction.selectedAttributes).toEqual({
      color: "Negro",
      talle: "42",
    });
  });

  test("does not add an ambiguous multi-variant product to the cart", () => {
    const actions = buildAgentActions({
      text: "Quiero comprar la Zapatilla Urbana",
      responseText: "La Zapatilla Urbana está disponible.",
      products: [productWithVariants],
    });

    expect(actions.some((action) => action.type === "add_to_cart")).toBe(false);
    expect(actions.some((action) => action.type === "view_product")).toBe(true);
  });

  test("blocks hallucinated commercial amounts", () => {
    const result = validateAgentCommerceResponse({
      responseText:
        "La Zapatilla Urbana cuesta $999.999 y tiene stock disponible.",
      products: [productWithVariants],
    });

    expect(result.ok).toBe(false);
    expect(result.shouldFallback).toBe(true);
    expect(result.warnings).toContain(
      "contains_numbers_not_present_in_context",
    );
  });

  test("accepts exact prices and stock from the catalog context", () => {
    const result = validateAgentCommerceResponse({
      responseText:
        "La Zapatilla Urbana cuesta $120.000 y tiene 8 unidades disponibles.",
      products: [productWithVariants],
    });

    expect(result.ok).toBe(true);
    expect(result.shouldFallback).toBe(false);
  });

  test("builds a schema-aligned default agent configuration", () => {
    const payload = buildDefaultAiAgentPayload({
      tenantId: "tenant-1",
      tenant: {
        name: "Henko",
        currency: "ars",
      },
    });

    expect(payload.personality).toEqual({
      tone: "friendly",
      language: "es-AR",
    });
    expect(payload.behavior.canCreateCartLinks).toBe(true);
    expect(payload.behavior.requireHumanForPayments).toBe(true);
    expect(payload.businessContext.policies).toEqual({
      shipping: "",
      returns: "",
      payments: "",
      privacy: "",
    });
  });
});
