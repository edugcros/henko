import asyncHandler from 'express-async-handler'
import Tenant from '../models/tenantModel.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'
import { describeMpAccount } from '../services/paymentTenantConfigService.js'

const clean = value => String(value ?? '').trim()

const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, { requireUserTenant: true }).tenantId

const ALLOWED_MODES = new Set(['test', 'production'])

const formatMpResponse = mp => ({
  mode: mp.mode || 'test',
  publicKey: mp.publicKey || '',
  hasAccessToken: Boolean(mp.accessToken),
  isEnabled: Boolean(mp.isEnabled),
  connectedAt: mp.connectedAt || null,
  updatedAt: mp.updatedAt || null,
})

export const getPaymentConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const tenant = await Tenant.findById(tenantId)
    .select('integrations.mercadopago')
    .lean()

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  return res.status(200).json({
    success: true,
    data: { mercadopago: formatMpResponse(tenant.integrations?.mercadopago || {}) },
  })
})

export const updatePaymentConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const body = req.body?.mercadopago || {}

  const mode = clean(body.mode)
  const publicKey = clean(body.publicKey)
  const accessToken = clean(body.accessToken)
  const isEnabled = Boolean(body.isEnabled)

  if (mode && !ALLOWED_MODES.has(mode)) {
    return res.status(400).json({
      success: false,
      message: 'Modo inválido. Usar "test" o "production".',
    })
  }

  const current = await Tenant.findById(tenantId)
    .select('+integrations.mercadopago.accessToken')

  if (!current) {
    return res.status(404).json({ success: false, message: 'Tenant no encontrado' })
  }

  const currentMp = current.integrations?.mercadopago || {}
  const hasExistingToken = Boolean(currentMp.accessToken)

  if (isEnabled && !publicKey) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere la Public Key para habilitar Mercado Pago.',
    })
  }

  if (isEnabled && !accessToken && !hasExistingToken) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere el Access Token para habilitar Mercado Pago.',
    })
  }

  if (publicKey && mode) {
    const pkMode = publicKey.startsWith('TEST-') ? 'test'
      : publicKey.startsWith('APP_USR-') ? 'production'
        : null
    if (pkMode && pkMode !== mode) {
      return res.status(400).json({
        success: false,
        message: `La Public Key es de modo "${pkMode}" pero seleccionaste "${mode}".`,
      })
    }
  }

  if (accessToken && mode) {
    const tkMode = accessToken.startsWith('TEST-') ? 'test'
      : accessToken.startsWith('APP_USR-') ? 'production'
        : null
    if (tkMode && tkMode !== mode) {
      return res.status(400).json({
        success: false,
        message: `El Access Token es de modo "${tkMode}" pero seleccionaste "${mode}".`,
      })
    }
  }

  // EL PREFIJO NO ALCANZA PARA "PRODUCTION"
  //
  // Los chequeos de arriba comparan prefijos, y con eso se atrapa el caso
  // obvio: una credencial TEST- declarada como productiva. Lo que no se ve es
  // el inverso silencioso — una cuenta de PRUEBA de Mercado Pago emite
  // credenciales APP_USR-, indistinguibles de las reales sin preguntar.
  //
  // Un comercio que guarde esas creyendo que ya cobra tiene una tienda que
  // parece funcionar: el checkout abre, la tarjeta se aprueba, el cliente
  // recibe su comprobante. La plata no existe. Se entera semanas después.
  //
  // Por eso se le pregunta a Mercado Pago, y por eso corta si no se puede
  // preguntar: guardar credenciales es algo que se hace un puñado de veces por
  // comercio, y volver a intentar cuesta un click. Dejar pasar lo que no
  // pudimos verificar cuesta la venta entera.
  const modoEfectivo = mode || clean(currentMp.mode)

  if (accessToken && modoEfectivo === 'production') {
    let cuenta

    try {
      cuenta = await describeMpAccount(accessToken)
    } catch (error) {
      return res.status(503).json({
        success: false,
        message:
          'No pudimos verificar la cuenta con Mercado Pago. Probá de nuevo en un minuto.',
        code: error.code || 'MP_ACCOUNT_LOOKUP_FAILED',
      })
    }

    if (cuenta.isTestAccount) {
      return res.status(400).json({
        success: false,
        code: 'MP_TEST_ACCOUNT_IN_PRODUCTION',
        message:
          `Estas credenciales son de una cuenta de prueba de Mercado Pago (${cuenta.nickname}). ` +
          'Empiezan con APP_USR- igual que las reales, pero los pagos no cobran nada. ' +
          'Copiá las de tu cuenta verdadera, o elegí el modo "test".',
      })
    }
  }

  const $set = {
    'integrations.mercadopago.isEnabled': isEnabled,
    'integrations.mercadopago.updatedAt': new Date(),
  }

  if (mode) $set['integrations.mercadopago.mode'] = mode
  if (publicKey) $set['integrations.mercadopago.publicKey'] = publicKey
  if (accessToken) $set['integrations.mercadopago.accessToken'] = accessToken

  if (isEnabled && !currentMp.connectedAt) {
    $set['integrations.mercadopago.connectedAt'] = new Date()
  }

  const tenant = await Tenant.findByIdAndUpdate(
    tenantId,
    { $set },
    { new: true },
  ).select('integrations.mercadopago')

  return res.status(200).json({
    success: true,
    data: { mercadopago: formatMpResponse(tenant.integrations?.mercadopago || {}) },
  })
})
