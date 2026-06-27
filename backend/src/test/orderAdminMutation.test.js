import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  FULFILLMENT_STATUS,
} from '../models/orderModel.js'
import { ensureAdminOrManager } from '../services/orderExecutionService.js'
import { orderRequiresForceDeletion } from '../services/orderAdminMutationService.js'
import { LEGACY_ORDER_STATUS } from '../controller/orderCtrl.js'

describe('order admin mutation guards', () => {
  test.each(['admin', 'moderator', 'manager', 'owner', 'superadmin'])(
    'allows %s to mutate orders',
    role => {
      expect(() => ensureAdminOrManager({ user: { role } })).not.toThrow()
    },
  )

  test.each(['user', 'guest', undefined, null])(
    'rejects %s from mutating orders',
    role => {
      expect(() => ensureAdminOrManager({ user: { role } })).toThrow(
        expect.objectContaining({
          statusCode: 403,
        }),
      )
    },
  )

  test('requires force when deleting paid or delivered orders', () => {
    expect(
      orderRequiresForceDeletion({
        order: {
          paymentStatus: PAYMENT_STATUS.APPROVED,
          orderStatus: ORDER_STATUS.OPEN,
          fulfillmentStatus: FULFILLMENT_STATUS.UNFULFILLED,
        },
        legacyOrderStatus: LEGACY_ORDER_STATUS,
      }).protectedOrder,
    ).toBe(true)

    expect(
      orderRequiresForceDeletion({
        order: {
          paymentStatus: PAYMENT_STATUS.PENDING,
          orderStatus: ORDER_STATUS.DELIVERED,
          fulfillmentStatus: FULFILLMENT_STATUS.DELIVERED,
        },
        legacyOrderStatus: LEGACY_ORDER_STATUS,
      }).protectedOrder,
    ).toBe(true)
  })
})
