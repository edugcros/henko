import mongoose from 'mongoose'
import sanitizeHtml from 'sanitize-html'
import { tenantPlugin } from './tenantPlugin.js'

const enqSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      minlength: [2, 'El nombre debe tener al menos 2 caracteres'],
      maxlength: [50, 'El nombre no puede exceder los 50 caracteres'],
    },
    email: {
      type: String,
      required: [true, 'El correo electrónico es obligatorio'],
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: v => /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v),
        message: props => `${props.value} no es un correo válido`,
      },
    },
    mobile: {
      type: String,
      required: [true, 'El número de teléfono es obligatorio'],
      trim: true,
      validate: {
        // 🔥 Sincronizada con el controlador: + opcional y 10-15 dígitos
        validator: v => /^\+?[0-9]{10,15}$/.test(v),
        message: props => `${props.value} no es un formato de teléfono válido (ej: +541122334455)`,
      },
    },
    comment: {
      type: String,
      required: [true, 'El comentario es obligatorio'],
      minlength: [10, 'El comentario debe tener al menos 10 caracteres'],
      maxlength: [1000, 'El comentario no puede exceder los 1000 caracteres'],
    },
    status: {
      type: String,
      default: 'Submitted',
      enum: {
        values: ['Submitted', 'Contacted', 'In Progress', 'Resolved', 'Closed'],
        message: '{VALUE} no es un estado válido',
      },
      index: true,
    },
  },
  { 
    timestamps: true,
  },
)

// Índice compuesto para que el admin vea lo más nuevo de su tienda primero
enqSchema.index({ tenantId: 1, createdAt: -1 })

// 🛡️ Sanitización Hook
enqSchema.pre('save', function (next) {
  const sanitizeOptions = {
    allowedTags: [],
    allowedAttributes: {},
  }

  if (this.isModified('comment')) {
    this.comment = sanitizeHtml(this.comment, sanitizeOptions).trim()
  }
  if (this.isModified('name')) {
    this.name = sanitizeHtml(this.name, sanitizeOptions).trim()
  }
  next()
})

enqSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

const Consultas = mongoose.model('Consultas', enqSchema)
export default Consultas