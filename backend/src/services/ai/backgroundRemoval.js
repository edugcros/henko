import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import logger from '../../../config/logger.js'

/**
 * Quitar fondo localmente con U2-Net portable (u2netp, ONNX).
 *
 * Corre en el propio proceso: no hay proveedor externo, no hay costo por
 * imagen y no hace falta ninguna API key.
 *
 * Medido contra RMBG-1.4 sobre la misma imagen, antes de elegirlo:
 *
 *   modelo         señal dentro   fuera   pico RAM   inferencia   archivo
 *   u2netp @320         0.990     0.002     102 MB      0.7 s      4.5 MB
 *   RMBG-1.4 q8 @1024   0.989     0.026     282 MB      ~6 s        44 MB
 *   RMBG-1.4 fp32       0.992     0.000     799 MB      ~4 s       176 MB
 *
 * RMBG-1.4 se probó primero en producción y el contenedor moría por OOM: su
 * entrada es fija de 1024x1024 y las activaciones intermedias dominan el pico,
 * que no entra junto a Express y Mongoose en una instancia chica. u2netp
 * trabaja a 320x320, así que el mismo cálculo cuesta un tercio de memoria y
 * separa igual o mejor.
 *
 * Dos detalles siguen siendo imprescindibles para no morir por OOM:
 *
 *  - `enableCpuMemArena` / `enableMemPattern` en false. Con la arena activada
 *    el pico de RMBG saltaba de 282 MB a 897 MB.
 *  - Una sola inferencia a la vez: cada una reserva su propio buffer de
 *    activaciones, así que dos en paralelo duplican el pico.
 */

/**
 * De dónde sale el modelo y cómo se comprueba que sea el que esperamos.
 *
 * Antes se bajaba de una sola URL: una cuenta personal de HuggingFace, sin
 * verificar nada. Quien controlara esa cuenta controlaba un archivo que este
 * servidor descarga y carga en memoria — el único punto del sistema donde
 * alguien ajeno decide algo que corre acá adentro.
 *
 * El hash se verificó contra DOS fuentes independientes el 10/09/2026: el
 * release oficial del proyecto rembg en GitHub y el mirror de HuggingFace
 * devuelven exactamente el mismo archivo, byte por byte. Que coincidan es lo
 * que permite fijarlo con confianza en vez de simplemente congelar lo que un
 * tercero servía ese día.
 *
 * El orden importa: primero la fuente oficial, el mirror solo si la primera no
 * responde. Si ninguna entrega el archivo esperado, no se usa ninguno — un
 * modelo que no es el que se pidió no se carga "por las dudas".
 */
const MODEL_SOURCES = [
  'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
  'https://huggingface.co/tomjackson2023/rembg/resolve/main/u2netp.onnx',
]

const MODEL_SHA256 =
  process.env.RMBG_MODEL_SHA256 ||
  '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'

// ~4.5 MB. Si el archivo en disco es mucho más chico, quedó una descarga a medias.
const MIN_MODEL_BYTES = 3 * 1024 * 1024
const INPUT_SIZE = 320

// u2netp espera la normalización de ImageNet.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/**
 * Memoria que hay que tener libre para animarse a correr la inferencia.
 * El pico medido es ~102 MB; pedimos bastante más porque encima corre Express,
 * Mongoose y el resto del proceso, y un OOM no se puede atrapar.
 */
const REQUIRED_FREE_MB = Number(process.env.RMBG_REQUIRED_FREE_MB || 170)

const modelPath = () =>
  process.env.RMBG_MODEL_PATH || path.join(os.tmpdir(), 'henko-ai', 'u2netp.onnx')

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
        return { limitMb: Math.round(bytes / 1024 / 1024), source: 'cgroup' }
      }
    } catch {
      // el archivo no existe fuera de Linux
    }
  }

  /**
   * Sin cgroup no sabemos cuánto nos toca. `os.totalmem()` acá miente: dentro de
   * un contenedor devuelve la RAM del host, así que usarlo como límite hacía que
   * el guard viera decenas de GB libres, dejara pasar la inferencia y el
   * contenedor muriera igual. Sólo se acepta cuando NO estamos en un contenedor.
   */
  return { limitMb: Math.round(os.totalmem() / 1024 / 1024), source: 'os' }
}

const runningInContainer = () => {
  if (process.env.RENDER || process.env.KUBERNETES_SERVICE_HOST) return true
  try {
    return fs.existsSync('/.dockerenv')
  } catch {
    return false
  }
}

const memorySnapshot = () => {
  const { limitMb, source } = containerLimitMb()
  const used = Math.round(process.memoryUsage().rss / 1024 / 1024)

  // Un límite proveniente de os.totalmem() dentro de un contenedor no es
  // confiable: lo marcamos como desconocido en vez de creerle.
  const trusted = source === 'cgroup' || !runningInContainer()

  return {
    limit: limitMb,
    used,
    free: limitMb - used,
    source,
    trusted,
  }
}

/**
 * Un OOM mata el proceso sin pasar por ningún catch: el request muere sin
 * respuesta y el navegador lo ve como 502 sin cabeceras CORS. Por eso la
 * única defensa es no arrancar la inferencia si el margen no alcanza.
 */
const assertEnoughMemory = () => {
  const snapshot = memorySnapshot()
  const { limit, free, trusted } = snapshot

  // Un OOM mata el proceso sin dejar rastro: el request muere sin respuesta y
  // el navegador sólo ve un 502 sin cabeceras CORS. Si no podemos afirmar que
  // entra, no lo intentamos.
  if (!trusted) {
    const error = new Error(
      'No se pudo determinar el límite de memoria del contenedor, así que no se arriesga la inferencia local.',
    )
    error.code = 'RMBG_UNKNOWN_MEMORY_LIMIT'
    throw error
  }

  if (free < REQUIRED_FREE_MB) {
    const error = new Error(
      `Memoria insuficiente para el recorte local: ${free} MB libres de ${limit} MB (se necesitan ${REQUIRED_FREE_MB} MB).`,
    )
    error.code = 'RMBG_INSUFFICIENT_MEMORY'
    throw error
  }

  return snapshot
}

// ─── Modelo ──────────────────────────────────────────────

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

const downloadModel = async destination => {
  await fsp.mkdir(path.dirname(destination), { recursive: true })

  const errores = []

  for (const url of MODEL_SOURCES) {
    const started = Date.now()
    logger.info('[RMBG] Descargando modelo', { url, destination })

    try {
      const response = await fetch(url)
      if (!response.ok) {
        errores.push(`${url}: HTTP ${response.status}`)
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())

      if (buffer.length < MIN_MODEL_BYTES) {
        errores.push(`${url}: descarga incompleta (${buffer.length} bytes)`)
        continue
      }

      const digest = sha256(buffer)

      if (digest !== MODEL_SHA256) {
        // No es un fallo de red: alguien está sirviendo otro archivo. Se
        // registra con nivel error porque es exactamente el evento que este
        // control existe para detectar, y se prueba la fuente siguiente en vez
        // de usar lo que llegó.
        logger.error('[RMBG] El modelo descargado NO es el esperado, se descarta', {
          url,
          esperado: MODEL_SHA256,
          recibido: digest,
        })
        errores.push(`${url}: hash distinto (${digest})`)
        continue
      }

      // Se escribe a un temporal y se renombra: si el proceso muere a mitad de
      // la escritura, no queda un .onnx corrupto que rompa todos los arranques
      // siguientes. El renombrado es atómico, así que lo que quede en destino
      // ya está verificado.
      const temporary = `${destination}.${process.pid}.part`
      await fsp.writeFile(temporary, buffer)
      await fsp.rename(temporary, destination)

      logger.info('[RMBG] Modelo descargado y verificado', {
        url,
        bytes: buffer.length,
        ms: Date.now() - started,
      })

      return
    } catch (error) {
      errores.push(`${url}: ${error.message}`)
    }
  }

  // Ninguna fuente entregó el archivo esperado. Se falla en vez de seguir con
  // lo que haya: quitar el fondo es una función accesoria, y usar un modelo que
  // no es el que se pidió no vale el riesgo de que lo sea.
  throw new Error(`No se pudo obtener un modelo RMBG verificado — ${errores.join(' | ')}`)
}

// El archivo en disco se verifica una vez por proceso. Hacerlo en cada llamada
// costaría leer y hashear 4,5 MB por imagen; no hacerlo nunca dejaría el
// control al alcance de cualquiera que pueda escribir en el directorio temporal.
let verifiedPath = null

const ensureModel = async () => {
  const destination = modelPath()

  if (verifiedPath === destination) return destination

  try {
    const cached = await fsp.readFile(destination)

    if (cached.length >= MIN_MODEL_BYTES && sha256(cached) === MODEL_SHA256) {
      verifiedPath = destination
      return destination
    }

    // Verificar la descarga y no lo que quedó en disco dejaría el control a
    // medias: alcanzaría con escribir el archivo una vez para saltearlo.
    logger.warn('[RMBG] El modelo en cache no coincide con el esperado, se descarta', {
      bytes: cached.length,
    })
    await fsp.rm(destination, { force: true })
  } catch {
    // no existe todavía, o no se pudo leer
  }

  await downloadModel(destination)
  verifiedPath = destination

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

  // RGB intercalado → planos CHW, escalado a [0,1] y normalizado con ImageNet.
  for (let i = 0; i < plane; i++) {
    tensor[i] = (data[i * 3] / 255 - MEAN[0]) / STD[0]
    tensor[plane + i] = (data[i * 3 + 1] / 255 - MEAN[1]) / STD[1]
    tensor[2 * plane + i] = (data[i * 3 + 2] / 255 - MEAN[2]) / STD[2]
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
