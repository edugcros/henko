// 📁 src/Components/SubscriptionCTA/index.jsx

import React, { useCallback, useMemo } from 'react'
import { Box, Button, Chip, Container, Divider, Stack, Typography } from '@mui/material'

import { env } from '../config/env'

const SUBSCRIPTION_PATH = '/subscripcion'
const LOCAL_ADMIN_BASE_URL = 'http://admin.henko.local:3001'

const cleanValue = value => String(value || '').trim()

const removeTrailingSlash = value => cleanValue(value).replace(/\/+$/, '')

const removeProtocol = value =>
  cleanValue(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')

const hasProtocol = value => /^https?:\/\//i.test(cleanValue(value))

const isLocalHostname = hostname => {
  const cleanHostname = cleanValue(hostname).toLowerCase()

  return (
    cleanHostname === 'localhost' ||
    cleanHostname === '127.0.0.1' ||
    cleanHostname.endsWith('.local')
  )
}

const buildAdminBaseUrl = () => {
  if (typeof window === 'undefined') return ''

  const { hostname, protocol, host } = window.location

  if (isLocalHostname(hostname)) {
    return LOCAL_ADMIN_BASE_URL
  }

  const adminBaseDomain = removeTrailingSlash(env?.adminBaseDomain)
  const publicBaseDomain = removeTrailingSlash(env?.publicBaseDomain)

  if (adminBaseDomain) {
    return hasProtocol(adminBaseDomain)
      ? adminBaseDomain
      : `https://${removeProtocol(adminBaseDomain)}`
  }

  if (publicBaseDomain) {
    return `https://admin.${removeProtocol(publicBaseDomain)}`
  }

  return `${protocol}//${host}`
}

const features = [
  'E-commerce multi-tenant listo para escalar',
  'Panel administrativo profesional',
  'Base preparada para IA aplicada a productos',
  'Arquitectura orientada a tiendas reales',
]

const highlights = [
  {
    title: 'Crear tienda',
    description:
      'Activá una tienda online con estructura comercial, catálogo, checkout y administración.',
  },
  {
    title: 'Gestionar ventas',
    description:
      'Centralizá productos, órdenes, clientes y experiencia operativa desde un panel privado.',
  },
  {
    title: 'Escalar con IA',
    description:
      'Prepará el ecosistema para automatizar análisis de productos, contenido y optimización.',
  },
]

const SubscriptionCTA = () => {
  const subscriptionUrl = useMemo(() => {
    const adminBaseUrl = buildAdminBaseUrl()
    return `${adminBaseUrl}${SUBSCRIPTION_PATH}`
  }, [])

  const handleGoToSubscription = useCallback(() => {
    if (!subscriptionUrl) return
    window.location.assign(subscriptionUrl)
  }, [subscriptionUrl])

  return (
    <Box
      component="section"
      sx={{
        minHeight: 'calc(100vh - 80px)',
        display: 'flex',
        alignItems: 'center',
        py: { xs: 7, md: 10 },
        background:
          'radial-gradient(circle at top left, rgba(15, 23, 42, 0.08), transparent 34%), linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
      }}
    >
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.05fr 0.95fr' },
            gap: { xs: 5, md: 7 },
            alignItems: 'center',
          }}
        >
          <Box>
            <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', rowGap: 1 }}>
              <Chip
                label="Henko Commerce"
                sx={{
                  fontWeight: 700,
                  color: '#0f172a',
                  backgroundColor: 'rgba(255,255,255,0.85)',
                  border: '1px solid rgba(148,163,184,0.45)',
                }}
              />

              <Chip
                label="Software Factory"
                sx={{
                  fontWeight: 700,
                  color: '#334155',
                  backgroundColor: 'rgba(241,245,249,0.9)',
                  border: '1px solid rgba(148,163,184,0.35)',
                }}
              />
            </Stack>

            <Typography
              component="h1"
              sx={{
                maxWidth: 760,
                fontSize: { xs: 38, sm: 48, md: 64 },
                lineHeight: 0.95,
                fontWeight: 900,
                letterSpacing: '-0.06em',
                color: '#020617',
                mb: 3,
              }}
            >
              Creá tu e-commerce profesional con una plataforma preparada para crecer.
            </Typography>

            <Typography
              sx={{
                maxWidth: 650,
                fontSize: { xs: 16, md: 19 },
                lineHeight: 1.8,
                color: '#475569',
                mb: 4,
              }}
            >
              Lanzá una tienda online moderna, administrable y escalable desde un ecosistema
              diseñado para negocios reales, múltiples tenants y automatización inteligente.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 4 }}>
              <Button
                type="button"
                onClick={handleGoToSubscription}
                variant="contained"
                size="large"
                sx={{
                  minHeight: 54,
                  px: 4,
                  borderRadius: 999,
                  textTransform: 'none',
                  fontSize: 16,
                  fontWeight: 800,
                  backgroundColor: '#020617',
                  boxShadow: '0 18px 38px rgba(2, 6, 23, 0.24)',
                  '&:hover': {
                    backgroundColor: '#111827',
                    boxShadow: '0 22px 48px rgba(2, 6, 23, 0.32)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                Comprar Ecommerce / Crear Tienda
              </Button>

              <Button
                variant="outlined"
                size="large"
                href="/contact"
                sx={{
                  minHeight: 54,
                  px: 4,
                  borderRadius: 999,
                  textTransform: 'none',
                  fontSize: 16,
                  fontWeight: 800,
                  color: '#0f172a',
                  borderColor: 'rgba(15, 23, 42, 0.22)',
                  backgroundColor: 'rgba(255,255,255,0.6)',
                  '&:hover': {
                    borderColor: '#0f172a',
                    backgroundColor: 'rgba(255,255,255,0.92)',
                  },
                }}
              >
                Hablar con ventas
              </Button>
            </Stack>

            <Stack spacing={1.4}>
              {features.map(feature => (
                <Stack key={feature} direction="row" spacing={1.4} alignItems="center">
                  <Box
                    aria-hidden="true"
                    sx={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      backgroundColor: '#0f172a',
                      boxShadow: '0 0 0 5px rgba(15, 23, 42, 0.08)',
                      flexShrink: 0,
                    }}
                  />

                  <Typography
                    sx={{
                      color: '#334155',
                      fontSize: 15,
                      fontWeight: 700,
                    }}
                  >
                    {feature}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>

          <Box
            sx={{
              position: 'relative',
              p: { xs: 2, md: 3 },
              borderRadius: 6,
              backgroundColor: 'rgba(255,255,255,0.72)',
              border: '1px solid rgba(148,163,184,0.32)',
              boxShadow: '0 30px 90px rgba(15, 23, 42, 0.14)',
              backdropFilter: 'blur(18px)',
              overflow: 'hidden',
            }}
          >
            <Box
              aria-hidden="true"
              sx={{
                position: 'absolute',
                inset: 'auto -80px -100px auto',
                width: 220,
                height: 220,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(15, 23, 42, 0.12), transparent 64%)',
              }}
            />

            <Box
              sx={{
                position: 'relative',
                p: { xs: 3, md: 4 },
                borderRadius: 5,
                backgroundColor: '#020617',
                color: '#fff',
                overflow: 'hidden',
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  color: '#94a3b8',
                  mb: 1.5,
                }}
              >
                Plataforma comercial
              </Typography>

              <Typography
                component="h2"
                sx={{
                  fontSize: { xs: 28, md: 38 },
                  lineHeight: 1.05,
                  fontWeight: 900,
                  letterSpacing: '-0.04em',
                  mb: 2,
                }}
              >
                De idea a tienda activa, con base tecnológica seria.
              </Typography>

              <Typography
                sx={{
                  color: '#cbd5e1',
                  lineHeight: 1.7,
                  fontSize: 15.5,
                  mb: 3,
                }}
              >
                Diseñado para negocios que necesitan vender, administrar y evolucionar sin
                reconstruir la plataforma cada vez que crecen.
              </Typography>

              <Divider sx={{ borderColor: 'rgba(148,163,184,0.22)', mb: 3 }} />

              <Stack spacing={2.2}>
                {highlights.map(item => (
                  <Box key={item.title}>
                    <Typography
                      sx={{
                        fontSize: 17,
                        fontWeight: 900,
                        color: '#f8fafc',
                        mb: 0.5,
                      }}
                    >
                      {item.title}
                    </Typography>

                    <Typography
                      sx={{
                        color: '#94a3b8',
                        lineHeight: 1.65,
                        fontSize: 14.5,
                      }}
                    >
                      {item.description}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>

            <Box
              sx={{
                mt: 2,
                p: 2.5,
                borderRadius: 4,
                backgroundColor: 'rgba(248,250,252,0.92)',
                border: '1px solid rgba(148,163,184,0.26)',
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  color: '#64748b',
                  fontWeight: 700,
                  mb: 0.6,
                }}
              >
                Destino de activación
              </Typography>

              <Typography
                sx={{
                  fontSize: 14,
                  color: '#0f172a',
                  fontWeight: 800,
                  wordBreak: 'break-all',
                }}
              >
                {subscriptionUrl}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  )
}

export default SubscriptionCTA
