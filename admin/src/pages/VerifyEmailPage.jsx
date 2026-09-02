// 📁 admin/src/pages/VerifyEmailPage.jsx
//
// Destino del enlace de verificación del dueño del comercio.
//
// Antes ese enlace apuntaba a /verify-email de la TIENDA: el comerciante
// verificaba su cuenta en la aplicación equivocada y el botón final lo
// mandaba a iniciar sesión como comprador, donde no tiene cuenta. El panel
// no tenía esta ruta, así que en algunos entornos el enlace directamente
// caía en un 404.
//
// Va en rutas públicas a propósito: quien llega acá todavía no inició sesión,
// justamente porque su cuenta no está verificada.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, Container, Paper, Typography } from '@mui/material'
import api from '@utils/axiosConfig'

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams()

  const token = useMemo(() => {
    return String(searchParams.get('token') || '').trim()
  }, [searchParams])

  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Verificando tu correo...')

  // El token es de un solo uso: en StrictMode el efecto corre dos veces y el
  // segundo intento recibiría "token inválido" sobre una verificación que en
  // realidad salió bien.
  const requestedTokenRef = useRef(null)

  useEffect(() => {
    let isMounted = true

    if (!token) {
      setStatus('error')
      setMessage('El enlace no incluye un token de verificación.')
      return undefined
    }

    if (requestedTokenRef.current === token) return undefined
    requestedTokenRef.current = token

    const run = async () => {
      try {
        const { data } = await api.get(`/user/verify-email?token=${encodeURIComponent(token)}`, {
          skipAuthRefresh: true,
          skipCsrfRetry: true,
        })

        if (data?.success !== true) {
          throw new Error(data?.message || 'No se pudo verificar el correo.')
        }

        if (!isMounted) return

        setStatus('success')
        setMessage(data.message || 'Correo verificado correctamente.')
      } catch (error) {
        if (!isMounted) return

        setStatus('error')
        setMessage(
          error?.response?.data?.message ||
            error?.message ||
            'El enlace es inválido, ya se usó o expiró.',
        )
      }
    }

    run()

    return () => {
      isMounted = false
    }
  }, [token])

  return (
    <Container maxWidth="sm" sx={{ py: 10 }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, md: 5 },
          borderRadius: 4,
          textAlign: 'center',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="overline" color="text.secondary">
          Panel de administración
        </Typography>

        {status === 'loading' && (
          <Box mt={2}>
            <CircularProgress />
            <Typography variant="h6" sx={{ mt: 3 }}>
              {message}
            </Typography>
          </Box>
        )}

        {status === 'success' && (
          <Box mt={2}>
            <Alert severity="success" sx={{ mb: 3, textAlign: 'left' }}>
              {message}
            </Alert>

            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Tu cuenta de comercio ya está activa.
            </Typography>

            <Button component={Link} to="/login" variant="contained" size="large">
              Entrar al panel
            </Button>
          </Box>
        )}

        {status === 'error' && (
          <Box mt={2}>
            <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
              {message}
            </Alert>

            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Si el enlace expiró, volvé a registrarte o pedí uno nuevo desde el inicio de sesión.
            </Typography>

            <Button component={Link} to="/login" variant="outlined" size="large">
              Ir al inicio de sesión
            </Button>
          </Box>
        )}
      </Paper>
    </Container>
  )
}

export default VerifyEmailPage
