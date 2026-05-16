import logger from '../../config/logger.js'

const debugAuth = (req, res, next) => {
  logger.info({
    path: req.originalUrl,
    method: req.method,
    authorization: req.headers.authorization,
    cookieToken: req.cookies?.token,
    cookies: req.cookies,
    origin: req.headers.origin,
  })

  next()
}

export default debugAuth
