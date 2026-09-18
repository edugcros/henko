// 📁 src/test/sendgridWebhook.test.js
//
// Qué pasó DESPUÉS de que SendGrid aceptó el correo.
//
// EL CASO QUE LO ORIGINÓ
//
// El envío registra el correo como bueno cuando la API de SendGrid devuelve
// 202, y eso solo significa "lo recibí". Medido en producción el 18/09/2026:
// un correo figuraba en los logs con "✅ Email enviado correctamente" y en el
// panel de SendGrid estaba en `Dropped` — la dirección estaba en su lista de
// supresión por rebotes anteriores.
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

const { handleSendgridEvents, verifySendgridSignature } = await import(
  '../controller/sendgridWebhookCtrl.js'
)
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
      ruta =>
        ruta.method === 'POST' && ruta.path.endsWith(config.SENDGRID_WEBHOOK_PATH),
    )

    expect(exenta).toBe(true)
  })

  test('la ruta registrada es la misma que se declara', async () => {
    const { default: webhookRoutes } = await import('../routes/webhookRoutes.js')

    const rutas = webhookRoutes.stack
      .filter(capa => capa.route)
      .map(capa => capa.route.path)

    expect(rutas).toContain(config.SENDGRID_WEBHOOK_ROUTE)
  })
})
