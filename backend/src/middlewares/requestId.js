// 📁 src/middlewares/requestId.js
//
// Un identificador por request, para poder unir lo que vio el usuario con lo
// que quedó en el log.
//
// POR QUÉ HACE FALTA
//
// El errorHandler dejó de devolverle al cliente el mensaje interno de los
// errores 500 — decía cosas como el host de Mongo o la ruta de un archivo. Pero
// si a cambio solo se devuelve "ocurrió un error", el comercio que reporta el
// problema no tiene nada que dar y quien investiga no tiene por dónde empezar.
// El identificador es lo que reemplaza al mensaje: no dice nada de la
// infraestructura y alcanza para encontrar la línea exacta del log.
//
// SOBRE EL ENCABEZADO ENTRANTE
//
// Se acepta un `x-request-id` del cliente para poder seguir una operación que
// nace en el navegador, pero solo si tiene forma inofensiva. Un valor de
// cliente que se copia sin mirar termina en el log y en un encabezado de
// respuesta: ahí se inyectan saltos de línea, se parte el log en dos y se
// falsifican entradas. Si no pasa el filtro se genera uno propio en vez de
// rechazar la request — el identificador es para diagnosticar, no un control de
// acceso.

import { randomUUID } from 'node:crypto'

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/

const readInboundId = req => {
  const raw = req.headers['x-request-id']
  const value = Array.isArray(raw) ? raw[0] : raw

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return SAFE_REQUEST_ID.test(trimmed) ? trimmed : null
}

export const requestId = (req, res, next) => {
  req.id = readInboundId(req) || randomUUID()

  // Se devuelve siempre, no solo ante un error: permite correlacionar una
  // request lenta o un resultado raro sin que haya habido excepción.
  res.setHeader('X-Request-Id', req.id)

  next()
}

export default requestId
