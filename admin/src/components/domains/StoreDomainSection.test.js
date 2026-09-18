// Carga del dominio propio del comercio.
//
// Mismo motivo que el resto de las pruebas de pantalla de este panel: webpack
// no ejecuta componentes, así que un build verde no dice nada sobre si esto
// abre. Y acá lo que se mide además es que la pantalla no ADELANTE nada.
//
// La propiedad importante: mientras el dominio está pendiente, el backend lo
// deja en status 'pending' y el resolvedor exige 'active', o sea que el dominio
// literalmente no resuelve. Una pantalla que diga "casi listo" describe mal lo
// que pasa, y el comercio va a creer que el problema es de la plataforma
// cuando en realidad le falta crear un registro.

import { jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

process.env.REACT_APP_API_BASE_URL = "http://localhost:5000/api";

const mockGetDomains = jest.fn();
const mockAddDomain = jest.fn();
const mockVerifyDomain = jest.fn();
const mockDeleteDomain = jest.fn();

jest.unstable_mockModule("../../services/tenantDomainService", () => ({
  getDomains: mockGetDomains,
  addDomain: mockAddDomain,
  verifyDomain: mockVerifyDomain,
  deleteDomain: mockDeleteDomain,
  default: {},
}));

const { default: StoreDomainSection } = await import("./StoreDomainSection.jsx");

const PLATAFORMA = {
  hostname: "mitienda.henkart.com.ar",
  type: "platform_subdomain",
  context: "storefront",
  status: "active",
  isPrimary: true,
  sslStatus: "not_required",
  verifiedAt: null,
  lastCheckedAt: null,
};

const PROPIO_PENDIENTE = {
  hostname: "mitienda.com.ar",
  type: "custom_domain",
  context: "both",
  status: "pending",
  isPrimary: false,
  sslStatus: "pending",
  verifiedAt: null,
  lastCheckedAt: null,
};

const INSTRUCCIONES = {
  verification: {
    type: "TXT",
    name: "_henko-verify.mitienda.com.ar",
    value: "henko-verify=abc123",
  },
  pointing: { type: "CNAME", name: "mitienda.com.ar", value: "api.henkart.com.ar" },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDomains.mockResolvedValue([PLATAFORMA]);
});

test("muestra la dirección que siempre funciona", async () => {
  // Es el respaldo, y saber cuál es importa justo cuando el dominio propio no
  // anda — que es cuando el comercio entra a esta pantalla.
  render(<StoreDomainSection />);

  await waitFor(() =>
    expect(screen.getByText("mitienda.henkart.com.ar")).toBeInTheDocument(),
  );
  expect(screen.getByText(/no se puede quitar/i)).toBeInTheDocument();
});

test("ofrece cargar un dominio cuando no hay ninguno", async () => {
  render(<StoreDomainSection />);

  await waitFor(() => expect(screen.getByLabelText(/tu dominio/i)).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /agregar/i })).toBeInTheDocument();
});

test("normaliza lo que el comercio pega del navegador", async () => {
  // La gente copia la URL con protocolo y barra. Rechazarlo sería correcto y
  // molesto.
  const user = userEvent.setup();
  mockAddDomain.mockResolvedValue({
    domain: PROPIO_PENDIENTE,
    instructions: INSTRUCCIONES,
  });

  render(<StoreDomainSection />);

  await waitFor(() => expect(screen.getByLabelText(/tu dominio/i)).toBeInTheDocument());
  await user.type(screen.getByLabelText(/tu dominio/i), "https://MiTienda.com.ar/");
  await user.click(screen.getByRole("button", { name: /agregar/i }));

  await waitFor(() => expect(mockAddDomain).toHaveBeenCalledWith("mitienda.com.ar"));
});

test("no deja agregar algo que no es un dominio", async () => {
  const user = userEvent.setup();
  render(<StoreDomainSection />);

  await waitFor(() => expect(screen.getByLabelText(/tu dominio/i)).toBeInTheDocument());
  await user.type(screen.getByLabelText(/tu dominio/i), "localhost");

  expect(screen.getByRole("button", { name: /agregar/i })).toBeDisabled();
});

test("con el dominio pendiente dice que NO funciona todavía", async () => {
  // ESTA ES LA PROPIEDAD. El dominio pendiente no resuelve: el backend exige
  // 'active'. Decir "casi listo" haría que el comercio crea que el problema es
  // nuestro cuando le falta crear un registro.
  mockGetDomains.mockResolvedValue([PLATAFORMA, PROPIO_PENDIENTE]);

  render(<StoreDomainSection />);

  await waitFor(() =>
    expect(screen.getByText(/todavía no funciona/i)).toBeInTheDocument(),
  );
  expect(screen.getByText(/Esperando DNS/i)).toBeInTheDocument();
});

test("muestra el registro TXT que hay que crear", async () => {
  const user = userEvent.setup();
  mockAddDomain.mockResolvedValue({
    domain: PROPIO_PENDIENTE,
    instructions: INSTRUCCIONES,
  });
  mockGetDomains
    .mockResolvedValueOnce([PLATAFORMA])
    .mockResolvedValue([PLATAFORMA, PROPIO_PENDIENTE]);

  render(<StoreDomainSection />);

  await waitFor(() => expect(screen.getByLabelText(/tu dominio/i)).toBeInTheDocument());
  await user.type(screen.getByLabelText(/tu dominio/i), "mitienda.com.ar");
  await user.click(screen.getByRole("button", { name: /agregar/i }));

  await waitFor(() =>
    expect(screen.getByText("_henko-verify.mitienda.com.ar")).toBeInTheDocument(),
  );
  expect(screen.getByText("henko-verify=abc123")).toBeInTheDocument();
});

test("verificar sin el registro no se presenta como un error", async () => {
  // Es el caso NORMAL: el comercio acaba de cargarlo y todavía no tocó su DNS.
  // Un cartel rojo ahí manda a buscar un problema que no existe.
  const user = userEvent.setup();
  mockGetDomains.mockResolvedValue([PLATAFORMA, PROPIO_PENDIENTE]);
  mockVerifyDomain.mockResolvedValue({
    verified: false,
    domain: PROPIO_PENDIENTE,
    instructions: INSTRUCCIONES,
  });

  render(<StoreDomainSection />);

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /verificar/i })).toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: /verificar/i }));

  await waitFor(() => expect(screen.getByText(/pueden tardar/i)).toBeInTheDocument());
});

test("con el dominio activo avisa que el certificado puede tardar", async () => {
  // Verificar y que el navegador muestre una advertencia de seguridad es
  // exactamente el momento en que alguien abre un ticket. Decirlo antes lo
  // evita.
  mockGetDomains.mockResolvedValue([
    PLATAFORMA,
    { ...PROPIO_PENDIENTE, status: "active", sslStatus: "pending" },
  ]);

  render(<StoreDomainSection />);

  await waitFor(() => expect(screen.getByText(/Funcionando/i)).toBeInTheDocument());
  expect(screen.getByText(/certificado de seguridad/i)).toBeInTheDocument();
});

test("no ofrece quitar el subdominio de la plataforma", async () => {
  // Solo hay un botón de quitar, y es el del dominio propio. El subdominio no
  // tiene acción porque el backend lo rechaza: es la dirección que siempre
  // funciona.
  mockGetDomains.mockResolvedValue([PLATAFORMA, PROPIO_PENDIENTE]);

  render(<StoreDomainSection />);

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /quitar dominio/i })).toBeInTheDocument(),
  );
  expect(screen.getAllByRole("button", { name: /quitar/i })).toHaveLength(1);
});
