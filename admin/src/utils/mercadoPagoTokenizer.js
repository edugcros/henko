// Tokenización de tarjeta con el SDK de Mercado Pago.
//
// POR QUÉ EXISTE
//
// El checkout mandaba `simulated_token_${Date.now()}` con este comentario al
// lado: "En producción, aquí se llamaría a la API de Mercado Pago para crear el
// card token. Por ahora, simulamos el flujo." La tarjeta nunca se tokenizaba,
// así que Mercado Pago recibía un string inventado y contestaba "Card token
// service bad request". No era un bug: era el paso que faltaba.
//
// POR QUÉ EN EL NAVEGADOR Y NO EN EL BACKEND
//
// Es el punto del mecanismo. El número de tarjeta viaja del navegador a Mercado
// Pago y vuelve convertido en un token de un solo uso; HENKO nunca ve el número
// ni lo guarda ni lo registra. Mandar la tarjeta al backend para tokenizarla
// desde ahí funcionaría igual y pondría datos de tarjeta en logs, en memoria del
// servidor y dentro del alcance de cualquier auditoría de PCI.
//
// CON QUÉ CLAVE
//
// Con la de HENKO, que la sirve /subscriptions/config. El token lo tiene que
// crear la misma cuenta que después lo consume, y esta suscripción la cobra la
// plataforma. Con la clave del comercio saldría un token que la cuenta de HENKO
// no puede usar, y el rechazo no dice eso: dice que el token está mal.

const SDK_URL = 'https://sdk.mercadopago.com/js/v2'

let sdkPromise = null

/** Carga el SDK una sola vez, aunque se llame desde varios lugares. */
const loadSdk = () => {
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    const existente = document.querySelector(`script[src="${SDK_URL}"]`)

    if (existente) {
      existente.addEventListener('load', () => resolve(window.MercadoPago))
      existente.addEventListener('error', () =>
        reject(new Error('No se pudo cargar Mercado Pago')),
      )
      return
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => resolve(window.MercadoPago)
    script.onerror = () => {
      // Se limpia para que un segundo intento vuelva a probar en vez de quedar
      // pegado a una promesa rechazada para siempre.
      sdkPromise = null
      reject(new Error('No se pudo cargar Mercado Pago'))
    }

    document.body.appendChild(script)
  })

  return sdkPromise
}

const soloDigitos = value => String(value || '').replace(/\D/g, '')

/**
 * Convierte los datos de la tarjeta en un token de un solo uso.
 *
 * @returns {Promise<string>} el id del token
 */
export const createCardToken = async ({ publicKey, card, holder }) => {
  if (!publicKey) {
    throw new Error('Falta la clave pública de Mercado Pago')
  }

  const MercadoPago = await loadSdk()
  const mp = new MercadoPago(publicKey, { locale: 'es-AR' })

  // Mercado Pago espera el año de cuatro dígitos. El formulario pide dos, que es
  // lo que dice la tarjeta.
  const anio = soloDigitos(card.expiryYear)
  const expirationYear = anio.length === 2 ? `20${anio}` : anio

  const respuesta = await mp.createCardToken({
    cardNumber: soloDigitos(card.cardNumber),
    cardholderName: String(holder.cardholderName || '').trim(),
    cardExpirationMonth: soloDigitos(card.expiryMonth).padStart(2, '0'),
    cardExpirationYear: expirationYear,
    securityCode: soloDigitos(card.cvv),
    identificationType: holder.identificationType,
    identificationNumber: soloDigitos(holder.identificationNumber),
  })

  if (!respuesta?.id) {
    throw new Error('Mercado Pago no devolvió un token de tarjeta')
  }

  return respuesta.id
}

export default { createCardToken }
