import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import logger from '../../../config/logger.js'

/**
 * Quitar fondo localmente con RMBG-1.4 (ONNX, cuantizado a int8).
 *
 * Corre en el propio proceso: no hay proveedor externo, no hay costo por
 * imagen y no hace falta ninguna API key.
 *
 * Medido antes de elegirlo, contra el modelo fp32 y sobre la misma imagen:
 *
 *   modelo   señal dentro   fuera    pico RAM   inferencia
 *   q8            0.989     0.026      282 MB       ~6 s
 *   fp32          0.992     0.000      799 MB       ~4 s
 *
 * El cuantizado da prácticamente la misma máscara con un tercio de la memoria,
 * así que es el único que entra en una instancia chica. Dos detalles hacen la
 * diferencia entre entrar y morir por OOM:
 *
 *  - `enableCpuMemArena` / `enableMemPattern` en false. Con la arena activada
 *    el pico salta de 282 MB a 897 MB, que es lo que tumbaba el contenedor.
 *  - Una sola inferencia a la vez. Cada una reserva su propio buffer de
 *    activaciones, así que dos en paralelo duplican el pico.
 *
 * El modelo tiene input fijo de 1024x1024: no se puede achicar para gastar
 * menos memoria.
 */

const MODEL_URL =
  'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx'

// ~42 MB. Si el archivo en disco es mucho más chico, quedó una descarga a medias.
const MIN_MODEL_BYTES = 30 * 1024 * 1024
const INPUT_SIZE = 1024

const modelPath = () =>
  process.env.RMBG_MODEL_PATH ||
  path.join(os.tmpdir(), 'henko-ai', 'rmbg-1.4-quantized.onnx')

let sessionPromise = null
let queue = Promise.resolve()

// ─── Modelo ──────────────────────────────────────────────

const downloadModel = async destination => {
  await fsp.mkdir(path.dirname(destination), { recursive: true })

  logger.info('[RMBG] Descargando modelo', { url: MODEL_URL, destination })
  const started = Date.now()

  const response = await fetch(MODEL_URL)
  if (!response.ok) {
    throw new Error(`No se pudo descargar el modelo RMBG (${response.status})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < MIN_MODEL_BYTES) {
    throw new Error(`Descarga incompleta del modelo RMBG (${buffer.length} bytes)`)
  }

  // Escribimos a un temporal y renombramos: si el proceso muere a mitad de la
  // descarga, no queda un .onnx corrupto que rompa todos los arranques siguientes.
  const temporary = `${destination}.${process.pid}.part`
  await fsp.writeFile(temporary, buffer)
  await fsp.rename(temporary, destination)

  logger.info('[RMBG] Modelo descargado', {
    bytes: buffer.length,
    ms: Date.now() - started,
  })
}

const ensureModel = async () => {
  const destination = modelPath()

  try {
    const stat = await fsp.stat(destination)
    if (stat.size >= MIN_MODEL_BYTES) return destination

    logger.warn('[RMBG] Modelo en cache incompleto, se vuelve a descargar', {
      bytes: stat.size,
    })
    await fsp.rm(destination, { force: true })
  } catch {
    // no existe todavía
  }

  await downloadModel(destination)
  return destination
}

/** Una sola sesión por proceso; las llamadas concurrentes comparten la carga. */
const getSession = () => {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const file = await ensureModel()
      const started = Date.now()

      const session = await ort.InferenceSession.create(file, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: false,
        enableMemPattern: false,
        intraOpNumThreads: 1,
      })

      logger.info('[RMBG] Sesión lista', { ms: Date.now() - started })
      return session
    })().catch(error => {
      // Si falla, limpiamos para que el próximo intento vuelva a probar en vez
      // de quedar cacheada una promesa rechazada para siempre.
      sessionPromise = null
      throw error
    })
  }

  return sessionPromise
}

// ─── Inferencia ──────────────────────────────────────────

const buildInput = async imageBuffer => {
  const { data } = await sharp(imageBuffer)
    .removeAlpha()
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const plane = INPUT_SIZE * INPUT_SIZE
  const tensor = new Float32Array(3 * plane)

  // RGB intercalado → planos CHW, escalado a [0,1] y centrado en 0 (media 0.5).
  for (let i = 0; i < plane; i++) {
    tensor[i] = data[i * 3] / 255 - 0.5
    tensor[plane + i] = data[i * 3 + 1] / 255 - 0.5
    tensor[2 * plane + i] = data[i * 3 + 2] / 255 - 0.5
  }

  return new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE])
}

const toAlphaMask = output => {
  const values = output.data
  const plane = INPUT_SIZE * INPUT_SIZE

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i]
    if (values[i] > max) max = values[i]
  }

  const range = max - min || 1
  const mask = Buffer.allocUnsafe(plane)
  for (let i = 0; i < plane; i++) {
    mask[i] = Math.round(((values[i] - min) / range) * 255)
  }

  return mask
}

const infer = async imageBuffer => {
  const session = await getSession()
  const input = await buildInput(imageBuffer)

  const result = await session.run({ [session.inputNames[0]]: input })
  return toAlphaMask(result[session.outputNames[0]])
}

/**
 * Serializa las inferencias. Sin esto, dos requests simultáneos duplican el
 * pico de memoria y tumban el contenedor.
 */
const enqueue = task => {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// ─── API pública ─────────────────────────────────────────

export const isLocalBackgroundRemovalEnabled = () =>
  String(process.env.LOCAL_BG_REMOVAL ?? 'true').toLowerCase() !== 'false'

/** Descarga y compila el modelo por adelantado para que el primer request no lo pague. */
export const warmUpBackgroundRemoval = async () => {
  if (!isLocalBackgroundRemovalEnabled()) return false

  try {
    await getSession()
    return true
  } catch (error) {
    logger.warn('[RMBG] No se pudo precalentar', { error: error.message })
    return false
  }
}

/**
 * Devuelve un PNG con el fondo transparente.
 * @param {Buffer} imageBuffer
 * @returns {Promise<Buffer>}
 */
export const removeBackgroundLocal = async imageBuffer => {
  const started = Date.now()

  const { width, height } = await sharp(imageBuffer).metadata()
  if (!width || !height) throw new Error('No se pudo leer la imagen')

  const mask = await enqueue(() => infer(imageBuffer))

  // `toColourspace('b-w')` no es opcional: al redimensionar, sharp promueve el
  // raw de 1 canal a 3 y joinChannel termina leyendo basura desalineada.
  const alpha = await sharp(mask, {
    raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 },
  })
    .resize(width, height, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer()

  if (alpha.length !== width * height) {
    throw new Error(
      `Máscara con tamaño inesperado: ${alpha.length} bytes para ${width}x${height}`,
    )
  }

  const base = await sharp(imageBuffer).removeAlpha().toBuffer()
  const cutout = await sharp(base)
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()

  logger.info('[RMBG] Fondo quitado localmente', {
    ms: Date.now() - started,
    width,
    height,
    outputBytes: cutout.length,
  })

  return cutout
}

export const __testing = { modelPath, MIN_MODEL_BYTES, INPUT_SIZE }
