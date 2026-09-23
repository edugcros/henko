import Order, {
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '../models/orderModel.js'
import { Money } from '../utils/money.js'
import { normalizeMpStatus } from './paymentMercadoPagoService.js'
import logger from '../../config/logger.js'

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const canApplyPaymentTransition = (currentStatus, nextStatus) => {
  if (!currentStatus || currentStatus === nextStatus) return true

  const allowedTransitions = {
    [PAYMENT_STATUS.PENDING]: [
      PAYMENT_STATUS.APPROVED,
      PAYMENT_STATUS.REJECTED,
      PAYMENT_STATUS.CANCELLED,
      PAYMENT_STATUS.REFUNDED,
    ],
    [PAYMENT_STATUS.APPROVED]: [PAYMENT_STATUS.REFUNDED],
    [PAYMENT_STATUS.REJECTED]: [],
    [PAYMENT_STATUS.CANCELLED]: [],
    [PAYMENT_STATUS.REFUNDED]: [],
  }

  return allowedTransitions[currentStatus]?.includes(nextStatus) === true
}

/**
 * Comisión real y neto recibido, a partir de la respuesta de un pago de
 * Mercado Pago.
 *
 * Hasta ahora el margen de un producto se calculaba con un porcentaje de
 * comisión cargado a mano en el análisis. Estos son los números que Mercado
 * Pago efectivamente descontó, que es otra cosa: cambian por método de pago,
 * cuotas y acuerdo comercial del vendedor.
 *
 * Dos detalles del dominio que importan:
 *
 * - Solo cuentan las comisiones que paga el VENDEDOR. Mercado Pago informa
 *   también las que absorbe el comprador (fee_payer: 'payer', típicamente el
 *   costo de financiación de las cuotas); sumarlas inflaría el costo del
 *   comercio con plata que nunca puso.
 *
 * - net_received_amount se guarda además de la comisión porque no siempre es
 *   monto menos comisión: retenciones e impuestos aparecen solo ahí.
 *
 * @returns {{ providerFeeCents: number|null, netReceivedCents: number|null }}
 *   null en cada campo que el proveedor no haya informado. Nunca 0: un cero
 *   afirmaría que no hubo comisión, que es distinto de no saberla.
 */
export const extractMercadoPagoFees = mpPayment => {
  const empty = { providerFeeCents: null, netReceivedCents: null }
  if (!mpPayment || typeof mpPayment !== 'object') return empty

  const details = Array.isArray(mpPayment.fee_details) ? mpPayment.fee_details : []

  const collectorFees = details.filter(fee => fee?.fee_payer !== 'payer')

  const feeTotal = collectorFees.reduce((sum, fee) => {
    const amount = Number(fee?.amount)
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
  }, 0)

  const net = Number(mpPayment.transaction_details?.net_received_amount)

  return {
    // Sin fee_details no se informó comisión; con detalles que suman 0 sí se
    // informó, y ese 0 es un dato real.
    providerFeeCents: collectorFees.length ? Money.fromDecimal(feeTotal) : null,
    netReceivedCents: Number.isFinite(net) && net >= 0 ? Money.fromDecimal(net) : null,
  }
}

export const applyMercadoPagoStatusToOrder = ({
  order,
  mpStatus,
  providerPaymentId,
  paymentMethodId = null,
  installments = null,
  payerEmail = null,
  statusDetail = null,
  providerRawStatus = null,
  providerFeeCents = null,
  netReceivedCents = null,
}) => {
  const normalizedPaymentStatus = normalizeMpStatus(mpStatus)

  if (!normalizedPaymentStatus) {
    throw new Error(`Estado de Mercado Pago no soportado: ${mpStatus}`)
  }

  if (
    !canApplyPaymentTransition(
      order.paymentStatus,
      normalizedPaymentStatus,
    )
  ) {
    return order
  }

  order.paymentStatus = normalizedPaymentStatus
  order.paymentIntent.status = normalizedPaymentStatus

  if (providerPaymentId) {
    order.paymentIntent.providerPaymentId = String(providerPaymentId)
  }

  if (providerRawStatus || mpStatus) {
    order.paymentIntent.providerRawStatus = sanitizeString(
      providerRawStatus || mpStatus,
    )
  }

  if (statusDetail) {
    order.paymentIntent.statusDetail = sanitizeString(statusDetail)
  }

  if (paymentMethodId) {
    order.paymentIntent.method = sanitizeString(paymentMethodId).toLowerCase()
  }

  if (installments !== null && installments !== undefined) {
    order.paymentIntent.installments = Number(installments)
  }

  if (payerEmail) {
    order.paymentIntent.payerEmail = normalizeEmail(payerEmail)
  }

  // Comisión real de la pasarela. Solo se escribe cuando el proveedor la
  // informó: pisar un valor conocido con null perdería el dato en cualquier
  // reintento del webhook que llegue sin fee_details.
  if (providerFeeCents !== null && providerFeeCents !== undefined) {
    order.paymentIntent.providerFeeCents = providerFeeCents
  }

  if (netReceivedCents !== null && netReceivedCents !== undefined) {
    order.paymentIntent.netReceivedCents = netReceivedCents
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.APPROVED && !order.paidAt) {
    order.paidAt = new Date()
    order.paymentError = null
    order.paymentErrorCode = null
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.REFUNDED) {
    order.refundStatus = REFUND_STATUS.REFUNDED
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.CANCELLED) {
    order.cancellation.cancelled = true
    order.cancellation.cancelledAt =
      order.cancellation.cancelledAt || new Date()
    order.cancellation.reason =
      order.cancellation.reason || 'Cancelado por Mercado Pago'
  }

  order.syncDerivedState?.()
  return order
}

// =====================================================
// RECONCILIACIÓN FINANCIERA DE ÓRDENES
// =====================================================
//
// El único dominio con plata que no tenía ninguna auditoría. La contabilidad
// de IA tiene tres, las suscripciones una, el historial de precios otra; las
// órdenes —donde entra la plata de verdad— no tenían ninguna.
//
// QUÉ MIRA Y POR QUÉ LO MIRA AHÍ
//
// La aritmética interna (productos = original, original - descuento = cobrado)
// ya la impone un pre('save') de orderModel. Igual se vuelve a comprobar acá,
// por dos motivos: el hook solo corre al guardar el documento, así que no dice
// nada de las filas escritas antes de que existiera; y updateOne/bulkWrite
// saltean el middleware de documento por completo. Hoy los tres caminos que lo
// saltean solo tocan fechas y banderas de email, pero eso es una propiedad de
// hoy, no una garantía.
//
// Lo que NADIE miraba es el otro lado: lo que Mercado Pago dice que pasó.
//
// EL AGUJERO CONCRETO: LAS DEVOLUCIONES PARCIALES
//
// HENKO nunca le pide una devolución a Mercado Pago — markRefunded es un
// cambio de estado, y la plata la devuelve el comerciante desde el panel del
// proveedor. Una devolución TOTAL cambia el status del pago a 'refunded' y el
// webhook la ve. Una PARCIAL no: Mercado Pago deja el pago en 'approved' y
// solo mueve transaction_amount_refunded, que este backend no leía en ningún
// lado. REFUND_STATUS.PARTIAL existe en el enum y no lo escribe nadie.
//
// O sea que si el comerciante devuelve $3.000 de una orden de $10.000, HENKO
// la sigue mostrando cobrada entera, el margen cuenta $10.000 de ingreso, y no
// hay forma de enterarse. Esta auditoría es la única que lo ve.
//
// NO CORRIGE NADA. Un estado de pago equivocado escrito automáticamente puede
// despachar una orden que se devolvió, o retener una que se cobró bien.
//
// Un fallo del proveedor NO cuenta como diferencia: va aparte, en
// `unverifiable`. Si no se pudo preguntar, no se sabe — que es distinto de
// saber que no coincide.

const COBRO_APROBADO = new Set([PAYMENT_STATUS.APPROVED, PAYMENT_STATUS.REFUNDED])

const centavosDeProveedor = valor => {
  const numero = Number(valor)
  return Number.isFinite(numero) && numero >= 0 ? Money.fromDecimal(numero) : null
}

/**
 * Las comprobaciones que no necesitan red.
 *
 * @returns {Array<object>} hallazgos; vacío si la orden cierra sola.
 */
export const checkOrderInternals = order => {
  const hallazgos = []
  const pi = order?.paymentIntent || {}

  const anotar = (kind, detalle) => hallazgos.push({ kind, ...detalle })

  const subtotalProductos = (order?.products || []).reduce(
    (suma, linea) => suma + Number(linea?.subtotalCents || 0),
    0,
  )

  if (subtotalProductos !== Number(pi.originalAmountCents)) {
    anotar('products-vs-original', {
      productos: subtotalProductos,
      original: Number(pi.originalAmountCents),
    })
  }

  const descuento = Number(pi.discountAmountCents || 0)

  if (descuento < 0 || descuento > Number(pi.originalAmountCents)) {
    anotar('discount-out-of-range', {
      descuento,
      original: Number(pi.originalAmountCents),
    })
  }

  const esperado = Number(pi.originalAmountCents) - descuento

  if (Number(pi.amountCents) !== esperado) {
    anotar('amount-mismatch', { cobrado: Number(pi.amountCents), esperado })
  }

  // Un pago aprobado sin id del proveedor no se puede auditar nunca más: es
  // plata que entró sin forma de volver a encontrarla del otro lado.
  if (COBRO_APROBADO.has(order?.paymentStatus) && pi.provider !== 'cod') {
    if (!pi.providerPaymentId) anotar('approved-without-provider-id', {})
    if (!order?.paidAt) anotar('approved-without-paid-at', {})
  }

  const comision = pi.providerFeeCents
  const neto = pi.netReceivedCents
  const cobrado = Number(pi.amountCents)

  if (comision !== null && comision !== undefined) {
    if (Number(comision) < 0 || Number(comision) > cobrado) {
      anotar('fee-out-of-range', { comision: Number(comision), cobrado })
    }
  }

  if (neto !== null && neto !== undefined) {
    if (Number(neto) < 0 || Number(neto) > cobrado) {
      anotar('net-out-of-range', { neto: Number(neto), cobrado })
    }
  }

  // El neto puede ser MENOR que cobrado - comisión, porque hay retenciones e
  // impuestos que solo aparecen en el neto. Mayor no puede ser nunca.
  if (
    comision !== null && comision !== undefined &&
    neto !== null && neto !== undefined &&
    Number(neto) + Number(comision) > cobrado
  ) {
    anotar('net-plus-fee-exceeds-amount', {
      neto: Number(neto),
      comision: Number(comision),
      cobrado,
    })
  }

  return hallazgos
}

/**
 * Compara una orden contra lo que informa Mercado Pago del mismo pago.
 *
 * @param {object} order
 * @param {object} pago respuesta cruda de /v1/payments/{id}
 * @returns {Array<object>}
 */
export const checkOrderAgainstProvider = (order, pago) => {
  const hallazgos = []
  const pi = order?.paymentIntent || {}
  const anotar = (kind, detalle) => hallazgos.push({ kind, ...detalle })

  const estadoProveedor = normalizeMpStatus(pago?.status)

  if (estadoProveedor && estadoProveedor !== order?.paymentStatus) {
    anotar('provider-status-mismatch', {
      henko: order?.paymentStatus,
      proveedor: pago?.status,
      proveedorMapeado: estadoProveedor,
    })
  }

  const montoProveedor = centavosDeProveedor(pago?.transaction_amount)

  if (montoProveedor !== null && montoProveedor !== Number(pi.amountCents)) {
    anotar('provider-amount-mismatch', {
      henko: Number(pi.amountCents),
      proveedor: montoProveedor,
    })
  }

  const netoProveedor = centavosDeProveedor(
    pago?.transaction_details?.net_received_amount,
  )

  if (
    netoProveedor !== null &&
    pi.netReceivedCents !== null &&
    pi.netReceivedCents !== undefined &&
    netoProveedor !== Number(pi.netReceivedCents)
  ) {
    anotar('provider-net-mismatch', {
      henko: Number(pi.netReceivedCents),
      proveedor: netoProveedor,
    })
  }

  // LA DEVOLUCIÓN PARCIAL. Mercado Pago deja el pago en 'approved' y solo
  // mueve este campo, así que el webhook —que mira el status— no ve nada.
  const devuelto = centavosDeProveedor(pago?.transaction_amount_refunded) || 0

  if (devuelto > 0 && order?.refundStatus === REFUND_STATUS.NONE) {
    anotar('provider-refund-unrecorded', {
      devueltoEnProveedor: devuelto,
      cobrado: Number(pi.amountCents),
      total: montoProveedor !== null && devuelto >= montoProveedor,
    })
  }

  // Nunca se puede haber devuelto más de lo cobrado. Si pasa, es el proveedor
  // el que no cierra, y hay que mirarlo igual.
  if (montoProveedor !== null && devuelto > montoProveedor) {
    anotar('provider-refund-exceeds-payment', {
      devuelto,
      cobrado: montoProveedor,
    })
  }

  if (
    order?.refundStatus === REFUND_STATUS.REFUNDED &&
    devuelto === 0 &&
    estadoProveedor !== PAYMENT_STATUS.REFUNDED
  ) {
    anotar('refunded-without-provider-refund', {
      henko: order?.refundStatus,
      proveedor: pago?.status,
    })
  }

  return hallazgos
}

const ALCANCE = 'platform:reconciliacion-financiera-de-ordenes'

const envEnteroPositivo = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre])
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}

/**
 * Recorre las órdenes y devuelve todo lo que no cierra.
 *
 * Solo lectura. Las dependencias de red se inyectan para poder probar la
 * lógica sin tocar Mercado Pago; por defecto se cargan con import dinámico,
 * así el SDK no entra en el grafo de todos los que importan este módulo.
 *
 * @returns {Promise<{
 *   checked: number, checkedAgainstProvider: number, balanced: boolean,
 *   findings: Array<object>, unverifiable: Array<object>,
 * }>}
 */
export const auditOrderFinancials = async ({
  tenantId = null,
  since = null,
  limit = 500,
  withProvider = true,
  resolveTenantContext = null,
  fetchProviderPayment = null,
} = {}) => {
  const filtro = { isDeleted: false }
  if (tenantId) filtro.tenantId = tenantId
  if (since) filtro.createdAt = { $gte: since }

  const ordenes = await Order.find(filtro)
    .sort({ createdAt: -1 })
    .limit(limit)
    .setOptions({ ignoreTenant: !tenantId, platformScope: ALCANCE })
    .lean()

  const findings = []
  const unverifiable = []

  const describir = orden => ({
    orderId: String(orden._id),
    tenantId: orden.tenantId ? String(orden.tenantId) : null,
    orderNumber: orden.idempotencyKey?.slice(-8)?.toUpperCase() || null,
    amountCents: Number(orden.paymentIntent?.amountCents || 0),
  })

  for (const orden of ordenes) {
    for (const hallazgo of checkOrderInternals(orden)) {
      findings.push({ ...describir(orden), ...hallazgo, source: 'internal' })
    }
  }

  if (!withProvider) {
    return {
      checked: ordenes.length,
      checkedAgainstProvider: 0,
      balanced: findings.length === 0,
      findings,
      unverifiable,
    }
  }

  // Solo las que tienen un pago del proveedor al cual preguntarle. Las de
  // efectivo contra entrega no pasan por Mercado Pago.
  const consultables = ordenes.filter(
    o =>
      o.paymentIntent?.provider === 'mercadopago' &&
      o.paymentIntent?.providerPaymentId,
  )

  if (!consultables.length) {
    return {
      checked: ordenes.length,
      checkedAgainstProvider: 0,
      balanced: findings.length === 0,
      findings,
      unverifiable,
    }
  }

  const traerContexto =
    resolveTenantContext ||
    (await import('./paymentTenantConfigService.js')).getTenantMercadoPagoContext

  const crearCliente = fetchProviderPayment
    ? null
    : (await import('./paymentTenantConfigService.js')).createMercadoPagoPaymentClient

  // Un comercio, un token, un cliente. Resolverlo por orden pediría las
  // credenciales del mismo comercio una vez por orden.
  const porComercio = new Map()

  for (const orden of consultables) {
    const clave = String(orden.tenantId)
    if (!porComercio.has(clave)) porComercio.set(clave, [])
    porComercio.get(clave).push(orden)
  }

  let consultadas = 0

  for (const [comercio, susOrdenes] of porComercio) {
    let leerPago = fetchProviderPayment

    if (!leerPago) {
      try {
        const contexto = await traerContexto(comercio)

        if (!contexto?.accessToken) {
          for (const orden of susOrdenes) {
            unverifiable.push({
              ...describir(orden),
              reason: 'sin credenciales de Mercado Pago',
            })
          }
          continue
        }

        const cliente = crearCliente(contexto.accessToken)
        leerPago = ({ paymentId }) => cliente.get({ id: paymentId })
      } catch (error) {
        for (const orden of susOrdenes) {
          unverifiable.push({ ...describir(orden), reason: error.message })
        }
        continue
      }
    }

    for (const orden of susOrdenes) {
      try {
        const pago = await leerPago({
          paymentId: orden.paymentIntent.providerPaymentId,
          tenantId: comercio,
        })

        consultadas += 1

        for (const hallazgo of checkOrderAgainstProvider(orden, pago)) {
          findings.push({ ...describir(orden), ...hallazgo, source: 'provider' })
        }
      } catch (error) {
        // Que el proveedor no conteste NO es una diferencia. Meterlo en
        // findings convertiría un problema de red en una alarma de plata.
        unverifiable.push({ ...describir(orden), reason: error.message })
      }
    }
  }

  return {
    checked: ordenes.length,
    checkedAgainstProvider: consultadas,
    balanced: findings.length === 0,
    findings,
    unverifiable,
  }
}

let cicloRef = null
let arranqueRef = null

export const runOrderReconciliation = async ({ since = null } = {}) => {
  try {
    // Por defecto solo las de los últimos 30 días: una devolución parcial
    // vieja ya se detectó en su momento, y preguntarle al proveedor por el
    // historial entero en cada pasada es una llamada por orden sin fecha de
    // vencimiento.
    const dias = envEnteroPositivo('ORDER_RECONCILIATION_DAYS', 30)
    const desde = since || new Date(Date.now() - dias * 86400000)

    const auditoria = await auditOrderFinancials({ since: desde })

    if (auditoria.balanced && !auditoria.unverifiable.length) {
      logger.info('[ORDENES] Todo cierra contra Mercado Pago', {
        revisadas: auditoria.checked,
        consultadasAlProveedor: auditoria.checkedAgainstProvider,
      })
      return auditoria
    }

    if (auditoria.unverifiable.length) {
      logger.warn('[ORDENES] Hubo órdenes que no se pudieron verificar', {
        cantidad: auditoria.unverifiable.length,
        motivos: [...new Set(auditoria.unverifiable.map(u => u.reason))].slice(0, 5),
      })
    }

    if (!auditoria.balanced) {
      logger.error('[ORDENES] Hay órdenes que no cierran', {
        revisadas: auditoria.checked,
        diferencias: auditoria.findings.length,
        porTipo: auditoria.findings.reduce((acc, f) => {
          acc[f.kind] = (acc[f.kind] || 0) + 1
          return acc
        }, {}),
        detalle: auditoria.findings.slice(0, 20),
      })

      const { notifyOrderReconciliation } = await import('./ai/aiBudgetNotifier.js')
      await notifyOrderReconciliation(auditoria)
    }

    return auditoria
  } catch (error) {
    logger.error('[ORDENES] La reconciliación falló', { error: error.message })
    return null
  }
}

export const startOrderReconciliation = ({ logger: log = logger } = {}) => {
  if (process.env.ORDER_RECONCILIATION_ENABLED === 'false') {
    log.info?.('[ORDENES] Reconciliación automática deshabilitada')
    return
  }

  if (cicloRef) return

  // Cada seis horas: cada pasada es una llamada a Mercado Pago por orden
  // reciente, y una devolución parcial no es una urgencia de minutos.
  const intervalMs = envEnteroPositivo(
    'ORDER_RECONCILIATION_INTERVAL_MS',
    6 * 60 * 60 * 1000,
  )
  const arranqueMs = envEnteroPositivo('ORDER_RECONCILIATION_ON_START_MS', 240 * 1000)

  arranqueRef = setTimeout(() => {
    runOrderReconciliation().catch(error => {
      log.error?.('[ORDENES] La pasada de arranque falló', { error: error.message })
    })
  }, arranqueMs)

  arranqueRef.unref?.()

  cicloRef = setInterval(() => {
    runOrderReconciliation().catch(error => {
      log.error?.('[ORDENES] El ciclo falló', { error: error.message })
    })
  }, intervalMs)

  cicloRef.unref?.()

  log.info?.('[ORDENES] Reconciliación automática iniciada', {
    intervalHours: Math.round(intervalMs / 3600000),
    primeraPasadaEnSegundos: Math.round(arranqueMs / 1000),
  })
}

export const stopOrderReconciliation = () => {
  if (arranqueRef) {
    clearTimeout(arranqueRef)
    arranqueRef = null
  }

  if (cicloRef) {
    clearInterval(cicloRef)
    cicloRef = null
  }
}
