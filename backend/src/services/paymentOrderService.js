import {
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '../models/orderModel.js'
import { Money } from '../utils/money.js'
import { normalizeMpStatus } from './paymentMercadoPagoService.js'

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
