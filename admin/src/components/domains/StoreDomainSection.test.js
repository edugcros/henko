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
  // El destino es el BORDE de la tienda. Decía api.henkart.com.ar —el backend—
  // y ese era el bug: un comercio que siguiera esa instrucción apuntaba su
  // dominio a la API y recibía JSON en vez de su tienda.
  pointing: {
    type: "CNAME",
    name: "mitienda.com.ar",
    value: "d2fac79b8adc2292.vercel-dns-017.com",
  },
};

// Verificado de nuestro lado, pero el borde pide su propia prueba: pasa cuando
// el hostname ya está dado de alta en otra cuenta del proveedor.
const PROPIO_CON_PENDIENTE_DEL_BORDE = {
  hostname: "mitienda.com.ar",
  type: "custom_domain",
  context: "both",
  status: "active",
  isPrimary: false,
  sslStatus: "pending",
  verifiedAt: new Date().toISOString(),
  lastCheckedAt: new Date().toISOString(),
  edgeVerification: [
    {
      type: "TXT",
      name: "_vercel.mitienda.com.ar",
      value: "vc-domain-verify=mitienda.com.ar,0217cb2e14",
    },
  ],
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

// CUANDO EL BORDE PIDE SU PROPIA VERIFICACIÓN
//
// Nuestro TXT prueba que el dominio es del comercio. Si ese hostname ya está
// dado de alta en otra cuenta del proveedor —una landing vieja, un sitio
// anterior— el borde exige su propia prueba antes de servirlo.
//
// Sin mostrarlo, el comercio ve su dominio "Funcionando" acá y la tienda no
// abre. Es el peor de los casos: la pantalla afirma lo contrario de lo que pasa.

test("muestra el registro que pide el borde cuando falta", async () => {
  mockGetDomains.mockResolvedValue([PLATAFORMA, PROPIO_CON_PENDIENTE_DEL_BORDE]);

  render(<StoreDomainSection />);

  expect(await screen.findByText(/falta un paso más/i)).toBeInTheDocument();
  expect(screen.getByText("_vercel.mitienda.com.ar")).toBeInTheDocument();
  expect(
    screen.getByText("vc-domain-verify=mitienda.com.ar,0217cb2e14"),
  ).toBeInTheDocument();
});

test("da forma de reintentar sin tener que volver a cargar el dominio", async () => {
  // El aviso le pide al comercio que cargue un registro y toque verificar. Sin
  // el botón en este estado, le estaríamos pidiendo algo que no puede
  // completar: el de "Verificar" solo existía mientras el dominio estaba
  // pendiente.
  mockGetDomains.mockResolvedValue([PLATAFORMA, PROPIO_CON_PENDIENTE_DEL_BORDE]);
  mockVerifyDomain.mockResolvedValue({ verified: true, instructions: null });

  const user = userEvent.setup();
  render(<StoreDomainSection />);

  const boton = await screen.findByRole("button", { name: /verificar de nuevo/i });
  await user.click(boton);

  await waitFor(() => expect(mockVerifyDomain).toHaveBeenCalledWith("mitienda.com.ar"));
});

test("sin pendientes del borde no inventa un paso", async () => {
  // El caso normal. Mostrar el aviso acá mandaría al comercio a crear un
  // registro que nadie le pidió.
  mockGetDomains.mockResolvedValue([
    PLATAFORMA,
    { ...PROPIO_CON_PENDIENTE_DEL_BORDE, edgeVerification: null },
  ]);

  render(<StoreDomainSection />);

  expect(await screen.findByText(/mitienda\.com\.ar/)).toBeInTheDocument();
  expect(screen.queryByText(/falta un paso más/i)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /verificar de nuevo/i }),
  ).not.toBeInTheDocument();
});
