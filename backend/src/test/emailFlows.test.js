import { jest } from "@jest/globals";

// El modelo Tenant importa secretCryptoService al cargarse.
process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString(
  "base64url",
);
process.env.CLIENT_URL = "https://tienda-plataforma.com";
process.env.ADMIN_URL = "https://panel-plataforma.com";

// Se intercepta el envío en el borde: lo que interesa verificar es QUÉ correo
// se arma y a quién va, no que Resend o Gmail acepten la conexión.
const sentEmails = [];

jest.unstable_mockModule("../utils/sendEmail.js", () => ({
  sendEmail: async payload => {
    sentEmails.push(payload);
    return { success: true, messageId: "test" };
  },
}));

const {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
} = await import("../services/email/verificationEmail.service.js");

const { sendCartRecoveryEmail } = await import(
  "../services/email/cartRecoveryEmail.service.js"
);

const { resolveSenderAddress } = await import("../services/emailService.js");
const { extractDomain } = await import(
  "../services/email/tenantEmailDomainService.js"
);

const { resolveRecoveryChannel } = await import(
  "../services/aiAgent/aiCartRecoveryWorkerService.js"
);

const TENANT = {
  name: "Tienda X",
  domains: [
    {
      hostname: "tiendax.com",
      normalizedHostname: "tiendax.com",
      status: "active",
      isPrimary: true,
    },
  ],
  adminDomains: [
    {
      hostname: "panel.tiendax.com",
      normalizedHostname: "panel.tiendax.com",
      status: "active",
      isPrimary: true,
    },
  ],
  settings: { store: { contactEmail: "hola@tiendax.com" } },
};

const USER = { email: "compradora@ejemplo.com", firstname: "Ana" };

beforeEach(() => {
  sentEmails.length = 0;
});

describe("correos de cuenta", () => {
  test("la verificación del comprador apunta a la tienda del comercio", async () => {
    await sendVerificationEmail(USER, TENANT, "tok123");

    const [mail] = sentEmails;
    expect(mail.to).toBe(USER.email);
    expect(mail.html).toContain("tiendax.com/verify-email?token=tok123");
    expect(mail.html).not.toContain("tienda-plataforma.com");
  });

  test("la verificación del comerciante apunta al panel, no a la tienda", async () => {
    // El dueño no tiene cuenta de comprador: mandarlo al storefront lo dejaba
    // verificando en la aplicación equivocada.
    await sendVerificationEmail(USER, TENANT, "tok123", { target: "admin" });

    const [mail] = sentEmails;
    expect(mail.html).toContain("panel.tiendax.com/verify-email");
    expect(mail.html).not.toContain("//tiendax.com/verify-email");
  });

  test("un comercio sin dominio propio cae al de la plataforma", async () => {
    await sendVerificationEmail(USER, { name: "Sin Dominio" }, "tok123");

    expect(sentEmails[0].html).toContain("tienda-plataforma.com");
  });

  test("el nombre del usuario se escapa antes de entrar al HTML", async () => {
    await sendVerificationEmail(
      { email: "x@ejemplo.com", firstname: '<img src=x onerror="alert(1)">' },
      TENANT,
      "tok123",
    );

    expect(sentEmails[0].html).not.toContain("<img");
    expect(sentEmails[0].html).toContain("&lt;img");
  });

  test("la verificación exige token", async () => {
    await expect(sendVerificationEmail(USER, TENANT, "")).rejects.toThrow();
    expect(sentEmails).toHaveLength(0);
  });

  test("el reseteo incluye el enlace recibido", async () => {
    await sendResetPasswordEmail(USER, "https://tiendax.com/reset/abc");

    expect(sentEmails[0].html).toContain("https://tiendax.com/reset/abc");
  });

  test("el aviso de contraseña cambiada no lleva enlaces de acción", async () => {
    // Un correo de "tu contraseña cambió" con un botón es indistinguible de un
    // phishing que pide exactamente eso.
    await sendPasswordChangedEmail(USER, TENANT);

    expect(sentEmails[0].html).not.toContain("<a ");
    expect(sentEmails[0].subject).toContain("Tienda X");
  });

  test("la bienvenida sale recién después de verificar y lleva a la tienda", async () => {
    await sendWelcomeEmail(USER, TENANT);

    expect(sentEmails[0].html).toContain("tiendax.com");
    expect(sentEmails[0].subject).toContain("Tienda X");
  });

  test("los correos de cortesía no explotan sin usuario", async () => {
    // Se llaman desde caminos que ya completaron su operación: si tiran, el
    // llamador convierte un éxito en un error.
    await expect(sendPasswordChangedEmail(null)).resolves.toMatchObject({
      skipped: true,
    });
    await expect(sendWelcomeEmail(null)).resolves.toMatchObject({
      skipped: true,
    });
    expect(sentEmails).toHaveLength(0);
  });
});

describe("recuperación de carrito por correo", () => {
  const VALUES = {
    customerName: "Ana",
    productName: "Zapatillas",
    cartTotal: "$120.000",
    checkoutUrl: "https://tiendax.com/checkout?cart=abc",
  };

  test("arma el correo con el enlace de checkout y el texto de la regla", async () => {
    await sendCartRecoveryEmail({
      to: "ana@ejemplo.com",
      tenantConfig: TENANT,
      values: VALUES,
      body: "Todavía estás a tiempo",
    });

    const [mail] = sentEmails;
    expect(mail.to).toBe("ana@ejemplo.com");
    expect(mail.html).toContain(VALUES.checkoutUrl);
    expect(mail.html).toContain("Todavía estás a tiempo");
    expect(mail.subject).toContain("Tienda X");
  });

  test("sin enlace de checkout no manda nada", async () => {
    // Un correo de carrito sin el enlace es ruido: no hay nada que retomar.
    await expect(
      sendCartRecoveryEmail({
        to: "ana@ejemplo.com",
        tenantConfig: TENANT,
        values: { ...VALUES, checkoutUrl: "" },
      }),
    ).rejects.toThrow();

    expect(sentEmails).toHaveLength(0);
  });

  test("sin destinatario no manda nada", async () => {
    await expect(
      sendCartRecoveryEmail({ to: "", tenantConfig: TENANT, values: VALUES }),
    ).rejects.toThrow();

    expect(sentEmails).toHaveLength(0);
  });
});

describe("elección de canal de recuperación", () => {
  const agentConWhatsapp = {
    channels: {
      whatsapp: { enabled: true, phoneNumberId: "123", accessToken: "tok" },
    },
  };
  const agentSinWhatsapp = { channels: { whatsapp: { enabled: false } } };

  test("con teléfono y WhatsApp configurado elige WhatsApp", () => {
    expect(
      resolveRecoveryChannel({
        recovery: { customer: { phone: "+5491122334455", email: "a@b.com" } },
        agent: agentConWhatsapp,
      }),
    ).toBe("whatsapp");
  });

  test("sin WhatsApp configurado usa el correo en vez de cancelar", () => {
    // Este es el caso que antes no mandaba nada: el comercio nunca conectó
    // WhatsApp y la recuperación se cancelaba con el email a la vista.
    expect(
      resolveRecoveryChannel({
        recovery: { customer: { phone: "+5491122334455", email: "a@b.com" } },
        agent: agentSinWhatsapp,
      }),
    ).toBe("email");
  });

  test("comprador sin teléfono cae al correo", () => {
    expect(
      resolveRecoveryChannel({
        recovery: { customer: { email: "a@b.com" } },
        agent: agentConWhatsapp,
      }),
    ).toBe("email");
  });

  test("sin ningún contacto no inventa canal", () => {
    expect(
      resolveRecoveryChannel({
        recovery: { customer: {} },
        agent: agentConWhatsapp,
      }),
    ).toBeNull();
  });

  test("respeta el canal pedido si hay con qué cumplirlo", () => {
    expect(
      resolveRecoveryChannel({
        recovery: {
          channel: "email",
          customer: { phone: "+5491122334455", email: "a@b.com" },
        },
        agent: agentConWhatsapp,
      }),
    ).toBe("email");
  });

  test("ignora el canal pedido si no hay dato para ese canal", () => {
    expect(
      resolveRecoveryChannel({
        recovery: { channel: "whatsapp", customer: { email: "a@b.com" } },
        agent: agentSinWhatsapp,
      }),
    ).toBe("email");
  });
});

describe("remitente por comercio", () => {
  const original = process.env.RESEND_FROM_EMAIL;

  beforeEach(() => {
    process.env.RESEND_FROM_EMAIL = "no-reply@plataforma.com";
  });

  afterAll(() => {
    if (original === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = original;
  });

  test("dominio verificado: sale desde la dirección del comercio", () => {
    expect(
      resolveSenderAddress({
        email: { status: "verified", fromAddress: "hola@tiendax.com" },
      }),
    ).toBe("hola@tiendax.com");
  });

  test("dominio pendiente: NO sale desde el comercio", () => {
    // Un dominio sin SPF/DKIM publicados no autoriza a nadie a enviar en su
    // nombre: usarlo garantiza rebote o spam.
    expect(
      resolveSenderAddress({
        email: { status: "pending", fromAddress: "hola@tiendax.com" },
      }),
    ).toBe("no-reply@plataforma.com");
  });

  test("dominio fallido: tampoco", () => {
    expect(
      resolveSenderAddress({
        email: { status: "failed", fromAddress: "hola@tiendax.com" },
      }),
    ).toBe("no-reply@plataforma.com");
  });

  test("comercio sin dominio propio: usa el de la plataforma", () => {
    expect(resolveSenderAddress({})).toBe("no-reply@plataforma.com");
  });

  test("verificado pero con dirección inválida: no se arriesga", () => {
    expect(
      resolveSenderAddress({
        email: { status: "verified", fromAddress: "esto-no-es-un-mail" },
      }),
    ).toBe("no-reply@plataforma.com");
  });

  test("sin nada configurado cae al sandbox del proveedor", () => {
    delete process.env.RESEND_FROM_EMAIL;
    expect(resolveSenderAddress({})).toBe("onboarding@resend.dev");
  });

  test("extractDomain solo acepta direcciones válidas", () => {
    expect(extractDomain("hola@tiendax.com")).toBe("tiendax.com");
    expect(extractDomain("HOLA@TiendaX.com")).toBe("tiendax.com");
    expect(extractDomain("sin-arroba")).toBe("");
    expect(extractDomain("")).toBe("");
  });
});

describe("remitente por comercio · bajo SMTP", () => {
  beforeEach(() => {
    process.env.EMAIL_TRANSPORT = "smtp";
  });

  afterEach(() => {
    delete process.env.EMAIL_TRANSPORT;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_USER;
  });

  test("dominio verificado: gana incluso con SMTP activo", () => {
    // Este es el bug que encontró la propia migración a SendGrid: la rama de
    // SMTP resolvía el remitente ANTES de mirar si el tenant tenía un
    // dominio propio verificado, así que un comercio con su dominio ya
    // autenticado en SendGrid seguía saliendo por la casilla compartida de
    // la plataforma.
    process.env.EMAIL_FROM = "no-reply@plataforma.com";

    expect(
      resolveSenderAddress({
        email: { status: "verified", fromAddress: "hola@tiendax.com" },
      }),
    ).toBe("hola@tiendax.com");
  });

  test("sin dominio propio, usa EMAIL_FROM de la plataforma", () => {
    process.env.EMAIL_FROM = "no-reply@plataforma.com";
    process.env.EMAIL_USER = "otra@plataforma.com";

    expect(resolveSenderAddress({})).toBe("no-reply@plataforma.com");
  });

  test("sin EMAIL_FROM, cae a EMAIL_USER", () => {
    process.env.EMAIL_USER = "cuenta@plataforma.com";

    expect(resolveSenderAddress({})).toBe("cuenta@plataforma.com");
  });

  test("sin nada configurado no inventa una dirección", () => {
    // A diferencia de Resend, SMTP no tiene un sandbox al que caer: sin
    // EMAIL_FROM ni EMAIL_USER no hay remitente seguro. getSmtpTransporter
    // ya bloquea el envío en ese caso (falta EMAIL_USER); esto solo
    // confirma que resolveSenderAddress no inventa un valor para tapar el
    // problema.
    expect(resolveSenderAddress({})).toBe("");
  });

  test("no confunde el remitente de Resend con el de SMTP", () => {
    // Si quedó configurado RESEND_FROM_EMAIL de una migración anterior, bajo
    // SMTP no tiene que usarse: son remitentes de proveedores distintos.
    process.env.RESEND_FROM_EMAIL = "no-reply@resend-leftover.com";
    process.env.EMAIL_FROM = "no-reply@plataforma.com";

    expect(resolveSenderAddress({})).toBe("no-reply@plataforma.com");

    delete process.env.RESEND_FROM_EMAIL;
  });
});
