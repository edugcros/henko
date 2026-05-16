import Brand from '../models/brandModel.js'
import asyncHandler from 'express-async-handler'
import mongoose from 'mongoose'
import logger from '../../config/logger.js'

// Crear una nueva marca
export const createBrand = asyncHandler(async (req, res) => {
  let { title } = req.body

  if (!title || title.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: 'El título de la marca es obligatorio y debe tener al menos 2 caracteres',
    })
  }

  title = title.trim().toUpperCase()

  const existingBrand = await Brand.findOne({ title })
  if (existingBrand) {
    return res.status(409).json({
      success: false,
      message: 'La marca ya existe',
    })
  }

  const newBrand = await Brand.create({ title })
  logger.info(`Marca creada: ${title} (ID: ${newBrand._id})`)
  res.status(201).json({ success: true, data: newBrand })
})

// Obtener todas las marcas con paginación
export const getAllBrands = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 20
  const skip = (page - 1) * limit

  const [brands, total] = await Promise.all([
    Brand.find().skip(skip).limit(limit).sort({ title: 1 }),
    Brand.countDocuments(),
  ])

  res.status(200).json({
    success: true,
    data: brands,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  })
})

// Obtener una marca por ID
export const getBrandById = asyncHandler(async (req, res) => {
  const { id } = req.params
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  const brand = await Brand.findById(id)
  if (!brand) {
    return res.status(404).json({ success: false, message: 'Marca no encontrada' })
  }

  res.status(200).json({ success: true, data: brand })
})

// Actualizar una marca
export const updateBrand = asyncHandler(async (req, res) => {
  const { id } = req.params
  let { title } = req.body

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  if (!title || title.trim().length < 2) {
    return res.status(400).json({ success: false, message: 'El título debe tener al menos 2 caracteres' })
  }

  title = title.trim().toUpperCase()

  const updatedBrand = await Brand.findByIdAndUpdate(
    id,
    { title },
    { new: true, runValidators: true },
  )

  if (!updatedBrand) {
    return res.status(404).json({ success: false, message: 'Marca no encontrada' })
  }

  logger.info(`Marca actualizada: ${title} (ID: ${updatedBrand._id})`)
  res.status(200).json({ success: true, data: updatedBrand })
})

// Eliminar una marca
export const deleteBrand = asyncHandler(async (req, res) => {
  const { id } = req.params
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  const deletedBrand = await Brand.findByIdAndDelete(id)
  if (!deletedBrand) {
    return res.status(404).json({ success: false, message: 'Marca no encontrada' })
  }

  logger.warn(`Marca eliminada: ${deletedBrand.title} (ID: ${deletedBrand._id})`)
  res.status(200).json({ success: true, message: 'Marca eliminada correctamente' })
})
