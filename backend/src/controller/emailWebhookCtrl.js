// 📁 src/controller/emailWebhookCtrl.js
//
// Qué pasó DESPUÉS de que el proveedor aceptó el correo.
//
// POR QUÉ HACE FALTA
//
// El envío registra "aceptado por el proveedor" cuando la API contesta que sí,
// y eso solo significa "lo recibí, después veré qué hago". El rebote, el
// descarte y el bloqueo ocurren más tarde y por otro canal.
//
// Pasó en producción el 18/09/2026: un correo quedó en `Dropped` porque la
// dirección estaba en la lista de supresión de SendGrid, y en los logs figuraba
// como enviado correctamente. Sin esto, un cliente que no recibe su correo de
// verificación es indistinguible de uno que sí lo recibió.
//
// UNA RUTA POR PROVEEDOR, NO UNA QUE ADIVINE
//
// Cada proveedor firma distinto, así que el endpoint tiene que saber de
// antemano a quién le está creyendo. Un endpoint único que mirara la forma del
// cuerpo para decidir qué verificador usar le daría al atacante justamente eso:
// elegir con qué firma lo van a verificar. Por eso son dos rutas.

import crypto from 'node:crypto'

import logger from '../../config/logger.js'
import { sendResponse } from '../utils/response.js'

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature'
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp'

/**
 * Eventos que significan que el correo NO llegó.
 *
 * `deferred` queda afuera a propósito: es un reintento en curso, no un fallo, y
 * tratarlo como error llenaría los logs de alarmas que se resuelven solas.
 */
const EVENTOS_DE_FALLO = new Set(['bounce', 'dropped', 'blocked', 'spamreport'])

/**
 * Cuánto se tolera de desfasaje entre el reloj de SendGrid y el nuestro.
 *
 * Sin ventana, una firma robada se puede reenviar para siempre. Diez minutos
 * cubren cualquier desfasaje razonable de relojes sin dejar la puerta abierta.
 */
const VENTANA_TOLERADA_MS = 10 * 60 * 1000

/**
 * ¿La firma es de SendGrid?
 *
 * SendGrid firma con ECDSA sobre (timestamp + cuerpo crudo). Por eso se usa
 * req.rawBody y no req.body: JSON.stringify del objeto ya parseado no
 * reproduce byte a byte lo que se firmó, y la verificación fallaría siempre.
 */
export const verifySendgridSignature = req => {
  const clavePublica = String(process.env.SENDGRID_WEBHOOK_PUBLIC_KEY || '').trim()

  if (!clavePublica) {
    // Mismo criterio que el webhook de Mercado Pago: en producción sin clave
    // no se procesa nada, porque un endpoint público sin verificar deja que
    // cualquiera invente rebotes.
    if (process.env.NODE_ENV === 'production') {
      logger.error('❌ SENDGRID_WEBHOOK_PUBLIC_KEY no configurada en producción')
      return false
    }

    logger.warn('⚠️ SENDGRID_WEBHOOK_PUBLIC_KEY sin configurar; no se verifica en desarrollo')
    return true
  }

  const firma = req.headers[SIGNATURE_HEADER]
  const timestamp = req.headers[TIMESTAMP_HEADER]

  if (!firma || !timestamp) return false

  const edad = Math.abs(Date.now() - Number(timestamp) * 1000)

  if (!Number.isFinite(edad) || edad > VENTANA_TOLERADA_MS) {
    logger.warn('[SENDGRID] Evento con timestamp fuera de ventana', { timestamp })
    return false
  }

  const cuerpo = req.rawBody

  if (!cuerpo) {
    logger.error('[SENDGRID] Falta req.rawBody: no se puede verificar la firma')
    return false
  }

  try {
    const verificador = crypto.createVerify('sha256')
    verificador.update(timestamp)
    verificador.update(cuerpo)
    verificador.end()

    return verificador.verify(
      {
        key: `-----BEGIN PUBLIC KEY-----\n${clavePublica}\n-----END PUBLIC KEY-----`,
        format: 'pem',
      },
      firma,
      'base64',
    )
  } catch (error) {
    logger.warn('[SENDGRID] No se pudo verificar la firma', { message: error.message })
    return false
  }
}

/**
 * POST /api/webhooks/sendgrid/events
 *
 * SendGrid manda los eventos en lotes. Se responde 204 siempre que la firma sea
 * válida: un error nuestro procesando un evento no debe hacer que SendGrid
 * reintente el lote entero en bucle.
 */
export const handleSendgridEvents = async (req, res) => {
  if (!verifySendgridSignature(req)) {
    logger.error('🔴 Webhook de SendGrid con firma inválida', {
      hasSignature: Boolean(req.headers[SIGNATURE_HEADER]),
    })

    return sendResponse(res, 401, false, 'Firma inválida')
  }

  const eventos = Array.isArray(req.body) ? req.body : []

  for (const evento of eventos) {
    const tipo = String(evento?.event || '').toLowerCase()

    const datos = {
      evento: tipo,
      to: evento?.email || null,
      // sg_message_id trae un sufijo de enrutamiento después del punto; la
      // parte anterior es el messageId que ya se registra al enviar, y es lo
      // que permite cruzar este evento con aquella línea del log.
      messageId: String(evento?.sg_message_id || '').split('.')[0] || null,
      motivo: evento?.reason || evento?.response || null,
      tipoRebote: evento?.type || null,
    }

    if (EVENTOS_DE_FALLO.has(tipo)) {
      logger.error('📭 Correo NO entregado', datos)
      continue
    }

    logger.info('📬 Evento de correo', datos)
  }

  return res.status(204).end()
}

// =====================================================
// AMAZON SES — eventos vía SNS
// =====================================================
//
// SES no postea a un endpoint: publica en un tópico de SNS y SNS lo reenvía.
// Eso agrega dos cosas que el webhook de SendGrid no tiene: un apretón de
// manos para dar de alta la suscripción, y una firma que se valida contra un
// certificado que hay que ir a buscar.

/**
 * Eventos que significan que el correo NO llegó.
 *
 * `deliverydelay` queda afuera por la misma razón que `deferred` en SendGrid:
 * es un reintento en curso, no un fallo, y tratarlo como error llenaría los
 * logs de alarmas que se resuelven solas.
 */
const EVENTOS_DE_FALLO_SES = new Set(['bounce', 'complaint', 'reject', 'rendering failure'])

const TIEMPO_DE_RED_MS = 10000

/**
 * ¿La URL es de SNS de verdad?
 *
 * ESTO ES LO QUE SOSTIENE TODO LO DEMÁS
 *
 * El propio mensaje dice con qué certificado hay que verificarlo. Si se
 * confía en esa URL sin mirarla, cualquiera manda un mensaje con
 * SigningCertURL apuntando a un certificado suyo, lo firma con su clave
 * privada, y la verificación da bien — queda inventando rebotes y quejas de
 * cualquier comercio, con los logs diciendo que vinieron de AWS.
 *
 * Por eso el host se compara contra el de AWS ANTES de ir a buscar nada.
 */
const HOST_DE_SNS = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/

const esUrlDeSns = valor => {
  try {
    const url = new URL(String(valor))

    return url.protocol === 'https:' && HOST_DE_SNS.test(url.hostname)
  } catch {
    return false
  }
}

const buscar = async url => {
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), TIEMPO_DE_RED_MS)

  try {
    return await fetch(url, { signal: control.signal })
  } finally {
    clearTimeout(reloj)
  }
}

// SNS rota su certificado cada tanto, pero no en cada mensaje. Cachearlo
// evita una petición de red por evento, que con miles de tiendas sería una
// por cada rebote. El conjunto de URLs distintas es de un puñado, así que no
// hace falta desalojar nada.
const certificadosDeSns = new Map()

const obtenerCertificadoDeSns = async url => {
  if (certificadosDeSns.has(url)) return certificadosDeSns.get(url)

  const respuesta = await buscar(url)

  if (!respuesta.ok) {
    throw new Error(`El certificado de SNS respondió ${respuesta.status}`)
  }

  const pem = await respuesta.text()

  certificadosDeSns.set(url, pem)

  return pem
}

/**
 * Los campos que AWS firma, en el orden exacto en que los firma.
 *
 * El orden no es estético: la firma se calcula sobre esta secuencia y
 * cualquier otra da un resultado distinto. `Subject` sólo entra si vino.
 */
const CAMPOS_FIRMADOS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
  UnsubscribeConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
}

const cadenaFirmada = mensaje => {
  const campos = CAMPOS_FIRMADOS[mensaje?.Type]

  if (!campos) return null

  return campos
    .filter(campo => mensaje[campo] !== undefined && mensaje[campo] !== null)
    .map(campo => `${campo}\n${mensaje[campo]}\n`)
    .join('')
}

export const verificarFirmaDeSns = async mensaje => {
  if (!esUrlDeSns(mensaje?.SigningCertURL)) {
    logger.error('🔴 SigningCertURL que no es de SNS', { url: mensaje?.SigningCertURL })
    return false
  }

  const cadena = cadenaFirmada(mensaje)

  if (!cadena || !mensaje?.Signature) return false

  // La versión 1 firma con SHA1; la 2, con SHA256. AWS está migrando a la 2,
  // así que hay que aceptar las dos en vez de asumir una.
  const algoritmo = String(mensaje.SignatureVersion) === '2' ? 'sha256' : 'sha1'

  try {
    const certificado = await obtenerCertificadoDeSns(mensaje.SigningCertURL)

    const verificador = crypto.createVerify(algoritmo)
    verificador.update(cadena, 'utf8')
    verificador.end()

    return verificador.verify(certificado, mensaje.Signature, 'base64')
  } catch (error) {
    logger.warn('[SES] No se pudo verificar la firma de SNS', { message: error.message })
    return false
  }
}

/**
 * SNS postea con Content-Type text/plain, así que express.json() no lo parsea
 * y req.body llega vacío. El cuerpo crudo sí está siempre —lo guarda el
 * `verify` de express.json— y de ahí se lee.
 */
const leerMensajeDeSns = req => {
  if (req.rawBody?.length) {
    try {
      return JSON.parse(String(req.rawBody))
    } catch {
      return null
    }
  }

  return req.body && typeof req.body === 'object' ? req.body : null
}

/**
 * POST /api/webhooks/ses/events
 */
export const handleSesEvents = async (req, res) => {
  const mensaje = leerMensajeDeSns(req)

  if (!mensaje?.Type) {
    return sendResponse(res, 400, false, 'Cuerpo ilegible')
  }

  const topicoEsperado = String(process.env.SES_SNS_TOPIC_ARN || '').trim()

  if (!topicoEsperado) {
    // Mismo criterio que el webhook de SendGrid: en producción, sin la
    // configuración que permite distinguir lo propio de lo ajeno, no se
    // procesa nada.
    if (process.env.NODE_ENV === 'production') {
      logger.error('❌ SES_SNS_TOPIC_ARN no configurada en producción')
      return sendResponse(res, 503, false, 'Webhook no configurado')
    }

    logger.warn('⚠️ SES_SNS_TOPIC_ARN sin configurar; no se valida el tópico en desarrollo')
  } else if (mensaje.TopicArn !== topicoEsperado) {
    // Una firma válida de AWS NO alcanza: vale para cualquier tópico de
    // cualquier cuenta de AWS. Sin esta comparación, cualquiera con una
    // cuenta puede mandar eventos firmados de verdad desde un tópico suyo y
    // ensuciar el historial de entrega de los comercios.
    logger.error('🔴 Evento de SNS de un tópico ajeno', { topic: mensaje.TopicArn })
    return sendResponse(res, 401, false, 'Tópico no autorizado')
  }

  if (!(await verificarFirmaDeSns(mensaje))) {
    logger.error('🔴 Webhook de SES con firma inválida', { type: mensaje.Type })
    return sendResponse(res, 401, false, 'Firma inválida')
  }

  if (mensaje.Type === 'SubscriptionConfirmation') {
    // El alta de una suscripción HTTPS se completa visitando esta URL: AWS no
    // la puede dar por confirmada desde su lado, justamente para probar que
    // quien contesta controla el endpoint. Por eso se confirma acá y no a
    // mano.
    if (!esUrlDeSns(mensaje.SubscribeURL)) {
      logger.error('🔴 SubscribeURL que no es de SNS', { url: mensaje.SubscribeURL })
      return sendResponse(res, 400, false, 'SubscribeURL inválida')
    }

    const respuesta = await buscar(mensaje.SubscribeURL).catch(error => {
      logger.error('[SES] No se pudo confirmar la suscripción', { message: error.message })
      return null
    })

    logger.info('[SES] Suscripción de SNS confirmada', {
      topic: mensaje.TopicArn,
      ok: Boolean(respuesta?.ok),
    })

    return res.status(204).end()
  }

  if (mensaje.Type !== 'Notification') return res.status(204).end()

  let evento

  try {
    evento = JSON.parse(mensaje.Message)
  } catch {
    logger.warn('[SES] Notificación con Message ilegible')
    return res.status(204).end()
  }

  // `eventType` lo usa la publicación por conjunto de configuración;
  // `notificationType`, la notificación directa de la identidad. Según cómo
  // esté configurado el destino llega uno u otro.
  const tipo = String(evento?.eventType || evento?.notificationType || '').toLowerCase()

  const datos = {
    evento: tipo,
    to: evento?.mail?.destination?.join(', ') || null,
    // Es el mismo id que se registra al enviar, así que este evento se cruza
    // con aquella línea del log — igual que con SendGrid.
    messageId: evento?.mail?.messageId || null,
    motivo:
      evento?.bounce?.bounceSubType ||
      evento?.complaint?.complaintFeedbackType ||
      evento?.failure?.errorMessage ||
      null,
    tipoRebote: evento?.bounce?.bounceType || null,
  }

  if (EVENTOS_DE_FALLO_SES.has(tipo)) {
    logger.error('📭 Correo NO entregado', datos)
  } else {
    logger.info('📬 Evento de correo', datos)
  }

  return res.status(204).end()
}

export default {
  handleSendgridEvents,
  verifySendgridSignature,
  handleSesEvents,
  verificarFirmaDeSns,
}
