import Color from '../models/colorModel.js'
import asyncHandler from 'express-async-handler'
import { isValidObjectId } from '../utils/requestContext.js'
import logger from '../../config/logger.js'

// Crear un nuevo color
export const createColor = asyncHandler(async (req, res) => {
  let { title } = req.body
  if (!title || title.trim().length < 2) {
    return res.status(400).json({ success: false, message: 'El título es obligatorio y debe tener al menos 2 caracteres' })
  }

  title = title.trim().toLowerCase()

  const existingColor = await Color.findOne({ title })
  if (existingColor) {
    return res.status(409).json({ success: false, message: 'El color ya existe' })
  }

  const newColor = await Color.create({ title })
  logger.info(`Color creado: ${title} (ID: ${newColor._id})`)
  res.status(201).json({ success: true, data: newColor })
})

// Obtener todos los colores con paginación
export const getAllColors = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 20
  const skip = (page - 1) * limit

  const [colors, total] = await Promise.all([
    Color.find().skip(skip).limit(limit).sort({ title: 1 }),
    Color.countDocuments(),
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
  const { id } = req.params
  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  const color = await Color.findById(id)
  if (!color) {
    return res.status(404).json({ success: false, message: 'Color no encontrado' })
  }

  res.status(200).json({ success: true, data: color })
})

// Actualizar un color
export const updateColor = asyncHandler(async (req, res) => {
  const { id } = req.params
  let { title } = req.body

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  if (!title || title.trim().length < 2) {
    return res.status(400).json({ success: false, message: 'El título debe tener al menos 2 caracteres' })
  }

  title = title.trim().toLowerCase()

  const duplicate = await Color.findOne({ title })
  if (duplicate && duplicate._id.toString() !== id) {
    return res.status(409).json({ success: false, message: 'Ya existe un color con ese nombre' })
  }

  const updatedColor = await Color.findByIdAndUpdate(
    id,
    { title },
    { new: true, runValidators: true },
  )

  if (!updatedColor) {
    return res.status(404).json({ success: false, message: 'Color no encontrado' })
  }

  logger.info(`Color actualizado: ${title} (ID: ${updatedColor._id})`)
  res.status(200).json({ success: true, data: updatedColor })
})

// Eliminar un color
export const deleteColor = asyncHandler(async (req, res) => {
  const { id } = req.params
  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  const deletedColor = await Color.findByIdAndDelete(id)
  if (!deletedColor) {
    return res.status(404).json({ success: false, message: 'Color no encontrado' })
  }

  logger.warn(`Color eliminado: ${deletedColor.title} (ID: ${deletedColor._id})`)
  res.status(200).json({ success: true, message: 'Color eliminado correctamente' })
})
