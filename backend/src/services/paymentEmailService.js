import {
  dispatchApprovedOrderEmails,
} from './orderEmailService.js'

/**
 * Compatibilidad para consumidores existentes.
 * El envío es directo, idempotente y se persiste en la orden; no existe una
 * cola ficticia ni un worker que pueda quedar desconectado del proceso.
 */
export const dispatchApprovedPaymentEmails = async options => {
  return dispatchApprovedOrderEmails(options)
}

export const queuePaymentEmails = dispatchApprovedPaymentEmails

export default {
  dispatchApprovedPaymentEmails,
  queuePaymentEmails,
}
