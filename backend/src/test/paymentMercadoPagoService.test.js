import { jest } from '@jest/globals'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')

const {
  normalizeMpStatus,
  NEGATIVE_PAYMENT_STATUSES,
} = await import('../services/paymentMercadoPagoService.js')
const { PAYMENT_STATUS } = await import('../models/orderModel.js')

describe('normalizeMpStatus', () => {
  test('mapea los estados básicos ya conocidos', () => {
    expect(normalizeMpStatus('approved')).toBe(PAYMENT_STATUS.APPROVED)
    expect(normalizeMpStatus('pending')).toBe(PAYMENT_STATUS.PENDING)
    expect(normalizeMpStatus('in_process')).toBe(PAYMENT_STATUS.PENDING)
    expect(normalizeMpStatus('rejected')).toBe(PAYMENT_STATUS.REJECTED)
    expect(normalizeMpStatus('cancelled')).toBe(PAYMENT_STATUS.CANCELLED)
    expect(normalizeMpStatus('refunded')).toBe(PAYMENT_STATUS.REFUNDED)
  })

  // Antes de este fix, estos 3 estados reales de Mercado Pago devolvían
  // null — applyMercadoPagoStatusToOrder (paymentOrderService.js) tira un
  // Error en ese caso, así que un webhook o una respuesta síncrona de pago
  // con cualquiera de estos 3 estados rompía el checkout/webhook entero sin
  // actualizar la orden.
  test('mapea authorized (captura diferida) a pending, no a approved', () => {
    expect(normalizeMpStatus('authorized')).toBe(PAYMENT_STATUS.PENDING)
  })

  test('mapea in_mediation (disputa en curso) a pending', () => {
    expect(normalizeMpStatus('in_mediation')).toBe(PAYMENT_STATUS.PENDING)
  })

  test('mapea charged_back (contracargo) a refunded', () => {
    expect(normalizeMpStatus('charged_back')).toBe(PAYMENT_STATUS.REFUNDED)
  })

  test('charged_back cae en NEGATIVE_PAYMENT_STATUSES (libera stock reservado)', () => {
    const mapped = normalizeMpStatus('charged_back')
    expect(NEGATIVE_PAYMENT_STATUSES.has(mapped)).toBe(true)
  })

  test('un estado realmente desconocido sigue devolviendo null (fail-closed)', () => {
    expect(normalizeMpStatus('algo_que_mp_nunca_manda')).toBeNull()
  })

  test('es insensible a mayúsculas y espacios', () => {
    expect(normalizeMpStatus('  APPROVED  ')).toBe(PAYMENT_STATUS.APPROVED)
  })
})
