// Mi suscripción: el botón de plan cuando todavía no hay suscripción.
//
// El comercio entraba a esta pantalla, veía su plan "activo", apretaba "Cambiar
// a este plan" y recibía "Suscripción de Mercado Pago no encontrada". El mensaje
// era correcto —no existía ninguna suscripción— pero el botón no podía hacer
// otra cosa que fallar: /subscriptions/change-plan le pide a Mercado Pago que
// modifique el monto de una suscripción EXISTENTE.
//
// El estado del comercio puede decir 'active' sin que haya suscripción alguna:
// es lo que pasa cuando el plan se puso a mano. La pantalla miraba solo ese
// estado para habilitar los botones.

import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

process.env.REACT_APP_API_BASE_URL = "http://localhost:5000/api";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNavigate = jest.fn();

// El alias @utils lo reescribe babel-plugin-module-resolver ANTES de que Jest
// vea el import, así que hay que mockear la ruta ya resuelta, no el alias.
jest.unstable_mockModule("../utils/axiosConfig", () => ({
  default: { get: mockGet, post: mockPost },
}));

jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const { default: SubscriptionManagementPage } = await import(
  "./SubscriptionManagementPage.js"
);

const suscripcion = (mercadoPago = null) => ({
  plan: "pro",
  subscriptionStatus: "active",
  trialEndsAt: null,
  subscriptionPastDueAt: null,
  mercadoPago,
});

const montar = async mercadoPago => {
  mockGet.mockImplementation(url => {
    if (url.includes("invoices")) {
      return Promise.resolve({ data: { success: true, data: { invoices: [] } } });
    }

    // Los precios ya no están en la pantalla: los sirve el backend.
    if (url.includes("plans")) {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            currency: "ARS",
            plans: [
              { plan: "starter", monthlyPriceArs: 40000, currency: "ARS" },
              { plan: "pro", monthlyPriceArs: 151470, currency: "ARS" },
            ],
          },
        },
      });
    }

    return Promise.resolve({
      data: { success: true, data: suscripcion(mercadoPago) },
    });
  });

  render(<SubscriptionManagementPage />);

  // La pantalla arranca en loading; se espera a que el plan esté en pantalla.
  await waitFor(() => expect(mockGet).toHaveBeenCalled());

  return screen.findByRole("button", { name: /Cambiar a este plan/i });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Mi suscripción · elegir plan sin suscripción previa", () => {
  test("lleva al checkout en vez de pedir un cambio imposible", async () => {
    const boton = await montar(null);

    await userEvent.click(boton);

    expect(mockNavigate).toHaveBeenCalledWith("/checkout?plan=starter");
    // Y NO se llama al endpoint que solo sabe modificar una suscripción que
    // ya existe.
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("no ofrece cancelar algo que no existe", async () => {
    await montar(null);

    expect(screen.queryByText(/Zona de peligro/i)).not.toBeInTheDocument();
  });
});

describe("Mi suscripción · con suscripción real", () => {
  test("sí pide el cambio de plan a Mercado Pago", async () => {
    // La contracara: sacar el botón roto no puede sacar también el que sirve.
    const boton = await montar({ subscriptionId: "mp-sub-1", status: "authorized" });

    await userEvent.click(boton);

    // El cambio pasa por una confirmación; lo que importa acá es que NO se haya
    // desviado al checkout.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("ofrece cancelar", async () => {
    await montar({ subscriptionId: "mp-sub-1", status: "authorized" });

    expect(await screen.findByText(/Zona de peligro/i)).toBeInTheDocument();
  });
});

describe("Mi suscripción · el precio lo sirve el backend", () => {
  test("muestra el del catálogo, no uno escrito en la pantalla", async () => {
    // La pantalla tenía 26,14 USD para el starter — el resultado congelado de
    // dividir 40.000 pesos por el dólar del 24/08/2026 — mientras el cobro salía
    // de otro número. Si alguien vuelve a escribir un precio acá, esto falla.
    await montar(null);

    expect(await screen.findByText(/\$\s?40\.000/)).toBeInTheDocument();
    expect(screen.queryByText(/26[.,]14/)).not.toBeInTheDocument();
    expect(screen.queryByText(/US\$|USD/)).not.toBeInTheDocument();
  });

  test("si el catálogo cambia el precio, la pantalla lo sigue", async () => {
    // Es la prueba de que no hay copia local: el número sale de la respuesta.
    mockGet.mockImplementation(url => {
      if (url.includes("invoices")) {
        return Promise.resolve({ data: { success: true, data: { invoices: [] } } });
      }
      if (url.includes("plans")) {
        return Promise.resolve({
          data: {
            success: true,
            data: {
              currency: "ARS",
              plans: [{ plan: "starter", monthlyPriceArs: 52000, currency: "ARS" }],
            },
          },
        });
      }
      return Promise.resolve({ data: { success: true, data: suscripcion(null) } });
    });

    render(<SubscriptionManagementPage />);

    expect(await screen.findByText(/\$\s?52\.000/)).toBeInTheDocument();
  });
});

// ─── La fecha del próximo cobro ──────────────────────────────────────────────
//
// La tarjeta decía "Próximo pago" y mostraba trialEndsAt: el fin del período
// de prueba. En un comercio que ya paga eso es una fecha vieja que no tiene
// nada que ver con el próximo cobro, y el dato bueno venía en la respuesta sin
// que nadie lo leyera.

describe("Mi suscripción · próximo cobro", () => {
  test("muestra la fecha que informa Mercado Pago, no el fin de la prueba", async () => {
    await montar({
      subscriptionId: "mp-1",
      status: "authorized",
      nextBillingAt: "2026-10-15T10:00:00.000Z",
    });

    expect(await screen.findByText(/Próximo pago/i)).toBeInTheDocument();
    // formatDate usa mes en palabras (es-AR).
    expect(screen.getByText(/15 de octubre de 2026/i)).toBeInTheDocument();
  });

  test("sin suscripción, la tarjeta dice de qué fecha habla", async () => {
    await montar(null);

    expect(screen.queryByText(/Próximo pago/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Fin de la prueba/i)).toBeInTheDocument();
  });
});
