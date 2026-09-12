import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { buildAgentActions } from "../services/aiAgent/aiAgentActionService.js";
import { buildAgentSystemPrompt } from "../services/aiAgent/aiAgentPromptService.js";
import { validateAgentCommerceResponse } from "../services/aiAgent/aiAgentResponseValidatorService.js";
import { buildDefaultAiAgentPayload } from "../services/aiAgent/aiAgentProvisioningService.js";
import AiAgent from "../models/aiAgentModel.js";

const productWithVariants = {
  id: "product-1",
  title: "Zapatilla Urbana",
  slug: "zapatilla-urbana",
  available: true,
  stock: 8,
  price: 120000,
  variants: [
    {
      id: "variant-red-40",
      sku: "URB-RED-40",
      stock: 4,
      price: 120000,
      attributes: { color: "Rojo", talle: "40" },
    },
    {
      id: "variant-black-42",
      sku: "URB-BLK-42",
      stock: 4,
      price: 125000,
      attributes: { color: "Negro", talle: "42" },
    },
  ],
};

describe("AI agent production contracts", () => {
  test("selects the requested variant instead of the first available variant", () => {
    const actions = buildAgentActions({
      text: "Quiero comprar la Zapatilla Urbana negra talle 42",
      responseText: "La Zapatilla Urbana negra talle 42 está disponible.",
      products: [productWithVariants],
    });

    const cartAction = actions.find((action) => action.type === "add_to_cart");

    expect(cartAction).toBeDefined();
    expect(cartAction.variantId).toBe("variant-black-42");
    expect(cartAction.variantSku).toBe("URB-BLK-42");
    expect(cartAction.selectedAttributes).toEqual({
      color: "Negro",
      talle: "42",
    });
  });

  test("does not add an ambiguous multi-variant product to the cart", () => {
    const actions = buildAgentActions({
      text: "Quiero comprar la Zapatilla Urbana",
      responseText: "La Zapatilla Urbana está disponible.",
      products: [productWithVariants],
    });

    expect(actions.some((action) => action.type === "add_to_cart")).toBe(false);
    expect(actions.some((action) => action.type === "view_product")).toBe(true);
  });

  test("blocks hallucinated commercial amounts", () => {
    const result = validateAgentCommerceResponse({
      responseText:
        "La Zapatilla Urbana cuesta $999.999 y tiene stock disponible.",
      products: [productWithVariants],
    });

    expect(result.ok).toBe(false);
    expect(result.shouldFallback).toBe(true);
    expect(result.warnings).toContain(
      "contains_unverified_commercial_numbers",
    );
  });

  test("accepts exact prices and stock from the catalog context", () => {
    const result = validateAgentCommerceResponse({
      responseText:
        "La Zapatilla Urbana cuesta $120.000 y tiene 8 unidades disponibles.",
      products: [productWithVariants],
    });

    expect(result.ok).toBe(true);
    expect(result.shouldFallback).toBe(false);
  });

  test("builds a schema-aligned default agent configuration", () => {
    const payload = buildDefaultAiAgentPayload({
      tenantId: "tenant-1",
      tenant: {
        name: "Henko",
        currency: "ars",
      },
    });

    expect(payload.personality).toEqual({
      tone: "friendly",
      language: "es-AR",
    });
    expect(payload.behavior.canCreateCartLinks).toBe(true);
    expect(payload.behavior.requireHumanForPayments).toBe(true);
    // currency debe viajar en el payload y el schema debe poder guardarlo
    // (lo consume el validador comercial para interpretar montos).
    expect(payload.businessContext.currency).toBe("ARS");
    expect(payload.businessContext.policies).toEqual({
      shipping: "",
      returns: "",
      payments: "",
      privacy: "",
      warranty: "",
    });
  });

  test("schema declares the businessContext fields the agent actually reads", () => {
    // Guarda contra la regresión que teníamos: campos que el provisioning
    // escribe y algún consumidor lee, pero que el schema descartaba en
    // silencio. Si alguien los quita del schema, este test falla.
    expect(AiAgent.schema.path("businessContext.currency")).toBeDefined();
    expect(
      AiAgent.schema.path("businessContext.policies.warranty"),
    ).toBeDefined();
  });
});

// ─── Lo que nunca puede llegarle al comprador ────────────────────────────────
//
// En producción salió esta respuesta tal cual: "...Pelota Adidas Argentum 25 /
// KTM Ultra / Honda VFR). Let's pick 2 clear ones:". Es el modelo pensando en
// voz alta, y ninguna regla del validador lo miraba.

describe("validador · razonamiento filtrado", () => {
  const validar = responseText =>
    validateAgentCommerceResponse({
      responseText,
      userMessage: "Quiero ver productos destacados",
      products: [productWithVariants],
    });

  test("una respuesta con el modelo pensando en voz alta se bloquea", () => {
    const resultado = validar(
      "Tenemos varias opciones. Let's pick 2 clear ones: la Zapatilla Urbana y otra.",
    );

    expect(resultado.warnings).toContain("contains_model_reasoning_leak");
    expect(resultado.shouldFallback).toBe(true);
  });

  test("también los bloques de código y el andamiaje de formato", () => {
    expect(validar("Claro:\n```\nproducto\n```").warnings).toContain(
      "contains_model_reasoning_leak",
    );
    expect(validar("Reasoning: el cliente busca zapatillas").warnings).toContain(
      "contains_model_reasoning_leak",
    );
  });

  test("un nombre de producto en inglés NO es una fuga", () => {
    // El catálogo está lleno de "Mountain Bike" y "Free Fire": la regla mira
    // marcas de proceso, no el idioma.
    const resultado = validar(
      "Tenemos la Zapatilla Urbana en negro talle 42, y también una Mountain Bike KTM Ultra.",
    );

    expect(resultado.warnings).not.toContain("contains_model_reasoning_leak");
  });
});

// ─── Identidad del lead ──────────────────────────────────────────────────────
//
// El comercio reportó que cada charla nueva del asistente REEMPLAZABA al lead
// anterior en vez de sumarse. La base lo confirmó: siete conversaciones, un
// solo lead —en estado 'lost'— apuntando siempre a la última. Las otras seis
// quedaron sin ningún lead que las nombre.
//
// Un lead es una PERSONA, así que volver con el mismo teléfono o email tiene
// que caer en el mismo lead: eso está bien y se mantiene. Lo que estaba mal era
// que una oportunidad CERRADA siguiera recibiendo escrituras.

describe("leads · una charla nueva no pisa la oportunidad cerrada", () => {
  let mongod;
  let AiLead;
  let upsertLeadFromConversation;

  const TENANT = new mongoose.Types.ObjectId();

  const charla = () => ({ _id: new mongoose.Types.ObjectId(), channel: "webchat" });

  const escribir = ({ conversation, name, message = "Hola, quiero comprar" }) =>
    upsertLeadFromConversation({
      tenantId: TENANT,
      conversation,
      customerName: name,
      customerPhone: "3585132767",
      message,
      channel: "webchat",
    });

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    AiLead = (await import("../models/aiLeadModel.js")).default;
    ({ upsertLeadFromConversation } = await import(
      "../services/aiAgent/aiLeadCommercialService.js"
    ));

    await AiLead.init();
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });

  afterEach(async () => {
    await AiLead.collection.deleteMany({});
  });

  test("la misma persona en dos charlas es un solo lead, con las dos charlas", async () => {
    const primera = charla();
    const segunda = charla();

    await escribir({ conversation: primera, name: "Eduardo" });
    await escribir({ conversation: segunda, name: "Eduardo" });

    const leads = await AiLead.find({}).setOptions({ tenantId: TENANT }).lean();

    expect(leads).toHaveLength(1);
    // Las dos quedan anotadas: antes la primera se perdía y solo sobrevivían
    // el puntero de origen y el de la última.
    expect(leads[0].conversationIds.map(String).sort()).toEqual(
      [String(primera._id), String(segunda._id)].sort(),
    );
    expect(String(leads[0].lastConversationId)).toBe(String(segunda._id));
  });

  test("con la oportunidad cerrada, la charla siguiente abre un lead nuevo", async () => {
    const primera = charla();
    const lead = await escribir({ conversation: primera, name: "Eduardo" });

    await AiLead.updateOne(
      { _id: lead._id },
      { $set: { status: "lost" } },
    ).setOptions({ tenantId: TENANT });

    const segunda = charla();
    await escribir({ conversation: segunda, name: "Otro visitante" });

    const leads = await AiLead.find({})
      .sort({ createdAt: 1 })
      .setOptions({ tenantId: TENANT })
      .lean();

    expect(leads).toHaveLength(2);

    // La cerrada queda intacta: mismo nombre, mismo estado, misma charla.
    expect(leads[0].status).toBe("lost");
    expect(leads[0].customer.name).toBe("Eduardo");
    expect(String(leads[0].lastConversationId)).toBe(String(primera._id));

    expect(leads[1].status).not.toBe("lost");
    expect(String(leads[1].conversationId)).toBe(String(segunda._id));
  });

  test("si la cierran en medio de la charla, la que sigue no rompe el índice único", async () => {
    // El índice (tenantId, conversationId) es único, y la charla ya tiene dueño:
    // el lead nuevo se crea igual, sin reclamarla, y la referencia viaja en
    // lastConversationId — que es el campo que el panel abre.
    const conversation = charla();
    const lead = await escribir({ conversation, name: "Eduardo" });

    await AiLead.updateOne(
      { _id: lead._id },
      { $set: { status: "won" } },
    ).setOptions({ tenantId: TENANT });

    const nuevo = await escribir({
      conversation,
      name: "Eduardo",
      message: "Che, una consulta más",
    });

    expect(nuevo).toBeTruthy();
    expect(String(nuevo._id)).not.toBe(String(lead._id));
    expect(nuevo.conversationId).toBeNull();
    expect(String(nuevo.lastConversationId)).toBe(String(conversation._id));

    const cerrado = await AiLead.findById(lead._id)
      .setOptions({ tenantId: TENANT })
      .lean();
    expect(cerrado.status).toBe("won");
  });
});

// ─── El visitante que recién llega ───────────────────────────────────────────
//
// isFollowUp salía solo de cómo estaba escrito el mensaje: quien entraba por
// primera vez preguntando "¿y el más barato?" hacía que el prompt afirmara que
// era el seguimiento de una charla previa, con la memoria vacía. El modelo
// retomaba un hilo inexistente, y de ahí salían las respuestas que arrancan
// pidiendo disculpas por una confusión que el cliente nunca vivió.

describe("asistente · primer mensaje de un visitante nuevo", () => {
  const prompt = conversationMemory =>
    buildAgentSystemPrompt({
      agent: {},
      tenant: { name: "Henko" },
      conversationMemory,
      currentUserMessage: "¿y el más barato?",
    });

  test("el prompt dice que es el primer mensaje y prohíbe inventar lo anterior", () => {
    const texto = prompt({ isFirstMessage: true, isFollowUp: false });

    expect(texto).toContain("PRIMER MENSAJE");
    expect(texto).toContain("No te disculpes por nada previo");
    expect(texto).not.toContain("Es seguimiento de una charla previa: sí");
  });

  test("con historial real sí se declara el seguimiento", () => {
    const texto = prompt({
      isFirstMessage: false,
      isFollowUp: true,
      lastUserMessages: ["Busco unas zapatillas"],
      summary: "Productos/IDs ya tratados: Zapatilla Urbana",
    });

    expect(texto).toContain("Es seguimiento de una charla previa: sí");
    expect(texto).not.toContain("PRIMER MENSAJE");
  });
});
