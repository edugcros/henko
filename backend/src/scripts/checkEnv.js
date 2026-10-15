// 📁 src/scripts/checkEnv.js
//
// Qué variables de entorno tiene este despliegue, cuáles le faltan y qué se
// rompe por cada una que falte.
//
// QUÉ HACÍA ANTES Y POR QUÉ NO ALCANZABA
//
// Imprimía quince campos ya resueltos —dominios, cookies, CORS— y nada más.
// Servía para confirmar que lo cargado se leía bien, y no contestaba la
// pregunta que uno realmente se hace antes de un deploy: QUÉ FALTA. Una
// variable ausente no aparecía en esa lista, así que el chequeo pasaba
// igual y el problema se descubría en producción.
//
// El 13/10/2026 costó caro: no había un segundo proveedor de correo cargado,
// nada lo decía en ningún lado, y cuando SendGrid se quedó sin créditos la
// plataforma entera se quedó sin correo.
//
// NUNCA IMPRIME UN VALOR
//
// De cada secreto se informa su FORMA —que esté, cuánto mide y, cuando el
// prefijo distingue algo que importa, ese prefijo—. Alcanza para detectar los
// errores reales (la variable vacía, la credencial de prueba en producción,
// la clave cortada al pegarla) sin que un secreto termine escrito en la
// consola, en el historial de la terminal o en el log de un CI.
//
// POR QUÉ NO IMPORTA config/env.js ANTES DE AUDITAR
//
// Porque en producción ese archivo LANZA ante la primera variable que falta.
// Un auditor que muere en el primer hallazgo obliga a corregir y volver a
// correr, una vez por variable. Acá se mira `process.env` crudo, se informa
// TODO, y recién al final se intenta cargar env.js para decir si el arranque
// real pasaría — que es otra pregunta y se contesta aparte.

import dotenv from 'dotenv'

// La MISMA función que usa el runtime para armar el ARN del inquilino. Se
// importa de emailShared porque ese módulo no tiene dependencias: traerla
// desde emailProviders arrastraría el logger y con él config/env.js, que en
// producción lanza ante la primera variable que falta — justo lo que este
// script existe para informar sin morirse.
import { isValidAwsAccountId } from '../services/email/emailShared.js'

// Las mismas dos líneas que config/env.js, y a propósito: hay que leer el
// entorno ANTES de importarlo. En Render no hay archivo .env —las variables
// vienen del entorno del proceso— así que esto es un no-op allá.
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
dotenv.config({ path: envFile })

const esProduccion = process.env.NODE_ENV === 'production'

const hay = nombre => Boolean(String(process.env[nombre] ?? '').trim())

/** El primero de la lista que esté cargado, o null. */
const primeroCargado = nombres => nombres.find(hay) || null

// ─── PISTAS SEGURAS ──────────────────────────────────────────────────────────
//
// Lo que se puede decir de un secreto sin decirlo.

const largo = nombre => String(process.env[nombre] ?? '').trim().length

/** Sólo la longitud. Es lo que detecta una clave cortada al pegarla. */
const forma = nombre => `${largo(nombre)} caracteres`

/**
 * Para MercadoPago el prefijo SÍ se informa, y es la excepción deliberada:
 * `TEST-` contra `APP_USR-` es la diferencia entre cobrar de verdad y no
 * cobrar nada, no es parte secreta de la credencial, y es el error que más
 * veces se comete. env.js ya lo corta en producción; acá se ve antes.
 */
const formaDeMercadoPago = nombre => {
  const valor = String(process.env[nombre] ?? '').trim()

  if (!valor) return ''
  if (valor.startsWith('TEST-')) return `${valor.length} caracteres · PRUEBA (TEST-)`
  if (valor.startsWith('APP_USR-')) return `${valor.length} caracteres · productiva (APP_USR-)`

  return `${valor.length} caracteres · prefijo desconocido`
}

// ─── EL CATÁLOGO ─────────────────────────────────────────────────────────────
//
// No están las ~280 variables que menciona el código: la enorme mayoría son
// perillas con un valor por defecto razonable, y listarlas sepultaría lo que
// importa. Están las que, si faltan o están mal, cuestan plata, cortan el
// servicio o abren un agujero.
//
// `gravedad`:
//   critica  sin esto el sistema no arranca o no funciona nada
//   seria    arranca y funciona, pero algo queda roto EN SILENCIO
//   aviso    conviene tenerla; su ausencia tiene un default aceptable
//
// `rompe` es lo que pasa si falta, en una línea. Un informe que dice
// «FALTA REDIS_URL» y nada más obliga a ir a buscar al código qué significa.

const CATALOGO = [
  // ── Base de datos y sesión ────────────────────────────────────────────
  {
    grupo: 'Base y sesión',
    nombres: ['MONGODB_URL', 'MONGO_URI'],
    gravedad: 'critica',
    rompe: 'sin base de datos no hay nada',
  },
  {
    grupo: 'Base y sesión',
    nombres: ['JWT_SECRET'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'nadie puede iniciar sesión',
    // env.js exige 32 en producción, y que los tres secretos sean distintos:
    // con uno solo, filtrar cualquiera compromete sesión, refresh y CSRF.
    minimo: 32,
  },
  {
    grupo: 'Base y sesión',
    nombres: ['REFRESH_TOKEN_SECRET'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'las sesiones se caen al expirar el access token',
    minimo: 32,
  },
  {
    grupo: 'Base y sesión',
    nombres: ['COOKIE_SECRET'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'las cookies firmadas y el CSRF dejan de validar',
    minimo: 32,
  },
  {
    grupo: 'Base y sesión',
    nombres: ['AI_AGENT_SECRET_ENCRYPTION_KEY'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'no se pueden descifrar las credenciales guardadas de los comercios',
  },
  {
    grupo: 'Base y sesión',
    nombres: ['REDIS_URL'],
    gravedad: 'seria',
    rompe: 'los límites de tasa pasan a contarse por instancia: con dos, el tope real se duplica',
  },

  // ── Correo ────────────────────────────────────────────────────────────
  {
    grupo: 'Correo',
    nombres: ['EMAIL_FROM'],
    gravedad: 'critica',
    rompe: 'no hay remitente y no sale ningún correo',
  },
  {
    grupo: 'Correo',
    nombres: ['EMAIL_PASS', 'SENDGRID_API_KEY'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'SendGrid no autentica',
    esCredencial: true,
    // Sólo se exige si es el proveedor activo: con EMAIL_PROVIDER=resend esta
    // variable deja de ser crítica y pasa a ser el respaldo.
    siProveedor: 'sendgrid',
  },
  {
    grupo: 'Correo',
    nombres: ['RESEND_API_KEY'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'Resend no autentica',
    esCredencial: true,
    siProveedor: 'resend',
  },
  {
    grupo: 'Correo',
    nombres: ['AWS_ACCESS_KEY_ID'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'Amazon SES no autentica',
    esCredencial: true,
    siProveedor: 'ses',
  },
  {
    grupo: 'Correo',
    nombres: ['AWS_SECRET_ACCESS_KEY'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'Amazon SES no autentica',
    esCredencial: true,
    siProveedor: 'ses',
  },
  // Los rebotes, UNO POR PROVEEDOR Y NO LOS TRES JUNTOS.
  //
  // Agrupados en una sola entrada, tener cargada la clave de SendGrid daría
  // por cubierto el webhook de Resend — y si Resend es el proveedor activo,
  // los rebotes que no llegan son los suyos. La misma falsa tranquilidad que
  // la detección de respaldo evita más abajo.
  {
    grupo: 'Correo',
    nombres: ['SENDGRID_WEBHOOK_PUBLIC_KEY'],
    gravedad: 'seria',
    pista: forma,
    rompe: 'no llegan los rebotes de SendGrid: un correo descartado se ve como entregado',
    siProveedor: 'sendgrid',
  },
  {
    grupo: 'Correo',
    nombres: ['RESEND_WEBHOOK_SECRET'],
    gravedad: 'seria',
    pista: forma,
    rompe: 'no llegan los rebotes de Resend: un correo descartado se ve como entregado',
    siProveedor: 'resend',
  },
  {
    grupo: 'Correo',
    nombres: ['SES_SNS_TOPIC_ARN'],
    gravedad: 'seria',
    rompe: 'no llegan los rebotes de SES: un correo descartado se ve como entregado',
    siProveedor: 'ses',
  },

  // LO QUE HACE QUE MIGRAR A SES SIRVA PARA ALGO.
  //
  // El aislamiento de reputación por comercio es la única razón de peso para
  // mudarse a SES, y degrada en silencio: sin estas dos el correo sale igual
  // y la reputación vuelve a ser compartida. O sea que el día de la migración
  // todo parece andar y lo que se fue a buscar no está pasando.
  {
    grupo: 'Correo',
    nombres: ['AWS_ACCOUNT_ID'],
    gravedad: 'seria',
    pista: forma,
    // Doce dígitos exactos: un alias de cuenta pasa el "está cargada" y
    // falla al armar el ARN, degradando a reputación compartida sin avisar.
    valido: isValidAwsAccountId,
    malFormado: 'tiene que ser el número de cuenta de AWS: doce dígitos exactos',
    rompe:
      'sin el número de cuenta no se arma el ARN y NO se aísla la reputación por comercio: ' +
      'una tienda que rebota puede frenar el envío de todas',
    siProveedor: 'ses',
  },
  {
    grupo: 'Correo',
    nombres: ['SES_CONFIGURATION_SET'],
    gravedad: 'seria',
    rompe:
      'SES lo exige asociado al inquilino para enviar en su nombre: sin él el alta del ' +
      'comercio queda a medias y no se aísla la reputación',
    siProveedor: 'ses',
  },
  {
    grupo: 'Correo',
    nombres: ['AWS_REGION'],
    gravedad: 'aviso',
    rompe: 'se usa us-east-1 por omisión; para Argentina conviene sa-east-1',
    siProveedor: 'ses',
  },

  // ── Techos de gasto de IA ─────────────────────────────────────────────
  {
    grupo: 'Gasto de IA',
    nombres: ['AI_PLATFORM_MONTHLY_USD_BUDGET'],
    gravedad: 'seria',
    rompe: 'no hay disyuntor EN PLATA: el gasto en dólares no tiene techo y nada lo corta',
  },
  {
    grupo: 'Gasto de IA',
    nombres: ['AI_PLATFORM_MONTHLY_TOKEN_BUDGET'],
    gravedad: 'seria',
    rompe: 'no hay disyuntor en volumen: el consumo no tiene techo',
  },
  {
    grupo: 'Gasto de IA',
    nombres: ['USD_ARS_RATE'],
    gravedad: 'aviso',
    rompe:
      'el margen de todos los comercios se calcula con un dólar por defecto (se puede cargar desde el panel)',
  },
  {
    grupo: 'Gasto de IA',
    nombres: ['PLAN_PRICE_ARS_STARTER'],
    gravedad: 'aviso',
    rompe:
      'el margen no tiene ingreso contra el que restar el costo (se puede cargar desde el panel)',
  },
  {
    grupo: 'Gasto de IA',
    nombres: ['PLAN_PRICE_ARS_PRO'],
    gravedad: 'aviso',
    rompe: 'ídem para el plan pro',
  },
  {
    grupo: 'Gasto de IA',
    nombres: ['PLATFORM_INFRA_MONTHLY_COST_USD'],
    gravedad: 'aviso',
    rompe: 'el margen ignora el costo de infraestructura y sale optimista',
  },

  // ── Proveedores externos ──────────────────────────────────────────────
  {
    grupo: 'Proveedores',
    nombres: ['GEMINI_API_KEY'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'no funciona ninguna función de IA',
  },
  {
    grupo: 'Proveedores',
    nombres: ['MP_ACCESS_TOKEN', 'MERCADOPAGO_ACCESS_TOKEN'],
    gravedad: 'critica',
    pista: formaDeMercadoPago,
    rompe: 'no se puede cobrar',
  },
  {
    grupo: 'Proveedores',
    nombres: ['MP_WEBHOOK_SECRET', 'MERCADOPAGO_WEBHOOK_SECRET'],
    gravedad: 'seria',
    pista: forma,
    rompe: 'los avisos de pago no se validan: cualquiera puede declarar una orden como pagada',
  },
  {
    grupo: 'Proveedores',
    nombres: ['CLOUDINARY_API_SECRET', 'CLOUDINARY_URL'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'no se pueden subir imágenes de productos',
  },
  {
    grupo: 'Proveedores',
    nombres: ['TURNSTILE_SECRET_KEY'],
    gravedad: 'seria',
    pista: forma,
    rompe: 'el registro queda sin protección contra bots',
  },
  {
    grupo: 'Proveedores',
    nombres: ['TAVILY_API_KEY'],
    gravedad: 'aviso',
    pista: forma,
    rompe: 'el análisis de mercado se queda sin búsqueda web',
  },

  // ── Plataforma ────────────────────────────────────────────────────────
  {
    grupo: 'Plataforma',
    nombres: ['JOBS_TRIGGER_SECRET'],
    gravedad: 'seria',
    pista: forma,
    rompe:
      'los ocho trabajos periódicos no corren: el plan de Render duerme el servicio y el scheduler externo no puede despertarlo',
  },
  {
    grupo: 'Plataforma',
    nombres: ['PLATFORM_OWNER_EMAILS'],
    gravedad: 'seria',
    rompe: 'nadie puede entrar a los reportes de plataforma (gasto de IA, margen)',
  },
  {
    grupo: 'Plataforma',
    nombres: ['PRODUCT_ANALYSIS_AGENT_KEYS_JSON'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'el agente de análisis de producto no autentica',
  },
  {
    grupo: 'Plataforma',
    nombres: ['WHATSAPP_VERIFY_TOKEN'],
    gravedad: 'critica',
    pista: forma,
    rompe: 'Meta no puede verificar el webhook y no entra ningún mensaje',
  },
  {
    grupo: 'Plataforma',
    nombres: ['ROOT_DOMAIN', 'PRODUCTION_DOMAIN'],
    gravedad: 'critica',
    rompe: 'no se resuelve ningún dominio de comercio',
  },
  {
    grupo: 'Plataforma',
    nombres: ['ALLOWED_ROOT_DOMAINS'],
    gravedad: 'critica',
    rompe: 'CORS rechaza a todos los comercios',
  },
  {
    grupo: 'Plataforma',
    nombres: ['CLIENT_URL', 'SHOP_FRONTEND_URL'],
    gravedad: 'critica',
    rompe: 'los enlaces de los correos apuntan a ninguna parte',
  },
  {
    grupo: 'Plataforma',
    nombres: ['ADMIN_URL', 'ADMIN_FRONTEND_URL'],
    gravedad: 'critica',
    rompe: 'los enlaces al panel apuntan a ninguna parte',
  },
]

// ─── INTERRUPTORES PELIGROSOS ────────────────────────────────────────────────
//
// No es que falten: es que su presencia en producción es el problema. env.js
// ya corta el arranque con casi todos, pero este script corre ANTES del
// deploy, que es cuando sirve enterarse.

const PELIGROSOS = [
  ['CORS_ALLOW_ALL', 'cualquier sitio puede llamar a la API con credenciales'],
  ['DISABLE_SSL_VERIFY', 'se aceptan certificados inválidos: habilita intercepción de tráfico'],
  ['ALLOW_LOCALHOST', 'se admite localhost como origen válido'],
  ['AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS', 'se leen credenciales de comercios sin cifrar'],
  ['PAYMENT_DEBUG_RESPONSE', 'las respuestas de pago exponen detalle interno'],
  ['AI_AGENT_DEBUG', 'se registran los prompts completos, que incluyen datos del comprador'],
]

const esVerdadero = nombre => /^(1|true|yes|on)$/i.test(String(process.env[nombre] ?? '').trim())

// ─── INFORME ─────────────────────────────────────────────────────────────────

const proveedorDeCorreo = (process.env.EMAIL_PROVIDER || 'sendgrid').trim().toLowerCase()

const ICONO = { critica: '🔴', seria: '🟠', aviso: '🟡' }

const faltantes = { critica: [], seria: [], aviso: [] }
const porGrupo = new Map()

for (const entrada of CATALOGO) {
  // Las credenciales de correo sólo son críticas para el proveedor activo.
  // Para los demás son el RESPALDO, y eso se informa aparte y con otro peso.
  const esDeOtroProveedor = entrada.siProveedor && entrada.siProveedor !== proveedorDeCorreo
  const gravedad = esDeOtroProveedor ? 'aviso' : entrada.gravedad

  const cargada = primeroCargado(entrada.nombres)
  const etiqueta = entrada.nombres.join(' / ')

  const filas = porGrupo.get(entrada.grupo) || []

  if (cargada) {
    const pista = entrada.pista ? entrada.pista(cargada) : ''

    /**
     * ESTAR CARGADA NO ES ESTAR BIEN, Y DARLO POR EQUIVALENTE YA COSTÓ.
     *
     * Este chequeo miraba sólo presencia. Con `AWS_ACCOUNT_ID` puesto a un
     * alias de cuenta en vez de los doce dígitos, el informe decía ✅ y el
     * runtime lo trataba como ausente: el ARN no se arma, la asociación del
     * inquilino falla, y el envío degrada a reputación compartida EN
     * SILENCIO. O sea que el preflight declaraba sana justo la migración que
     * no iba a aislar nada — el mismo defecto que vino a cerrar.
     *
     * `valido` lo comprueba con la MISMA función que usa el runtime, no con
     * una copia: dos reglas que tienen que coincidir y viven en dos archivos
     * terminan discrepando, que es exactamente cómo apareció esto.
     */
    const problema =
      entrada.minimo && largo(cargada) < entrada.minimo
        ? `${pista}, y hacen falta al menos ${entrada.minimo}`
        : entrada.valido && !entrada.valido(process.env[cargada])
          ? entrada.malFormado
          : null

    filas.push({
      ok: !problema,
      texto: problema
        ? `❌ ${etiqueta} — ${problema}`
        : `✅ ${cargada}${pista ? ` — ${pista}` : ''}`,
    })

    if (problema) faltantes[gravedad].push(etiqueta)
  } else {
    // El motivo por el que esta falta no es grave: no es el proveedor que
    // está enviando. Se dice distinto según qué sea la variable — para una
    // credencial, cargarla te DA un respaldo; para un webhook, no.
    const nota = esDeOtroProveedor
      ? ` (${entrada.esCredencial ? 'sería el respaldo de correo' : 'de un proveedor que no es el activo'})`
      : ''

    filas.push({ ok: false, texto: `${ICONO[gravedad]} ${etiqueta} — ${entrada.rompe}${nota}` })
    faltantes[gravedad].push(etiqueta)
  }

  porGrupo.set(entrada.grupo, filas)
}

console.log(`\n═══ Entorno: ${process.env.NODE_ENV || 'development'} ═══`)
console.log(`Proveedor de correo activo: ${proveedorDeCorreo}\n`)

for (const [grupo, filas] of porGrupo) {
  console.log(`── ${grupo}`)
  filas.forEach(fila => console.log(`   ${fila.texto}`))
  console.log('')
}

/**
 * Cuándo un proveedor de correo está realmente en condiciones de enviar.
 *
 * REPLICA `estaConfigurado()` DE emailProviders.js, Y LA DIFERENCIA IMPORTA.
 *
 * SendGrid sirve con CUALQUIERA de sus dos variables —EMAIL_PASS alcanza como
 * API key—, pero SES necesita LAS DOS: con el id de acceso y sin el secreto no
 * firma nada. Tratar las dos listas igual (preguntar sólo si hay "alguna")
 * haría que este informe anunciara un respaldo que no existe, que es
 * exactamente la falsa tranquilidad que el script viene a evitar.
 */
const CREDENCIAL_DE_CORREO = {
  sendgrid: { nombres: ['EMAIL_PASS', 'SENDGRID_API_KEY'], todas: false },
  resend: { nombres: ['RESEND_API_KEY'], todas: true },
  ses: { nombres: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], todas: true },
}

const proveedoresListos = Object.entries(CREDENCIAL_DE_CORREO)
  .filter(([, { nombres, todas }]) => (todas ? nombres.every(hay) : nombres.some(hay)))
  .map(([id]) => id)

const respaldos = proveedoresListos.filter(id => id !== proveedorDeCorreo)

console.log('── Respaldo de correo')
if (respaldos.length === 0) {
  console.log(
    '   🟠 SIN RESPALDO — si el proveedor activo se cae, no sale un solo correo de ninguna tienda.',
  )
  console.log(
    '      Pasó el 13/10/2026: SendGrid se quedó sin créditos y se cortó el correo de todas.',
  )
} else {
  console.log(`   ✅ Detrás de ${proveedorDeCorreo}: ${respaldos.join(', ')}`)
}
console.log('')

const encendidos = PELIGROSOS.filter(([nombre]) => esVerdadero(nombre))

if (encendidos.length > 0) {
  console.log('── Interruptores peligrosos ENCENDIDOS')
  encendidos.forEach(([nombre, consecuencia]) => console.log(`   🔴 ${nombre} — ${consecuencia}`))
  console.log('')
}

// ─── VEREDICTO ───────────────────────────────────────────────────────────────

const resumen = [
  faltantes.critica.length ? `${faltantes.critica.length} críticas` : null,
  faltantes.seria.length ? `${faltantes.seria.length} serias` : null,
  faltantes.aviso.length ? `${faltantes.aviso.length} avisos` : null,
]
  .filter(Boolean)
  .join(' · ')

console.log(`── Resumen: ${resumen || 'sin faltantes'}\n`)

// Y por último, si el arranque real pasaría. Se intenta DESPUÉS del informe
// porque config/env.js lanza ante el primer problema: si se importara arriba,
// este script moriría sin decir nada de lo de abajo.
if (esProduccion) {
  try {
    await import('../../config/env.js')
    console.log('✅ Las validaciones de arranque de producción pasan.\n')
  } catch (error) {
    console.log(`🔴 El arranque en producción FALLARÍA: ${error.message}\n`)
    process.exitCode = 1
  }
}

// Código de salida distinto de cero sólo ante faltantes críticos o un
// interruptor peligroso: así sirve como paso previo a un deploy sin que un
// aviso lo frene.
if (faltantes.critica.length > 0 || encendidos.length > 0) process.exitCode = 1
