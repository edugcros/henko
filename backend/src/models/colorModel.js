import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const colorSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'El tenantId es obligatorio'],
      index: true,
    },

    title: {
      type: String,
      required: [true, 'El nombre del color es obligatorio'],
      index: true,
      lowercase: true,
      trim: true,
      minlength: [3, 'El nombre del color debe tener al menos 3 caracteres'],
      maxlength: [30, 'El nombre del color no puede superar los 30 caracteres'],
      validate: {
        validator: function (v) {
          // Permitir nombres con letras, espacios y acentos, o códigos hex (#RRGGBB o #RRGGBBAA)
          return /^([a-záéíóúüñ\s]+|#(?:[0-9a-fA-F]{3,4}){1,2})$/.test(v)
        },
        message: props =>
          `${props.value} no es un nombre de color válido ni un código hex correcto.`,
      },
    },
  },
  {
    timestamps: true,
  },
)

colorSchema.index({ tenantId: 1, title: 1 }, { unique: true })

colorSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const Color = mongoose.model('Color', colorSchema)

export default Color
