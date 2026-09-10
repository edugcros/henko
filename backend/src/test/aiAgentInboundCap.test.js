// Tope de longitud del mensaje que entra al agente.
//
// La salida de una llamada está acotada en varios lugares —8192 tokens como
// techo duro— y el prompt de sistema tiene su propio límite. La ENTRADA que
// manda el cliente no tenía ninguno, y el body admite 1 MB en producción: unos
// 250.000 tokens en un solo mensaje, ~USD 0,19 de entrada, seis mensajes para
// vaciarle la cuota mensual a un comercio free.
//
// El tope vive en aiPlanPolicy y no en el cerebro del agente porque hay tres
// puertas —el chat público, la prueba del panel y el webhook de WhatsApp— y
// tres topes separados terminan desincronizados.

import { getMaxInboundMessageChars } from "../services/ai/aiPlanPolicy.js";

beforeEach(() => {
  delete process.env.AI_AGENT_MAX_INBOUND_CHARS;
});

afterAll(() => {
  delete process.env.AI_AGENT_MAX_INBOUND_CHARS;
});

test("por defecto deja pasar un mensaje de chat holgado", () => {
  // Nadie legítimo se acerca a 2.000 caracteres en un chat de tienda: el tope
  // tiene que ser invisible en el uso real o se convierte en un problema para
  // quien no hizo nada.
  const consulta =
    "Hola, ¿tenés este producto en talle M? ¿Cuánto sale el envío a Córdoba capital y en cuánto llega?";

  expect(getMaxInboundMessageChars()).toBe(2000);
  expect(consulta.length).toBeLessThan(getMaxInboundMessageChars());
});

test("recorta lo que el body permitía mandar", () => {
  // El caso que motiva el tope: 1 MB de body entero como un solo mensaje.
  const enorme = "a".repeat(1024 * 1024);
  const recortado = enorme.slice(0, getMaxInboundMessageChars());

  expect(recortado).toHaveLength(2000);
  // Tres órdenes de magnitud de diferencia en tokens de entrada, que es lo que
  // se paga.
  expect(enorme.length / recortado.length).toBeGreaterThan(500);
});

test("se puede ajustar por entorno", () => {
  process.env.AI_AGENT_MAX_INBOUND_CHARS = "500";

  expect(getMaxInboundMessageChars()).toBe(500);
});

test("no se puede bajar tanto que rompa una consulta normal", () => {
  // Un tope de 10 caracteres dejaría el chat inservible sin que nadie lo note
  // hasta que un cliente se queje.
  process.env.AI_AGENT_MAX_INBOUND_CHARS = "5";

  expect(getMaxInboundMessageChars()).toBe(200);
});

test("no se puede subir hasta volver a habilitar el abuso", () => {
  // El techo del techo: subirlo a un millón devolvería exactamente el agujero
  // que esto cierra.
  process.env.AI_AGENT_MAX_INBOUND_CHARS = "1000000";

  expect(getMaxInboundMessageChars()).toBe(20000);
});

test("un valor basura cae al default en vez de a cero", () => {
  // Number('') es 0 y un tope de cero dejaría el agente sin mensajes que leer.
  process.env.AI_AGENT_MAX_INBOUND_CHARS = "no es un número";

  expect(getMaxInboundMessageChars()).toBe(2000);
});
