// 📁 src/validators/promotionalBlockValidator.js
import { body, param, query } from 'express-validator'
import {
  PROMOTIONAL_BLOCK_TYPES,
  PROMOTIONAL_BLOCK_PLACEMENTS,
} from '../models/promotionalBlockModel.js'

// =====================================================
// Helpers
// =====================================================

const validateDateRange = (value, { req }) => {
  const startDate = req.body?.startDate
  const endDate = req.body?.endDate

  if (!startDate || !endDate) return true

  const start = new Date(startDate)
  const end = new Date(endDate)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return true
  }

  if (end <= start) {
    throw new Error('La fecha de fin debe ser posterior a la fecha de inicio.')
  }

  return true
}

const basePromotionalBlockRules = ({ partial = false } = {}) => {
  const maybe = rule => (partial ? rule.optional() : rule)

  return [
    maybe(
      body('title')
        .trim()
        .notEmpty()
        .withMessage('El título es obligatorio.')
        .isLength({ max: 120 })
        .withMessage('El título no puede superar 120 caracteres.'),
    ),

    body('slug')
      .optional()
      .trim()
      .isLength({ max: 140 })
      .withMessage('El slug no puede superar 140 caracteres.'),

    body('type')
      .optional()
      .isIn(PROMOTIONAL_BLOCK_TYPES)
      .withMessage('Tipo de bloque inválido.'),

    body('placement')
      .optional()
      .isIn(PROMOTIONAL_BLOCK_PLACEMENTS)
      .withMessage('Ubicación inválida.'),

    body('description')
      .optional()
      .trim()
      .isLength({ max: 300 })
      .withMessage('La descripción no puede superar 300 caracteres.'),

    body('maxItems')
      .optional()
      .isInt({ min: 1, max: 20 })
      .withMessage('maxItems debe estar entre 1 y 20.'),

    body('priority')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('La prioridad debe estar entre 1 y 100.'),

    maybe(
      body('startDate')
        .notEmpty()
        .withMessage('La fecha de inicio es obligatoria.')
        .isISO8601()
        .withMessage('La fecha de inicio debe ser válida.'),
    ),

    maybe(
      body('endDate')
        .notEmpty()
        .withMessage('La fecha de fin es obligatoria.')
        .isISO8601()
        .withMessage('La fecha de fin debe ser válida.')
        .custom(validateDateRange),
    ),

    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive debe ser booleano.'),

    body('visibility')
      .optional()
      .isIn(['public', 'hidden'])
      .withMessage('Visibilidad inválida.'),

    body('products')
      .optional()
      .isArray({ max: 20 })
      .withMessage('products debe ser un array con máximo 20 productos.'),

    body('products.*.productId')
      .if(body('products').exists())
      .notEmpty()
      .withMessage('Cada producto debe tener productId.')
      .isMongoId()
      .withMessage('ID de producto inválido.'),

    body('products.*.discountPercentage')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage('El descuento debe estar entre 0 y 100.'),

    body('products.*.priority')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('La prioridad del producto debe estar entre 1 y 100.'),

    body('products.*.isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive del producto debe ser booleano.'),
  ]
}

// =====================================================
// Validators
// =====================================================

export const promotionalBlockIdValidator = [
  param('id')
    .isMongoId()
    .withMessage('ID de bloque promocional inválido.'),
]

export const getPromotionalBlocksValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La página debe ser válida.'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('El límite debe estar entre 1 y 100.'),

  query('placement')
    .optional()
    .isIn(PROMOTIONAL_BLOCK_PLACEMENTS)
    .withMessage('Ubicación inválida.'),

  query('type')
    .optional()
    .isIn(PROMOTIONAL_BLOCK_TYPES)
    .withMessage('Tipo inválido.'),
]

export const createPromotionalBlockValidator =
  basePromotionalBlockRules({ partial: false })

export const updatePromotionalBlockValidator =
  basePromotionalBlockRules({ partial: true })

export const togglePromotionalBlockStatusValidator = [
  ...promotionalBlockIdValidator,

  body('isActive')
    .isBoolean()
    .withMessage('isActive debe ser booleano.'),
]