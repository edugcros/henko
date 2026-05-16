export const respondSuccess = (res, statusCode = 200, message = 'OK', data = null) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  })
}

export const respondError = (res, statusCode = 500, message = 'Error', data = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    data,
  })
}

// Alias genérico
export const sendResponse = (res, statusCode, success, message, data = null) => {
  return res.status(statusCode).json({ success, message, data })
}
