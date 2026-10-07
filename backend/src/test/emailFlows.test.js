import { jest } from '@jest/globals'

// El modelo Tenant importa secretCryptoService al cargarse.
process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64url')
process.env.CLIENT_URL = 'https://tienda-plataforma.com'
process.env.ADMIN_URL = 'https://panel-plataforma.com'

// Se intercepta el envío en el borde: lo que interesa verificar es QUÉ correo
// se arma y a quién va, no que SendGrid acepte la conexión.
const sentEmails = []

jest.unstable_mockModule('../utils/sendEmail.js', () => ({
  sendEmail: async payload => {
    sentEmails.push(payload)
    return { success: true, messageId: 'test' }
  },
}))

// Los comercios que "existen" en la base, por id. Se mockea el modelo en vez
// de levantar Mongo porque lo que se verifica es a QUIÉN se le pregunta el
// nombre, no cómo lo guarda Mongo.
const comerciosEnBase = new Map()
const findByIdCalls = []

jest.unstable_mockModule('../models/tenantModel.js', () => ({
  default: {
    findById: id => {
      findByIdCalls.push(String(id))

      return {
        lean: async () => comerciosEnBase.get(String(id)) || null,
      }
    },
  },
}))

const {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
} = await import('../services/email/verificationEmail.service.js')

const { sendCartRecoveryEmail } = await import('../services/email/cartRecoveryEmail.service.js')

// El SDK de AWS se intercepta entero: lo que interesa verificar es QUÉ
// comandos se mandan y con qué forma —sobre todo que se cree el inquilino y
// se le asocien los recursos—, no que AWS los acepte.
const comandosSes = []
const respuestasSes = {}

const comandoSes = tipo =>
  class {
    constructor(input) {
      this.__tipo = tipo
      this.input = input
    }
  }

jest.unstable_mockModule('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    async send(comando) {
      comandosSes.push({ tipo: comando.__tipo, input: comando.input })

      const respuesta = respuestasSes[comando.__tipo]

      if (typeof respuesta === 'function') return respuesta(comando.input)

      return respuesta || {}
    }
  },
  SendEmailCommand: comandoSes('SendEmail'),
  CreateEmailIdentityCommand: comandoSes('CreateEmailIdentity'),
  GetEmailIdentityCommand: comandoSes('GetEmailIdentity'),
  CreateTenantCommand: comandoSes('CreateTenant'),
  CreateTenantResourceAssociationCommand: comandoSes('CreateTenantResourceAssociation'),
}))

const { resolveSenderAddress, sendEmail } = await import('../services/emailService.js')
const { extractDomain } = await import('../services/email/tenantEmailDomainService.js')

const { CODIGOS, esReintentable, proveedorActivo, enviarConProveedor, dominiosDelProveedor } =
  await import('../services/email/emailProviders.js')

const { resolveRecoveryChannel } =
  await import('../services/aiAgent/aiCartRecoveryWorkerService.js')

const TENANT = {
  name: 'Tienda X',
  domains: [
    {
      hostname: 'tiendax.com',
      normalizedHostname: 'tiendax.com',
      status: 'active',
      isPrimary: true,
    },
  ],
  adminDomains: [
    {
      hostname: 'panel.tiendax.com',
      normalizedHostname: 'panel.tiendax.com',
      status: 'active',
      isPrimary: true,
    },
  ],
  settings: { store: { contactEmail: 'hola@tiendax.com' } },
}

const USER = { email: 'compradora@ejemplo.com', firstname: 'Ana' }

beforeEach(() => {
  sentEmails.length = 0
  comerciosEnBase.clear()
  findByIdCalls.length = 0
  delete process.env.STORE_NAME
})

// QUÉ NOMBRE FIRMA EL CORREO
//
// El nombre salía de una cadena de respaldos que terminaba en STORE_NAME, una
// variable de entorno de la PLATAFORMA. Quien llamaba sin pasar el comercio no
// fallaba: mandaba el correo firmado con ese valor.
//
// Pasó en producción. El reseteo de contraseña arranca sin sesión, así que no
// tenía req.tenant y llamaba sin segundo argumento: a un cliente le llegó "Tu
// contraseña de Henko Dev fue modificada". "Henko Dev" era el STORE_NAME.
//
// Con un comercio es un nombre feo. Con varios, el cliente de cualquiera de
// ellos recibe un correo de SEGURIDAD firmado por alguien que no reconoce.
describe('el comercio que firma el correo', () => {
  const USUARIO_CON_COMERCIO = {
    email: 'compradora@ejemplo.com',
    firstname: 'Ana',
    tenantId: '6a4dcc911161615f76a8131f',
  }

  test('sin que se lo pasen, lo busca por el comercio del usuario', async () => {
    // ESTE ES EL CASO QUE FALLÓ. Nadie pasa el comercio y el correo igual
    // tiene que salir firmado por la tienda donde el cliente compró.
    comerciosEnBase.set(USUARIO_CON_COMERCIO.tenantId, { name: 'Tienda Real' })
    process.env.STORE_NAME = 'Henko Dev'

    await sendPasswordChangedEmail(USUARIO_CON_COMERCIO)

    expect(sentEmails[0].subject).toBe('Tu contraseña de Tienda Real fue modificada')
    expect(sentEmails[0].subject).not.toContain('Henko Dev')
    expect(findByIdCalls).toEqual([USUARIO_CON_COMERCIO.tenantId])
  })

  test('el mismo arreglo vale para el correo de bienvenida', async () => {
    comerciosEnBase.set(USUARIO_CON_COMERCIO.tenantId, { name: 'Tienda Real' })
    process.env.STORE_NAME = 'Henko Dev'

    await sendWelcomeEmail(USUARIO_CON_COMERCIO)

    expect(sentEmails[0].subject).toBe('Bienvenido a Tienda Real')
  })

  test('y para el de verificación', async () => {
    comerciosEnBase.set(USUARIO_CON_COMERCIO.tenantId, { name: 'Tienda Real' })
    process.env.STORE_NAME = 'Henko Dev'

    await sendVerificationEmail(USUARIO_CON_COMERCIO, null, 'tok123')

    expect(sentEmails[0].subject).toContain('Tienda Real')
  })

  test('si se lo pasan, NO va a la base', async () => {
    // Quien ya tiene el comercio en la mano —req.tenant— no debe pagar una
    // consulta por correo enviado.
    await sendPasswordChangedEmail(USUARIO_CON_COMERCIO, { name: 'Pasado' })

    expect(sentEmails[0].subject).toBe('Tu contraseña de Pasado fue modificada')
    expect(findByIdCalls).toEqual([])
  })

  test('un usuario sin comercio no dispara ninguna consulta', async () => {
    process.env.STORE_NAME = 'Henko Dev'

    await sendPasswordChangedEmail({ email: 'suelta@ejemplo.com' })

    expect(findByIdCalls).toEqual([])
    expect(sentEmails[0].subject).toBe('Tu contraseña de Henko Dev fue modificada')
  })

  test('si la base falla, el correo sale igual', async () => {
    // Estos avisos son la única señal que recibe el dueño de la casilla si la
    // acción no fue suya: que no salga es peor que que salga genérico.
    comerciosEnBase.set(USUARIO_CON_COMERCIO.tenantId, null)
    process.env.STORE_NAME = 'Henko Dev'

    await sendPasswordChangedEmail(USUARIO_CON_COMERCIO)

    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].subject).toBe('Tu contraseña de Henko Dev fue modificada')
  })
})

describe('correos de cuenta', () => {
  test('la verificación del comprador apunta a la tienda del comercio', async () => {
    await sendVerificationEmail(USER, TENANT, 'tok123')

    const [mail] = sentEmails
    expect(mail.to).toBe(USER.email)
    expect(mail.html).toContain('tiendax.com/verify-email?token=tok123')
    expect(mail.html).not.toContain('tienda-plataforma.com')
  })

  test('la verificación del comerciante apunta al panel, no a la tienda', async () => {
    // El dueño no tiene cuenta de comprador: mandarlo al storefront lo dejaba
    // verificando en la aplicación equivocada.
    await sendVerificationEmail(USER, TENANT, 'tok123', { target: 'admin' })

    const [mail] = sentEmails
    expect(mail.html).toContain('panel.tiendax.com/verify-email')
    expect(mail.html).not.toContain('//tiendax.com/verify-email')
  })

  test('un comercio sin dominio propio cae al de la plataforma', async () => {
    await sendVerificationEmail(USER, { name: 'Sin Dominio' }, 'tok123')

    expect(sentEmails[0].html).toContain('tienda-plataforma.com')
  })

  test('el nombre del usuario se escapa antes de entrar al HTML', async () => {
    await sendVerificationEmail(
      { email: 'x@ejemplo.com', firstname: '<img src=x onerror="alert(1)">' },
      TENANT,
      'tok123',
    )

    expect(sentEmails[0].html).not.toContain('<img')
    expect(sentEmails[0].html).toContain('&lt;img')
  })

  test('la verificación exige token', async () => {
    await expect(sendVerificationEmail(USER, TENANT, '')).rejects.toThrow()
    expect(sentEmails).toHaveLength(0)
  })

  test('el reseteo incluye el enlace recibido', async () => {
    await sendResetPasswordEmail(USER, 'https://tiendax.com/reset/abc')

    expect(sentEmails[0].html).toContain('https://tiendax.com/reset/abc')
  })

  test('el aviso de contraseña cambiada no lleva enlaces de acción', async () => {
    // Un correo de "tu contraseña cambió" con un botón es indistinguible de un
    // phishing que pide exactamente eso.
    await sendPasswordChangedEmail(USER, TENANT)

    expect(sentEmails[0].html).not.toContain('<a ')
    expect(sentEmails[0].subject).toContain('Tienda X')
  })

  test('la bienvenida sale recién después de verificar y lleva a la tienda', async () => {
    await sendWelcomeEmail(USER, TENANT)

    expect(sentEmails[0].html).toContain('tiendax.com')
    expect(sentEmails[0].subject).toContain('Tienda X')
  })

  test('los correos de cortesía no explotan sin usuario', async () => {
    // Se llaman desde caminos que ya completaron su operación: si tiran, el
    // llamador convierte un éxito en un error.
    await expect(sendPasswordChangedEmail(null)).resolves.toMatchObject({
      skipped: true,
    })
    await expect(sendWelcomeEmail(null)).resolves.toMatchObject({
      skipped: true,
    })
    expect(sentEmails).toHaveLength(0)
  })
})

describe('recuperación de carrito por correo', () => {
  const VALUES = {
    customerName: 'Ana',
    productName: 'Zapatillas',
    cartTotal: '$120.000',
    checkoutUrl: 'https://tiendax.com/checkout?cart=abc',
  }

  test('arma el correo con el enlace de checkout y el texto de la regla', async () => {
    await sendCartRecoveryEmail({
      to: 'ana@ejemplo.com',
      tenantConfig: TENANT,
      values: VALUES,
      body: 'Todavía estás a tiempo',
    })

    const [mail] = sentEmails
    expect(mail.to).toBe('ana@ejemplo.com')
    expect(mail.html).toContain(VALUES.checkoutUrl)
    expect(mail.html).toContain('Todavía estás a tiempo')
    expect(mail.subject).toContain('Tienda X')
  })

  test('sin enlace de checkout no manda nada', async () => {
    // Un correo de carrito sin el enlace es ruido: no hay nada que retomar.
    await expect(
      sendCartRecoveryEmail({
        to: 'ana@ejemplo.com',
        tenantConfig: TENANT,
        values: { ...VALUES, checkoutUrl: '' },
      }),
    ).rejects.toThrow()

    expect(sentEmails).toHaveLength(0)
  })

  test('sin destinatario no manda nada', async () => {
    await expect(
      sendCartRecoveryEmail({ to: '', tenantConfig: TENANT, values: VALUES }),
    ).rejects.toThrow()

    expect(sentEmails).toHaveLength(0)
  })
})

describe('elección de canal de recuperación', () => {
  const agentConWhatsapp = {
    channels: {
      whatsapp: { enabled: true, phoneNumberId: '123', accessToken: 'tok' },
    },
  }
  const agentSinWhatsapp = { channels: { whatsapp: { enabled: false } } }

  test('con teléfono y WhatsApp configurado elige WhatsApp', () => {
    expect(
      resolveRecoveryChannel({
        recovery: { customer: { phone: '+5491122334455', email: 'a@b.com' } },
        agent: agentConWhatsapp,
      }),
    ).toBe('whatsapp')
  })

  test('sin WhatsApp configurado usa el correo en vez de cancelar', () => {
    // Este es el caso que antes no mandaba nada: el comercio nunca conectó
    // WhatsApp y la recuperación se cancelaba con el email a la vista.
    expect(
      resolveRecoveryChannel({
        recovery: { customer: { phone: '+5491122334455', email: 'a@b.com' } },
        agent: agentSinWhatsapp,
      }),
    ).toBe('email')
  })

  test('comprador sin teléfono cae al correo', () => {
    expect(
      resolveRecoveryChannel({
        recovery: { customer: { email: 'a@b.com' } },
        agent: agentConWhatsapp,
      }),
    ).toBe('email')
  })

  test('sin ningún contacto no inventa canal', () => {
    expect(
      resolveRecoveryChannel({
        recovery: { customer: {} },
        agent: agentConWhatsapp,
      }),
    ).toBeNull()
  })

  test('respeta el canal pedido si hay con qué cumplirlo', () => {
    expect(
      resolveRecoveryChannel({
        recovery: {
          channel: 'email',
          customer: { phone: '+5491122334455', email: 'a@b.com' },
        },
        agent: agentConWhatsapp,
      }),
    ).toBe('email')
  })

  test('ignora el canal pedido si no hay dato para ese canal', () => {
    expect(
      resolveRecoveryChannel({
        recovery: { channel: 'whatsapp', customer: { email: 'a@b.com' } },
        agent: agentSinWhatsapp,
      }),
    ).toBe('email')
  })
})

describe('remitente por comercio', () => {
  // .env.development trae credenciales reales de SendGrid (EMAIL_FROM,
  // EMAIL_USER) que config/env.js carga incluso bajo NODE_ENV=test. Sin
  // limpiarlas acá, estos tests correrían contra esas variables ambientales
  // en vez del estado que cada test arma explícitamente.
  const ORIGINAL_KEYS = ['EMAIL_FROM', 'EMAIL_USER']
  const originals = Object.fromEntries(ORIGINAL_KEYS.map(key => [key, process.env[key]]))

  beforeEach(() => {
    delete process.env.EMAIL_FROM
    delete process.env.EMAIL_USER
  })

  afterAll(() => {
    ORIGINAL_KEYS.forEach(key => {
      if (originals[key] === undefined) delete process.env[key]
      else process.env[key] = originals[key]
    })
  })

  test('dominio verificado: sale desde la dirección del comercio', () => {
    process.env.EMAIL_FROM = 'no-reply@plataforma.com'

    expect(
      resolveSenderAddress({
        email: { status: 'verified', fromAddress: 'hola@tiendax.com' },
      }),
    ).toBe('hola@tiendax.com')
  })

  test('dominio pendiente: NO sale desde el comercio', () => {
    // Un dominio sin SPF/DKIM publicados no autoriza a nadie a enviar en su
    // nombre: usarlo garantiza rebote o spam.
    process.env.EMAIL_FROM = 'no-reply@plataforma.com'

    expect(
      resolveSenderAddress({
        email: { status: 'pending', fromAddress: 'hola@tiendax.com' },
      }),
    ).toBe('no-reply@plataforma.com')
  })

  test('dominio fallido: tampoco', () => {
    process.env.EMAIL_FROM = 'no-reply@plataforma.com'

    expect(
      resolveSenderAddress({
        email: { status: 'failed', fromAddress: 'hola@tiendax.com' },
      }),
    ).toBe('no-reply@plataforma.com')
  })

  test('sin dominio propio, usa EMAIL_FROM de la plataforma', () => {
    process.env.EMAIL_FROM = 'no-reply@plataforma.com'
    process.env.EMAIL_USER = 'otra@plataforma.com'

    expect(resolveSenderAddress({})).toBe('no-reply@plataforma.com')
  })

  test('sin EMAIL_FROM, cae a EMAIL_USER', () => {
    process.env.EMAIL_USER = 'cuenta@plataforma.com'

    expect(resolveSenderAddress({})).toBe('cuenta@plataforma.com')
  })

  test('verificado pero con dirección inválida: no se arriesga', () => {
    process.env.EMAIL_FROM = 'no-reply@plataforma.com'

    expect(
      resolveSenderAddress({
        email: { status: 'verified', fromAddress: 'esto-no-es-un-mail' },
      }),
    ).toBe('no-reply@plataforma.com')
  })

  test('sin nada configurado no inventa una dirección', () => {
    // SendGrid no tiene sandbox al que caer: sin EMAIL_FROM ni EMAIL_USER no
    // hay remitente seguro — el envío falla explícito río abajo en vez de
    // fingir que salió. Esto solo confirma que resolveSenderAddress no
    // inventa un valor para tapar el problema.
    expect(resolveSenderAddress({})).toBe('')
  })

  test('extractDomain solo acepta direcciones válidas', () => {
    expect(extractDomain('hola@tiendax.com')).toBe('tiendax.com')
    expect(extractDomain('HOLA@TiendaX.com')).toBe('tiendax.com')
    expect(extractDomain('sin-arroba')).toBe('')
    expect(extractDomain('')).toBe('')
  })
})

// =====================================================
// Proveedor de envío intercambiable
// =====================================================
//
// El proveedor dejó de estar clavado a fuego y ahora lo elige EMAIL_PROVIDER.
// Lo que estos bloques fijan es el contrato que hace que cambiarlo sea
// seguro: que cada proveedor reciba el mensaje con la forma que pide, y que
// sus fallas se traduzcan todas al mismo vocabulario — porque de esa
// traducción depende si se reintenta o no.

const guardarEntorno = claves => {
  const previas = Object.fromEntries(claves.map(clave => [clave, process.env[clave]]))

  return () =>
    claves.forEach(clave => {
      if (previas[clave] === undefined) delete process.env[clave]
      else process.env[clave] = previas[clave]
    })
}

describe('proveedor de envío · cuál queda activo', () => {
  let restaurar

  beforeEach(() => {
    restaurar = guardarEntorno(['EMAIL_PROVIDER'])
  })

  afterEach(() => restaurar())

  test('sin EMAIL_PROVIDER sigue siendo SendGrid', () => {
    // Mientras dure la mudanza, no configurar nada tiene que dejar todo como
    // estaba: el cambio de proveedor es una decisión explícita, no un efecto
    // de haber desplegado esta versión.
    delete process.env.EMAIL_PROVIDER

    expect(proveedorActivo().nombre).toBe('SendGrid')
  })

  test('EMAIL_PROVIDER elige el driver, sin importar mayúsculas ni espacios', () => {
    process.env.EMAIL_PROVIDER = '  SES  '
    expect(proveedorActivo().nombre).toBe('Amazon SES')

    process.env.EMAIL_PROVIDER = 'resend'
    expect(proveedorActivo().nombre).toBe('Resend')
  })

  test('un proveedor inexistente falla nombrando las opciones', () => {
    // Un typo en una variable de entorno no se ve en ningún diff. Si el
    // mensaje no dice qué valores son válidos, el error aparece recién en el
    // primer correo que no sale.
    process.env.EMAIL_PROVIDER = 'mailchimp'

    expect(() => proveedorActivo()).toThrow(/mailchimp/)
    expect(() => proveedorActivo()).toThrow(/sendgrid, resend, ses/)
  })
})

describe('proveedor de envío · qué se reintenta y qué no', () => {
  // EL BUG QUE CIERRA ESTE BLOQUE
  //
  // La clasificación anterior mandaba todo lo que no fuera 401/403 al cajón
  // de "pedido inválido", que es no-reintentable. O sea que un 429 ("pediste
  // de más, esperá") y un 503 ("estoy caído, volvé") abortaban en el primer
  // intento — los dos únicos casos donde reintentar es exactamente lo que
  // corresponde. El bucle de reintentos existía y no se usaba para aquello
  // que sirve.

  test('lo pasajero se reintenta', () => {
    expect(esReintentable(CODIGOS.LIMITE_DE_TASA)).toBe(true)
    expect(esReintentable(CODIGOS.PROVEEDOR_CAIDO)).toBe(true)
    expect(esReintentable(CODIGOS.TIEMPO_AGOTADO)).toBe(true)
  })

  test('lo que no se arregla solo, no', () => {
    expect(esReintentable(CODIGOS.AUTENTICACION)).toBe(false)
    expect(esReintentable(CODIGOS.PEDIDO_INVALIDO)).toBe(false)
    expect(esReintentable(CODIGOS.SIN_CONFIGURAR)).toBe(false)

    // Un inquilino pausado por reputación en SES no se destraba
    // reintentando: hay que resolver el motivo primero.
    expect(esReintentable(CODIGOS.ENVIO_PAUSADO)).toBe(false)
  })
})

describe('proveedor de envío · forma del pedido y traducción de fallas', () => {
  const CORREO = {
    to: 'compradora@ejemplo.com',
    from: 'Tienda X <no-reply@tiendax.com>',
    subject: 'Asunto',
    text: 'Cuerpo',
  }

  let restaurar
  let fetchOriginal

  beforeEach(() => {
    restaurar = guardarEntorno([
      'EMAIL_PROVIDER',
      'SENDGRID_API_KEY',
      'EMAIL_PASS',
      'RESEND_API_KEY',
    ])
    fetchOriginal = global.fetch

    process.env.EMAIL_PROVIDER = 'sendgrid'
    process.env.SENDGRID_API_KEY = 'clave-de-prueba'
  })

  afterEach(() => {
    global.fetch = fetchOriginal
    restaurar()
  })

  const responderCon = status => {
    global.fetch = async () => ({
      ok: false,
      status,
      text: async () => 'detalle del proveedor',
      json: async () => ({ message: 'detalle del proveedor' }),
      headers: { get: () => null },
    })
  }

  test('429 se traduce a límite de tasa, que sí se reintenta', async () => {
    responderCon(429)

    await expect(enviarConProveedor(CORREO)).rejects.toMatchObject({
      code: CODIGOS.LIMITE_DE_TASA,
    })
    expect(esReintentable(CODIGOS.LIMITE_DE_TASA)).toBe(true)
  })

  test('503 se traduce a proveedor caído, que sí se reintenta', async () => {
    responderCon(503)

    await expect(enviarConProveedor(CORREO)).rejects.toMatchObject({
      code: CODIGOS.PROVEEDOR_CAIDO,
    })
    expect(esReintentable(CODIGOS.PROVEEDOR_CAIDO)).toBe(true)
  })

  test('401 se traduce a autenticación, que no se reintenta', async () => {
    responderCon(401)

    await expect(enviarConProveedor(CORREO)).rejects.toMatchObject({
      code: CODIGOS.AUTENTICACION,
    })
  })

  test('400 se traduce a pedido inválido, que no se reintenta', async () => {
    responderCon(400)

    await expect(enviarConProveedor(CORREO)).rejects.toMatchObject({
      code: CODIGOS.PEDIDO_INVALIDO,
    })
  })

  test('sin credencial no se sale a la red siquiera', async () => {
    delete process.env.SENDGRID_API_KEY
    delete process.env.EMAIL_PASS

    let huboLlamada = false
    global.fetch = async () => {
      huboLlamada = true
      throw new Error('no debería haberse llamado')
    }

    await expect(enviarConProveedor(CORREO)).rejects.toMatchObject({
      code: CODIGOS.SIN_CONFIGURAR,
    })
    expect(huboLlamada).toBe(false)
  })

  test('los adjuntos fallan en voz alta en vez de desaparecer', async () => {
    // Antes se aceptaban como parámetro y se descartaban en silencio: quien
    // llamaba se quedaba creyendo que el adjunto había salido. Nadie los usa
    // todavía, así que el costo de decirlo es cero y el de callarlo es un
    // bug que sólo aparece cuando alguien confíe en ellos.
    let huboLlamada = false
    global.fetch = async () => {
      huboLlamada = true
      throw new Error('no debería haberse llamado')
    }

    await expect(
      enviarConProveedor({ ...CORREO, attachments: [{ filename: 'factura.pdf' }] }),
    ).rejects.toMatchObject({ code: CODIGOS.ADJUNTOS_NO_SOPORTADOS })
    expect(huboLlamada).toBe(false)
  })

  test('SendGrid recibe el remitente partido en {email, name}', async () => {
    let cuerpo = null

    global.fetch = async (url, opciones) => {
      cuerpo = JSON.parse(opciones.body)

      return {
        ok: true,
        status: 202,
        text: async () => '',
        headers: { get: cabecera => (cabecera === 'x-message-id' ? 'sg-123' : null) },
      }
    }

    const resultado = await enviarConProveedor(CORREO)

    expect(cuerpo.from).toEqual({ email: 'no-reply@tiendax.com', name: 'Tienda X' })
    expect(cuerpo.personalizations).toEqual([{ to: [{ email: 'compradora@ejemplo.com' }] }])
    expect(resultado).toEqual({ messageId: 'sg-123', proveedor: 'SendGrid' })
  })

  test('Resend recibe el remitente entero, que es como lo pide', async () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 'clave-de-prueba'

    let cuerpo = null

    global.fetch = async (url, opciones) => {
      cuerpo = JSON.parse(opciones.body)

      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'res-456' }),
        headers: { get: () => null },
      }
    }

    const resultado = await enviarConProveedor(CORREO)

    expect(cuerpo.from).toBe('Tienda X <no-reply@tiendax.com>')
    expect(cuerpo.to).toEqual(['compradora@ejemplo.com'])
    expect(resultado).toEqual({ messageId: 'res-456', proveedor: 'Resend' })
  })
})

// =====================================================
// Dominio propio del comercio, al cambiar de proveedor
// =====================================================

describe('remitente · un dominio verificado vale sólo para quien lo verificó', () => {
  // LO QUE ESTE BLOQUE EVITA
  //
  // Los registros DKIM que publica un comercio autorizan a UN servicio a
  // firmar en su nombre, no a cualquiera. Cuando la plataforma cambia de
  // proveedor, ese dominio deja de estar autorizado hasta volver a
  // verificarlo — pero el estado guardado en la base sigue diciendo
  // 'verified', porque nadie lo tocó.
  //
  // Sin este chequeo, el día de la mudanza todos los comercios con dominio
  // propio seguirían saliendo con su identidad, el nuevo proveedor firmaría
  // con una clave que ese dominio no autoriza, y cada correo rebotaría o
  // caería en spam — mostrando "verificado" en el panel todo el tiempo.

  let restaurar

  beforeEach(() => {
    restaurar = guardarEntorno(['EMAIL_PROVIDER', 'EMAIL_FROM'])
    process.env.EMAIL_FROM = 'no-reply@plataforma.com'
  })

  afterEach(() => restaurar())

  const DOMINIO_PROPIO = {
    email: { status: 'verified', fromAddress: 'hola@tiendax.com', provider: 'sendgrid' },
  }

  test('con el mismo proveedor, sale desde el comercio', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'

    expect(resolveSenderAddress(DOMINIO_PROPIO)).toBe('hola@tiendax.com')
  })

  test('con otro proveedor, vuelve a salir por la plataforma', () => {
    process.env.EMAIL_PROVIDER = 'ses'

    expect(resolveSenderAddress(DOMINIO_PROPIO)).toBe('no-reply@plataforma.com')
  })

  test('un registro sin proveedor cuenta como de SendGrid', () => {
    // Son los que se guardaron antes de que hubiera más de uno. Tratarlos
    // como "de proveedor desconocido" dejaría sin dominio propio a comercios
    // que hoy lo tienen funcionando.
    process.env.EMAIL_PROVIDER = 'sendgrid'

    expect(
      resolveSenderAddress({ email: { status: 'verified', fromAddress: 'hola@tiendax.com' } }),
    ).toBe('hola@tiendax.com')
  })
})

describe('dominios · no todos los proveedores los administran', () => {
  let restaurar

  beforeEach(() => {
    restaurar = guardarEntorno(['EMAIL_PROVIDER'])
  })

  afterEach(() => restaurar())

  test('Resend lo dice explícitamente', () => {
    // Resend está como puente mientras SES sale del sandbox. Dar de alta el
    // dominio de un comercio ahí sería hacerle publicar registros que habría
    // que reemplazar en días: mejor que el panel diga que no se puede.
    process.env.EMAIL_PROVIDER = 'resend'

    expect(dominiosDelProveedor().soportado).toBe(false)
  })

  test('SendGrid y SES sí', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    expect(dominiosDelProveedor().soportado).toBe(true)

    process.env.EMAIL_PROVIDER = 'ses'
    expect(dominiosDelProveedor().soportado).toBe(true)
  })
})

describe('dominios · alta en SES', () => {
  let restaurar

  beforeEach(() => {
    restaurar = guardarEntorno([
      'EMAIL_PROVIDER',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_ACCOUNT_ID',
      'AWS_REGION',
      'SES_CONFIGURATION_SET',
    ])

    process.env.EMAIL_PROVIDER = 'ses'
    process.env.AWS_ACCESS_KEY_ID = 'clave-de-prueba'
    process.env.AWS_SECRET_ACCESS_KEY = 'secreto-de-prueba'
    process.env.AWS_ACCOUNT_ID = '123456789012'
    process.env.AWS_REGION = 'us-east-1'
    process.env.SES_CONFIGURATION_SET = 'henko'

    comandosSes.length = 0
    Object.keys(respuestasSes).forEach(clave => delete respuestasSes[clave])

    respuestasSes.CreateEmailIdentity = () => ({
      VerifiedForSendingStatus: false,
      DkimAttributes: { Status: 'PENDING', Tokens: ['aaa', 'bbb', 'ccc'] },
    })
  })

  afterEach(() => restaurar())

  test('devuelve los tres CNAME de Easy DKIM y ninguno toca el MX', async () => {
    const alta = await dominiosDelProveedor().alta('tiendax.com', { inquilino: 'comercio-1' })

    expect(alta.status).toBe('pending')
    expect(alta.dns).toHaveLength(3)

    expect(alta.dns.map(r => r.type)).toEqual(['CNAME', 'CNAME', 'CNAME'])
    expect(alta.dns[0]).toMatchObject({
      name: 'aaa._domainkey.tiendax.com',
      value: 'aaa.dkim.amazonses.com',
    })

    // Que no haya MX no es un detalle: la variante con MX le robaría al
    // comercio su correo ENTRANTE.
    expect(alta.dns.some(r => r.type === 'MX')).toBe(false)
  })

  test('crea el inquilino con lista de supresión propia', async () => {
    await dominiosDelProveedor().alta('tiendax.com', { inquilino: 'comercio-1' })

    const inquilino = comandosSes.find(c => c.tipo === 'CreateTenant')

    expect(inquilino.input.TenantName).toBe('comercio-1')

    // Con la lista de la cuenta —el valor por omisión— un comprador que
    // marca spam a UNA tienda queda bloqueado para TODAS.
    expect(inquilino.input.SuppressionAttributes).toEqual({
      SuppressionScope: 'TENANT',
      SuppressedReasons: ['BOUNCE', 'COMPLAINT'],
    })
  })

  test('asocia al inquilino la identidad y el conjunto de configuración', async () => {
    await dominiosDelProveedor().alta('tiendax.com', { inquilino: 'comercio-1' })

    const asociados = comandosSes
      .filter(c => c.tipo === 'CreateTenantResourceAssociation')
      .map(c => c.input.ResourceArn)

    // SES exige las dos: sin el conjunto de configuración el alta queda a
    // medias y el primer envío falla con un error que no menciona esto.
    expect(asociados).toEqual([
      'arn:aws:ses:us-east-1:123456789012:identity/tiendax.com',
      'arn:aws:ses:us-east-1:123456789012:configuration-set/henko',
    ])
  })

  test('sin inquilino no se crea ninguno, pero la identidad sí', async () => {
    await dominiosDelProveedor().alta('tiendax.com')

    expect(comandosSes.map(c => c.tipo)).toEqual(['CreateEmailIdentity'])
  })

  test('un AWS_ACCOUNT_ID que no es una cuenta se dice por su nombre', async () => {
    // El ARN se arma a mano, así que una cuenta mal cargada se manifestaría
    // como "no existe ese recurso" — un error que no señala a la variable.
    process.env.AWS_ACCOUNT_ID = 'mi-cuenta'

    await expect(
      dominiosDelProveedor().alta('tiendax.com', { inquilino: 'comercio-1' }),
    ).rejects.toThrow(/AWS_ACCOUNT_ID/)
  })

  test('DKIM en SUCCESS queda verificado; en FAILED, fallido', async () => {
    // SES sí tiene un estado terminal, a diferencia de SendGrid. Informar
    // FAILED como "pendiente" dejaría al comercio esperando para siempre.
    respuestasSes.GetEmailIdentity = () => ({
      VerifiedForSendingStatus: true,
      DkimAttributes: { Status: 'SUCCESS', Tokens: ['aaa'] },
    })

    const verificado = await dominiosDelProveedor().estado({ dominio: 'tiendax.com' })
    expect(verificado.status).toBe('verified')

    respuestasSes.GetEmailIdentity = () => ({
      VerifiedForSendingStatus: false,
      DkimAttributes: { Status: 'FAILED', Tokens: ['aaa'] },
    })

    const fallido = await dominiosDelProveedor().estado({ dominio: 'tiendax.com' })
    expect(fallido.status).toBe('failed')
  })
})

describe('SES · el inquilino viaja con cada correo', () => {
  // LO QUE ESTE BLOQUE EVITA
  //
  // El inquilino es lo único que hace que la reputación se mida por comercio.
  // Si el envío no lo lleva, el alta del inquilino existe pero no sirve para
  // nada: todo sale con la reputación de la cuenta, que es exactamente lo que
  // se quiso evitar — y no hay ningún error que lo delate.
  //
  // Por eso se deriva del comercio y no se le pide a cada punto de envío que
  // se acuerde de pasarlo: hay una docena, y el que se olvidara volvería a la
  // reputación compartida en silencio.

  let restaurar

  const CON_DOMINIO_PROPIO = {
    _id: 'comercio-1',
    name: 'Tienda X',
    email: { status: 'verified', provider: 'ses', fromAddress: 'hola@tiendax.com' },
  }

  beforeEach(() => {
    restaurar = guardarEntorno([
      'EMAIL_PROVIDER',
      'EMAIL_FROM',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
    ])

    process.env.EMAIL_PROVIDER = 'ses'
    process.env.EMAIL_FROM = 'no-reply@plataforma.com'
    process.env.AWS_ACCESS_KEY_ID = 'clave-de-prueba'
    process.env.AWS_SECRET_ACCESS_KEY = 'secreto-de-prueba'

    comandosSes.length = 0
    Object.keys(respuestasSes).forEach(clave => delete respuestasSes[clave])

    respuestasSes.SendEmail = () => ({ MessageId: 'ses-1' })
  })

  afterEach(() => restaurar())

  const enviar = async extra => {
    await sendEmail({ to: 'compradora@ejemplo.com', subject: 'Asunto', text: 'Cuerpo', ...extra })

    return comandosSes.find(c => c.tipo === 'SendEmail')?.input
  }

  test('con dominio propio verificado, el envío lleva el inquilino', async () => {
    const envio = await enviar({ tenantConfig: CON_DOMINIO_PROPIO })

    expect(envio.TenantName).toBe('comercio-1')
    expect(envio.FromEmailAddress).toContain('hola@tiendax.com')
  })

  test('saliendo por la plataforma NO lleva inquilino', async () => {
    // Esto no es una omisión: SES valida que el inquilino tenga permiso sobre
    // la identidad que se usa, y la de la plataforma no está asociada a él.
    // Mandarlo igual no sería más aislamiento, sería un envío rechazado.
    const envio = await enviar({
      tenantConfig: {
        _id: 'comercio-1',
        email: { status: 'pending', provider: 'ses', fromAddress: 'hola@tiendax.com' },
      },
    })

    expect(envio.TenantName).toBeUndefined()
    expect(envio.FromEmailAddress).toContain('no-reply@plataforma.com')
  })

  test('un dominio verificado con OTRO proveedor tampoco lo lleva', async () => {
    const envio = await enviar({
      tenantConfig: {
        _id: 'comercio-1',
        email: { status: 'verified', provider: 'sendgrid', fromAddress: 'hola@tiendax.com' },
      },
    })

    expect(envio.TenantName).toBeUndefined()
    expect(envio.FromEmailAddress).toContain('no-reply@plataforma.com')
  })

  test('con un remitente explícito no se deduce nada', async () => {
    // Quien pasa `from` eligió una identidad que este módulo no resolvió, así
    // que adivinar el inquilino sería arriesgar un rechazo.
    const envio = await enviar({
      tenantConfig: CON_DOMINIO_PROPIO,
      from: 'Otra cosa <otra@tiendax.com>',
    })

    expect(envio.TenantName).toBeUndefined()
  })
})
