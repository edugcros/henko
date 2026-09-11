// Tokenización de tarjeta.
//
// El checkout mandaba `simulated_token_${Date.now()}` — un string inventado —
// con un comentario al lado que decía que en producción habría que llamar a la
// API de verdad. Mercado Pago contestaba "Card token service bad request", que
// era exactamente cierto: ese token no existía.
//
// Lo que se prueba acá es que lo que viaja sea un token de Mercado Pago y que
// los datos lleguen en el formato que su SDK espera, que es donde una tarjeta
// válida se rechaza por una tontería de formato.

import { jest } from '@jest/globals'

const { createCardToken } = await import('./mercadoPagoTokenizer.js')

const mockCreateCardToken = jest.fn()

const montarSdk = () => {
  window.MercadoPago = jest.fn(function MercadoPagoMock() {
    this.createCardToken = mockCreateCardToken
  })
}

const TARJETA = {
  cardNumber: '4509 9535 6623 3704',
  expiryMonth: '3',
  expiryYear: '30',
  cvv: '123',
}

const TITULAR = {
  cardholderName: '  Eduardo Greco  ',
  identificationType: 'DNI',
  identificationNumber: '32.680.474',
}

beforeEach(() => {
  jest.clearAllMocks()
  montarSdk()
  mockCreateCardToken.mockResolvedValue({ id: 'tok-real-de-mercadopago' })
})

afterEach(() => {
  delete window.MercadoPago
})

describe('createCardToken', () => {
  test('devuelve el token de Mercado Pago, no uno inventado', async () => {
    const token = await createCardToken({
      publicKey: 'APP_USR-abc',
      card: TARJETA,
      holder: TITULAR,
    })

    expect(token).toBe('tok-real-de-mercadopago')
    expect(token).not.toMatch(/^simulated_token_/)
  })

  test('usa la clave pública que se le pasa', async () => {
    // Tiene que ser la de HENKO: el token lo consume la cuenta que cobra. Con la
    // del comercio sale un token que la plataforma no puede usar.
    await createCardToken({ publicKey: 'APP_USR-henko', card: TARJETA, holder: TITULAR })

    expect(window.MercadoPago).toHaveBeenCalledWith(
      'APP_USR-henko',
      expect.objectContaining({ locale: 'es-AR' }),
    )
  })

  test('sin clave pública no intenta nada', async () => {
    await expect(
      createCardToken({ publicKey: '', card: TARJETA, holder: TITULAR }),
    ).rejects.toThrow(/clave pública/i)

    expect(mockCreateCardToken).not.toHaveBeenCalled()
  })

  test('manda los datos como los espera el SDK', async () => {
    await createCardToken({ publicKey: 'APP_USR-abc', card: TARJETA, holder: TITULAR })

    expect(mockCreateCardToken).toHaveBeenCalledWith({
      // Sin espacios: el formulario los muestra, el SDK no los quiere.
      cardNumber: '4509953566233704',
      cardholderName: 'Eduardo Greco',
      // Con cero adelante: "3" no es un mes válido para Mercado Pago.
      cardExpirationMonth: '03',
      // El formulario pide dos dígitos, que es lo que dice la tarjeta; el SDK
      // quiere cuatro.
      cardExpirationYear: '2030',
      securityCode: '123',
      identificationType: 'DNI',
      // Sin puntos: así lo escribe cualquiera y así lo rechazaría el SDK.
      identificationNumber: '32680474',
    })
  })

  test('un año de cuatro dígitos se respeta', async () => {
    await createCardToken({
      publicKey: 'APP_USR-abc',
      card: { ...TARJETA, expiryYear: '2031' },
      holder: TITULAR,
    })

    expect(mockCreateCardToken.mock.calls[0][0].cardExpirationYear).toBe('2031')
  })

  test('si Mercado Pago no devuelve id, falla en vez de mandar vacío', async () => {
    // Mandar un token vacío produciría el mismo rechazo confuso de antes.
    mockCreateCardToken.mockResolvedValue({})

    await expect(
      createCardToken({ publicKey: 'APP_USR-abc', card: TARJETA, holder: TITULAR }),
    ).rejects.toThrow(/token de tarjeta/i)
  })
})
