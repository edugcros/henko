import { body, validationResult } from 'express-validator'

export const validateCouponCreation = [
  body('description').notEmpty().withMessage('La descripción es requerida'),
  body('discountType').isIn(['percentage', 'fixed_amount']).withMessage('Tipo de descuento inválido'),
  body('discountValue').isFloat({ min: 0 }).withMessage('El valor de descuento debe ser positivo'),
  body('startDate').isISO8601().withMessage('Fecha de inicio inválida'),
  body('endDate').isISO8601().withMessage('Fecha de fin inválida'),
  (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() })
    }
    next()
  },
]

export const validateCouponApplication = [
  body('code').notEmpty().withMessage('El código de cupón es requerido'),
  body('cartItems').isArray({ min: 1 }).withMessage('Se requieren items en el carrito'),
  body('subtotal').isFloat({ min: 0 }).withMessage('Subtotal inválido'),
  (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() })
    }
    next()
  },
]