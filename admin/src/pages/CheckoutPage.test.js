// El checkout tiene que RENDERIZAR, no solo importarse.
//
// El smoke test de pantallas comprueba que cada archivo parsee y que sus
// imports resuelvan. Eso no alcanzó: después de reemplazar el formulario propio
// por el Brick de Mercado Pago, la página importaba bien y explotaba al
// renderizar — el ErrorBoundary mostraba "Ocurrió un error inesperado" y no
// había forma de llegar al pago.
//
// Es literalmente el motivo por el que existe jest.config.js en este panel: "un
// build verde no dice nada sobre si la página abre". Un import verde tampoco.

import React from "react";
import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";

process.env.REACT_APP_API_BASE_URL = "http://localhost:5000/api";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockInitMercadoPago = jest.fn();

jest.unstable_mockModule("../utils/axiosConfig", () => ({
  default: { get: mockGet, post: mockPost },
}));

jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams("plan=starter")],
}));

jest.unstable_mockModule("react-redux", () => ({
  useSelector: selector => selector({ user: { user: { email: "a@b.com" } } }),
}));

// El Brick es un iframe de Mercado Pago: en jsdom no se monta. Lo que importa
// acá es que la pantalla lo pida con los datos correctos y no rompa alrededor.
jest.unstable_mockModule("@mercadopago/sdk-react", () => ({
  initMercadoPago: mockInitMercadoPago,
  CardPayment: ({ initialization }) => (
    <div data-testid="brick">monto: {initialization?.amount}</div>
  ),
}));

const { default: CheckoutPage } = await import("./CheckoutPage.js");

beforeEach(() => {
  jest.clearAllMocks();

  mockGet.mockImplementation(url => {
    if (url.includes("/subscriptions/config")) {
      return Promise.resolve({
        data: { success: true, data: { mpPublicKey: "APP_USR-abc" } },
      });
    }

    if (url.includes("/subscriptions/plans")) {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            currency: "ARS",
            plans: [{ plan: "starter", monthlyPriceArs: 1, currency: "ARS" }],
          },
        },
      });
    }

    return Promise.resolve({ data: { success: true, data: {} } });
  });
});

describe("CheckoutPage · abre", () => {
  test("renderiza sin romper", async () => {
    render(<CheckoutPage />);

    // Con que llegue a pedir la configuración ya pasó el render inicial.
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
  });

  test("inicializa Mercado Pago con la clave que sirve el backend", async () => {
    render(<CheckoutPage />);

    await waitFor(() =>
      expect(mockInitMercadoPago).toHaveBeenCalledWith("APP_USR-abc", {
        locale: "es-AR",
      }),
    );
  });

  test("le pasa al Brick el precio del catálogo", async () => {
    // El monto que cobra Mercado Pago sale de acá. Si fuera otro, el comercio
    // pagaría algo distinto de lo que dice la pantalla.
    render(<CheckoutPage />);

    expect(await screen.findByTestId("brick")).toHaveTextContent("monto: 1");
  });
});
