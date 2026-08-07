import {
  encryptSecret,
  decryptSecret,
  maskSecret,
} from "../services/aiAgent/secretCryptoService.js";

// Clave válida de 32 bytes (base64url) para todo el archivo. getKey() la
// lee en cada llamada, así que basta con setearla en process.env.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64url");

describe("secretCryptoService", () => {
  const original = {
    key: process.env.AI_AGENT_SECRET_ENCRYPTION_KEY,
    env: process.env.NODE_ENV,
    legacy: process.env.AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS,
  };

  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  beforeAll(() => {
    process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    restore("AI_AGENT_SECRET_ENCRYPTION_KEY", original.key);
    restore("NODE_ENV", original.env);
    restore("AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS", original.legacy);
  });

  test("round-trips a secret and never leaks the plaintext", () => {
    const secret = "EAAGwhatsapp-access-token-1234567890";
    const encrypted = encryptSecret(secret);

    expect(encrypted).not.toBe(secret);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(encrypted.split(".")).toHaveLength(4);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  test("round-trips unicode and long values", () => {
    const secret = `clave-áéíóú-🔐-${"x".repeat(500)}`;
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  test("uses a random IV: same input yields different ciphertext, same plaintext", () => {
    const secret = "same-input-token";
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);

    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  test("treats empty and whitespace-only values as empty without throwing", () => {
    expect(encryptSecret("")).toBe("");
    expect(encryptSecret("   ")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  test("rejects tampered ciphertext via the GCM auth tag", () => {
    const encrypted = encryptSecret("tamper-me");
    const parts = encrypted.split(".");
    const payload = parts[3];
    const flippedFirst = payload[0] === "A" ? "B" : "A";
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      flippedFirst + payload.slice(1),
    ].join(".");

    expect(() => decryptSecret(tampered)).toThrow();
  });

  test("rejects a v1 envelope with an invalid IV length", () => {
    // 'AAAA' base64url decodes to 3 bytes, no los 12 esperados.
    expect(() => decryptSecret("v1.AAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA")).toThrow(
      /inválido/i,
    );
  });

  test("passes through legacy plaintext when not in production", () => {
    process.env.NODE_ENV = "test";
    expect(decryptSecret("legacy-plaintext-token")).toBe(
      "legacy-plaintext-token",
    );
  });

  test("rejects legacy plaintext in production by default", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS;

    try {
      expect(() => decryptSecret("legacy-plaintext-token")).toThrow(/legacy/i);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  test("allows legacy plaintext in production only when explicitly enabled", () => {
    process.env.NODE_ENV = "production";
    process.env.AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS = "true";

    try {
      expect(decryptSecret("legacy-plaintext-token")).toBe(
        "legacy-plaintext-token",
      );
    } finally {
      process.env.NODE_ENV = "test";
      delete process.env.AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS;
    }
  });

  test("throws when the encryption key is missing", () => {
    delete process.env.AI_AGENT_SECRET_ENCRYPTION_KEY;

    try {
      expect(() => encryptSecret("x")).toThrow(/obligatorio/i);
    } finally {
      process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = TEST_KEY;
    }
  });

  test("masks secrets for safe display", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("short")).toBe("***");
    expect(maskSecret("1234567890")).toBe("***");
    expect(maskSecret("EAAG1234567890XYZ")).toBe("EAAG12***0XYZ");
  });
});
