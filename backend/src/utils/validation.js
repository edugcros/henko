import mongoose from 'mongoose'
import { sendResponse } from '../utils/response.js'
import { body } from 'express-validator'
import { handleValidationErrors } from '../middlewares/handleValidationErrors.js'


/**
 * Middleware flexible para validar un ObjectId en distintas ubicaciones
 * @param {'user' | 'params' | 'body'} source - De dónde obtener el ID
 * @param {string} key - Clave a validar (por defecto: '_id' o 'id')
 */
export const validateMongoDbIdMiddleware = (source = 'user', key = '_id') => {
  return (req, res, next) => {
    let id

    switch (source) {
    case 'user':
      id = req.user?.[key]
      break
    case 'params':
      id = req.params?.[key]
      break
    case 'body':
      id = req.body?.[key]
      break
    default:
      return sendResponse(res, 400, false, 'Origen de ID no válido')
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendResponse(res, 400, false, `ID inválido: ${id}`)
    }

    next()
  }
}

export const validateBlogFields = [
  body('title')
    .notEmpty()
    .withMessage('El título es obligatorio')
    .isLength({ min: 5 })
    .withMessage('El título debe tener al menos 5 caracteres'),
  body('content')
    .notEmpty()
    .withMessage('El contenido es obligatorio')
    .isLength({ min: 20 })
    .withMessage('El contenido debe tener al menos 20 caracteres'),
  body('description')
    .notEmpty()
    .withMessage('La descripción es obligatoria')
    .isLength({ min: 20 })
    .withMessage('La descripción debe tener al menos 20 caracteres'),
  handleValidationErrors,
]