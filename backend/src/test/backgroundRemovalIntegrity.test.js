// Integridad del modelo que se descarga para quitar fondos.
//
// Es el único punto del sistema donde alguien ajeno decide un archivo que este
// servidor descarga y carga en memoria. Antes se bajaba de una cuenta personal
// de HuggingFace sin verificar nada.
//
// El hash se fijó tras comprobar que el release oficial del proyecto rembg y el
// mirror devuelven el mismo archivo byte por byte. Lo que se prueba acá es que
// el control efectivamente RECHACE lo que no coincide — un control de
// integridad que nunca dice que no es un comentario.

import { jest } from "@jest/globals";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { createHash } from "node:crypto";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.unstable_mockModule("../../config/logger.js", () => ({
  default: mockLogger,
}));

const HASH_ESPERADO =
  "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8";

const DIR = path.join(os.tmpdir(), "henko-rmbg-test");

/** Un buffer del tamaño mínimo aceptable pero con contenido ajeno. */
const archivoImpostor = () => Buffer.alloc(4_500_000, 42);

const respuesta = buffer => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ),
});

let fetchOriginal;

beforeAll(() => {
  fetchOriginal = globalThis.fetch;
});

afterAll(async () => {
  globalThis.fetch = fetchOriginal;
  await fsp.rm(DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();
  await fsp.rm(DIR, { recursive: true, force: true });
  process.env.RMBG_MODEL_PATH = path.join(DIR, "u2netp.onnx");
});

const cargar = async () => import("../services/ai/backgroundRemoval.js");

test("un archivo con otro hash se rechaza en TODAS las fuentes y falla", async () => {
  // El caso que motiva el control: alguien sirve otra cosa. No se usa "por las
  // dudas" — quitar el fondo es accesorio y no vale el riesgo.
  globalThis.fetch = jest.fn(async () => respuesta(archivoImpostor()));

  const { warmUpBackgroundRemoval } = await cargar();

  await expect(warmUpBackgroundRemoval()).resolves.toBeDefined();

  // Se probaron las dos fuentes antes de rendirse.
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);

  // Y quedó registrado como error, que es el evento que esto existe para ver.
  expect(mockLogger.error).toHaveBeenCalledWith(
    expect.stringContaining("NO es el esperado"),
    expect.objectContaining({ esperado: HASH_ESPERADO }),
  );

  // Nada quedó escrito en disco.
  await expect(fsp.stat(process.env.RMBG_MODEL_PATH)).rejects.toThrow();
});

test("si la primera fuente falla, se prueba la siguiente", async () => {
  // El orden importa: primero la oficial, el mirror solo de respaldo.
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce(respuesta(archivoImpostor()));

  const { warmUpBackgroundRemoval } = await cargar();
  await warmUpBackgroundRemoval();

  const urls = globalThis.fetch.mock.calls.map(([url]) => url);

  expect(urls[0]).toContain("github.com/danielgatis/rembg");
  expect(urls[1]).toContain("huggingface.co");
});

test("una cache envenenada no se acepta", async () => {
  // Verificar solo la descarga dejaría el control a medias: alcanzaría con
  // escribir el archivo una vez para saltearlo.
  await fsp.mkdir(DIR, { recursive: true });
  await fsp.writeFile(process.env.RMBG_MODEL_PATH, archivoImpostor());

  globalThis.fetch = jest.fn(async () => ({ ok: false, status: 503 }));

  const { warmUpBackgroundRemoval } = await cargar();
  await warmUpBackgroundRemoval();

  // Se dio cuenta de que lo que había en disco no servía y salió a buscarlo.
  expect(mockLogger.warn).toHaveBeenCalledWith(
    expect.stringContaining("cache no coincide"),
    expect.anything(),
  );
  expect(globalThis.fetch).toHaveBeenCalled();
});

test("el hash fijado es el que se verificó contra las dos fuentes", async () => {
  // Deja el número escrito donde se pueda comparar si alguien lo cambia.
  const contenido = await fsp.readFile(
    "src/services/ai/backgroundRemoval.js",
    "utf8",
  );

  expect(contenido).toContain(HASH_ESPERADO);
});

test("un archivo correcto se acepta y queda en disco", async () => {
  // La contracara: el control tiene que dejar pasar lo bueno. Un control que
  // rechaza todo también es inútil.
  const bueno = Buffer.alloc(4_600_000, 0);
  const hashDelBueno = createHash("sha256").update(bueno).digest("hex");

  process.env.RMBG_MODEL_SHA256 = hashDelBueno;
  jest.resetModules();

  globalThis.fetch = jest.fn(async () => respuesta(bueno));

  const { warmUpBackgroundRemoval } = await cargar();
  await warmUpBackgroundRemoval();

  const escrito = await fsp.readFile(process.env.RMBG_MODEL_PATH);
  expect(createHash("sha256").update(escrito).digest("hex")).toBe(hashDelBueno);

  delete process.env.RMBG_MODEL_SHA256;
});
