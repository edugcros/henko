import { jest } from "@jest/globals";

const { verifyTurnstile } = await import(
  "../middlewares/turnstileMiddleware.js"
);

const buildReq = (body = {}) => ({ body, ip: "203.0.113.7" });

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("verifyTurnstile", () => {
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test("sin TURNSTILE_SECRET_KEY: deja pasar sin verificar", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    global.fetch = jest.fn();

    const req = buildReq({ turnstileToken: "" });
    const res = buildRes();
    const next = jest.fn();

    await verifyTurnstile(req, res, next);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("con key configurada, sin token: 400", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = jest.fn();

    const req = buildReq({});
    const res = buildRes();
    const next = jest.fn();

    await verifyTurnstile(req, res, next);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("Cloudflare rechaza el token: 400", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    });

    const req = buildReq({ turnstileToken: "bad-token" });
    const res = buildRes();
    const next = jest.fn();

    await verifyTurnstile(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("Cloudflare acepta el token: sigue a next()", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    });

    const req = buildReq({ turnstileToken: "good-token" });
    const res = buildRes();
    const next = jest.fn();

    await verifyTurnstile(req, res, next);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("Cloudflare inalcanzable: falla abierto (no bloquea el registro)", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));

    const req = buildReq({ turnstileToken: "any-token" });
    const res = buildRes();
    const next = jest.fn();

    await verifyTurnstile(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });
});
