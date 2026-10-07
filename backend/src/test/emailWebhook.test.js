// 📁 src/test/emailWebhook.test.js
//
// Qué pasó DESPUÉS de que el proveedor aceptó el correo.
//
// EL CASO QUE LO ORIGINÓ
//
// El envío registra el correo como bueno cuando la API contesta que sí, y eso
// solo significa "lo recibí". Medido en producción el 18/09/2026: un correo
// figuraba en los logs con "✅ Email enviado correctamente" y en el panel de
// SendGrid estaba en `Dropped` — la dirección estaba en su lista de supresión
// por rebotes anteriores.
//
// Sin estos eventos, un cliente que no recibe su correo de verificación es
// indistinguible de uno que sí lo recibió.

import { jest } from '@jest/globals'
import crypto from 'node:crypto'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')

const errores = []
const infos = []

jest.unstable_mockModule('../../config/logger.js', () => ({
  default: {
    info: (msg, datos) => infos.push({ msg, datos }),
    warn: jest.fn(),
    error: (msg, datos) => errores.push({ msg, datos }),
    debug: jest.fn(),
  },
}))

const { handleSendgridEvents, verifySendgridSignature, handleSesEvents } =
  await import('../controller/emailWebhookCtrl.js')
const config = await import('../config/subscriptionConfig.js')

// Par de claves ECDSA propio: firmar de verdad es la única forma de saber que
// la verificación acepta lo legítimo y no solo que rechaza lo inválido.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
})

const clavePublicaBase64 = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
  .replace(/\s/g, '')

const firmar = (timestamp, cuerpo) => {
  const firmador = crypto.createSign('sha256')
  firmador.update(timestamp)
  firmador.update(cuerpo)
  firmador.end()

  return firmador.sign(privateKey, 'base64')
}

const armarPeticion = (eventos, { timestamp, romperFirma = false } = {}) => {
  const cuerpo = JSON.stringify(eventos)
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000))
  const firma = romperFirma ? 'firma-falsa' : firmar(ts, cuerpo)

  return {
    headers: {
      'x-twilio-email-event-webhook-signature': firma,
      'x-twilio-email-event-webhook-timestamp': ts,
    },
    rawBody: Buffer.from(cuerpo),
    body: eventos,
  }
}

const armarRespuesta = () => {
  const res = { statusCode: null, cuerpo: null }

  res.status = code => {
    res.statusCode = code
    return res
  }
  res.json = data => {
    res.cuerpo = data
    return res
  }
  res.end = () => res

  return res
}

beforeEach(() => {
  errores.length = 0
  infos.length = 0
  process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = clavePublicaBase64
  process.env.NODE_ENV = 'test'
})

describe('eventos de entrega de SendGrid · firma', () => {
  test('una firma válida se acepta', async () => {
    const req = armarPeticion([{ event: 'delivered', email: 'ana@ejemplo.com' }])
    const res = armarRespuesta()

    await handleSendgridEvents(req, res)

    expect(res.statusCode).toBe(204)
  })

  test('una firma inválida devuelve 401 y no procesa nada', async () => {
    // Sin esto, cualquiera puede inventar rebotes y ensuciar el diagnóstico —
    // o peor, tapar uno real entre ruido.
    const req = armarPeticion([{ event: 'bounce', email: 'ana@ejemplo.com' }], {
      romperFirma: true,
    })
    const res = armarRespuesta()

    await handleSendgridEvents(req, res)

    expect(res.statusCode).toBe(401)
    expect(errores.some(e => /firma inválida/i.test(e.msg))).toBe(true)
  })

  test('un evento viejo se rechaza aunque la firma sea válida', async () => {
    // La firma de un lote legítimo sigue siendo válida para siempre: sin
    // ventana de tiempo, alguien que la capture puede reenviarla cuando quiera.
    const hace2Horas = String(Math.floor(Date.now() / 1000) - 7200)
    const req = armarPeticion([{ event: 'delivered' }], { timestamp: hace2Horas })
    const res = armarRespuesta()

    await handleSendgridEvents(req, res)

    expect(res.statusCode).toBe(401)
  })

  test('sin cuerpo crudo no se puede verificar', async () => {
    // La firma se calcula sobre los bytes exactos; JSON.stringify del objeto ya
    // parseado no los reproduce. Si req.rawBody faltara, verificar contra el
    // objeto daría un falso negativo permanente y los eventos se perderían.
    const req = armarPeticion([{ event: 'delivered' }])
    delete req.rawBody

    expect(verifySendgridSignature(req)).toBe(false)
  })
})

describe('eventos de entrega de SendGrid · qué se registra', () => {
  test('un rebote queda como ERROR, no como info', async () => {
    // ESTE ES EL PUNTO. Si un correo no llegó, tiene que verse distinto de uno
    // que sí llegó — si no, volvemos al estado donde todo parecía bien.
    const req = armarPeticion([
      {
        event: 'bounce',
        email: 'nadie@ejemplo.com',
        reason: '550 unknown recipient',
        sg_message_id: 'abc123.filter0001',
        type: 'blocked',
      },
    ])

    await handleSendgridEvents(req, armarRespuesta())

    expect(errores).toHaveLength(1)
    expect(errores[0].msg).toMatch(/NO entregado/i)
    expect(errores[0].datos).toMatchObject({
      evento: 'bounce',
      to: 'nadie@ejemplo.com',
      motivo: '550 unknown recipient',
    })
  })

  test('dropped y spamreport también son fallos', async () => {
    // dropped es el que se midió en producción: la dirección estaba en la
    // lista de supresión y el correo se descartó sin intentar la entrega.
    const req = armarPeticion([
      { event: 'dropped', email: 'a@ejemplo.com', reason: 'Bounced Address' },
      { event: 'spamreport', email: 'b@ejemplo.com' },
    ])

    await handleSendgridEvents(req, armarRespuesta())

    expect(errores).toHaveLength(2)
  })

  test('deferred NO es un fallo', async () => {
    // Es un reintento en curso. Tratarlo como error llenaría los logs de
    // alarmas que se resuelven solas, y el ruido esconde los rebotes reales.
    const req = armarPeticion([{ event: 'deferred', email: 'a@ejemplo.com' }])

    await handleSendgridEvents(req, armarRespuesta())

    expect(errores).toHaveLength(0)
    expect(infos).toHaveLength(1)
  })

  test('el messageId se puede cruzar con el del envío', async () => {
    // sg_message_id trae un sufijo de enrutamiento; la parte anterior al punto
    // es la que ya quedó registrada al enviar. Sin recortarla, no hay forma de
    // unir "lo mandamos" con "no llegó".
    const req = armarPeticion([
      { event: 'bounce', email: 'a@ejemplo.com', sg_message_id: 'MSG-42.recvd-xyz.0' },
    ])

    await handleSendgridEvents(req, armarRespuesta())

    expect(errores[0].datos.messageId).toBe('MSG-42')
  })

  test('un lote con muchos eventos se procesa entero', async () => {
    // SendGrid agrupa. Cortar en el primero perdería el resto del lote.
    const req = armarPeticion([
      { event: 'delivered', email: 'a@ejemplo.com' },
      { event: 'bounce', email: 'b@ejemplo.com' },
      { event: 'delivered', email: 'c@ejemplo.com' },
    ])

    await handleSendgridEvents(req, armarRespuesta())

    expect(errores).toHaveLength(1)
    expect(infos).toHaveLength(2)
  })
})

describe('eventos de entrega de SendGrid · la ruta llega al controlador', () => {
  test('está exenta de CSRF', async () => {
    // Ya pasó dos veces hoy: una ruta de webhook sin exención devuelve 403
    // ANTES del controlador, y todo lo que este archivo prueba no se ejecuta
    // nunca en producción.
    const { csrfExemptRoutes } = await import('../middlewares/csrfMiddleware.js')

    const exenta = csrfExemptRoutes.some(
      ruta => ruta.method === 'POST' && ruta.path.endsWith(config.SENDGRID_WEBHOOK_PATH),
    )

    expect(exenta).toBe(true)
  })

  test('la ruta registrada es la misma que se declara', async () => {
    const { default: webhookRoutes } = await import('../routes/webhookRoutes.js')

    const rutas = webhookRoutes.stack.filter(capa => capa.route).map(capa => capa.route.path)

    expect(rutas).toContain(config.SENDGRID_WEBHOOK_ROUTE)
  })
})

// =====================================================
// Amazon SES, por SNS
// =====================================================
//
// SES no postea a un endpoint: publica en un tópico de SNS y SNS lo reenvía.
// Eso trae dos cosas que SendGrid no tiene, y las dos se prueban acá: el
// apretón de manos que da de alta la suscripción, y una firma que se valida
// contra un certificado que el PROPIO MENSAJE dice dónde buscar.
//
// Ese último detalle es el que hace que esto valga la pena probar de verdad:
// si no se mira de dónde viene el certificado, cualquiera firma lo que quiera
// con su clave y la verificación da bien.

const TOPICO = 'arn:aws:sns:us-east-1:123456789012:henko-email-events'

// Certificado autofirmado propio: firmar de verdad es la única forma de saber
// que la verificación acepta lo legítimo, no sólo que rechaza lo inválido.
const claveDeSns = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })

// SNS sirve un certificado X.509 y acá se usa la clave pública pelada.
//
// No es un atajo que deje un hueco: crypto.createVerify().verify() acepta las
// dos formas y toma el mismo camino. Medido el 06/10/2026 con un certificado
// autofirmado de verdad — certificado PEM, X509Certificate.publicKey y clave
// pelada verifican las tres la misma firma.
//
// Se usa la clave porque Node no genera certificados X.509 sin ayuda, y
// depender de openssl haría que esta prueba pase o falle según la máquina.
const certificadoDeSns = claveDeSns.publicKey.export({ type: 'spki', format: 'pem' }).toString()

const CAMPOS_FIRMADOS_SNS = {
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
}

const firmarMensajeDeSns = mensaje => {
  const cadena = CAMPOS_FIRMADOS_SNS[mensaje.Type]
    .filter(campo => mensaje[campo] !== undefined && mensaje[campo] !== null)
    .map(campo => `${campo}\n${mensaje[campo]}\n`)
    .join('')

  const firmador = crypto.createSign('sha256')
  firmador.update(cadena, 'utf8')
  firmador.end()

  return firmador.sign(claveDeSns.privateKey, 'base64')
}

const mensajeDeSns = (campos, { firmar: conFirma = true } = {}) => {
  const mensaje = {
    Type: 'Notification',
    MessageId: 'id-1',
    TopicArn: TOPICO,
    Timestamp: new Date().toISOString(),
    SignatureVersion: '2',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem',
    ...campos,
  }

  mensaje.Signature = conFirma ? firmarMensajeDeSns(mensaje) : 'firma-falsa'

  return mensaje
}

const peticionDeSns = mensaje => ({
  headers: {},
  // SNS postea con Content-Type text/plain, así que express.json() no lo
  // parsea y req.body llega vacío. Se reproduce ese escenario a propósito.
  rawBody: Buffer.from(JSON.stringify(mensaje)),
  body: {},
})

const eventoDeSes = cuerpo => JSON.stringify(cuerpo)

describe('eventos de entrega de SES · firma de SNS', () => {
  let fetchOriginal

  beforeEach(() => {
    fetchOriginal = global.fetch
    process.env.SES_SNS_TOPIC_ARN = TOPICO

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => certificadoDeSns,
    }))
  })

  afterEach(() => {
    global.fetch = fetchOriginal
    delete process.env.SES_SNS_TOPIC_ARN
  })

  test('una notificación firmada se acepta', async () => {
    const res = armarRespuesta()

    await handleSesEvents(
      peticionDeSns(
        mensajeDeSns({
          Message: eventoDeSes({ eventType: 'Delivery', mail: { messageId: 'm-1' } }),
        }),
      ),
      res,
    )

    expect(res.statusCode).toBe(204)
  })

  test('una firma inválida devuelve 401 y no procesa nada', async () => {
    const res = armarRespuesta()

    await handleSesEvents(
      peticionDeSns(
        mensajeDeSns(
          { Message: eventoDeSes({ eventType: 'Bounce', mail: { messageId: 'm-2' } }) },
          { firmar: false },
        ),
      ),
      res,
    )

    expect(res.statusCode).toBe(401)
    expect(errores.some(e => /📭/.test(e.msg))).toBe(false)
  })

  test('un certificado que no es de AWS se rechaza sin ir a buscarlo', async () => {
    // ESTE ES EL ATAQUE QUE IMPORTA. El mensaje dice con qué certificado
    // verificarlo: si se le cree, el atacante firma con su propia clave y la
    // verificación da bien. Acá la firma es VÁLIDA para ese certificado y
    // tiene que rechazarse igual, por venir de donde viene.
    const res = armarRespuesta()

    const mensaje = mensajeDeSns({
      Message: eventoDeSes({ eventType: 'Bounce', mail: { messageId: 'm-3' } }),
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com.atacante.com/cert.pem',
    })

    await handleSesEvents(peticionDeSns(mensaje), res)

    expect(res.statusCode).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('un tópico ajeno se rechaza aunque la firma sea válida', async () => {
    // Una firma de AWS sirve para CUALQUIER tópico de CUALQUIER cuenta:
    // cualquiera con una cuenta de AWS puede mandar eventos firmados de
    // verdad desde un tópico suyo.
    const res = armarRespuesta()

    await handleSesEvents(
      peticionDeSns(
        mensajeDeSns({
          TopicArn: 'arn:aws:sns:us-east-1:999999999999:el-topico-de-otro',
          Message: eventoDeSes({ eventType: 'Bounce', mail: { messageId: 'm-4' } }),
        }),
      ),
      res,
    )

    expect(res.statusCode).toBe(401)
  })
})

describe('eventos de entrega de SES · alta de la suscripción', () => {
  let fetchOriginal

  beforeEach(() => {
    fetchOriginal = global.fetch
    process.env.SES_SNS_TOPIC_ARN = TOPICO

    global.fetch = jest.fn(async url => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('.pem') ? certificadoDeSns : 'ok'),
    }))
  })

  afterEach(() => {
    global.fetch = fetchOriginal
    delete process.env.SES_SNS_TOPIC_ARN
  })

  test('visita la URL de confirmación', async () => {
    // Una suscripción HTTPS sólo queda dada de alta si el propio endpoint
    // visita esa URL: es como AWS comprueba que quien contesta lo controla.
    const res = armarRespuesta()

    const confirmacion = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=xyz'

    await handleSesEvents(
      peticionDeSns(
        mensajeDeSns({
          Type: 'SubscriptionConfirmation',
          Message: 'Confirmá la suscripción',
          Token: 'xyz',
          SubscribeURL: confirmacion,
        }),
      ),
      res,
    )

    expect(res.statusCode).toBe(204)
    expect(global.fetch.mock.calls.some(([url]) => url === confirmacion)).toBe(true)
  })

  test('una SubscribeURL que no es de AWS no se visita', async () => {
    // Visitar una URL arbitraria que viene en el cuerpo convierte al endpoint
    // en un cliente HTTP de quien la mande.
    const res = armarRespuesta()

    await handleSesEvents(
      peticionDeSns(
        mensajeDeSns({
          Type: 'SubscriptionConfirmation',
          Message: 'Confirmá la suscripción',
          Token: 'xyz',
          SubscribeURL: 'https://atacante.com/confirmar',
        }),
      ),
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('atacante'))).toBe(false)
  })
})

describe('eventos de entrega de SES · qué se registra', () => {
  let fetchOriginal

  beforeEach(() => {
    fetchOriginal = global.fetch
    process.env.SES_SNS_TOPIC_ARN = TOPICO

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => certificadoDeSns,
    }))
  })

  afterEach(() => {
    global.fetch = fetchOriginal
    delete process.env.SES_SNS_TOPIC_ARN
  })

  const mandar = async evento => {
    const res = armarRespuesta()
    await handleSesEvents(peticionDeSns(mensajeDeSns({ Message: eventoDeSes(evento) })), res)
    return res
  }

  test('un rebote queda como ERROR, no como info', async () => {
    await mandar({
      eventType: 'Bounce',
      mail: { messageId: 'm-10', destination: ['quien@ejemplo.com'] },
      bounce: { bounceType: 'Permanent', bounceSubType: 'General' },
    })

    const fallo = errores.find(e => /📭/.test(e.msg))

    expect(fallo).toBeDefined()
    expect(fallo.datos).toMatchObject({
      evento: 'bounce',
      to: 'quien@ejemplo.com',
      messageId: 'm-10',
      tipoRebote: 'Permanent',
      motivo: 'General',
    })
  })

  test('una queja de spam también es un fallo', async () => {
    await mandar({
      eventType: 'Complaint',
      mail: { messageId: 'm-11', destination: ['quien@ejemplo.com'] },
      complaint: { complaintFeedbackType: 'abuse' },
    })

    expect(errores.some(e => /📭/.test(e.msg))).toBe(true)
  })

  test('DeliveryDelay NO es un fallo', async () => {
    // Mismo criterio que `deferred` en SendGrid: es un reintento en curso, y
    // tratarlo como error llenaría los logs de alarmas que se resuelven solas.
    await mandar({
      eventType: 'DeliveryDelay',
      mail: { messageId: 'm-12', destination: ['quien@ejemplo.com'] },
    })

    expect(errores.some(e => /📭/.test(e.msg))).toBe(false)
    expect(infos.some(e => /📬/.test(e.msg))).toBe(true)
  })

  test('el messageId se puede cruzar con el del envío', async () => {
    await mandar({
      eventType: 'Delivery',
      mail: { messageId: 'el-mismo-del-envio', destination: ['quien@ejemplo.com'] },
    })

    const evento = infos.find(e => /📬/.test(e.msg))

    expect(evento.datos.messageId).toBe('el-mismo-del-envio')
  })
})

describe('eventos de entrega de SES · la ruta llega al controlador', () => {
  test('está exenta de CSRF', async () => {
    const { csrfExemptRoutes } = await import('../middlewares/csrfMiddleware.js')

    const exenta = csrfExemptRoutes.some(
      ruta => ruta.method === 'POST' && ruta.path.endsWith(config.SES_WEBHOOK_PATH),
    )

    expect(exenta).toBe(true)
  })

  test('la ruta registrada es la misma que se declara', async () => {
    const { default: webhookRoutes } = await import('../routes/webhookRoutes.js')

    const rutas = webhookRoutes.stack.filter(capa => capa.route).map(capa => capa.route.path)

    expect(rutas).toContain(config.SES_WEBHOOK_ROUTE)
  })

  test('es una ruta distinta de la de SendGrid', async () => {
    // Un endpoint único que mirara la forma del cuerpo para elegir el
    // verificador le daría al atacante exactamente eso: elegir con qué firma
    // lo van a verificar.
    expect(config.SES_WEBHOOK_ROUTE).not.toBe(config.SENDGRID_WEBHOOK_ROUTE)
  })
})
