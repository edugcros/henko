import React from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Grid,
  Typography,
  TextField,
  Button,
  IconButton,
  Container,
  Stack,
  Divider,
  Link as MuiLink,
  alpha,
} from '@mui/material'
import { LinkedIn, Instagram, GitHub, YouTube } from '@mui/icons-material'
import newsletter from '@assets/images/newsletter.png'
import { useTenant } from '../contexts/TenantContext'
import { useSelector } from 'react-redux'
import { getThemeColors } from '@utils/themeRuntime'

const getAssetUrl = asset => {
  if (!asset) return null
  if (typeof asset === 'string') return asset
  return asset.url || null
}

const Footer = () => {
  const { themeConfig } = useTenant()
  const themeState = useSelector(state => state.theme) || {}
  const activeConfig =
    themeState.previewMode && themeState.previewConfig
      ? themeState.previewConfig
      : themeState.config || themeConfig || {}
  const themeColors = getThemeColors(activeConfig)
  const footerLinkSx = {
    color: alpha(themeColors.background, 0.75),
    display: 'block',
    '&:hover': { color: themeColors.actionPrimary },
  }
  const footer = activeConfig?.footer || {}
  const general = activeConfig?.general || {}
  const footerLogo = getAssetUrl(footer.logo)
  const social = footer.social || {}
  const footerColumns = Math.min(Math.max(Number(footer.columns ?? 4), 1), 6)
  const footerColumnSize = 12 / footerColumns

  return (
    <Box
      component="footer"
      sx={{
        bgcolor: themeColors.text,
        color: themeColors.background,
        mt: 6,
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      {/* Newsletter compacto */}
      <Box
        sx={{
          py: 2,
          borderBottom: `1px solid ${alpha(themeColors.background, 0.08)}`,
        }}
      >
        <Container maxWidth="lg">
          {footer.showNewsletter !== false && (
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={5}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    component="img"
                    src={newsletter}
                    alt="newsletter"
                    sx={{ width: 40, height: 40 }}
                  />
                  <Typography
                    variant="subtitle1"
                    fontWeight="600"
                    sx={{ fontSize: 16 }}
                  >
                    {footer.newsletterText || 'Suscribite a nuestro Newsletter'}
                  </Typography>
                </Stack>
              </Grid>

              <Grid item xs={12} md={7}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    placeholder="Tu correo electrónico"
                    size="small"
                    sx={{
                      bgcolor: themeColors.background,
                      borderRadius: 1,
                      input: { color: themeColors.text },
                    }}
                  />
                  <Button
                    variant="contained"
                    sx={{
                      bgcolor: themeColors.actionPrimary,
                      color: themeColors.actionPrimaryText,
                      fontWeight: 600,
                      px: 2,
                      '&:hover': {
                        bgcolor: themeColors.actionPrimary,
                        filter: 'brightness(0.92)',
                      },
                    }}
                  >
                    Enviar
                  </Button>
                </Stack>
              </Grid>
            </Grid>
          )}
        </Container>
      </Box>

      {/* Secciones principales */}
      <Box sx={{ py: 4 }}>
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            {/* Contacto */}
            <Grid item xs={12} sm={6} md={footerColumnSize}>
              {footerLogo && (
                <Box
                  component="img"
                  src={footerLogo}
                  alt={general.storeName || 'Logo'}
                  sx={{
                    maxWidth: 140,
                    maxHeight: 56,
                    objectFit: 'contain',
                    mb: 1.5,
                  }}
                />
              )}
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                {general.storeName || 'Contacto'}
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: alpha(themeColors.background, 0.7) }}
              >
                {footer.description ||
                  general.tagline ||
                  'Tu tienda de confianza.'}
              </Typography>
              {footer.phone && (
                <Typography
                  variant="body2"
                  sx={{ mt: 1, color: alpha(themeColors.background, 0.8) }}
                >
                  Tel:{' '}
                  <a
                    href={`tel:${footer.phone}`}
                    style={{ color: themeColors.background }}
                  >
                    {footer.phone}
                  </a>
                </Typography>
              )}
              {footer.email && (
                <Typography
                  variant="body2"
                  sx={{ mt: 0.5, color: alpha(themeColors.background, 0.8) }}
                >
                  Email:{' '}
                  <a
                    href={`mailto:${footer.email}`}
                    style={{ color: themeColors.background }}
                  >
                    {footer.email}
                  </a>
                </Typography>
              )}

              <Stack direction="row" spacing={1.5} mt={2}>
                {[
                  { Icon: LinkedIn, url: social.linkedin },
                  { Icon: Instagram, url: social.instagram },
                  { Icon: GitHub, url: social.facebook },
                  { Icon: YouTube, url: social.youtube },
                ]
                  .filter(item => item.url)
                  .map(({ Icon, url }, i) => (
                    <IconButton
                      key={i}
                      component="a"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      color="inherit"
                      size="small"
                      sx={{
                        bgcolor: alpha(themeColors.background, 0.08),
                        '&:hover': {
                          bgcolor: alpha(themeColors.background, 0.15),
                          color: themeColors.actionPrimary,
                        },
                      }}
                    >
                      <Icon fontSize="small" />
                    </IconButton>
                  ))}
              </Stack>
            </Grid>

            {/* Información */}
            <Grid item xs={12} sm={6} md={footerColumnSize}>
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                Información
              </Typography>
              <Stack spacing={0.5}>
                <MuiLink
                  component={RouterLink}
                  to="/privacy-policy"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Política de Privacidad
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/refund-policy"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Política de Reembolso
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/shipping-policy"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Política de Envío
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/term-conditions"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Términos y Condiciones
                </MuiLink>
              </Stack>
            </Grid>

            {/* Cuenta */}
            <Grid item xs={12} sm={6} md={footerColumnSize}>
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                Cuenta
              </Typography>
              <Stack spacing={0.5}>
                <MuiLink
                  component={RouterLink}
                  to="/about"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Sobre Nosotros
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/faq"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Preguntas Frecuentes
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/contact"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Contacto
                </MuiLink>
              </Stack>
            </Grid>

            {/* Enlaces rápidos */}
            <Grid item xs={12} sm={6} md={footerColumnSize}>
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                Enlaces Rápidos
              </Typography>
              <Stack spacing={0.5}>
                <MuiLink
                  component={RouterLink}
                  to="/category/laptops"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Laptops
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/category/headphones"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Auriculares
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/category/tablets"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Tablets
                </MuiLink>
                <MuiLink
                  component={RouterLink}
                  to="/category/watch"
                  underline="hover"
                  sx={footerLinkSx}
                >
                  Relojes
                </MuiLink>
              </Stack>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Línea inferior */}
      <Divider sx={{ bgcolor: alpha(themeColors.background, 0.08) }} />
      <Box sx={{ py: 1.5, textAlign: 'center', bgcolor: themeColors.text }}>
        <Typography
          variant="caption"
          sx={{ color: alpha(themeColors.background, 0.6) }}
        >
          © {new Date().getFullYear()} — Powered by henko
        </Typography>
      </Box>
    </Box>
  )
}

export default Footer
