export const sendResponse = (
  res,
  statusCode,
  success,
  message = null,
  data = null,
  extra = {},
) => {
  const payload = {
    success,
    ...(message !== null && message !== undefined ? { message } : {}),
    ...(data !== null && data !== undefined ? { data } : {}),
    ...extra,
  }

  return res.status(statusCode).json(payload)
}

export const sendSuccessResponse = (
  res,
  data,
  statusCode = 200,
  extra = {},
) => {
  return sendResponse(res, statusCode, true, null, data, extra)
}

export const sendErrorResponse = (
  res,
  message,
  statusCode = 400,
  extra = {},
) => {
  return sendResponse(res, statusCode, false, message, null, extra)
}
