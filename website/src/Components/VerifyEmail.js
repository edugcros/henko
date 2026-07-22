// 📁 src/Components/VerifyEmail.js
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Typography,
} from '@mui/material'
import api from '@utils/axiosConfig'

// =====================================================
// Guards de deduplicación
// =====================================================

const inFlightVerifications = new Map()

const buildVerificationCacheKey = token => {
  return `email_verification_result:${token}`
}

const readCachedVerificationResult = token => {
  try {
    const raw = sessionStorage.getItem(buildVerificationCacheKey(token))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const saveCachedVerificationResult = (token, payload) => {
  try {
    sessionStorage.setItem(
      buildVerificationCacheKey(token),
      JSON.stringify(payload),
    )
  } catch {
    // sessionStorage puede fallar en modo privado o políticas del navegador.
    // No rompe el flujo principal.
  }
}

const verifyEmailToken = async token => {
  const existingRequest = inFlightVerifications.get(token)

  if (existingRequest) {
    return existingRequest
  }

  const request = api
    .get(`/user/verify-email?token=${encodeURIComponent(token)}`, {
      skipAuthRefresh: true,
      skipCsrfRetry: true,
    })
    .then(({ data }) => {
      if (data?.success !== true) {
        throw new Error(data?.message || 'No se pudo verificar el correo.')
      }

      const result = {
        success: true,
        message: data?.message || 'Correo verificado correctamente.',
      }

      saveCachedVerificationResult(token, result)
      return result
    })
    .finally(() => {
      inFlightVerifications.delete(token)
    })

  inFlightVerifications.set(token, request)

  return request
}

// =====================================================
// Component
// =====================================================

const VerifyEmail = () => {
  const [searchParams] = useSearchParams()

  const token = useMemo(() => {
    return String(searchParams.get('token') || '').trim()
  }, [searchParams])

  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Verificando tu correo...')

  useEffect(() => {
    let isMounted = true

    if (!token) {
      setStatus('error')
      setMessage('Token de verificación no proporcionado.')
      return undefined
    }

    const cachedResult = readCachedVerificationResult(token)

    if (cachedResult?.success) {
      setStatus('success')
      setMessage(cachedResult.message || 'Correo verificado correctamente.')
      return undefined
    }

    const runVerification = async () => {
      try {
        const result = await verifyEmailToken(token)

        if (!isMounted) return

        setStatus('success')
        setMessage(result.message || 'Correo verificado correctamente.')
      } catch (error) {
        if (!isMounted) return

        const backendMessage =
          error?.response?.data?.message ||
          error?.message ||
          'El enlace es inválido, ha expirado o ya fue utilizado.'

        setStatus('error')
        setMessage(backendMessage)
      }
    }

    runVerification()

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
        {status === 'loading' && (
          <Box>
            <CircularProgress />
            <Typography variant="h6" sx={{ mt: 3 }}>
              {message}
            </Typography>
          </Box>
        )}

        {status === 'success' && (
          <Box>
            <Alert severity="success" sx={{ mb: 3, textAlign: 'left' }}>
              {message}
            </Alert>

            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Tu cuenta ya está activa. Ahora podés iniciar sesión.
            </Typography>

            <Button
              component={Link}
              to="/login"
              variant="contained"
              size="large"
            >
              Ir a iniciar sesión
            </Button>
          </Box>
        )}

        {status === 'error' && (
          <Box>
            <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
              {message}
            </Alert>

            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Solicitá un nuevo enlace o intentá registrarte nuevamente si el
              token expiró.
            </Typography>

            <Button component={Link} to="/" variant="contained" size="large">
              Volver al inicio
            </Button>
          </Box>
        )}
      </Paper>
    </Container>
  )
}

export default VerifyEmail
