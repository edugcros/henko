import { validationResult } from 'express-validator'
import { sendResponse } from '../utils/response.js'

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg)
    return sendResponse(res, 400, false, 'Error de validación', errorMessages)
  }
  next()
}
