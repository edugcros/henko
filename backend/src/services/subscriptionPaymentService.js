// 📁 src/services/subscriptionPaymentService.js
// Servicio para procesar pagos de suscripción con Mercado Pago
// Valida plan, crea PaymentIntent y maneja confirmación

import { normalizePlan, getPlanMonthlyPriceArs } from './ai/aiPlanPolicy.js'
import { MercadoPagoConfig, PreApproval } from 'mercadopago'

import { env } from '../../config/env.js'

/**
 * Cliente de SUSCRIPCIONES de Mercado Pago.
 *
 * QUÉ ESTABA MAL
 *
 * subscriptionCtrl construía su cliente con
 * `createMercadoPagoPaymentClient(tenant._id)`, y eso fallaba de tres formas a
 * la vez:
 *
 *   1. Esa función espera un TOKEN DE ACCESO y valida que empiece con
 *      `APP_USR-` o `TEST-`. Le pasaban el id del comercio, así que lanzaba
 *      MP_ACCESS_TOKEN_INVALID y el controlador devolvía 503 antes de tocar
 *      Mercado Pago.
 *   2. Devuelve un cliente de PAGOS. Las suscripciones son otro recurso.
 *   3. El código llamaba `mpClient.subscription.create(...)`, un método que el
 *      cliente de pagos no tiene.
 *
 * O sea que el alta de suscripciones nunca llegó a ejecutarse. No es que se
 * perdían: no se creaba ninguna.
 *
 * DE QUIÉN SON LAS CREDENCIALES
 *
 * De HENKO, no del comercio. Acá el comercio le paga a la plataforma, así que
 * la plata entra a la cuenta de la plataforma. Pasar `tenant._id` sugiere que
 * la intención original era usar las credenciales del propio comercio — eso
 * sería el comercio cobrándose a sí mismo, y además el token de un comercio no
 * puede crear una suscripción a favor de otro.
 */
export const createSubscriptionClient = () => {
  const accessToken = String(env.mercadoPago?.accessToken || '').trim()

  // Mismo criterio que paymentTenantConfigService: si no tiene forma de
  // credencial de Mercado Pago, no se intenta la llamada.
  if (!accessToken.startsWith('APP_USR-') && !accessToken.startsWith('TEST-')) {
    const error = new Error('MP_ACCESS_TOKEN_INVALID')
    error.statusCode = 500
    error.details = 'MP_ACCESS_TOKEN de plataforma ausente o con formato inválido'
    throw error
  }

  return new PreApproval(
    new MercadoPagoConfig({ accessToken, options: { timeout: 15000 } }),
  )
}

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  return value.trim() || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))

/**
 * Construir la suscripción recurrente de Mercado Pago.
 *
 * Los parámetros son los que /preapproval realmente usa.
 *
 * Antes recibía además paymentMethodId, issuerId, payer y autoRenew. Ninguno
 * sobrevivió al contrato real: el medio de pago y el emisor van dentro del token
 * de la tarjeta, el pagador se identifica con payer_email, y la renovación
 * automática es lo que una suscripción es. Mantenerlos en la firma sugería que
 * hacían algo.
 */
export const buildMercadoPagoSubscriptionData = ({
  plan,
  tenantId,
  userId,
  email,
  token,
}) => {
  const normalizedPlan = normalizePlan(plan)
  const priceArs = getPlanMonthlyPriceArs(normalizedPlan)

  // Validar que el plan tenga precio definido
  if (!Number.isFinite(priceArs) || priceArs <= 0) {
    const error = new Error('SUBSCRIPTION_PLAN_INVALID')
    error.statusCode = 400
    error.details = `Plan ${normalizedPlan} no tiene precio definido`
    throw error
  }

  const payerEmail = normalizeEmail(email)

  if (!payerEmail || !isValidEmail(payerEmail)) {
    const error = new Error('PAYER_EMAIL_INVALID')
    error.statusCode = 400
    throw error
  }

  // EL CONTRATO REAL DE /preapproval
  //
  // Verificado contra los tipos del SDK (PreApprovalRequest en
  // clients/preApproval/commonTypes.d.ts). Acepta exactamente:
  // auto_recurring, back_url, card_token_id, external_reference, payer_email,
  // preapproval_plan_id, reason y status. Nada más.
  //
  // Lo que había acá mandaba `payer: { email, name, identification }`. El SDK
  // serializa el body con JSON.stringify tal cual, así que ese objeto viajaba y
  // Mercado Pago lo ignoraba: **el email del suscriptor nunca llegaba**, y es el
  // campo con el que identifica a quién le cobra.
  //
  // Faltaba también `status`. Sin él, Mercado Pago crea la suscripción en
  // 'pending' y devuelve un init_point para que el comprador la autorice a mano.
  // Con un card_token_id y status 'authorized' cobra en el acto, que es lo que
  // este checkout promete.
  //
  // `metadata` e `issuer_id` no son parte del contrato y se van: la correlación
  // con el comercio y el usuario viaja en external_reference, que sí lo es.
  const subscriptionData = {
    reason: `Suscripción Henko Plan ${normalizedPlan}`,
    external_reference: `sub:${tenantId}:${userId}:${Date.now()}`,
    payer_email: payerEmail,
    status: 'authorized',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      // En PESOS, que es lo que cobra HENKO y lo único que admite una
      // suscripción de una cuenta de Mercado Pago argentina. Mandarle USD a una
      // cuenta MLA es un rechazo asegurado, y era lo que estaba escrito.
      transaction_amount: priceArs,
      currency_id: 'ARS',
      // start_date NO se manda, y es a propósito.
      //
      // Iba `new Date().toISOString()` — "ahora". Para cuando el request llega a
      // Mercado Pago, ese "ahora" ya pasó, y su validación es estricta:
      // "Invalid value for auto_recurring.start_date, cannot be a past date".
      // Es una carrera que no se puede ganar: cualquier instante que uno escriba
      // es pasado cuando el otro lo lee.
      //
      // El campo es opcional (AutoRecurringRequest.start_date?) y omitirlo hace
      // que la suscripción arranque ya, que es lo que este checkout quiere.
      // Sumarle unos minutos de colchón sería elegir un número arbitrario para
      // esquivar el problema en vez de sacarlo.
    },
    // ADMIN_BASE_URL no existe en config/env.js: quedaba "undefined/..." y
    // Mercado Pago rechaza una back_url inválida. env.adminUrl sí es
    // obligatoria en producción. La ruta también estaba mal: el router del
    // panel no tiene /subscription/success, sí /admin/mi-suscripcion.
    back_url:
      process.env.SUBSCRIPTION_SUCCESS_URL || `${env.adminUrl}/admin/mi-suscripcion`,
    // notification_url NO se manda, y ahora hay prueba de por qué.
    //
    // No está en PreApprovalRequest, y se comprobó contra una suscripción real:
    // al consultar /preapproval/<id> después de crearla, Mercado Pago devuelve
    // back_url pero NO notification_url. Lo descarta.
    //
    // Los webhooks de suscripción se configuran en el panel de Mercado Pago
    // (Tus integraciones → Webhooks), apuntando a getWebhookUrl(). Mandarlo acá
    // daba la impresión de que el aviso estaba resuelto cuando no lo estaba.
  }

  // Las dos ramas que había acá ponían el mismo card_token_id, así que el
  // paymentMethodId no decidía nada. Se cobra con el token o no se cobra.
  if (token && token !== 'undefined') {
    subscriptionData.card_token_id = token
  }

  return { subscriptionData }
}

/**
 * Mapear errores de Mercado Pago a mensajes amigables
 */
export const mapMercadoPagoSubscriptionError = error => {
  const rawMessage = String(error?.message || '').toLowerCase()

  // EL CAMPO ES `causes`, Y ACÁ SE LEÍA `cause`
  //
  // La clase MercadoPagoError del SDK expone `status`, `error` y `causes` —
  // este último construido desde `body.cause` de la respuesta, pero guardado
  // en plural (ver node_modules/mercadopago/dist/utils/errors/index.js).
  // Leyendo `cause` el array quedaba SIEMPRE vacío, así que ninguna de las
  // ramas de abajo podía disparar por el detalle del proveedor: todo caía en
  // el mensaje genérico.
  //
  // Se conserva `cause` como respaldo por si otra versión del SDK lo expone
  // así: leer los dos no cuesta nada y equivocarse otra vez sí.
  const causas = Array.isArray(error?.causes)
    ? error.causes
    : Array.isArray(error?.cause)
      ? error.cause
      : []

  const causeText = causas
    .map(item => String(item?.description || item?.message || '').toLowerCase())
    .join(' | ')

  // El código del proveedor viaja en `error`, aparte del mensaje. Sin esto,
  // un rechazo cuyo motivo solo está en ese campo se clasifica como genérico.
  const providerCode = String(error?.error || '').toLowerCase()

  const combined = `${rawMessage} ${causeText} ${providerCode}`
  const status = Number(error?.status || error?.statusCode || 400)

  if (
    combined.includes('invalid access token') ||
    combined.includes('access_token') ||
    combined.includes('unauthorized')
  ) {
    return {
      status: 503,
      code: 'MP_ACCESS_TOKEN_INVALID',
      message: 'Mercado Pago no está configurado correctamente',
      details: 'Error de autenticación con Mercado Pago',
    }
  }

  if (
    combined.includes('invalid card token') ||
    combined.includes('card_token') ||
    combined.includes('token not found')
  ) {
    return {
      status: 400,
      code: 'CARD_TOKEN_INVALID',
      message: 'Token de tarjeta inválido',
      details: 'El token de pago expiró o es inválido. Intenta nuevamente.',
    }
  }

  if (combined.includes('security_code') || combined.includes('cvv')) {
    return {
      status: 400,
      code: 'CARD_CVV_INVALID',
      message: 'Código de seguridad inválido',
      details: 'Verifica el CVV de la tarjeta.',
    }
  }

  if (combined.includes('amount')) {
    return {
      status: 400,
      code: 'PAYMENT_AMOUNT_INVALID',
      message: 'Monto de pago inválido',
      details: error?.message || 'Mercado Pago rechazó el monto.',
    }
  }

  return {
    status: 400,
    code: 'SUBSCRIPTION_PAYMENT_ERROR',
    message: 'No se pudo procesar el pago de suscripción',
    details: error?.message || 'Error desconocido',
  }
}

/**
 * Fecha del proveedor, o null. Nunca una inventada.
 *
 * Un valor nulo dice "Mercado Pago todavía no lo informó", y eso es un dato:
 * quien lo lee sabe que no sabe. La versión anterior escribía
 * `Date.now() + 30 días` y producía una fecha que se ve exactamente igual de
 * confiable que una real — el comercio veía "próximo cobro: 15/10" con la misma
 * tipografía viniera de donde viniera, y nadie podía distinguir el dato del
 * supuesto.
 */
const providerDate = value => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Ciclo de facturación tal como lo informa Mercado Pago.
 *
 * `next_payment_date` y `auto_recurring.start_date` son campos del proveedor.
 * `currentPeriodEnd` se deriva del primero y no de un calendario nuestro: en una
 * suscripción que cobra al inicio de cada período, el período vigente termina
 * cuando llega el próximo cobro. Es una definición, no una estimación — y si el
 * proveedor no informó el próximo cobro, queda nula como todo lo demás.
 */
export const readProviderBillingDates = (mpSubscription = {}) => {
  const nextBillingAt = providerDate(mpSubscription?.next_payment_date)

  return {
    currentPeriodStart:
      providerDate(mpSubscription?.summarized?.last_charged_date) ||
      providerDate(mpSubscription?.auto_recurring?.start_date),
    currentPeriodEnd: nextBillingAt,
    nextBillingAt,
  }
}

/**
 * Mapear estado de suscripción MP a nuestro domain
 */
export const mapMercadoPagoSubscriptionStatus = (mpStatus, mpReason) => {
  const status = sanitizeString(mpStatus).toLowerCase()
  const reason = sanitizeString(mpReason).toLowerCase()

  // Estados de MP para suscripciones: authorized, pending, processing, paused, cancelled, suspended
  const statusMap = {
    authorized: 'active',      // Suscripción autorizada y activa
    pending: 'pending',        // Pendiente de confirmación
    processing: 'pending',     // En procesamiento
    paused: 'paused',         // Pausa temporal
    cancelled: 'cancelled',   // Cancelada por usuario
    suspended: 'cancelled',   // Suspendida (timeout de pagos)
  }

  return statusMap[status] || 'pending'
}

/**
 * La misma suscripción, pero para que la autorice el comercio.
 *
 * QUÉ PROBLEMA RESUELVE
 *
 * El checkout cobra en el acto: tokeniza la tarjeta y manda la suscripción con
 * `status: 'authorized'` y `card_token_id`. Cuando esa tarjeta no pasa, el
 * comercio queda en un callejón — no hay forma de elegir otro medio de pago
 * desde nuestra pantalla.
 *
 * Medido el 19/09/2026 con un comercio real: el emisor rechazó una prepaga de
 * Mercado Pago once veces seguidas. El propio panel del vendedor recomendaba
 * "pague con otro medio de pago", y la plataforma no ofrecía ninguno.
 *
 * Sin `card_token_id` y con `status: 'pending'`, Mercado Pago crea la
 * suscripción y devuelve un `init_point`: el comercio entra con SU sesión de
 * Mercado Pago y elige ahí cómo pagar —otra tarjeta, dinero en cuenta, lo que
 * tenga—. Comprobado contra la cuenta de producción: devuelve 201.
 *
 * NO REEMPLAZA AL COBRO DIRECTO
 *
 * Cuando la tarjeta pasa, cobrar en el acto es mejor: una pantalla menos y el
 * comercio queda activo al instante. Esto es el rodeo para cuando no pasa.
 *
 * La suscripción nace en 'pending' y NO activa nada: la autorización llega
 * después por webhook. Devolver un init_point y dar el plan por pagado sería
 * regalar el servicio a quien abandone la pantalla de Mercado Pago.
 */
export const createAuthorizableSubscription = async ({
  plan,
  tenantId,
  userId,
  email,
}) => {
  const { subscriptionData } = buildMercadoPagoSubscriptionData({
    plan,
    tenantId,
    userId,
    email,
    token: null,
  })

  const cliente = createSubscriptionClient()

  const creada = await cliente.create({
    body: { ...subscriptionData, status: 'pending' },
  })

  return {
    id: creada?.id || null,
    status: creada?.status || null,
    // A dónde mandar al comercio. Sin esto el rodeo no existe.
    initPoint: creada?.init_point || null,
  }
}

/**
 * El pago, consultado con la credencial de PLATAFORMA.
 *
 * POR QUÉ HACE FALTA
 *
 * Los avisos de tipo `payment` y `subscription_authorized_payment` traen en
 * `data.id` el id de un PAGO, no el de la suscripción. El id de la suscripción
 * viaja adentro del pago, en `metadata.preapproval_id`. Sin consultarlo no hay
 * forma de saber a qué comercio corresponde el evento.
 *
 * Devuelve null si no se puede leer: un aviso que no se puede resolver no
 * puede tumbar el webhook, y arriba se distingue ese caso del de "no existe".
 */
const pedirAMercadoPago = async ruta => {
  const accessToken = String(env.mercadoPago?.accessToken || '').trim()

  if (!accessToken) return null

  try {
    const res = await fetch(`https://api.mercadopago.com${ruta}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return null

    return await res.json()
  } catch {
    return null
  }
}

export const fetchPlatformPayment = async paymentId => {
  const id = sanitizeString(paymentId)
  if (!id) return null

  return pedirAMercadoPago(`/v1/payments/${encodeURIComponent(id)}`)
}

/**
 * El cobro recurrente de una suscripción.
 *
 * VIVE EN OTRO RECURSO, Y AHÍ ESTUVO EL SEGUNDO TROPIEZO
 *
 * Los avisos `subscription_authorized_payment` traen un id que NO existe en
 * /v1/payments — devuelve 404. Está en /authorized_payments, que es un recurso
 * distinto: comprobado el 19/09/2026 con el id 7032067277, 404 en el primero y
 * 200 en el segundo.
 *
 * Y ahí el dato viene mejor: `preapproval_id` es un campo de primer nivel, sin
 * tener que buscarlo adentro de point_of_interaction, y el cobro real viaja
 * anidado en `payment` con su propio status.
 */
export const fetchAuthorizedPayment = async authorizedPaymentId => {
  const id = sanitizeString(authorizedPaymentId)
  if (!id) return null

  return pedirAMercadoPago(`/authorized_payments/${encodeURIComponent(id)}`)
}

/**
 * De qué suscripción habla este aviso.
 *
 * EL BUG QUE CIERRA
 *
 * El webhook buscaba el comercio con `data.id` tal cual, contra
 * `integrations.subscriptionMercadoPago.subscriptionId`. Para los avisos de
 * suscripción eso está bien. Para los de PAGO no: `data.id` es un id de pago
 * —10 dígitos— y subscriptionId guarda un id de preapproval —32 caracteres
 * hex—. No coinciden nunca.
 *
 * Medido en producción el 19/09/2026 a las 04:05:
 *
 *   type=payment  data.id=179804496028
 *   -> "Tenant no encontrado para suscripción de MP"
 *
 * Y ese pago traía metadata.preapproval_id = 89dc868afe674fd39f84664aea5b5f28.
 * El dato estaba, no se miraba.
 *
 * Los avisos de pago son las RENOVACIONES MENSUALES y los PAGOS RECHAZADOS.
 * Descartarlos todos deja el ciclo de vida de la suscripción ciego justo
 * después del alta — que es el mismo agujero que se creyó cerrado al arreglar
 * el 403 del CSRF.
 *
 * Devuelve también el PAGO cuando lo hubo, para no consultarlo dos veces: el
 * mismo objeto dice de qué suscripción se trata Y si el cobro salió o no.
 *
 * @returns {Promise<{preapprovalId: string|null, payment: Object|null}>}
 */
export const resolveSubscriptionEventTarget = async ({ type, dataId }) => {
  const id = sanitizeString(dataId)
  if (!id) return { preapprovalId: null, payment: null }

  const tipo = sanitizeString(type).toLowerCase()

  // DOS RECURSOS DISTINTOS, Y EL MISMO ERROR DOS VECES SI SE CONFUNDEN
  //
  // `subscription_authorized_payment` es el COBRO RECURRENTE, y su id vive en
  // /authorized_payments. Buscarlo en /v1/payments da 404 — comprobado con el
  // id 7032067277 el 19/09/2026. Ahí el preapproval_id viene de primer nivel y
  // el cobro real viaja anidado en `payment`.
  if (tipo === 'subscription_authorized_payment') {
    const autorizado = await fetchAuthorizedPayment(id)

    return {
      preapprovalId: sanitizeString(autorizado?.preapproval_id) || null,
      // Se devuelve el PAGO anidado, no el envoltorio: el que decide arriba
      // mira `payment.status`, y el del envoltorio ('processed') dice que el
      // aviso se proceso, no que el cobro haya salido.
      payment: autorizado?.payment || null,
    }
  }

  if (tipo !== 'payment') return { preapprovalId: id, payment: null }

  const payment = await fetchPlatformPayment(id)

  // DÓNDE VIVE DE VERDAD EL ID DE LA SUSCRIPCIÓN
  //
  // En `point_of_interaction.transaction_data.subscription_id`. NO en
  // `metadata`: medido sobre el pago 179806584762 del 19/09/2026, metadata
  // llega vacío —`{}`— y el id está solo en esa ruta.
  //
  // La primera versión de esto leía metadata.preapproval_id y resolvía null
  // siempre. El error vino de un script de diagnóstico que imprimía
  // `metadata?.preapproval_id || point_of_interaction?...?.subscription_id`:
  // el valor salía de la segunda rama y se escribió el código contra la
  // primera.
  //
  // Se leen las dos igual. Cuál use Mercado Pago puede depender del tipo de
  // evento o de la versión de su API, y equivocarse de campo otra vez sale
  // más caro que un `||`.
  const preapprovalId =
    sanitizeString(payment?.point_of_interaction?.transaction_data?.subscription_id) ||
    sanitizeString(payment?.metadata?.preapproval_id) ||
    sanitizeString(payment?.metadata?.preapprovalId) ||
    null

  return { preapprovalId, payment }
}

// ─── AUDITORÍA CONTRA EL PROVEEDOR ─────────────────────────────────────────
//
// QUÉ PROBLEMA RESUELVE
//
// El estado de suscripción de un comercio se mantiene por eventos: el alta lo
// escribe el flujo síncrono del panel, y todo lo demás —renovaciones, pagos
// rechazados, cancelaciones— llega SOLO por webhook. Un evento perdido deja
// deriva permanente y silenciosa, y ese estado decide si el comercio puede
// usar la plataforma.
//
// No es hipotético. Medido el 19/09/2026 sobre el único comercio con
// suscripción real:
//
//   Mercado Pago   status: cancelled
//   HENKO          status: authorized · subscriptionStatus: active · plan: pro
//
// La cancelación ocurrió mientras el webhook devolvía 403 —faltaba en
// csrfExemptRoutes— y nunca llegó. Arreglar el webhook evita la deriva futura;
// no reconcilia la que ya existe, y nada la iba a encontrar.
//
// La contabilidad de IA ya tenía esto: auditAccounting compara las tres
// representaciones y avisa. Las suscripciones no tenían nada equivalente, y
// ahí lo que está en juego no son centavos sino el acceso a la plataforma.
//
// NUNCA CORRIGE
//
// Mismo criterio que aiAccountingService, y por el mismo motivo: corregir un
// estado sin que una persona haya mirado la evidencia convierte un fallo de
// lectura en pérdida de datos. Un timeout con Mercado Pago no puede dar de
// baja a un comercio que está pagando.
//
// POR QUÉ USA mapMercadoPagoSubscriptionStatus Y NO COMPARA EL CRUDO
//
// Es el MISMO mapeo que aplica el webhook al recibir un evento. Si la
// auditoría interpretara los estados por su cuenta, podría reportar una deriva
// que el webhook nunca va a cerrar —porque para él no es deriva— y el aviso
// quedaría sonando para siempre.

/** Ni hallazgo ni silencio: no se pudo preguntar. */
const NO_VERIFICABLE = 'no_verificable'

/**
 * Compara el estado guardado de cada suscripción contra el del proveedor.
 *
 * @returns {Promise<SubscriptionAudit>}
 *
 * @typedef {Object} SubscriptionAudit
 * @property {number} checked      - cuántas se pudieron consultar
 * @property {Array}  findings     - las que no coinciden
 * @property {Array}  unverifiable - las que el proveedor no contestó
 * @property {boolean} balanced
 */
export const auditSubscriptions = async ({ Tenant, client = null } = {}) => {
  if (!Tenant) throw new Error('auditSubscriptions requiere el modelo Tenant')

  const tenants = await Tenant.find({
    'integrations.subscriptionMercadoPago.subscriptionId': { $exists: true, $ne: null },
  })
    .select('slug plan subscriptionStatus integrations.subscriptionMercadoPago')
    .lean()

  const findings = []
  const unverifiable = []
  let checked = 0

  // Un solo cliente para todas: crearlo por comercio multiplicaría las
  // conexiones sin ganar nada, y si la credencial no sirve falla una vez.
  const mp = client || createSubscriptionClient()

  for (const tenant of tenants) {
    const guardado = tenant.integrations?.subscriptionMercadoPago || {}
    const subscriptionId = sanitizeString(guardado.subscriptionId)

    let proveedor
    try {
      proveedor = await mp.get({ id: subscriptionId })
    } catch (error) {
      // No saber NO es lo mismo que estar mal. Separarlo es lo que impide que
      // una caída del proveedor se lea como una cancelación masiva.
      unverifiable.push({
        tenantId: String(tenant._id),
        slug: tenant.slug,
        subscriptionId,
        reason: NO_VERIFICABLE,
        message: error?.message || 'sin respuesta',
      })
      continue
    }

    checked += 1

    const esperado = mapMercadoPagoSubscriptionStatus(proveedor?.status, proveedor?.reason || '')
    const almacenado = sanitizeString(tenant.subscriptionStatus)

    if (esperado === almacenado) continue

    findings.push({
      tenantId: String(tenant._id),
      slug: tenant.slug,
      subscriptionId,
      stored: { subscriptionStatus: almacenado, plan: tenant.plan },
      provider: { status: proveedor?.status || null, mapped: esperado },
    })
  }

  return {
    checked,
    findings,
    unverifiable,
    balanced: findings.length === 0,
  }
}

export default {
  buildMercadoPagoSubscriptionData,
  mapMercadoPagoSubscriptionError,
  mapMercadoPagoSubscriptionStatus,
  auditSubscriptions,
}
