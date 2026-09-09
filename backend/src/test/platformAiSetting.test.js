// Ajustes de plataforma editables en caliente.
//
// Lo que se prueba acá es el contrato que hace seguro mover un límite de
// seguridad desde una pantalla: que el override gane sobre la variable de
// entorno, que se pueda deshacer, que quede registrado quién y por qué, y que
// al mover el techo no se apaguen los avisos del período.

import { jest } from "@jest/globals";

const mockSetting = {
  create: jest.fn(),
  find: jest.fn(),
};

const mockPlatformUsage = {
  updateOne: jest.fn(),
};

jest.unstable_mockModule("../models/platformAiSettingModel.js", () => ({
  default: mockSetting,
  PLATFORM_AI_SETTINGS: {
    MONTHLY_TOKEN_BUDGET: "monthlyTokenBudget",
    PER_TENANT_SHARE: "perTenantShare",
  },
}));

jest.unstable_mockModule("../models/aiPlatformUsageModel.js", () => ({
  default: mockPlatformUsage,
}));

const {
  getPlatformAiOverride,
  setPlatformAiOverride,
  refreshPlatformAiSettings,
  PLATFORM_AI_SETTINGS,
} = await import("../services/ai/platformAiSettingService.js");

const { getPlatformMonthlyTokenBudget, getPlatformBudgetSource } = await import(
  "../services/ai/aiPlanPolicy.js"
);

const BUDGET = PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET;

// find().sort().limit().lean() — la cadena que usa readLatest.
const chain = rows => ({
  sort: () => ({ limit: () => ({ lean: () => Promise.resolve(rows) }) }),
});

/** Deja la memoria del servicio con el override indicado. */
const loadOverride = async value => {
  mockSetting.find.mockImplementation(query =>
    chain(query.setting === BUDGET && value !== null ? [{ value }] : []),
  );
  await refreshPlatformAiSettings();
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockSetting.create.mockResolvedValue({});
  mockPlatformUsage.updateOne.mockResolvedValue({});
  delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET;
  await loadOverride(null);
});

describe("precedencia del techo", () => {
  test("sin override manda la variable de entorno", async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "200000000";

    expect(getPlatformMonthlyTokenBudget()).toBe(200_000_000);
    expect(getPlatformBudgetSource()).toBe("env");
  });

  test("el override del panel le gana a la variable de entorno", async () => {
    // Es el punto de todo esto: la variable exige reiniciar el servicio, y el
    // momento en que el techo importa es cuando el disyuntor ya cortó.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "200000000";
    await loadOverride(400_000_000);

    expect(getPlatformMonthlyTokenBudget()).toBe(400_000_000);
    expect(getPlatformBudgetSource()).toBe("panel");
  });

  test("quitar el override devuelve el mando a la variable", async () => {
    // Sin esto, poner un valor desde el panel sería irreversible sin un deploy,
    // que es exactamente lo que este mecanismo vino a evitar.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = "200000000";
    await loadOverride(400_000_000);
    await loadOverride(null);

    expect(getPlatformMonthlyTokenBudget()).toBe(200_000_000);
    expect(getPlatformBudgetSource()).toBe("env");
  });

  test("sin override ni variable no hay techo, y se dice", async () => {
    expect(getPlatformBudgetSource()).toBe("none");
  });
});

describe("registro del cambio", () => {
  test("guarda autor, motivo y el valor anterior", async () => {
    mockSetting.find.mockImplementation(query =>
      chain(query.setting === BUDGET ? [{ value: 200_000_000 }] : []),
    );

    await setPlatformAiOverride({
      setting: BUDGET,
      value: 400_000_000,
      changedByEmail: "dueño@henko.com",
      reason: "Cortó a las 3am por un bulk import",
    });

    const row = mockSetting.create.mock.calls[0][0];

    expect(row.value).toBe(400_000_000);
    expect(row.previousValue).toBe(200_000_000);
    expect(row.changedByEmail).toBe("dueño@henko.com");
    expect(row.reason).toContain("bulk import");
  });

  test("el valor nuevo rige en el acto, sin esperar el refresh", async () => {
    // Quien sube el techo porque se cortó el servicio necesita que valga ya.
    await setPlatformAiOverride({
      setting: BUDGET,
      value: 400_000_000,
      changedByEmail: "dueño@henko.com",
      reason: "urgencia",
    });

    expect(getPlatformAiOverride(BUDGET)).toBe(400_000_000);
  });

  test("un ajuste desconocido se rechaza", async () => {
    await expect(
      setPlatformAiOverride({
        setting: "loQueSea",
        value: 1,
        changedByEmail: "dueño@henko.com",
      }),
    ).rejects.toThrow(/desconocido/i);

    expect(mockSetting.create).not.toHaveBeenCalled();
  });
});

describe("estado de avisos al mover el techo", () => {
  test("subir el techo reinicia los avisos del período", async () => {
    // Regresión de un modo de falla silencioso: alertedThreshold guarda un
    // escalón expresado contra el techo VIEJO. Al 80% de 200M se guarda 80; si
    // ahí se sube a 400M, el consumo pasa a ser 40% y el guardia
    // alertedThreshold >= reached sigue dando verdadero para todo lo que venga.
    // El período se quedaba sin avisos justo después de la maniobra que indica
    // que alguien está mirando el gasto de cerca.
    mockSetting.find.mockImplementation(query =>
      chain(query.setting === BUDGET ? [{ value: 200_000_000 }] : []),
    );

    await setPlatformAiOverride({
      setting: BUDGET,
      value: 400_000_000,
      changedByEmail: "dueño@henko.com",
      reason: "subo el techo",
    });

    const [, update] = mockPlatformUsage.updateOne.mock.calls[0];

    expect(update.$set.alertedThreshold).toBe(0);
    // Y levanta la marca de corte: quedaría mostrando una caída que ya no está.
    expect(update.$set.breakerTrippedAt).toBeNull();
  });

  test("bajar el techo NO reinicia nada", async () => {
    // Los avisos ya emitidos siguen siendo ciertos, y el corte, si estaba,
    // sigue estándolo.
    mockSetting.find.mockImplementation(query =>
      chain(query.setting === BUDGET ? [{ value: 400_000_000 }] : []),
    );

    await setPlatformAiOverride({
      setting: BUDGET,
      value: 100_000_000,
      changedByEmail: "dueño@henko.com",
      reason: "bajo el techo",
    });

    expect(mockPlatformUsage.updateOne).not.toHaveBeenCalled();
  });

  test("quitar el override también reinicia: el escalón ya no significa lo mismo", async () => {
    mockSetting.find.mockImplementation(query =>
      chain(query.setting === BUDGET ? [{ value: 400_000_000 }] : []),
    );

    await setPlatformAiOverride({
      setting: BUDGET,
      value: null,
      changedByEmail: "dueño@henko.com",
      reason: "vuelvo a la variable",
    });

    expect(mockPlatformUsage.updateOne).toHaveBeenCalled();
  });

  test("si el reinicio de avisos falla, el cambio de techo igual queda", async () => {
    // Un aviso de más es preferible a rechazar la maniobra que estaba
    // levantando un corte de servicio.
    mockPlatformUsage.updateOne.mockRejectedValue(new Error("mongo caído"));
    mockSetting.find.mockImplementation(() => chain([]));

    await expect(
      setPlatformAiOverride({
        setting: BUDGET,
        value: 400_000_000,
        changedByEmail: "dueño@henko.com",
        reason: "urgencia",
      }),
    ).resolves.toBeDefined();

    expect(mockSetting.create).toHaveBeenCalled();
  });
});

describe("lectura resistente a fallos", () => {
  test("si la base falla, se sigue con el último valor conocido", async () => {
    // Quedarse sin techo por un problema de la base es peor que usar uno viejo.
    await loadOverride(400_000_000);

    mockSetting.find.mockImplementation(() => {
      throw new Error("mongo caído");
    });
    await refreshPlatformAiSettings();

    expect(getPlatformAiOverride(BUDGET)).toBe(400_000_000);
  });
});
