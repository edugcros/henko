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

// ─── Reglas de campaña y recuperación de carritos ────────────────────────────
//
// Dos fallas reportadas por el comercio: "no se puede editar la regla, da
// error" y "no se ve qué hace la recuperación de carrito ni funciona".

describe("reglas de campaña · editar una regla existente", () => {
  let mongod;
  let AiCampaignRule;

  const TENANT = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    AiCampaignRule = (await import("../models/aiCampaignRuleModel.js")).default;
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });

  afterEach(async () => {
    await AiCampaignRule.collection.deleteMany({});
  });

  test("el update NO puede llevar tenantId adentro", async () => {
    // El controlador armaba un solo objeto para crear y para editar, con
    // tenantId incluido. En la edición eso viaja dentro de un $set y el plugin
    // de aislamiento lo rechaza —con razón: mover una fila de comercio es la
    // fuga que ese plugin existe para impedir—. Editar cualquier regla fallaba
    // siempre.
    const regla = await AiCampaignRule.create({
      tenantId: TENANT,
      name: "Recuperación de carrito",
      type: "abandoned_cart",
      channel: "whatsapp",
      messageTemplate: "Hola, quedó algo en tu carrito",
    });

    await expect(
      AiCampaignRule.findOneAndUpdate(
        { _id: regla._id, tenantId: TENANT },
        { $set: { tenantId: TENANT, name: "Editada" } },
        { new: true },
      ).setOptions({ tenantId: TENANT }),
    ).rejects.toThrow(/Cannot modify tenantId/);

    // Sin tenantId en el $set, la misma edición pasa.
    const editada = await AiCampaignRule.findOneAndUpdate(
      { _id: regla._id, tenantId: TENANT },
      { $set: { name: "Editada" } },
      { new: true },
    ).setOptions({ tenantId: TENANT });

    expect(editada.name).toBe("Editada");
    expect(String(editada.tenantId)).toBe(String(TENANT));
  });
});

describe("recuperación de carritos · por qué no corre", () => {
  let mongod;
  let AiAgent;
  let AiCampaignRule;
  let getCartRecoveryReadiness;

  const TENANT = new mongoose.Types.ObjectId();

  const crearAgente = ({ enabled = true, whatsapp = true } = {}) =>
    AiAgent.collection.insertOne({
      tenantId: TENANT,
      enabled,
      channels: { webchat: { enabled: true }, whatsapp: { enabled: whatsapp } },
    });

  const crearRegla = (extra = {}) =>
    AiCampaignRule.collection.insertOne({
      tenantId: TENANT,
      name: "Carrito abandonado",
      type: "abandoned_cart",
      channel: "whatsapp",
      enabled: true,
      messageTemplate: "Hola",
      ...extra,
    });

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    AiAgent = (await import("../models/aiAgentModel.js")).default;
    AiCampaignRule = (await import("../models/aiCampaignRuleModel.js")).default;
    ({ getCartRecoveryReadiness } = await import(
      "../services/aiAgent/aiCartRecoveryService.js"
    ));
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });

  afterEach(async () => {
    await AiAgent.collection.deleteMany({});
    await AiCampaignRule.collection.deleteMany({});
  });

  test("con el canal de WhatsApp apagado lo dice, en vez de callarse", async () => {
    // Es el caso real de producción: regla activa, carrito esperando, y nada
    // pasaba porque el canal estaba en false. El worker lo descartaba cada 60
    // segundos sin dejar rastro.
    await crearAgente({ whatsapp: false });
    await crearRegla();

    const estado = await getCartRecoveryReadiness({ tenantId: TENANT });

    expect(estado.ready).toBe(false);
    expect(estado.reason).toBe("whatsapp_channel_disabled");
    expect(estado.hasActiveRule).toBe(true);
  });

  test("sin regla activa, el motivo es la regla y no el canal", async () => {
    await crearAgente();

    const estado = await getCartRecoveryReadiness({ tenantId: TENANT });

    expect(estado.reason).toBe("no_active_abandoned_cart_rule");
    expect(estado.whatsappEnabled).toBe(true);
  });

  test("con el asistente apagado, ese es el motivo", async () => {
    await crearAgente({ enabled: false });
    await crearRegla();

    const estado = await getCartRecoveryReadiness({ tenantId: TENANT });

    expect(estado.reason).toBe("agent_disabled");
  });

  test("con todo prendido, está lista", async () => {
    await crearAgente();
    await crearRegla();

    const estado = await getCartRecoveryReadiness({ tenantId: TENANT });

    expect(estado).toMatchObject({
      ready: true,
      reason: null,
      agentEnabled: true,
      whatsappEnabled: true,
      hasActiveRule: true,
    });
  });
});

// ─── El token de verificación del webhook ────────────────────────────────────
//
// Meta lo pide una sola vez, al dar de alta el webhook. Antes había uno solo
// para toda la plataforma —así que todos los comercios tenían que pegar el
// mismo secreto— y el campo que la pantalla les pedía completar no lo leía
// nadie. Ahora cada comercio tiene el suyo, derivado de su id.

describe("webhook de WhatsApp · token por comercio", () => {
  const A = "6a4dcc911161615f76a8131f";
  const B = "6aa4dcc911161615f76a8131";

  let buildWebhookVerifyToken;
  let verifyWhatsappWebhook;
  let anterior;

  beforeAll(async () => {
    anterior = process.env.WHATSAPP_VERIFY_TOKEN;
    process.env.WHATSAPP_VERIFY_TOKEN = "secreto-de-plataforma";
    ({ buildWebhookVerifyToken, verifyWhatsappWebhook } = await import(
      "../controller/whatsappWebhookCtrl.js"
    ));
  });

  afterAll(() => {
    if (anterior === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
    else process.env.WHATSAPP_VERIFY_TOKEN = anterior;
  });

  const verificar = async token => {
    const req = { query: { "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1234" } };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this },
      send(payload) { this.body = payload; return this },
      json(payload) { this.body = payload; return this },
    };
    await verifyWhatsappWebhook(req, res);
    return res;
  };

  test("cada comercio tiene un token distinto", () => {
    expect(buildWebhookVerifyToken(A)).not.toBe(buildWebhookVerifyToken(B));
    expect(buildWebhookVerifyToken(A)).toContain(A);
  });

  test("el token del comercio verifica el webhook", async () => {
    const res = await verificar(buildWebhookVerifyToken(A));

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("1234");
  });

  test("el token global sigue sirviendo: no rompe una integración ya dada de alta", async () => {
    const res = await verificar("secreto-de-plataforma");

    expect(res.statusCode).toBe(200);
  });

  test("un token inventado se rechaza", async () => {
    expect((await verificar(`${A}.0000000000000000000000000000cafe`)).statusCode).toBe(403);
    expect((await verificar("cualquier-cosa")).statusCode).toBe(403);
    expect((await verificar("")).statusCode).toBe(403);
  });
});

// ─── Recuperación por correo ─────────────────────────────────────────────────
//
// El worker sabía mandar por email, el servicio de correo existía y hasta
// personaliza mejor que WhatsApp (el correo no tiene ventana de 24 h). Lo
// único que faltaba era que el creador de recuperaciones lo eligiera: buscaba
// la regla con `channel: 'whatsapp'` fijo. Un comercio sin WhatsApp no
// recuperaba un solo carrito, aunque el comprador hubiera dejado su email.

describe("recuperación de carritos · el correo también sirve", () => {
  let mongod;
  let AiAgent;
  let AiCampaignRule;
  let AiCartRecovery;
  let User;
  let Cart;
  let createCartRecoveryFromCart;
  let getCartRecoveryReadiness;

  const TENANT = new mongoose.Types.ObjectId();

  const crearAgente = ({ whatsapp = false } = {}) =>
    AiAgent.collection.insertOne({
      tenantId: TENANT,
      enabled: true,
      channels: { webchat: { enabled: true }, whatsapp: { enabled: whatsapp } },
    });

  const crearRegla = channel =>
    AiCampaignRule.collection.insertOne({
      tenantId: TENANT,
      name: `Carrito abandonado (${channel})`,
      type: "abandoned_cart",
      channel,
      enabled: true,
      messageTemplate: "Hola {{customerName}}, quedó algo en tu carrito",
      trigger: { delayMinutes: 30, maxAttempts: 2 },
    });

  const crearUsuario = async ({ phone = "", email = "" } = {}) => {
    const { insertedId } = await User.collection.insertOne({
      tenantId: TENANT,
      firstname: "Clienta",
      email,
      mobile: phone,
    });

    return insertedId;
  };

  const carrito = () => ({
    _id: new mongoose.Types.ObjectId(),
    tenantId: TENANT,
    updatedAt: new Date(),
    products: [
      {
        productId: new mongoose.Types.ObjectId(),
        title: "Zapatilla Urbana",
        quantity: 1,
        price: 1000,
        subtotal: 1000,
      },
    ],
  });

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    AiAgent = (await import("../models/aiAgentModel.js")).default;
    AiCampaignRule = (await import("../models/aiCampaignRuleModel.js")).default;
    AiCartRecovery = (await import("../models/aiCartRecoveryModel.js")).default;
    User = (await import("../models/userModel.js")).default;
    Cart = (await import("../models/cartModel.js")).default;
    ({ createCartRecoveryFromCart, getCartRecoveryReadiness } = await import(
      "../services/aiAgent/aiCartRecoveryService.js"
    ));
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });

  afterEach(async () => {
    await Promise.all([
      AiAgent.collection.deleteMany({}),
      AiCampaignRule.collection.deleteMany({}),
      AiCartRecovery.collection.deleteMany({}),
      User.collection.deleteMany({}),
      Cart.collection.deleteMany({}),
    ]);
  });

  test("sin WhatsApp pero con regla de correo, la recuperación sale igual", async () => {
    await crearAgente({ whatsapp: false });
    await crearRegla("email");
    const userId = await crearUsuario({ email: "clienta@correo.com" });

    const recovery = await createCartRecoveryFromCart({
      tenantId: TENANT,
      tenant: { _id: TENANT, name: "Tienda" },
      cart: carrito(),
      userId,
    });

    expect(recovery).toBeTruthy();
    expect(recovery.channel).toBe("email");
    expect(recovery.customer.email).toBe("clienta@correo.com");
  });

  test("cuando los dos canales están disponibles, gana WhatsApp", async () => {
    // Convierte más. El correo entra cuando WhatsApp no está, no como reemplazo.
    await crearAgente({ whatsapp: true });
    await crearRegla("whatsapp");
    await crearRegla("email");
    const userId = await crearUsuario({
      phone: "+5493585132767",
      email: "clienta@correo.com",
    });

    const recovery = await createCartRecoveryFromCart({
      tenantId: TENANT,
      tenant: { _id: TENANT, name: "Tienda" },
      cart: carrito(),
      userId,
    });

    expect(recovery.channel).toBe("whatsapp");
  });

  test("una regla de WhatsApp con el canal apagado no manda por correo sola", async () => {
    // Si el comercio configuró WhatsApp y solo WhatsApp, no se le cambia el
    // canal por atrás: se avisa que no puede correr.
    await crearAgente({ whatsapp: false });
    await crearRegla("whatsapp");
    const userId = await crearUsuario({
      phone: "+5493585132767",
      email: "clienta@correo.com",
    });

    const recovery = await createCartRecoveryFromCart({
      tenantId: TENANT,
      tenant: { _id: TENANT, name: "Tienda" },
      cart: carrito(),
      userId,
    });

    expect(recovery).toBeNull();

    const estado = await getCartRecoveryReadiness({ tenantId: TENANT });
    expect(estado.reason).toBe("whatsapp_channel_disabled");
  });

  test("con regla de correo, el diagnóstico dice que está lista", async () => {
    await crearAgente({ whatsapp: false });
    await crearRegla("email");

    const estado = await getCartRecoveryReadiness({ tenantId: TENANT });

    expect(estado).toMatchObject({
      ready: true,
      reason: null,
      usableChannel: "email",
      whatsappEnabled: false,
    });
  });
});
