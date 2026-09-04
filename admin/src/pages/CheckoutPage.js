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
import axios from 'axios'

const USD_ARS_REFERENCE_RATE = 1530

const PLAN_DETAILS = {
  starter: {
    name: 'Plan Emprendedor',
    priceUsd: 26.14,
    priceArs: 40000,
    features: [
      '300 análisis de imágenes/mes',
      '2.000 mensajes del asistente/mes',
      '100 generaciones de fondo con IA/mes',
      '50 análisis de demanda/mes',
    ],
  },
  pro: {
    name: 'Plan Profesional',
    priceUsd: 99,
    priceArs: null,
    features: [
      '1.500 análisis de imágenes/mes',
      '10.000 mensajes del asistente/mes',
      '500 generaciones de fondo con IA/mes',
      '250 análisis de demanda/mes',
    ],
  },
}

const CheckoutPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useSelector(state => state.user || {})

  const selectedPlan = searchParams.get('plan') || 'starter'
  const planDetails = PLAN_DETAILS[selectedPlan] || PLAN_DETAILS.starter

  // Estados del formulario
  const [formData, setFormData] = useState({
    name: user?.firstname && user?.lastname
      ? `${user.firstname} ${user.lastname}`
      : '',
    email: user?.email || '',
    phone: '',
    identityType: 'DNI',
    identityNumber: '',
    cardholderName: '',
  })

  const [cardData, setCardData] = useState({
    cardNumber: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
  })

  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [mpPublicKey, setMpPublicKey] = useState(null)
  const [mpToken, setMpToken] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [subscriptionId, setSubscriptionId] = useState(null)

  // Cargar configuración de Mercado Pago
  useEffect(() => {
    const loadMpConfig = async () => {
      try {
        setIsLoading(true)
        const response = await axios.get('/api/subscriptions/config')
        if (response.data?.data?.mpPublicKey) {
          setMpPublicKey(response.data.data.mpPublicKey)
          // Aquí se cargaría el SDK de MP cuando esté disponible
        }
      } catch (err) {
        console.error('Error cargando config MP:', err)
        setError('No se pudo cargar la configuración de pago')
      } finally {
        setIsLoading(false)
      }
    }

    loadMpConfig()
  }, [])

  const handleFormChange = e => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleCardChange = e => {
    const { name, value } = e.target

    // Formatear según el campo
    let formatted = value
    if (name === 'cardNumber') {
      formatted = value.replace(/\D/g, '').slice(0, 16)
    } else if (name === 'expiryMonth') {
      formatted = value.replace(/\D/g, '').slice(0, 2)
      if (formatted.length === 1 && parseInt(formatted) > 1) {
        formatted = `0${formatted}`
      }
    } else if (name === 'expiryYear') {
      formatted = value.replace(/\D/g, '').slice(0, 2)
    } else if (name === 'cvv') {
      formatted = value.replace(/\D/g, '').slice(0, 4)
    }

    setCardData(prev => ({ ...prev, [name]: formatted }))
  }

  const validateForm = () => {
    if (!formData.name || formData.name.trim().length < 3) {
      setError('Nombre completo requerido (mínimo 3 caracteres)')
      return false
    }

    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError('Email válido requerido')
      return false
    }

    if (!formData.identityNumber || formData.identityNumber.length < 6) {
      setError('Número de documento válido requerido')
      return false
    }

    if (!cardData.cardNumber || cardData.cardNumber.length !== 16) {
      setError('Número de tarjeta válido requerido (16 dígitos)')
      return false
    }

    if (!cardData.expiryMonth || !cardData.expiryYear) {
      setError('Fecha de vencimiento requerida')
      return false
    }

    if (!cardData.cvv || cardData.cvv.length < 3) {
      setError('Código de seguridad válido requerido')
      return false
    }

    if (!formData.cardholderName || formData.cardholderName.trim().length < 3) {
      setError('Nombre del titular de tarjeta requerido')
      return false
    }

    return true
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setError(null)

    if (!validateForm()) return

    try {
      setIsProcessing(true)

      // NOTA: En producción, aquí se llamaría a la API de Mercado Pago
      // para crear el card token. Por ahora, simulamos el flujo.
      //
      // En una implementación real con MP.js:
      // const cardtoken = await MP.checkout.tokenize(cardData)
      // const token = cardtoken.id

      // Por ahora, usar un token simulado para demostración
      const simulatedToken = `simulated_token_${Date.now()}`

      console.log('Enviando pago con token:', simulatedToken)

      const response = await axios.post('/api/subscriptions/process-payment', {
        plan: selectedPlan,
        token: simulatedToken,
        paymentMethodId: 'credit_card',
        payer: {
          name: formData.name,
          email: formData.email,
          identification: {
            type: formData.identityType,
            number: formData.identityNumber,
          },
        },
      })

      if (response.data?.success) {
        setSuccess(true)
        setSubscriptionId(response.data?.data?.subscriptionId)

        // Redirigir a dashboard después de 3 segundos
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
        err.response?.data?.details ||
        'Error procesando pago. Intenta nuevamente.'
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
                          USD {planDetails.priceUsd}
                          {planDetails.priceArs && (
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{ display: 'block', color: 'text.secondary', fontWeight: 400 }}
                            >
                              (~ARS {planDetails.priceArs.toLocaleString()})
                            </Typography>
                          )}
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

                  <form onSubmit={handleSubmit}>
                    <Stack spacing={4}>
                      {/* Sección: Datos Personales */}
                      <Box>
                        <Typography
                          variant="h6"
                          sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                          <Person sx={{ color: 'primary.main' }} />
                          Datos Personales
                        </Typography>

                        <Stack spacing={2}>
                          <TextField
                            fullWidth
                            label="Nombre Completo"
                            name="name"
                            value={formData.name}
                            onChange={handleFormChange}
                            required
                            placeholder="Juan Pérez"
                            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                          />

                          <TextField
                            fullWidth
                            label="Email"
                            name="email"
                            type="email"
                            value={formData.email}
                            onChange={handleFormChange}
                            required
                            placeholder="juan@example.com"
                            slotProps={{
                              input: {
                                startAdornment: (
                                  <InputAdornment position="start">
                                    <Email sx={{ color: 'action.active' }} />
                                  </InputAdornment>
                                ),
                              },
                            }}
                            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                          />

                          <Grid container spacing={2}>
                            <Grid item xs={12} sm={6}>
                              <TextField
                                fullWidth
                                select
                                label="Tipo de Documento"
                                name="identityType"
                                value={formData.identityType}
                                onChange={handleFormChange}
                                SelectProps={{ native: true }}
                                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                              >
                                <option value="DNI">DNI</option>
                                <option value="PASSPORT">Pasaporte</option>
                                <option value="CUIT">CUIT</option>
                              </TextField>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                              <TextField
                                fullWidth
                                label="Número de Documento"
                                name="identityNumber"
                                value={formData.identityNumber}
                                onChange={handleFormChange}
                                required
                                placeholder="12345678"
                                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                              />
                            </Grid>
                          </Grid>
                        </Stack>
                      </Box>

                      <Divider />

                      {/* Sección: Datos de Tarjeta */}
                      <Box>
                        <Typography
                          variant="h6"
                          sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                          <CreditCard sx={{ color: 'primary.main' }} />
                          Datos de Tarjeta
                        </Typography>

                        <Stack spacing={2}>
                          <TextField
                            fullWidth
                            label="Nombre del Titular"
                            name="cardholderName"
                            value={formData.cardholderName}
                            onChange={handleFormChange}
                            required
                            placeholder="JUAN PEREZ"
                            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                          />

                          <TextField
                            fullWidth
                            label="Número de Tarjeta"
                            name="cardNumber"
                            value={cardData.cardNumber}
                            onChange={handleCardChange}
                            required
                            placeholder="1234 5678 9012 3456"
                            inputProps={{
                              maxLength: 16,
                              inputMode: 'numeric',
                            }}
                            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                          />

                          <Grid container spacing={2}>
                            <Grid item xs={6}>
                              <TextField
                                fullWidth
                                label="Mes (MM)"
                                name="expiryMonth"
                                value={cardData.expiryMonth}
                                onChange={handleCardChange}
                                required
                                placeholder="12"
                                inputProps={{ maxLength: 2, inputMode: 'numeric' }}
                                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                              />
                            </Grid>
                            <Grid item xs={6}>
                              <TextField
                                fullWidth
                                label="Año (YY)"
                                name="expiryYear"
                                value={cardData.expiryYear}
                                onChange={handleCardChange}
                                required
                                placeholder="25"
                                inputProps={{ maxLength: 2, inputMode: 'numeric' }}
                                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                              />
                            </Grid>
                          </Grid>

                          <TextField
                            fullWidth
                            label="Código de Seguridad (CVV)"
                            name="cvv"
                            value={cardData.cvv}
                            onChange={handleCardChange}
                            required
                            placeholder="123"
                            type="password"
                            inputProps={{ maxLength: 4, inputMode: 'numeric' }}
                            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                          />
                        </Stack>
                      </Box>

                      {/* Botón de Submit */}
                      <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        size="large"
                        disabled={isProcessing}
                        startIcon={isProcessing ? <CircularProgress size={20} /> : <Payment />}
                        sx={{
                          py: 2.5,
                          borderRadius: 2,
                          fontWeight: 800,
                          fontSize: '1rem',
                          textTransform: 'none',
                        }}
                      >
                        {isProcessing ? 'Procesando Pago...' : `Pagar USD ${planDetails.priceUsd}`}
                      </Button>

                      <Typography variant="caption" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                        Tu pago es seguro y está encriptado con SSL
                      </Typography>
                    </Stack>
                  </form>
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
