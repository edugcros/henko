// 📁 src/pages/CheckoutPage.js
//
// Checkout de la suscripción del comercio a un plan de HENKO.
//
// Lo que esta pantalla cuida, porque es donde el comercio pone la tarjeta:
//
//   - Decir exactamente cuándo se cobra. El backend crea la suscripción en
//     'authorized' y sin start_date (subscriptionPaymentService): se cobra en
//     el acto y se renueva cada mes. Acá decía "los primeros 14 días son
//     gratis, después se cobrará", que era falso: esos 14 días son la prueba
//     de la cuenta, antes de suscribirse.
//   - No dar por pagado lo que no se pagó. Un 202 con status 'pending' no es
//     un cobro aprobado.
//   - No cobrar dos veces. Si el comercio ya tiene la suscripción activa, el
//     cambio de plan es en Mi suscripción: un segundo alta acá crearía una
//     segunda suscripción recurrente en Mercado Pago.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
// CheckCircle es un ícono: venía importado desde '@mui/material', que no lo
// exporta, así que llegaba undefined y React rompía al renderizar el resumen
// del plan.
import { ArrowBack, CheckCircle, HourglassTop, Lock } from '@mui/icons-material'
import api from '@utils/axiosConfig'
import { PLAN_PRESENTATION, SELLABLE_PLANS, formatArs } from '../constants/plans.js'
import { getPlanCatalog } from '../services/subscriptionPlansService.js'
import { CardPayment, initMercadoPago } from '@mercadopago/sdk-react'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  green: '#047857',
  amber: '#b45309',
  red: '#b42318',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// El precio NO está acá. Lo trae /subscriptions/plans, que es de donde sale el
// cobro. Esta pantalla tenía su propia tabla con `priceUsd: 26.14` y el botón
// decía literalmente "Pagar USD 26.14" mientras el backend cobraba 40.000 pesos:
// el número y la moneda del botón estaban los dos mal.
//
// Las cuotas tampoco están acá: vienen con el catálogo, derivadas de los mismos
// topes que el medidor aplica.
const ETIQUETA_CUOTA = {
  vision: 'análisis de imágenes',
  agentMessages: 'mensajes del asistente',
  imageEdits: 'generaciones de fondo con IA',
  marketAnalyses: 'análisis de demanda',
}

// En este orden y solo estas cuatro: son las que el comercio entiende al
// comprar. Las de tokens son un freno técnico, no una promesa de venta.
const CUOTAS_VISIBLES = ['vision', 'agentMessages', 'imageEdits', 'marketAnalyses']

const describirCuotas = limits => {
  if (!limits) return []

  return CUOTAS_VISIBLES.filter(clave => limits[clave] > 0).map(
    clave => `${new Intl.NumberFormat('es-AR').format(limits[clave])} ${ETIQUETA_CUOTA[clave]}/mes`,
  )
}

/**
 * La misma fecha del mes que viene, sin pasarse de mes: del 31/01 al 28/02 y
 * no al 03/03. Es una estimación del próximo cobro —la fecha real la fija
 * Mercado Pago— y se presenta como tal.
 */
export const addOneMonth = date => {
  const next = new Date(date)
  const day = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + 1)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

const formatDate = date =>
  date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Días que le quedan a la prueba gratis, o null si no está en prueba. */
export const trialDaysLeft = (subscriptionStatus, trialEndsAt, now = Date.now()) => {
  if (subscriptionStatus !== 'trialing' || !trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

const REDIRECT_MS = 3000

const CheckoutPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useSelector(state => state.user || {})

  const selectedPlan = searchParams.get('plan') || 'starter'
  const planIsSellable = SELLABLE_PLANS.includes(selectedPlan)
  const planName = PLAN_PRESENTATION[selectedPlan]?.name || selectedPlan

  const [isLoading, setIsLoading] = useState(true)
  const [mpReady, setMpReady] = useState(false)
  const [mpError, setMpError] = useState(null)
  const [account, setAccount] = useState(null)
  // 'loading' | 'ok' | 'error'. Antes un catálogo que no cargaba se mostraba
  // igual que un plan sin precio: "todavía no tiene precio configurado".
  const [catalogState, setCatalogState] = useState('loading')
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [precioArs, setPrecioArs] = useState(null)
  const [cuotas, setCuotas] = useState([])

  const [error, setError] = useState(null)
  // A dónde mandar al comercio cuando su tarjeta no pasa. Lo devuelve el
  // backend en data.initPoint junto con el error del cobro.
  const [initPoint, setInitPoint] = useState(null)
  // null | 'active' | 'pending'
  const [outcome, setOutcome] = useState(null)
  const [subscriptionId, setSubscriptionId] = useState(null)
  const redirectRef = useRef(null)

  useEffect(() => () => clearTimeout(redirectRef.current), [])

  // Trae la clave pública e inicializa el SDK, y con eso el estado de la
  // cuenta: si ya paga, si está en prueba y hasta cuándo.
  useEffect(() => {
    let vigente = true

    const cargarConfig = async () => {
      try {
        const response = await api.get('/subscriptions/config')
        const data = response.data?.data || {}
        const publicKey = data.mpPublicKey

        if (!vigente) return

        setAccount({
          currentPlan: data.currentPlan || null,
          subscriptionStatus: data.subscriptionStatus || null,
          trialEndsAt: data.trialEndsAt || null,
        })

        // Es la clave de HENKO, no la del comercio: el token lo consume la
        // cuenta que cobra, y esta suscripción la cobra la plataforma.
        if (!publicKey) {
          setMpError('El pago con tarjeta no está disponible en este momento.')
          return
        }

        if (!publicKey.startsWith('TEST-') && !publicKey.startsWith('APP_USR-')) {
          setMpError('El pago con tarjeta no está disponible en este momento.')
          return
        }

        initMercadoPago(publicKey, { locale: 'es-AR' })
        setMpReady(true)
      } catch (err) {
        console.error('Error cargando config MP:', err)
        if (vigente) setMpError('No se pudo preparar el pago. Recargá la página para reintentar.')
      } finally {
        if (vigente) setIsLoading(false)
      }
    }

    cargarConfig()

    return () => {
      vigente = false
    }
  }, [])

  useEffect(() => {
    let vigente = true
    setCatalogState('loading')

    getPlanCatalog()
      .then(catalogo => {
        if (!vigente) return

        const fila = (catalogo?.plans || []).find(p => p.plan === selectedPlan)

        setPrecioArs(fila ? fila.monthlyPriceArs : null)
        setCuotas(describirCuotas(fila?.limits))
        setCatalogState('ok')
      })
      .catch(() => {
        // Sin catálogo no se muestra precio ni cuotas. Un respaldo escrito acá
        // sería exactamente el problema que esto vino a sacar.
        if (!vigente) return
        setPrecioArs(null)
        setCuotas([])
        setCatalogState('error')
      })

    return () => {
      vigente = false
    }
  }, [selectedPlan, catalogAttempt])

  const retryCatalog = useCallback(() => setCatalogAttempt(n => n + 1), [])

  const goBack = () => {
    // Abierto desde un enlace directo no hay a dónde volver dentro del panel.
    if (window.history.length > 1) navigate(-1)
    else navigate('/subscripcion')
  }

  /**
   * Lo dispara el Brick de Mercado Pago con la tarjeta YA tokenizada.
   *
   * El Brick dibuja los campos de tarjeta en un iframe propio de Mercado Pago:
   * el número no pasa nunca por nuestro DOM, ni por nuestro estado, ni por
   * nuestros logs. Y trae la detección de medio de pago, las cuotas, el emisor
   * y los tipos de documento correctos sin que haya que mantener nada de eso.
   */
  const onPaymentSubmit = async formData => {
    setError(null)
    setInitPoint(null)

    try {
      const response = await api.post('/subscriptions/process-payment', {
        plan: selectedPlan,
        // El Brick ya tokenizó la tarjeta.
        token: formData.token,
        paymentMethodId: formData.payment_method_id,
        issuerId: formData.issuer_id,
        payer: {
          email: formData.payer?.email || user?.email,
          identification: formData.payer?.identification,
        },
      })

      if (response.data?.success) {
        setSubscriptionId(response.data?.data?.subscriptionId)

        // El backend responde 202 con success: true y status 'pending' cuando
        // Mercado Pago todavía no aprobó. Antes eso mostraba "¡Pago Exitoso!
        // Tu suscripción ha sido activada" y mandaba al panel: un cobro que no
        // ocurrió, presentado como hecho.
        if (response.data?.data?.status === 'pending') {
          setOutcome('pending')
          return
        }

        setOutcome('active')
        redirectRef.current = setTimeout(() => {
          // El panel cuelga de /admin (ver routesConfig.js); '/dashboard' no
          // es una ruta del router y caía en el fallback 404.
          navigate('/admin')
        }, REDIRECT_MS)
      } else {
        setError(response.data?.message || 'No se pudo procesar el pago.')
        setInitPoint(response.data?.data?.initPoint || null)
      }
    } catch (err) {
      console.error('Error en checkout:', err)
      setError(
        err.response?.data?.message ||
          err.response?.data?.data?.details ||
          'No se pudo procesar el pago. Intentá nuevamente.',
      )
      // EL RECHAZO DEJA DE SER UN CALLEJÓN
      //
      // Un cobro rechazado suele ser del emisor de la tarjeta, no de la
      // plataforma: medido el 19/09/2026, once rechazos seguidos de una
      // prepaga, con el propio Mercado Pago recomendando "pague con otro
      // medio de pago". Sin este enlace el comercio ve el error y no tiene
      // ninguna salida desde acá.
      setInitPoint(err.response?.data?.data?.initPoint || null)
    }
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: BRAND.paper,
        }}
      >
        <CircularProgress aria-label="Preparando el pago" />
      </Box>
    )
  }

  const alreadyActive = account?.subscriptionStatus === 'active'
  const daysLeft = trialDaysLeft(account?.subscriptionStatus, account?.trialEndsAt)
  const nextCharge = formatDate(addOneMonth(new Date()))

  let blocker = null
  if (!planIsSellable) {
    blocker = {
      title: 'Ese plan no existe',
      body: 'El enlace que abriste no corresponde a ningún plan que se pueda contratar.',
      action: { label: 'Ver los planes', to: '/subscripcion' },
    }
  } else if (alreadyActive) {
    blocker = {
      title: 'Ya tenés una suscripción activa',
      body: `Estás en el plan ${PLAN_PRESENTATION[account.currentPlan]?.name || account.currentPlan || 'actual'}. Para cambiar de plan andá a Mi suscripción: contratar otra vez acá crearía un segundo cobro mensual.`,
      action: { label: 'Ir a Mi suscripción', to: '/admin/mi-suscripcion' },
    }
  }

  const header = (
    <Box component="header" sx={{ mb: 3 }}>
      <Button
        startIcon={<ArrowBack />}
        onClick={goBack}
        sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted, ml: -1, mb: 1 }}
      >
        Volver
      </Button>
      <Typography
        variant="overline"
        sx={{ display: 'block', color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
      >
        TU SUSCRIPCIÓN A HENKO
      </Typography>
      <Typography
        component="h1"
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 800,
          fontSize: { xs: 26, md: 34 },
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
        }}
      >
        {planIsSellable ? `Contratar el plan ${planName}` : 'Contratar un plan'}
      </Typography>
    </Box>
  )

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BRAND.paper, color: BRAND.ink }}>
      <Box sx={{ maxWidth: 1080, mx: 'auto', px: { xs: 2, md: 3 }, py: { xs: 3, md: 5 } }}>
        {header}

        {outcome ? (
          <Paper
            variant="outlined"
            role="status"
            sx={{
              ...PANEL_SX,
              p: { xs: 3, md: 5 },
              textAlign: 'center',
              maxWidth: 620,
              mx: 'auto',
            }}
          >
            {outcome === 'active' ? (
              <>
                <CheckCircle sx={{ fontSize: 56, color: BRAND.green }} />
                <Typography
                  component="h2"
                  sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 26, mt: 1 }}
                >
                  ¡Listo! Ya estás en el plan {planName}
                </Typography>
                <Typography sx={{ color: BRAND.muted, mt: 1 }}>
                  El pago se aprobó y la suscripción quedó activa. Te mandamos la confirmación por
                  email. Te llevamos al panel en unos segundos.
                </Typography>
              </>
            ) : (
              <>
                <HourglassTop sx={{ fontSize: 56, color: BRAND.amber }} />
                <Typography
                  component="h2"
                  sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 26, mt: 1 }}
                >
                  Tu pago está en revisión
                </Typography>
                <Typography sx={{ color: BRAND.muted, mt: 1 }}>
                  Mercado Pago todavía no lo aprobó. Cuando lo haga, la suscripción se activa sola y
                  te avisamos por email. No hace falta volver a pagar.
                </Typography>
                <Button
                  variant="contained"
                  disableElevation
                  onClick={() => navigate('/admin')}
                  sx={{ mt: 3, borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                >
                  Ir al panel
                </Button>
              </>
            )}
            {subscriptionId && (
              <Typography variant="body2" sx={{ color: BRAND.muted, mt: 2 }}>
                Número de suscripción: {subscriptionId}
              </Typography>
            )}
          </Paper>
        ) : blocker ? (
          <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 3, md: 4 }, maxWidth: 620 }}>
            <Typography
              component="h2"
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 22 }}
            >
              {blocker.title}
            </Typography>
            <Typography sx={{ color: BRAND.muted, mt: 1 }}>{blocker.body}</Typography>
            <Button
              variant="contained"
              disableElevation
              onClick={() => navigate(blocker.action.to)}
              sx={{ mt: 2.5, borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
            >
              {blocker.action.label}
            </Button>
          </Paper>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 5fr) minmax(0, 7fr)' },
              alignItems: 'start',
            }}
          >
            <Paper
              variant="outlined"
              component="section"
              aria-label="Resumen"
              sx={{
                ...PANEL_SX,
                p: { xs: 2.5, md: 3 },
                position: { md: 'sticky' },
                top: { md: 24 },
              }}
            >
              <Typography sx={{ fontSize: 13, fontWeight: 800, color: BRAND.muted }}>
                Plan {planName}
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', mt: 0.5 }}>
                <Typography
                  sx={{
                    fontFamily: DISPLAY_FONT,
                    fontWeight: 800,
                    fontSize: 34,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {catalogState === 'loading' ? '…' : formatArs(precioArs)}
                </Typography>
                {precioArs !== null && (
                  <Typography sx={{ fontWeight: 700, color: BRAND.muted }}>/ mes</Typography>
                )}
              </Stack>

              <Box
                component="dl"
                sx={{
                  m: 0,
                  mt: 2,
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  columnGap: 2,
                  rowGap: 0.75,
                  fontSize: 14,
                }}
              >
                <Typography component="dt" variant="body2" sx={{ color: BRAND.muted }}>
                  Hoy se cobra
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 800 }}>
                  {formatArs(precioArs)}
                </Typography>
                <Typography component="dt" variant="body2" sx={{ color: BRAND.muted }}>
                  Próximo cobro
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 700 }}>
                  cerca del {nextCharge}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: BRAND.muted, mt: 1 }}>
                Se renueva solo cada mes. Podés cancelarlo cuando quieras desde Mi suscripción.
              </Typography>

              {daysLeft !== null && (
                <Alert severity="info" sx={{ mt: 2, borderRadius: 3 }}>
                  Te {daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft} días`} de prueba gratis.
                  Si contratás ahora, se cobra hoy y la prueba termina.
                </Alert>
              )}

              {cuotas.length > 0 && (
                <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${BRAND.line}` }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800, color: BRAND.muted, mb: 1 }}>
                    Incluye por mes
                  </Typography>
                  <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: 'none' }}>
                    {cuotas.map(cuota => (
                      <Stack
                        component="li"
                        key={cuota}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'flex-start' }}
                      >
                        <CheckCircle sx={{ fontSize: 18, color: BRAND.green, mt: '2px' }} />
                        <Typography variant="body2">{cuota}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              )}
            </Paper>

            <Paper
              variant="outlined"
              component="section"
              aria-label="Pago"
              sx={{ ...PANEL_SX, p: { xs: 2.5, md: 3 } }}
            >
              <Typography
                component="h2"
                sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, mb: 2 }}
              >
                Pagá con tarjeta
              </Typography>

              {error && (
                <Alert severity="error" sx={{ mb: initPoint ? 1.5 : 2, borderRadius: 3 }}>
                  {error}
                </Alert>
              )}

              {initPoint && (
                <Alert severity="info" sx={{ mb: 2, borderRadius: 3 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    Probá con otro medio de pago
                  </Typography>
                  Casi siempre el rechazo viene del banco que emitió la tarjeta, no de nosotros.
                  Podés autorizar la suscripción desde tu cuenta de Mercado Pago y elegir ahí cómo
                  pagarla —otra tarjeta, dinero en cuenta, lo que tengas—.
                  <Button
                    variant="contained"
                    disableElevation
                    href={initPoint}
                    // Se abre aparte para no perder esta pantalla: si el
                    // comercio vuelve atrás, encuentra el checkout donde lo
                    // dejó en vez de una página en blanco.
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      mt: 1.5,
                      display: 'block',
                      width: 'fit-content',
                      borderRadius: 2,
                      textTransform: 'none',
                      fontWeight: 700,
                    }}
                  >
                    Autorizar en Mercado Pago
                  </Button>
                </Alert>
              )}

              {!mpReady ? (
                <Alert severity="warning" sx={{ borderRadius: 3 }}>
                  {mpError || 'Preparando el formulario de pago…'}
                </Alert>
              ) : catalogState === 'loading' ? (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 2 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" sx={{ color: BRAND.muted }}>
                    Cargando el precio del plan…
                  </Typography>
                </Stack>
              ) : catalogState === 'error' ? (
                <Alert
                  severity="warning"
                  sx={{ borderRadius: 3 }}
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={retryCatalog}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      Reintentar
                    </Button>
                  }
                >
                  No se pudo cargar el precio del plan, así que todavía no se puede pagar.
                </Alert>
              ) : precioArs === null ? (
                <Alert severity="warning" sx={{ borderRadius: 3 }}>
                  Este plan todavía no tiene precio configurado, así que no se puede contratar.
                </Alert>
              ) : (
                <CardPayment
                  initialization={{ amount: Number(precioArs) }}
                  onSubmit={onPaymentSubmit}
                  onError={brickError => {
                    // El Brick también dispara onError para eventos no
                    // críticos —por ejemplo, que todavía no pueda calcular
                    // las cuotas mientras se tipea el número—, que son parte
                    // normal de completar el formulario. Mostrar todos
                    // llenaría la pantalla de errores que no lo son.
                    if (brickError?.type === 'critical') {
                      setError(brickError?.message || 'Error en el formulario de pago')
                    }
                  }}
                  customization={{
                    visual: {
                      style: { theme: 'flat' },
                      texts: {
                        formTitle: 'Datos de tu tarjeta',
                        formSubmit: `Pagar ${formatArs(precioArs)}`,
                      },
                    },
                  }}
                />
              )}

              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'center', mt: 2, color: BRAND.muted }}
              >
                <Lock sx={{ fontSize: 16 }} />
                <Typography variant="caption">
                  Los datos de tu tarjeta los procesa Mercado Pago directamente. HENKO no los recibe
                  ni los guarda.
                </Typography>
              </Stack>
            </Paper>
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default CheckoutPage
