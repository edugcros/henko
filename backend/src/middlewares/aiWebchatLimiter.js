// 📁 src/middlewares/aiWebchatLimiter.js
import rateLimit from 'express-rate-limit'

export const aiWebchatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados mensajes. Esperá un momento y volvé a intentar.',
  },
})