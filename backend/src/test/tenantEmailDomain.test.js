import { jest } from "@jest/globals";

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
  "base64url",
);

// Aplica un $set de Mongo (paths con punto, tipo 'email.fromAddress') sobre
// un objeto plano en memoria, para que updateOne y el siguiente findById
// vean el mismo estado, como pasaría contra Mongo real.
const applySet = (target, setObj = {}) => {
  for (const [path, value] of Object.entries(setObj)) {
    const parts = path.split(".");
    let node = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      node[parts[i]] = node[parts[i]] || {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }
};

// Mongoose encadena .select().lean() sobre lo que devuelve findById, pero
// register() además hace `await Tenant.findById(id)` directo, sin cadena.
// Este objeto sirve para los dos casos: es thenable Y tiene .select/.lean.
const makeQuery = result => {
  const query = {
    select: () => query,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

let tenantDoc;

const mockFindById = jest.fn(() => makeQuery(tenantDoc));
const mockUpdateOne = jest.fn(async (_filter, update) => {
  applySet(tenantDoc, update.$set);
  return { acknowledged: true };
});

jest.unstable_mockModule("../models/tenantModel.js", () => ({
  default: { findById: mockFindById, updateOne: mockUpdateOne },
}));

const {
  clearTenantSendingDomain,
  extractDomain,
  getTenantEmailIdentity,
  refreshTenantDomainStatus,
  registerTenantSendingDomain,
} = await import("../services/email/tenantEmailDomainService.js");

const TENANT_ID = "64b7f0000000000000000002";

const resetTenant = () => {
  tenantDoc = {
    _id: TENANT_ID,
    name: "Tienda X",
    settings: { store: { contactEmail: "hola@tiendax.com" } },
    email: {},
  };
};

let originalFetch;

beforeEach(() => {
  resetTenant();
  mockFindById.mockClear();
  mockUpdateOne.mockClear();
  originalFetch = global.fetch;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.EMAIL_PASS;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_USER;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("extractDomain", () => {
  test("saca el dominio de una dirección válida", () => {
    expect(extractDomain("hola@tiendax.com")).toBe("tiendax.com");
    expect(extractDomain("HOLA@TiendaX.COM")).toBe("tiendax.com");
  });

  test("descarta lo que no es una dirección", () => {
    expect(extractDomain("no-es-un-mail")).toBe("");
    expect(extractDomain("")).toBe("");
  });
});

describe("registro de dominio", () => {
  beforeEach(() => {
    process.env.SENDGRID_API_KEY = "SG.test";
  });

  test("sin API key de administración, registra el intento y explica por qué", async () => {
    // Sin SENDGRID_API_KEY ni EMAIL_PASS configuradas: el alta no puede
    // llamar al proveedor, pero tiene que quedar registrada igual, nunca en
    // un estado que aparente estar verificado.
    delete process.env.SENDGRID_API_KEY;

    const result = await registerTenantSendingDomain({
      tenantId: TENANT_ID,
      fromAddress: "no-reply@tiendax.com",
    });

    expect(result.requested.status).toBe("pending");
    expect(result.requested.lastError).toBeTruthy();
    expect(result.usingOwnDomain).toBe(false);
  });

  test("una dirección inválida no llega a tocar el proveedor", async () => {
    global.fetch = jest.fn();

    await expect(
      registerTenantSendingDomain({
        tenantId: TENANT_ID,
        fromAddress: "esto no es un mail",
      }),
    ).rejects.toThrow();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("arma el body con automatic_security y normaliza el DNS-como-objeto a array", async () => {
    // El DNS de SendGrid llega como {mail_cname, dkim1, dkim2}, no como
    // array — si no se normaliza acá el panel (SendingDomainSection) no
    // tiene nada que iterar.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 302183,
        valid: false,
        dns: {
          mail_cname: {
            valid: false,
            type: "cname",
            host: "em.tiendax.com",
            data: "u123.wl.sendgrid.net",
          },
          dkim1: {
            valid: false,
            type: "cname",
            host: "s1._domainkey.tiendax.com",
            data: "s1.domainkey.u123.wl.sendgrid.net",
          },
        },
      }),
    }));

    const result = await registerTenantSendingDomain({
      tenantId: TENANT_ID,
      fromAddress: "no-reply@tiendax.com",
    });

    const [, options] = global.fetch.mock.calls[0];
    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://api.sendgrid.com/v3/whitelabel/domains",
    );
    expect(JSON.parse(options.body)).toMatchObject({
      domain: "tiendax.com",
      automatic_security: true,
    });

    expect(result.provider).toBe("SendGrid");
    expect(result.requested.status).toBe("pending");
    expect(result.requested.dnsRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record: "mail_cname",
          name: "em.tiendax.com",
          type: "cname",
          value: "u123.wl.sendgrid.net",
        }),
        expect.objectContaining({ record: "dkim1" }),
      ]),
    );
  });

  test("reusa EMAIL_PASS como key de administración si no hay una separada", async () => {
    delete process.env.SENDGRID_API_KEY;
    process.env.EMAIL_PASS = "SG.desde-email-pass";

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 1, valid: false, dns: {} }),
    }));

    await registerTenantSendingDomain({
      tenantId: TENANT_ID,
      fromAddress: "no-reply@tiendax.com",
    });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer SG.desde-email-pass");
  });

  test("una key sin permiso de administrar dominios no rompe el alta", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ errors: [{ message: "access forbidden" }] }),
    }));

    const result = await registerTenantSendingDomain({
      tenantId: TENANT_ID,
      fromAddress: "no-reply@tiendax.com",
    });

    expect(result.requested.status).toBe("pending");
    expect(result.requested.lastError).toContain("SendGrid");
  });
});

describe("verificación de dominio", () => {
  beforeEach(() => {
    process.env.SENDGRID_API_KEY = "SG.test";
    tenantDoc.email = {
      fromAddress: "no-reply@tiendax.com",
      domain: "tiendax.com",
      providerDomainId: "302183",
      status: "pending",
      dnsRecords: [
        { record: "mail_cname", name: "em.tiendax.com", type: "cname", value: "u123.wl.sendgrid.net", priority: null },
      ],
    };
  });

  test("llama al endpoint de validate, no a un GET pasivo", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 302183, valid: true, validation_results: {} }),
    }));

    const result = await refreshTenantDomainStatus(TENANT_ID);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.sendgrid.com/v3/whitelabel/domains/302183/validate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.requested.status).toBe("verified");
    expect(result.usingOwnDomain).toBe(true);
  });

  test("no vuelve a pedir los registros DNS: los que ya estaban guardados se conservan", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 302183, valid: false, validation_results: {} }),
    }));

    const result = await refreshTenantDomainStatus(TENANT_ID);

    expect(result.requested.dnsRecords).toHaveLength(1);
    expect(result.requested.dnsRecords[0].record).toBe("mail_cname");
  });

  test("sin providerDomainId busca el dominio por nombre antes de validar", async () => {
    tenantDoc.email.providerDomainId = "";

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 999, domain: "tiendax.com" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 999, valid: true }),
      });

    const result = await refreshTenantDomainStatus(TENANT_ID);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.sendgrid.com/v3/whitelabel/domains",
      expect.anything(),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.sendgrid.com/v3/whitelabel/domains/999/validate",
      expect.anything(),
    );
    expect(result.requested.status).toBe("verified");
  });
});

describe("efectivo vs solicitado", () => {
  test("pending: el remitente efectivo sigue siendo el de la plataforma", async () => {
    process.env.EMAIL_FROM = "no-reply@plataforma.com";
    tenantDoc.email = {
      fromAddress: "no-reply@tiendax.com",
      domain: "tiendax.com",
      status: "pending",
    };

    const result = await getTenantEmailIdentity(TENANT_ID);

    expect(result.effectiveFromAddress).toBe("no-reply@plataforma.com");
    expect(result.usingOwnDomain).toBe(false);
  });

  test("verified: el remitente efectivo es el del comercio", async () => {
    tenantDoc.email = {
      fromAddress: "no-reply@tiendax.com",
      domain: "tiendax.com",
      status: "verified",
    };

    const result = await getTenantEmailIdentity(TENANT_ID);

    expect(result.effectiveFromAddress).toBe("no-reply@tiendax.com");
    expect(result.usingOwnDomain).toBe(true);
  });

  test("clear vuelve todo a 'none' y al remitente de la plataforma", async () => {
    tenantDoc.email = {
      fromAddress: "no-reply@tiendax.com",
      domain: "tiendax.com",
      status: "verified",
    };

    const result = await clearTenantSendingDomain(TENANT_ID);

    expect(result.requested.status).toBe("none");
    expect(result.requested.fromAddress).toBe("");
    expect(result.usingOwnDomain).toBe(false);
  });
});
