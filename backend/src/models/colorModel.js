import mongoose from 'mongoose'

const colorSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'El nombre del color es obligatorio'],
      unique: true,
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

const Color = mongoose.model('Color', colorSchema)

export default Color
