import Color from '../models/colorModel.js'
import asyncHandler from 'express-async-handler'
import {
  getTenantIdFromRequest,
  isValidObjectId,
  toObjectId,
} from '../utils/requestContext.js'
import logger from '../../config/logger.js'

const resolveTenantId = req => {
  const tenantId = getTenantIdFromRequest(req)
  if (!tenantId) {
    const error = new Error('Tenant no identificado')
    error.statusCode = 401
    throw error
  }

  return tenantId
}

// Crear un nuevo color
export const createColor = asyncHandler(async (req, res) => {
  const tenantId = resolveTenantId(req)
  let { title } = req.body
  if (!title || title.trim().length < 2) {
    return res.status(400).json({ success: false, message: 'El título es obligatorio y debe tener al menos 2 caracteres' })
  }

  title = title.trim().toLowerCase()

  const existingColor = await Color.findOne({ title, tenantId: toObjectId(tenantId) })
  if (existingColor) {
    return res.status(409).json({ success: false, message: 'El color ya existe' })
  }

  const newColor = await Color.create({ title, tenantId })
  logger.info(`Color creado: ${title} (ID: ${newColor._id}, tenant: ${tenantId})`)
  res.status(201).json({ success: true, data: newColor })
})

// Obtener todos los colores con paginación
export const getAllColors = asyncHandler(async (req, res) => {
  const tenantId = resolveTenantId(req)
  const page = parseInt(req.query.page) || 1
  const limit = Math.min(parseInt(req.query.limit) || 20, 100)
  const skip = (page - 1) * limit
  const filter = { tenantId: toObjectId(tenantId) }

  const [colors, total] = await Promise.all([
    Color.find(filter).skip(skip).limit(limit).sort({ title: 1 }),
    Color.countDocuments(filter),
  ])

  res.status(200).json({
    success: true,
    data: colors,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  })
})

// Obtener un color por ID
export const getColorById = asyncHandler(async (req, res) => {
  const tenantId = resolveTenantId(req)
  const { id } = req.params
  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  const color = await Color.findOne({ _id: id, tenantId: toObjectId(tenantId) })
  if (!color) {
    return res.status(404).json({ success: false, message: 'Color no encontrado' })
  }

  res.status(200).json({ success: true, data: color })
})

// Actualizar un color
export const updateColor = asyncHandler(async (req, res) => {
  const tenantId = resolveTenantId(req)
  const { id } = req.params
  let { title } = req.body

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  if (!title || title.trim().length < 2) {
    return res.status(400).json({ success: false, message: 'El título debe tener al menos 2 caracteres' })
  }

  title = title.trim().toLowerCase()

  const duplicate = await Color.findOne({ title, tenantId: toObjectId(tenantId) })
  if (duplicate && duplicate._id.toString() !== id) {
    return res.status(409).json({ success: false, message: 'Ya existe un color con ese nombre' })
  }

  const updatedColor = await Color.findOneAndUpdate(
    { _id: id, tenantId: toObjectId(tenantId) },
    { title },
    { new: true, runValidators: true },
  )

  if (!updatedColor) {
    return res.status(404).json({ success: false, message: 'Color no encontrado' })
  }

  logger.info(`Color actualizado: ${title} (ID: ${updatedColor._id}, tenant: ${tenantId})`)
  res.status(200).json({ success: true, data: updatedColor })
})

// Eliminar un color
export const deleteColor = asyncHandler(async (req, res) => {
  const tenantId = resolveTenantId(req)
  const { id } = req.params
  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  const deletedColor = await Color.findOneAndDelete({ _id: id, tenantId: toObjectId(tenantId) })
  if (!deletedColor) {
    return res.status(404).json({ success: false, message: 'Color no encontrado' })
  }

  logger.warn(`Color eliminado: ${deletedColor.title} (ID: ${deletedColor._id}, tenant: ${tenantId})`)
  res.status(200).json({ success: true, message: 'Color eliminado correctamente' })
})
