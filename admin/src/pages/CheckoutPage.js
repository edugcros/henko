// 📁 src/pages/CheckoutPage.js
// Página de checkout para suscripción a plan

import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import {
  Container,
  Box,
  Paper,
  Stack,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Alert,
  AlertTitle,
  Card,
  CardContent,
  Grid,
  Divider,
  InputAdornment,
  Fade,
} from '@mui/material'
// CheckCircle es un ícono: venía importado desde '@mui/material', que no lo
// exporta, así que llegaba undefined y React rompía al renderizar el resumen
// del plan. CheckCircleOutline directamente no está en el barrel de íconos
// del proyecto (ver el warning del build), por eso la pantalla de éxito usa
// el mismo CheckCircle.
import {
  Payment,
  CreditCard,
  Person,
  Email,
  Phone,
  ArrowBack,
  CheckCircle,
} from '@mui/icons-material'
import api from '@utils/axiosConfig'
import { PLAN_PRESENTATION, formatArs } from '../constants/plans.js'
import { getPlanCatalog, findPlanPrice } from '../services/subscriptionPlansService.js'
import { CardPayment, initMercadoPago } from '@mercadopago/sdk-react'

// El precio NO está acá. Lo trae /subscriptions/plans, que es de donde sale el
// cobro. Esta pantalla tenía su propia tabla con `priceUsd: 26.14` y el botón
// decía literalmente "Pagar USD 26.14" mientras el backend cobraba 40.000 pesos:
// el número y la moneda del botón estaban los dos mal.
//
// Las cuotas de cada plan siguen escritas acá porque son texto de producto. Son
// las mismas que DEFAULT_PLAN_LIMITS del backend, así que si alguien mueve un
// tope por variable de entorno esta lista queda vieja — es una copia menos grave
// que la del precio, pero es una copia.
const PLAN_FEATURES = {
  starter: [
    '300 análisis de imágenes/mes',
    '2.000 mensajes del asistente/mes',
    '100 generaciones de fondo con IA/mes',
    '50 análisis de demanda/mes',
  ],
  pro: [
    '1.500 análisis de imágenes/mes',
    '10.000 mensajes del asistente/mes',
    '500 generaciones de fondo con IA/mes',
    '250 análisis de demanda/mes',
  ],
}

const CheckoutPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useSelector(state => state.user || {})

  const selectedPlan = searchParams.get('plan') || 'starter'
  const [precioArs, setPrecioArs] = useState(null)

  const planDetails = {
    name: PLAN_PRESENTATION[selectedPlan]?.name || PLAN_PRESENTATION.starter.name,
    features: PLAN_FEATURES[selectedPlan] || PLAN_FEATURES.starter,
  }

  useEffect(() => {
    let vigente = true

    getPlanCatalog()
      .then(catalogo => {
        if (vigente) setPrecioArs(findPlanPrice(catalogo, selectedPlan))
      })
      .catch(() => {
        // Sin precio no se muestra ninguno. Un respaldo escrito acá sería
        // exactamente el problema que esto vino a sacar.
        if (vigente) setPrecioArs(null)
      })

    return () => {
      vigente = false
    }
  }, [selectedPlan])

  // Estados del formulario
  // El formulario propio —datos del titular, tarjeta y su validación— lo
  // reemplaza el Brick de Mercado Pago. Mantener esos campos acá significaba
  // mantener también sus reglas: el largo de la tarjeta, los tipos de documento
  // válidos por país, el formato del vencimiento. Cada una de esas reglas ya
  // había fallado al menos una vez.

  /**
   * Lo dispara el Brick de Mercado Pago con la tarjeta YA tokenizada.
   *
   * Antes acá había un formulario propio: se pedían los datos de la tarjeta en
   * campos nuestros, se validaban a mano y se tokenizaban aparte. Eso trajo
   * exactamente los problemas que trae hacerlo a mano — largo de tarjeta fijado
   * en 16 (una Amex tiene 15), una lista de tipos de documento con dos valores
   * que Mercado Pago no acepta, y antes de eso un token inventado.
   *
   * El Brick es el mismo componente que ya usa el checkout de la tienda, que
   * funciona en producción. Dibuja los campos de tarjeta en un iframe propio de
   * Mercado Pago: el número no pasa nunca por nuestro DOM, ni por nuestro
   * estado, ni por nuestros logs. Y trae la detección de medio de pago, las
   * cuotas, el emisor y los tipos de documento correctos sin que haya que
   * mantener nada de eso.
   */
  const onPaymentSubmit = async formData => {
    setError(null)
    setIsProcessing(true)

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
        setSuccess(true)
        setSubscriptionId(response.data?.data?.subscriptionId)

        setTimeout(() => {
          // El panel cuelga de /admin (ver routesConfig.js); '/dashboard' no
          // es una ruta del router y caía en el fallback 404.
          navigate('/admin')
        }, 3000)
      } else {
        setError(response.data?.message || 'Error procesando pago')
      }
    } catch (err) {
      console.error('Error en checkout:', err)
      setError(
        err.response?.data?.message ||
        err.response?.data?.data?.details ||
        'Error procesando pago. Intenta nuevamente.',
      )
    } finally {
      setIsProcessing(false)
    }
  }

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#f5f5f5',
        py: 4,
      }}
    >
      <Container maxWidth="lg">
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate(-1)}
          sx={{ mb: 3 }}
          variant="text"
        >
          Volver
        </Button>

        {success ? (
          <Fade in={success}>
            <Paper
              elevation={0}
              sx={{
                p: 6,
                textAlign: 'center',
                borderRadius: 4,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
              }}
            >
              <CheckCircle sx={{ fontSize: 80, mb: 2 }} />
              <Typography variant="h4" sx={{ fontWeight: 800, mb: 2 }}>
                ¡Pago Exitoso!
              </Typography>
              <Typography variant="body1" sx={{ mb: 2, opacity: 0.95 }}>
                Tu suscripción al {planDetails.name} ha sido activada correctamente.
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.85 }}>
                ID de suscripción: {subscriptionId}
              </Typography>
              <Typography variant="body2" sx={{ mt: 2, opacity: 0.85 }}>
                Serás redirigido al panel en unos segundos...
              </Typography>
            </Paper>
          </Fade>
        ) : (
          <Grid container spacing={4}>
            {/* Resumen del Plan */}
            <Grid item xs={12} md={4}>
              <Fade in>
                <Card
                  sx={{
                    borderRadius: 3,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                    position: 'sticky',
                    top: 20,
                  }}
                >
                  <CardContent sx={{ p: 4 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                      Resumen
                    </Typography>
                    <Typography variant="h3" sx={{ fontWeight: 900, color: 'primary.main', mb: 3 }}>
                      {planDetails.name}
                    </Typography>

                    <Stack spacing={2} sx={{ mb: 3 }}>
                      <Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          Precio mensual
                        </Typography>
                        <Typography variant="h5" sx={{ fontWeight: 800 }}>
                          {formatArs(precioArs)}
                        </Typography>
                      </Box>

                      <Divider />

                      <Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                          INCLUYE
                        </Typography>
                        <Stack spacing={1} sx={{ mt: 1 }}>
                          {planDetails.features.map((feature, idx) => (
                            <Typography
                              key={idx}
                              variant="body2"
                              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                            >
                              <CheckCircle sx={{ fontSize: 18, color: 'success.main' }} />
                              {feature}
                            </Typography>
                          ))}
                        </Stack>
                      </Box>

                      <Divider />

                      <Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          Próximo pago
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('es-AR')}
                        </Typography>
                      </Box>

                      <Alert severity="info" sx={{ borderRadius: 2 }}>
                        <Typography variant="caption">
                          Los primeros <strong>14 días son gratis</strong>. Después se cobrará el monto mensual.
                        </Typography>
                      </Alert>
                    </Stack>
                  </CardContent>
                </Card>
              </Fade>
            </Grid>

            {/* Formulario de Pago */}
            <Grid item xs={12} md={8}>
              <Fade in>
                <Paper
                  elevation={0}
                  sx={{
                    p: 4,
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
                  }}
                >
                  {error && (
                    <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                      <AlertTitle>Error</AlertTitle>
                      {error}
                    </Alert>
                  )}

                  {!mpReady ? (
                    <Alert severity="warning" sx={{ borderRadius: 2 }}>
                      {mpError || 'Preparando el formulario de pago...'}
                    </Alert>
                  ) : precioArs === null ? (
                    <Alert severity="warning" sx={{ borderRadius: 2 }}>
                      Este plan todavía no tiene precio configurado, así que no se
                      puede contratar.
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

                  <Typography
                    variant="caption"
                    sx={{ display: 'block', textAlign: 'center', color: 'text.secondary', mt: 2 }}
                  >
                    Los datos de tu tarjeta los procesa Mercado Pago directamente.
                    HENKO no los recibe ni los guarda.
                  </Typography>
                </Paper>
              </Fade>
            </Grid>
          </Grid>
        )}
      </Container>
    </Box>
  )
}

export default CheckoutPage
