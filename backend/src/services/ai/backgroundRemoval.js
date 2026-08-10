import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
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

/**
 * Memoria que hay que tener libre para animarse a correr la inferencia.
 * El pico medido es ~282 MB; dejamos margen porque encima corre Express,
 * Mongoose y el resto del proceso.
 */
const REQUIRED_FREE_MB = Number(process.env.RMBG_REQUIRED_FREE_MB || 340)

const modelPath = () =>
  process.env.RMBG_MODEL_PATH ||
  path.join(os.tmpdir(), 'henko-ai', 'rmbg-1.4-quantized.onnx')

let sessionPromise = null
let ortPromise = null
let queue = Promise.resolve()
let disabledReason = null

// ─── Memoria disponible ──────────────────────────────────

/**
 * `os.totalmem()` reporta la RAM del host, no el límite del contenedor, así que
 * en Render o Docker miente por varios GB. El límite real está en cgroups.
 */
const containerLimitMb = () => {
  const candidates = [
    '/sys/fs/cgroup/memory.max', // cgroup v2
    '/sys/fs/cgroup/memory/memory.limit_in_bytes', // cgroup v1
  ]

  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim()
      if (!raw || raw === 'max') continue

      const bytes = Number(raw)
      // cgroup v1 usa un número gigante como "sin límite".
      if (Number.isFinite(bytes) && bytes > 0 && bytes < 64 * 1024 ** 3) {
        return Math.round(bytes / 1024 / 1024)
      }
    } catch {
      // el archivo no existe fuera de Linux
    }
  }

  return Math.round(os.totalmem() / 1024 / 1024)
}

const memorySnapshot = () => {
  const limit = containerLimitMb()
  const used = Math.round(process.memoryUsage().rss / 1024 / 1024)
  return { limit, used, free: limit - used }
}

/**
 * Un OOM mata el proceso sin pasar por ningún catch: el request muere sin
 * respuesta y el navegador lo ve como 502 sin cabeceras CORS. Por eso la
 * única defensa es no arrancar la inferencia si el margen no alcanza.
 */
const assertEnoughMemory = () => {
  const { limit, used, free } = memorySnapshot()

  if (free < REQUIRED_FREE_MB) {
    const error = new Error(
      `Memoria insuficiente para el recorte local: ${free} MB libres de ${limit} MB (se necesitan ${REQUIRED_FREE_MB} MB).`,
    )
    error.code = 'RMBG_INSUFFICIENT_MEMORY'
    throw error
  }

  return { limit, used, free }
}

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

/**
 * onnxruntime-node trae un binario nativo por plataforma. Importarlo arriba
 * hacía que, si ese binario no resuelve, reventara la cadena de imports y el
 * servidor entero no levantara. Cargado acá, el fallo queda contenido en esta
 * función y el resto de la API sigue en pie.
 */
const loadOrt = () => {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-node').catch(error => {
      ortPromise = null
      throw new Error(`onnxruntime-node no disponible: ${error.message}`)
    })
  }
  return ortPromise
}

/** Una sola sesión por proceso; las llamadas concurrentes comparten la carga. */
const getSession = () => {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt()
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

const buildInput = async (ort, imageBuffer) => {
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
  const ort = await loadOrt()
  const session = await getSession()
  const input = await buildInput(ort, imageBuffer)

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

export const isLocalBackgroundRemovalEnabled = () => {
  if (String(process.env.LOCAL_BG_REMOVAL ?? 'true').toLowerCase() === 'false') {
    return false
  }
  // Si ya se descartó en este proceso (sin binario nativo, o instancia chica),
  // no volvemos a intentarlo request tras request.
  return disabledReason === null
}

export const getBackgroundRemovalStatus = () => ({
  enabled: isLocalBackgroundRemovalEnabled(),
  disabledReason,
  requiredFreeMb: REQUIRED_FREE_MB,
  memory: memorySnapshot(),
})

/** Descarga y compila el modelo por adelantado para que el primer request no lo pague. */
export const warmUpBackgroundRemoval = async () => {
  if (!isLocalBackgroundRemovalEnabled()) return false

  try {
    assertEnoughMemory()
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

  const memory = assertEnoughMemory()

  const { width, height } = await sharp(imageBuffer).metadata()
  if (!width || !height) throw new Error('No se pudo leer la imagen')

  let mask
  try {
    mask = await enqueue(() => infer(imageBuffer))
  } catch (error) {
    // Un binario nativo ausente no se arregla reintentando: apagamos el motor
    // local por lo que queda del proceso y dejamos que el llamador use el remoto.
    if (/onnxruntime-node no disponible/.test(error.message)) {
      disabledReason = error.message
      logger.error('[RMBG] Motor local deshabilitado', { reason: error.message })
    }
    throw error
  }

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
    memoryLimitMb: memory.limit,
    memoryFreeMbBefore: memory.free,
  })

  return cutout
}

export const __testing = { modelPath, MIN_MODEL_BYTES, INPUT_SIZE }
