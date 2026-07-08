// 📁 src/controller/enqCtrl.js
import Consultas from '../models/enqModel.js'
import asyncHandler from 'express-async-handler'
import { sendEmail } from '../utils/sendEmail.js'
import validator from 'validator'
import {
  getTenantIdFromRequest,
  isValidObjectId,
} from '../utils/requestContext.js'
import { escapeRegex } from '../utils/escapeRegex.js'
import logger from '../../config/logger.js'

// 🔴 HELPER: Verificar si el usuario tiene acceso al tenant
/*const hasTenantAccess = (req, enquiryTenantId) => {
  const userTenantId = getTenantIdFromRequest(req)
  const userRole = req.user?.role
  
  // Admin/manager solo ven su tenant
  if (['admin', 'manager'].includes(userRole)) {
    return String(userTenantId) === String(enquiryTenantId)
  }
  
  // Super admin podría ver todos (si lo implementas)
  return false
}*/

// Responder consulta y enviar email
export const replyEnquiry = asyncHandler(async (req, res) => {
  const { id } = req.params
  const { message } = req.body
  const tenantId = getTenantIdFromRequest(req)

  if (!tenantId) {
    return res.status(401).json({ success: false, message: 'No autorizado: Tenant no identificado' })
  }

  if (!message || message.trim().length < 5) {
    return res.status(400).json({ success: false, message: 'La respuesta es muy corta.' })
  }

  // 🔴 BUSCAR CONSULTA POR ID Y TENANT (aislamiento)
  const enquiry = await Consultas.findOne({ _id: id, tenantId })
  if (!enquiry) {
    return res.status(404).json({ success: false, message: 'Consulta no encontrada o no pertenece a este tenant' })
  }

  try {
    const safeMessage = validator.escape(message.trim())

    await sendEmail({
      to: enquiry.email,
      subject: `Respuesta a tu consulta: ${enquiry._id.toString().slice(-6)}`,
      text: message.trim(),
      html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee;">
              <h2>Hola ${enquiry.name},</h2>
              <p>Hemos respondido a tu consulta:</p>
              <blockquote style="background: #f9f9f9; padding: 10px; border-left: 5px solid #ccc;">
                ${enquiry.comment}
              </blockquote>
              <h3>Nuestra respuesta:</h3>
              <p>${safeMessage}</p>
              <br/>
              <p>Saludos,<br/>Equipo de Soporte</p>
            </div>`,
    })

    enquiry.status = 'Resolved'
    await enquiry.save()

    logger.info(`📧 Respuesta enviada a ${enquiry.email} para consulta ${id} (tenant: ${tenantId})`)

    res.status(200).json({
      success: true,
      message: 'Respuesta enviada correctamente al cliente.',
      data: enquiry,
    })
  } catch (error) {
    logger.error(`❌ Error al enviar email de respuesta: ${error.message}`)
    res.status(500).json({ success: false, message: 'Error al enviar el correo electrónico.' })
  }
})

// Crear nueva consulta (pública o desde admin)
export const createEnquiry = asyncHandler(async (req, res) => {
  const { name, email, mobile, comment } = req.body
  
  // El tenant público debe venir del dominio resuelto por middleware, no del body.
  const tenantId = getTenantIdFromRequest(req, { allowBodyTenantId: false })

  // Si viene de un form público sin auth, el tenantId debe venir en el body
  // Si viene del admin, lo tomamos del usuario
  if (!tenantId) {
    logger.error(`❌ Intento de consulta sin tenantId desde: ${req.get('host')}`)
    return res.status(400).json({ 
      success: false, 
      message: 'Error de contexto: No se pudo vincular la consulta a ninguna tienda.', 
    })
  }

  // Validaciones de campos
  if (!name?.trim() || !email?.trim() || !mobile || !comment?.trim()) {
    return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' })
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ success: false, message: 'Email inválido' })
  }

  const cleanMobile = String(mobile).replace(/[\s-]/g, '')
  const mobileRegex = /^\+?[0-9]{10,15}$/
  
  if (!mobileRegex.test(cleanMobile)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Número de teléfono inválido. Debe incluir código de área (ej: +54...)', 
    })
  }

  if (comment.length > 1000) {
    return res.status(400).json({ success: false, message: 'El comentario es demasiado largo' })
  }

  const newConsulta = await Consultas.create({
    name: validator.escape(name.trim()),
    email: email.trim().toLowerCase(),
    mobile: cleanMobile,
    comment: validator.escape(comment.trim()),
    tenantId, // 🔴 Guardamos el tenantId
  })

  logger.info(`📧 Consulta creada ID: ${newConsulta._id} [Tenant: ${tenantId}]`)

  res.status(201).json({ 
    success: true, 
    message: '¡Consulta enviada! Nos pondremos en contacto pronto.',
    data: newConsulta, 
  })
})

// 🔴 CORREGIDO: Obtener consultas del tenant actual (admin) con paginación
export const getAllEnquiries = asyncHandler(async (req, res) => {
  const tenantId = getTenantIdFromRequest(req)
  
  if (!tenantId) {
    return res.status(401).json({ success: false, message: 'No autorizado: Tenant no identificado' })
  }

  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 20
  const skip = (page - 1) * limit

  // 🔴 FILTRO POR TENANT ID (CRÍTICO)
  const filter = { tenantId }

  // Filtros opcionales adicionales
  if (req.query.status) filter.status = req.query.status
  if (req.query.q) {
    const safeRegex = escapeRegex(req.query.q)
    filter.$or = [
      { name: { $regex: safeRegex, $options: 'i' } },
      { email: { $regex: safeRegex, $options: 'i' } },
      { comment: { $regex: safeRegex, $options: 'i' } },
    ]
  }

  const [enquiries, total] = await Promise.all([
    Consultas.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    Consultas.countDocuments(filter), // 🔴 Contar solo del tenant
  ])

  logger.info(`📋 Consultas listadas: ${enquiries.length} de ${total} (tenant: ${tenantId}, page: ${page})`)

  res.status(200).json({
    success: true,
    data: enquiries,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  })
})

// 🔴 CORREGIDO: Obtener una consulta (con verificación de tenant)
export const getEnquiryById = asyncHandler(async (req, res) => {
  const { id } = req.params
  const tenantId = getTenantIdFromRequest(req)

  if (!tenantId) {
    return res.status(401).json({ success: false, message: 'No autorizado' })
  }

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  // 🔴 BUSCAR POR ID Y TENANT
  const enquiry = await Consultas.findOne({ _id: id, tenantId })
  if (!enquiry) {
    return res.status(404).json({ success: false, message: 'Consulta no encontrada' })
  }

  res.status(200).json({ success: true, data: enquiry })
})

// 🔴 CORREGIDO: Actualizar estado (con verificación de tenant)
export const updateEnquiryStatus = asyncHandler(async (req, res) => {
  const { id } = req.params
  const { status } = req.body
  const tenantId = getTenantIdFromRequest(req)

  if (!tenantId) {
    return res.status(401).json({ success: false, message: 'No autorizado' })
  }

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  const allowedStatuses = Consultas.schema.path('status').enumValues
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Estado inválido' })
  }

  // 🔴 ACTUALIZAR SOLO SI PERTENECE AL TENANT
  const updatedEnquiry = await Consultas.findOneAndUpdate(
    { _id: id, tenantId }, 
    { status }, 
    { new: true, runValidators: true },
  )
  
  if (!updatedEnquiry) {
    return res.status(404).json({ success: false, message: 'Consulta no encontrada' })
  }

  logger.info(`📝 Consulta (ID: ${id}) actualizada a estado: ${status} (tenant: ${tenantId})`)
  res.status(200).json({ success: true, data: updatedEnquiry })
})

// 🔴 CORREGIDO: Eliminar consulta (con verificación de tenant)
export const deleteEnquiry = asyncHandler(async (req, res) => {
  const { id } = req.params
  const tenantId = getTenantIdFromRequest(req)

  if (!tenantId) {
    return res.status(401).json({ success: false, message: 'No autorizado' })
  }

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID inválido' })
  }

  // 🔴 ELIMINAR SOLO SI PERTENECE AL TENANT
  const deletedEnquiry = await Consultas.findOneAndDelete({ _id: id, tenantId })
  
  if (!deletedEnquiry) {
    return res.status(404).json({ success: false, message: 'Consulta no encontrada' })
  }

  logger.warn(`🗑️ Consulta eliminada (ID: ${deletedEnquiry._id}, tenant: ${tenantId})`)
  res.status(200).json({ success: true, message: 'Consulta eliminada correctamente' })
})
