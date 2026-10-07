// 📁 src/services/email/emailProviders.js
//
// Qué servicio pone los correos en la red, detrás de una sola interfaz.
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// Hasta octubre de 2026 SendGrid estaba clavado a fuego en tres lugares: el
// transporte, el alta de dominios por comercio y el webhook de eventos.
// Cambiar de proveedor obligaba a tocar los tres a la vez, y no había forma
// de probar uno nuevo sin romper el que andaba.
//
// El disparador fue que SendGrid eliminó su plan gratuito permanente en mayo
// de 2025: el trial de la cuenta vence el 12/10/2026 y después no sale un
// correo más. Pero el problema de fondo era el acoplamiento, no el
// vencimiento. Ahora el proveedor es la variable EMAIL_PROVIDER y mudarse no
// toca código.
//
// RESTRICCIÓN QUE DESCARTA MEDIO MERCADO
//
// henko-api corre en el plan Free de Render, que bloquea los puertos SMTP
// salientes (25, 465, 587) desde septiembre 2025 — verificado contra la API
// de Render, no asumido. Todo driver de acá habla por HTTPS/443. Un
// proveedor que solo ofrezca SMTP no entra, por bueno que sea.
// Detalle completo en docs/EMAIL_PRODUCTION.md.

import { sanitizeString as limpiar } from './emailShared.js'

const TIMEOUT_MS = 15000

// =====================================================
// ERRORES NORMALIZADOS
// =====================================================
//
// Cada proveedor informa sus fallas a su manera: SendGrid con un status HTTP,
// SES con el nombre de una excepción del SDK. Río arriba nada de eso importa;
// lo único que hay que decidir es si tiene sentido reintentar. Por eso los
// códigos son del sistema y no del proveedor — así el bucle de reintentos no
// tiene que aprender el vocabulario de cada uno.

export const CODIGOS = {
  SIN_CONFIGURAR: 'EMAIL_PROVIDER_NOT_CONFIGURED',
  AUTENTICACION: 'EMAIL_AUTH_FAILED',
  PEDIDO_INVALIDO: 'EMAIL_REQUEST_INVALID',
  LIMITE_DE_TASA: 'EMAIL_RATE_LIMITED',
  PROVEEDOR_CAIDO: 'EMAIL_PROVIDER_UNAVAILABLE',
  TIEMPO_AGOTADO: 'EMAIL_TIMEOUT',
  ENVIO_PAUSADO: 'EMAIL_SENDING_PAUSED',
  ADJUNTOS_NO_SOPORTADOS: 'EMAIL_ATTACHMENTS_NOT_SUPPORTED',
}

// Reintentar sirve cuando la causa es pasajera. Con una key inválida o un
// pedido mal armado, tres intentos son tres fallas idénticas y catorce
// segundos perdidos adentro de una petición que un usuario está esperando.
const NO_REINTENTABLES = new Set([
  CODIGOS.SIN_CONFIGURAR,
  CODIGOS.AUTENTICACION,
  CODIGOS.PEDIDO_INVALIDO,
  CODIGOS.ENVIO_PAUSADO,
  CODIGOS.ADJUNTOS_NO_SOPORTADOS,
])

export const esReintentable = codigo => !NO_REINTENTABLES.has(codigo)

const fallar = (codigo, mensaje, extra = {}) => {
  const error = new Error(mensaje)
  error.code = codigo
  return Object.assign(error, extra)
}

/**
 * De un status HTTP al código del sistema.
 *
 * POR QUÉ IMPORTA CLASIFICAR BIEN
 *
 * La versión anterior mandaba todo lo que no fuera 401/403 al mismo cajón de
 * "pedido inválido", que es no-reintentable. O sea que un 429 (pediste de
 * más, esperá) y un 503 (estoy caído, volvé) abortaban en el primer intento
 * — justo los dos casos donde reintentar es lo único que hay que hacer. El
 * bucle de reintentos existía, pero no se usaba para aquello que sirve.
 */
const clasificarStatus = status => {
  if (status === 401 || status === 403) return CODIGOS.AUTENTICACION
  if (status === 408 || status === 429) return CODIGOS.LIMITE_DE_TASA
  if (status >= 500) return CODIGOS.PROVEEDOR_CAIDO

  return CODIGOS.PEDIDO_INVALIDO
}

const pedir = async (url, opciones) => {
  // Sin timeout, una respuesta que nunca llega deja la promesa colgada para
  // siempre en vez de fallar y dejar reintentar — es exactamente lo que pasó
  // probando SMTP contra el plan Free de Render antes de migrar a HTTPS.
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), TIMEOUT_MS)

  try {
    return await fetch(url, { ...opciones, signal: control.signal })
  } catch (error) {
    if (error.name === 'AbortError') {
      throw fallar(CODIGOS.TIEMPO_AGOTADO, `El proveedor no respondió en ${TIMEOUT_MS}ms`)
    }

    // Red caída, DNS que no resuelve, TLS roto: nada de eso lo arregla
    // cambiar el pedido, pero sí puede arreglarse solo en un segundo.
    throw fallar(CODIGOS.PROVEEDOR_CAIDO, error.message)
  } finally {
    clearTimeout(reloj)
  }
}

// El remitente llega armado como 'Nombre <mail>' (o solo 'mail') porque así
// lo arma getFromAddress. SendGrid en cambio pide {email, name} separados.
const separarRemitente = crudo => {
  const texto = limpiar(crudo)
  const coincidencia = /^(.*)<([^>]+)>\s*$/.exec(texto)

  if (!coincidencia) return { email: texto }

  const nombre = coincidencia[1].trim().replace(/^"|"$/g, '')

  return { email: coincidencia[2].trim(), name: nombre || undefined }
}

// =====================================================
// DRIVERS
// =====================================================

const sendgrid = {
  nombre: 'SendGrid',

  // EMAIL_PASS ya sirve como API key; SENDGRID_API_KEY solo hace falta para
  // separar una key de solo-envío de una con permiso de administrar dominios.
  clave: () => limpiar(process.env.SENDGRID_API_KEY) || limpiar(process.env.EMAIL_PASS),

  estaConfigurado() {
    return Boolean(this.clave())
  },

  async enviar(correo) {
    const clave = this.clave()

    if (!clave) {
      throw fallar(CODIGOS.SIN_CONFIGURAR, 'Falta SENDGRID_API_KEY (o EMAIL_PASS)')
    }

    const { email, name } = separarRemitente(correo.from)

    const contenido = [
      correo.text ? { type: 'text/plain', value: correo.text } : null,
      correo.html ? { type: 'text/html', value: correo.html } : null,
    ].filter(Boolean)

    const respuesta = await pedir('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: correo.to }] }],
        from: { email, ...(name ? { name } : {}) },
        ...(correo.replyTo ? { reply_to: { email: correo.replyTo } } : {}),
        subject: correo.subject,
        content: contenido,
      }),
    })

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => '')

      throw fallar(
        clasificarStatus(respuesta.status),
        `SendGrid rechazó el envío (${respuesta.status}): ${cuerpo.slice(0, 500)}`,
        { statusCode: respuesta.status },
      )
    }

    return { messageId: respuesta.headers.get('x-message-id') || null }
  },
}

const resend = {
  nombre: 'Resend',

  clave: () => limpiar(process.env.RESEND_API_KEY),

  estaConfigurado() {
    return Boolean(this.clave())
  },

  async enviar(correo) {
    const clave = this.clave()

    if (!clave) {
      throw fallar(CODIGOS.SIN_CONFIGURAR, 'Falta RESEND_API_KEY')
    }

    const respuesta = await pedir('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Resend acepta 'Nombre <mail>' tal cual, sin separar.
        from: correo.from,
        to: [correo.to],
        subject: correo.subject,
        ...(correo.html ? { html: correo.html } : {}),
        ...(correo.text ? { text: correo.text } : {}),
        ...(correo.replyTo ? { reply_to: correo.replyTo } : {}),
      }),
    })

    const datos = await respuesta.json().catch(() => null)

    if (!respuesta.ok) {
      throw fallar(
        clasificarStatus(respuesta.status),
        `Resend rechazó el envío (${respuesta.status}): ${limpiar(datos?.message) || 'sin detalle'}`,
        { statusCode: respuesta.status },
      )
    }

    return { messageId: limpiar(datos?.id) || null }
  },
}

// ─── Amazon SES ──────────────────────────────────────────

// El nombre de la excepción del SDK es el dato más confiable que da AWS para
// clasificar: el status HTTP de varias de estas es 400 y mezclarlas sería
// reintentar lo que no se arregla, o rendirse con lo que sí.
const ERRORES_DE_SES = {
  AccountSuspendedException: CODIGOS.ENVIO_PAUSADO,
  SendingPausedException: CODIGOS.ENVIO_PAUSADO,
  TooManyRequestsException: CODIGOS.LIMITE_DE_TASA,
  ThrottlingException: CODIGOS.LIMITE_DE_TASA,
  MessageRejected: CODIGOS.PEDIDO_INVALIDO,
  BadRequestException: CODIGOS.PEDIDO_INVALIDO,
  NotFoundException: CODIGOS.PEDIDO_INVALIDO,
  UnrecognizedClientException: CODIGOS.AUTENTICACION,
  InvalidClientTokenId: CODIGOS.AUTENTICACION,
  InvalidSignatureException: CODIGOS.AUTENTICACION,
  AccessDeniedException: CODIGOS.AUTENTICACION,
}

let clienteSes = null

/**
 * El cliente de AWS se carga sólo cuando SES es el proveedor activo.
 *
 * POR QUÉ UNA DEPENDENCIA ACÁ Y NO fetch COMO LOS OTROS DOS
 *
 * SES exige firma SigV4. Hacerla a mano es la clase de cosa que falla en
 * producción con un "signature does not match" indescifrable, y el costo de
 * equivocarse es que no sale ni un correo. Para firmar criptográficamente
 * conviene el cliente que mantiene el propio proveedor.
 *
 * El import dinámico evita que la paguen en el arranque los despliegues que
 * no usan SES, y que un `npm install` incompleto voltee el proceso entero
 * por una dependencia que nadie iba a tocar.
 */
const obtenerClienteSes = async () => {
  if (clienteSes) return clienteSes

  const { SESv2Client } = await import('@aws-sdk/client-sesv2')

  clienteSes = new SESv2Client({
    region: limpiar(process.env.AWS_REGION) || 'us-east-1',
    credentials: {
      accessKeyId: limpiar(process.env.AWS_ACCESS_KEY_ID),
      secretAccessKey: limpiar(process.env.AWS_SECRET_ACCESS_KEY),
    },

    // Los reintentos los maneja sendWithRetry río arriba, con su propia
    // espera creciente y su propio registro. Dejar activos los dos niveles
    // los multiplica (3 × 3 = 9 intentos) y estira una falla a casi un
    // minuto adentro de una petición de usuario.
    maxAttempts: 1,
  })

  return clienteSes
}

const ses = {
  nombre: 'Amazon SES',

  estaConfigurado: () =>
    Boolean(limpiar(process.env.AWS_ACCESS_KEY_ID) && limpiar(process.env.AWS_SECRET_ACCESS_KEY)),

  async enviar(correo) {
    if (!this.estaConfigurado()) {
      throw fallar(CODIGOS.SIN_CONFIGURAR, 'Faltan AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY')
    }

    const cliente = await obtenerClienteSes()
    const { SendEmailCommand } = await import('@aws-sdk/client-sesv2')

    const cuerpo = {}
    if (correo.text) cuerpo.Text = { Data: correo.text, Charset: 'UTF-8' }
    if (correo.html) cuerpo.Html = { Data: correo.html, Charset: 'UTF-8' }

    const conjunto = limpiar(process.env.SES_CONFIGURATION_SET)

    try {
      const salida = await cliente.send(
        new SendEmailCommand({
          FromEmailAddress: correo.from,
          Destination: { ToAddresses: [correo.to] },
          ...(correo.replyTo ? { ReplyToAddresses: [correo.replyTo] } : {}),
          Content: {
            Simple: {
              Subject: { Data: correo.subject, Charset: 'UTF-8' },
              Body: cuerpo,
            },
          },
          ...(conjunto ? { ConfigurationSetName: conjunto } : {}),

          // El inquilino llega desde arriba cuando el comercio ya tiene su
          // identidad propia en SES. Sin esto todos los comercios comparten
          // una sola reputación, y la lista sucia de uno pausa a todos.
          ...(correo.tenantName ? { TenantName: correo.tenantName } : {}),
        }),
      )

      return { messageId: limpiar(salida?.MessageId) || null }
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode

      // Sin status no hubo respuesta de AWS: se cortó antes. Eso es
      // transporte, y el transporte se reintenta.
      const codigo =
        ERRORES_DE_SES[error?.name] || (status ? clasificarStatus(status) : CODIGOS.PROVEEDOR_CAIDO)

      throw fallar(
        codigo,
        `Amazon SES rechazó el envío (${error?.name || 'sin nombre'}): ${error?.message || ''}`,
        { statusCode: status },
      )
    }
  },
}

// =====================================================
// SELECCIÓN
// =====================================================

const PROVEEDORES = { sendgrid, resend, ses }

export const NOMBRES_DE_PROVEEDOR = Object.keys(PROVEEDORES)

// SendGrid sigue siendo el valor por omisión mientras su trial dure: así
// nada cambia de comportamiento hasta que alguien ponga EMAIL_PROVIDER a
// propósito. Cuando la mudanza a SES esté terminada, este valor pasa a 'ses'
// y SendGrid queda disponible sólo para volver atrás.
const POR_OMISION = 'sendgrid'

export const proveedorActivo = () => {
  const pedido = limpiar(process.env.EMAIL_PROVIDER).toLowerCase() || POR_OMISION
  const proveedor = PROVEEDORES[pedido]

  if (!proveedor) {
    throw fallar(
      CODIGOS.SIN_CONFIGURAR,
      `EMAIL_PROVIDER="${pedido}" no es un proveedor conocido. Opciones: ${NOMBRES_DE_PROVEEDOR.join(', ')}`,
    )
  }

  return proveedor
}

/**
 * Manda un correo por el proveedor activo.
 *
 * Devuelve {messageId, proveedor}. Lanza un Error con `code` de CODIGOS, que
 * es lo único que quien llama necesita mirar para decidir si reintenta.
 */
export const enviarConProveedor = async correo => {
  const proveedor = proveedorActivo()

  if (Array.isArray(correo.attachments) && correo.attachments.length > 0) {
    // Antes se aceptaban y se descartaban sin decir nada: quien llamaba se
    // quedaba creyendo que el adjunto había salido. Ningún driver los
    // implementa todavía, así que se dice en voz alta en vez de mentir.
    throw fallar(
      CODIGOS.ADJUNTOS_NO_SOPORTADOS,
      `El envío con adjuntos todavía no está implementado para ${proveedor.nombre}`,
    )
  }

  const resultado = await proveedor.enviar(correo)

  return { ...resultado, proveedor: proveedor.nombre }
}

export default {
  CODIGOS,
  esReintentable,
  proveedorActivo,
  enviarConProveedor,
  NOMBRES_DE_PROVEEDOR,
}
