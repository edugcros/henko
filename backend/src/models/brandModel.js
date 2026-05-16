import mongoose from 'mongoose'

const brandSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'El título de la marca es obligatorio'],
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
      minlength: [2, 'El título debe tener al menos 2 caracteres'],
      maxlength: [50, 'El título no puede superar los 50 caracteres'],
      validate: {
        validator: function (v) {
          // Permite letras con acentos, ñ, números y espacios
          return /^[A-ZÁÉÍÓÚÜÑ0-9 ]+$/.test(v)
        },
        message: props =>
          `${props.value} no es un nombre de marca válido. Solo se permiten letras, números y espacios.`,
      },
    },
  },
  {
    timestamps: true,
  },
)

const Brand = mongoose.model('Brand', brandSchema)

export default Brand
