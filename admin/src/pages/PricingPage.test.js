// Pantalla de Pricing Intelligence.
//
// El primer test del panel, y existe por un motivo concreto: esta pantalla se
// desplegó compilando y rompía al abrirla. `renderInput` del Autocomplete leía
// params.InputProps.endAdornment, que en MUI v9 no existe — un TypeError en
// pleno render. webpack no ejecuta componentes, así que el build verde no dijo
// nada.
//
// Lo que se prueba acá no es el diseño: es que la página monte y que las ramas
// que dependen de la forma de la respuesta del backend se rendericen sin
// romperse.

import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";

const mockGetPolicy = jest.fn();
const mockRecommend = jest.fn();
const mockUpdatePolicy = jest.fn();
const mockGetProducts = jest.fn();

// Se mockea la capa de red y no fetch: pricingApi importa axiosConfig, que
// valida REACT_APP_API_BASE_URL al cargar el módulo y aborta sin ella.
jest.unstable_mockModule("../utils/pricingApi", () => ({
  getPricingPolicy: mockGetPolicy,
  updatePricingPolicy: mockUpdatePolicy,
  recommendPrice: mockRecommend,
  default: {},
}));

jest.unstable_mockModule("../features/product/productService", () => ({
  default: { getAdminProducts: mockGetProducts },
}));

const { default: PricingPage } = await import("./PricingPage.js");

const POLICY = {
  strategy: "margin",
  mode: "manual",
  minMarginPercent: 35,
  targetMarginPercent: 50,
  maxChangePercent: 10,
  autoApplyMaxPercent: 5,
  priceFloor: null,
  priceCeiling: null,
  rounding: { enabled: true, endings: [990] },
  isDefault: true,
};

beforeEach(() => {
  mockGetPolicy.mockResolvedValue({ success: true, data: POLICY });
  mockGetProducts.mockResolvedValue({ data: [] });
  mockRecommend.mockResolvedValue({ success: true, data: null });
});

describe("PricingPage · monta", () => {
  test("renderiza sin romperse", async () => {
    render(<PricingPage />);

    expect(await screen.findByText("Pricing Intelligence")).toBeDefined();
  });

  test("muestra el buscador de productos", async () => {
    render(<PricingPage />);

    await waitFor(() => expect(mockGetProducts).toHaveBeenCalled());
    expect(screen.getByLabelText(/producto/i)).toBeDefined();
  });

  test("carga la política y avisa que son los valores de fábrica", async () => {
    render(<PricingPage />);

    expect(await screen.findByText(/valores de fábrica/i)).toBeDefined();
  });

  test("no rompe si la política no carga", async () => {
    // El comerciante tiene que poder ver los indicadores aunque la
    // configuración falle.
    mockGetPolicy.mockRejectedValue(new Error("500"));

    render(<PricingPage />);

    expect(await screen.findByText("Pricing Intelligence")).toBeDefined();
  });

  test("no rompe si el catálogo no carga", async () => {
    mockGetProducts.mockRejectedValue(new Error("500"));

    render(<PricingPage />);

    expect(await screen.findByText("Pricing Intelligence")).toBeDefined();
  });
});
