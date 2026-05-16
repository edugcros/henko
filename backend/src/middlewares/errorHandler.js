
import { buildFrontendUrl } from '../utils/frontendUrl.js'


export const notFound = (req, res) => {
  // Si la ruta incluye '/reset-password/', devolver HTML sí o sí
  if (req.originalUrl.includes('/reset-password/')) {
    const token = req.originalUrl.split('/reset-password/')[1]
    const resetUrl = buildFrontendUrl(`/reset-password/${token}`, req)

    console.log('Token detectado en URL:', req.originalUrl)
    // Forzar la respuesta en HTML directamente
    return res.status(404).type('html').send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Enlace Inválido</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            background-color: #f4f4f9;
            color: #333;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .container {
            background-color: #fff;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            text-align: center;
            width: 90%;
            max-width: 500px;
          }
          h1 {
            color: #d9534f;
            margin-bottom: 20px;
          }
          p {
            font-size: 16px;
            line-height: 1.5;
            margin-bottom: 20px;
          }
          .token {
            background-color: #f1f1f1;
            padding: 10px;
            border-radius: 5px;
            font-family: 'Courier New', Courier, monospace;
            word-break: break-word;
            margin-bottom: 20px;
            color: #555;
          }
          .btn {
            display: inline-block;
            background-color: #007bff;
            color: white;
            padding: 12px 25px;
            border-radius: 5px;
            text-decoration: none;
            font-size: 16px;
            transition: background-color 0.3s ease;
          }
          .btn:hover {
            background-color: #0056b3;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Token!</h1>
          <div class="token">${token}</div>
        </div>
        </br>
        <div class="container">
          <h1>IR a!</h1>
          <button class="btn">
          <a href="${resetUrl}" target="_blank" style="padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">
      Restablecer Contraseña
    </a>
    </button>
        </div>
      </body>
      </html>
    `)
  }

  // Para cualquier otra ruta, devolver JSON
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.originalUrl}`,
  })
}

// 📁 src/middlewares/errorHandler.js

export const errorHandler = (err, req, res) => { // Agregamos 'next'
  let statusCode = res.statusCode !== 200 ? res.statusCode : (err.status || 500)

  // 1. Mongoose Validation
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message)
    return res.status(400).json({
      success: false,
      error: 'Error de validación',
      messages, // Cambiado de 'errors' a 'messages' para consistencia
    })
  } 
    

  // 2. Mongoose CastError (ID inválido)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'ID inválido',
      message: `El recurso con id '${err.value}' no es válido.`,
    })
  }

  // 3. CSRF (EBADCSRFTOKEN)
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      success: false,
      error: 'Token CSRF inválido',
      message: 'La sesión de seguridad es inválida. Recarga la página.',
    })
  }

  // 4. Respuesta Final Genérica
  // Usamos 'err' (la variable definida en los argumentos)
  res.status(statusCode).json({
    success: false,
    error: err.name || 'Error del servidor',
    message: err.message || 'Algo salió mal',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  })
}