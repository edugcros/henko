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

// EMAIL_PASS ya sirve como API key; SENDGRID_API_KEY solo hace falta para
// separar una key de solo-envío de una con permiso de administrar dominios.
const claveDeSendGrid = () =>
  limpiar(process.env.SENDGRID_API_KEY) || limpiar(process.env.EMAIL_PASS)

const SENDGRID_API = 'https://api.sendgrid.com/v3'

const pedirASendGrid = async (ruta, { method = 'GET', body } = {}) => {
  const clave = claveDeSendGrid()

  if (!clave) {
    throw fallar(CODIGOS.SIN_CONFIGURAR, 'No hay API key de SendGrid configurada')
  }

  const respuesta = await pedir(`${SENDGRID_API}${ruta}`, {
    method,
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

  const datos = await respuesta.json().catch(() => null)

  if (!respuesta.ok) {
    // SendGrid controla permisos por scope de API key, no con un código de
    // error dedicado: un 401/403 acá casi siempre significa que la key no
    // tiene habilitado el scope de Domain Authentication, no que esté mal.
    throw fallar(
      clasificarStatus(respuesta.status),
      datos?.errors?.[0]?.message || datos?.message || `SendGrid respondió ${respuesta.status}`,
      { statusCode: respuesta.status },
    )
  }

  return datos
}

// El DNS de SendGrid llega como objeto {mail_cname, dkim1, dkim2, ...}, no
// como arreglo — cada clave es un registro con {type, host, data}.
const normalizarDnsDeSendGrid = dns => {
  if (!dns || typeof dns !== 'object') return []

  return Object.entries(dns).map(([clave, registro]) => ({
    record: clave,
    name: limpiar(registro?.host),
    type: limpiar(registro?.type) || 'CNAME',
    value: limpiar(registro?.data),
    priority: null,
  }))
}

// SendGrid no expone un estado terminal de "falló": un dominio queda
// pendiente indefinidamente hasta que el DNS esté bien. Por eso acá sólo hay
// dos estados posibles, a diferencia de SES.
const estadoDeSendGrid = valido => (valido ? 'verified' : 'pending')

const esDominioDuplicado = error =>
  /already exists|already authenticated|duplicate|conflict/i.test(String(error?.message || '')) ||
  error?.statusCode === 409

const buscarIdDeDominioEnSendGrid = async dominio => {
  const lista = await pedirASendGrid('/whitelabel/domains')

  const encontrado = Array.isArray(lista)
    ? lista.find(item => limpiar(item?.domain).toLowerCase() === dominio)
    : null

  return limpiar(encontrado?.id)
}

const sendgrid = {
  id: 'sendgrid',
  nombre: 'SendGrid',

  clave: claveDeSendGrid,

  estaConfigurado() {
    return Boolean(this.clave())
  },

  dominios: {
    soportado: true,

    async alta(dominio) {
      try {
        const creado = await pedirASendGrid('/whitelabel/domains', {
          method: 'POST',
          body: {
            domain: dominio,

            // CNAME en vez de TXT+MX: la variante MX reemplaza el registro MX
            // del dominio, lo que le robaría al comercio su correo ENTRANTE
            // real. La variante CNAME convive con cualquier MX que ya tenga.
            automatic_security: true,
          },
        })

        return {
          id: limpiar(creado?.id),
          dns: normalizarDnsDeSendGrid(creado?.dns),
          status: estadoDeSendGrid(creado?.valid),
        }
      } catch (error) {
        // Un dominio dado de alta antes no es un fallo: se resuelve
        // consultando el estado, que trae los mismos registros.
        if (!esDominioDuplicado(error)) throw error

        return this.estado({ dominio })
      }
    },

    async estado({ id, dominio }) {
      const identificador = id || (await buscarIdDeDominioEnSendGrid(dominio))

      if (!identificador) return null

      // GET devuelve el último estado conocido; validate fuerza una consulta
      // fresca de DNS, que es justo lo que un refresh necesita. Los valores
      // de los registros no cambian una vez asignados, así que no hace falta
      // pedirlos de nuevo — se conserva lo ya guardado.
      const validado = await pedirASendGrid(`/whitelabel/domains/${identificador}/validate`, {
        method: 'POST',
      })

      return {
        id: identificador,
        dns: null,
        status: estadoDeSendGrid(validado?.valid),
      }
    },
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
  id: 'resend',
  nombre: 'Resend',

  clave: () => limpiar(process.env.RESEND_API_KEY),

  estaConfigurado() {
    return Boolean(this.clave())
  },

  // Resend existe acá como PUENTE: cubre el envío desde el dominio de la
  // plataforma si SES todavía no salió del sandbox, no como destino.
  //
  // No administra dominios de comercios a propósito, no por falta de API.
  // Dar de alta el dominio de un comercio durante un puente de tres días
  // sería hacerle publicar unos registros DNS que habría que reemplazar por
  // los de SES al terminar: trabajo tirado y una verificación que se cae
  // sola. Mejor que el panel diga que no se puede ahora.
  dominios: { soportado: false },

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

/**
 * Traduce una excepción del SDK al vocabulario del sistema.
 *
 * Lo usan el envío y la gestión de dominios: una credencial sin permisos o
 * un throttling se ven igual en los dos caminos, y conviene que se informen
 * igual.
 */
const traducirErrorDeSes = (error, queHacia) => {
  const status = error?.$metadata?.httpStatusCode

  // Sin status no hubo respuesta de AWS: se cortó antes de llegar. Eso es
  // transporte, y el transporte se reintenta.
  const codigo =
    ERRORES_DE_SES[error?.name] || (status ? clasificarStatus(status) : CODIGOS.PROVEEDOR_CAIDO)

  return fallar(
    codigo,
    `Amazon SES rechazó ${queHacia} (${error?.name || 'sin nombre'}): ${error?.message || ''}`,
    { statusCode: status },
  )
}

const regionDeSes = () => limpiar(process.env.AWS_REGION) || 'us-east-1'

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
    region: regionDeSes(),
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

/**
 * El ARN de un recurso de SES, armado a mano.
 *
 * CreateEmailIdentity no devuelve el ARN y CreateTenantResourceAssociation
 * lo exige, así que no hay forma de evitarlo. El número de cuenta tampoco se
 * deduce de las credenciales sin pedírselo a STS —otra dependencia, otra
 * llamada— así que se configura y se valida acá: doce dígitos mal puestos se
 * manifestarían como un "no existe ese recurso" que no señala a la variable.
 */
const arnDeSes = (tipo, nombre) => {
  const cuenta = limpiar(process.env.AWS_ACCOUNT_ID)

  if (!/^\d{12}$/.test(cuenta)) {
    throw fallar(
      CODIGOS.SIN_CONFIGURAR,
      'AWS_ACCOUNT_ID tiene que ser el número de cuenta de AWS (12 dígitos): sin eso no se ' +
        'puede armar el ARN que pide asociar una identidad a un inquilino',
    )
  }

  return `arn:aws:ses:${regionDeSes()}:${cuenta}:${tipo}/${nombre}`
}

/**
 * Los tres CNAME de Easy DKIM.
 *
 * Son los únicos registros que SES pide para un dominio de envío, y ninguno
 * toca el MX: el correo ENTRANTE del comercio sigue funcionando igual. Es la
 * misma razón por la que en SendGrid se usa automatic_security.
 */
const dnsDeDkim = (dominio, tokens) =>
  (tokens || []).map(token => ({
    record: `dkim_${String(token).slice(0, 8)}`,
    name: `${token}._domainkey.${dominio}`,
    type: 'CNAME',
    value: `${token}.dkim.amazonses.com`,
    priority: null,
  }))

/**
 * El estado de verificación, traducido al del modelo.
 *
 * `VerifiedForSendingStatus` es la respuesta autorizada a "¿puede enviar?",
 * así que manda sobre el estado de DKIM.
 *
 * A diferencia de SendGrid, SES SÍ tiene un estado terminal: cuando DKIM
 * queda en FAILED dejó de reintentar, y el comercio tiene que corregir el
 * DNS y volver a empezar. Informar eso como "pendiente" lo dejaría esperando
 * algo que no va a pasar nunca.
 */
const estadoDeSes = ({ verificado, dkim }) => {
  if (verificado) return 'verified'
  if (dkim === 'FAILED') return 'failed'

  return 'pending'
}

/**
 * Lee el estado de una identidad en SES.
 *
 * Devuelve null si no existe, que es distinto de "existe y todavía no
 * verificó": lo primero significa que el alta nunca llegó y hay que
 * rehacerla; lo segundo, que falta publicar el DNS.
 */
const leerIdentidadDeSes = async dominio => {
  const { GetEmailIdentityCommand } = await import('@aws-sdk/client-sesv2')
  const cliente = await obtenerClienteSes()

  try {
    const salida = await cliente.send(new GetEmailIdentityCommand({ EmailIdentity: dominio }))

    return {
      verificado: salida?.VerifiedForSendingStatus === true,
      estado: salida?.DkimAttributes?.Status,
      tokens: salida?.DkimAttributes?.Tokens,
    }
  } catch (error) {
    if (error?.name === 'NotFoundException') return null

    throw traducirErrorDeSes(error, 'la consulta del dominio')
  }
}

/**
 * Deja listo el inquilino de SES para un comercio: lo crea si no está y le
 * asocia los recursos que va a usar.
 *
 * POR QUÉ IMPORTA
 *
 * Sin inquilino, la reputación de envío se mide por CUENTA. O sea que una
 * tienda que importa una lista comprada y rebota el 40% no se hunde sola:
 * hunde el envío de todas las demás, incluidas las confirmaciones de compra
 * de comercios que no hicieron nada. Con inquilino, SES pausa a esa sola.
 *
 * Es idempotente a propósito: registrar de nuevo el mismo dominio, o
 * refrescar su estado, pasan por acá.
 */
const asegurarInquilinoEnSes = async (inquilino, dominio) => {
  const { CreateTenantCommand, CreateTenantResourceAssociationCommand } =
    await import('@aws-sdk/client-sesv2')

  const cliente = await obtenerClienteSes()

  const salvoSiYaExiste = async operacion => {
    try {
      await operacion()
    } catch (error) {
      if (error?.name !== 'AlreadyExistsException') throw traducirErrorDeSes(error, 'el alta')
    }
  }

  await salvoSiYaExiste(() =>
    cliente.send(
      new CreateTenantCommand({
        TenantName: inquilino,

        // Lista de supresión propia. Con la de la cuenta —que es el valor
        // por omisión— un comprador que marca spam a UNA tienda queda
        // bloqueado para TODAS, y la de al lado deja de poder mandarle la
        // confirmación de su compra sin haber hecho nada.
        SuppressionAttributes: {
          SuppressionScope: 'TENANT',
          SuppressedReasons: ['BOUNCE', 'COMPLAINT'],
        },
      }),
    ),
  )

  await salvoSiYaExiste(() =>
    cliente.send(
      new CreateTenantResourceAssociationCommand({
        TenantName: inquilino,
        ResourceArn: arnDeSes('identity', dominio),
      }),
    ),
  )

  const conjunto = limpiar(process.env.SES_CONFIGURATION_SET)

  // SES exige un configuration set asociado al inquilino para poder enviar
  // en su nombre. Sin él el alta queda a medias y el primer envío falla con
  // un error que no menciona esto.
  if (conjunto) {
    await salvoSiYaExiste(() =>
      cliente.send(
        new CreateTenantResourceAssociationCommand({
          TenantName: inquilino,
          ResourceArn: arnDeSes('configuration-set', conjunto),
        }),
      ),
    )
  }
}

const ses = {
  id: 'ses',
  nombre: 'Amazon SES',

  estaConfigurado: () =>
    Boolean(limpiar(process.env.AWS_ACCESS_KEY_ID) && limpiar(process.env.AWS_SECRET_ACCESS_KEY)),

  dominios: {
    soportado: true,

    async alta(dominio, { inquilino } = {}) {
      const { CreateEmailIdentityCommand } = await import('@aws-sdk/client-sesv2')
      const cliente = await obtenerClienteSes()

      let dkim

      try {
        const creada = await cliente.send(
          new CreateEmailIdentityCommand({
            EmailIdentity: dominio,

            // Easy DKIM con clave de 2048 bits: más fuerte que la de 1024
            // que viene por omisión, y publicada igual con tres CNAME.
            DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048' },
          }),
        )

        dkim = {
          verificado: creada?.VerifiedForSendingStatus === true,
          estado: creada?.DkimAttributes?.Status,
          tokens: creada?.DkimAttributes?.Tokens,
        }
      } catch (error) {
        if (error?.name !== 'AlreadyExistsException') {
          throw traducirErrorDeSes(error, 'el alta del dominio')
        }

        // La identidad ya existía —otro intento, o un alta hecha a mano en
        // la consola—. Pedir su estado trae los mismos tokens, así que el
        // comercio ve los registros de siempre y no unos nuevos.
        dkim = await leerIdentidadDeSes(dominio)
      }

      if (inquilino) await asegurarInquilinoEnSes(inquilino, dominio)

      return {
        // SES no da un id aparte: la identidad SE LLAMA como el dominio, y
        // eso es lo que después pide GetEmailIdentity.
        id: dominio,
        dns: dnsDeDkim(dominio, dkim?.tokens),
        status: estadoDeSes({ verificado: dkim?.verificado, dkim: dkim?.estado }),
      }
    },

    async estado({ dominio, inquilino }) {
      const identidad = await leerIdentidadDeSes(dominio)

      if (!identidad) return null

      // Quien refresca puede ser un comercio dado de alta antes de que
      // existieran los inquilinos. Asegurarlo acá lo pone al día sin pedirle
      // que borre y vuelva a registrar el dominio.
      if (inquilino) await asegurarInquilinoEnSes(inquilino, dominio)

      return {
        id: dominio,

        // Los tokens no cambian una vez asignados, pero devolverlos cuesta
        // lo mismo y cubre el caso del comercio que perdió los registros.
        dns: dnsDeDkim(dominio, identidad.tokens),
        status: estadoDeSes({ verificado: identidad.verificado, dkim: identidad.estado }),
      }
    },
  },

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
      throw traducirErrorDeSes(error, 'el envío')
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

/**
 * La gestión de dominios del proveedor activo.
 *
 * Devuelve siempre un objeto con `soportado`, así que quien llama pregunta
 * en vez de adivinar: no todos los proveedores dan de alta dominios de
 * terceros, y el que no puede tiene que decirlo antes de que un comercio
 * publique registros DNS al pedo.
 */
export const dominiosDelProveedor = () => {
  const proveedor = proveedorActivo()

  return {
    proveedor: proveedor.nombre,
    id: proveedor.id,
    ...(proveedor.dominios || { soportado: false }),
  }
}

export default {
  CODIGOS,
  esReintentable,
  proveedorActivo,
  enviarConProveedor,
  dominiosDelProveedor,
  NOMBRES_DE_PROVEEDOR,
}
