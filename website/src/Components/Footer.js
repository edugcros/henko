import React from 'react'
import { Link } from 'react-router-dom'
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
  useTheme,
} from '@mui/material'
import { LinkedIn, Instagram, GitHub, YouTube } from '@mui/icons-material'
import newsletter from '@assets/images/newsletter.png'

const Footer = () => {
  const theme = useTheme()

  return (
    <Box
      component="footer"
      sx={{
        bgcolor: theme.palette.grey[900],
        color: '#fff',
        mt: 6,
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      {/* Newsletter compacto */}
      <Box
        sx={{
          py: 2,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={5}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box
                  component="img"
                  src={newsletter}
                  alt="newsletter"
                  sx={{ width: 40, height: 40 }}
                />
                <Typography variant="subtitle1" fontWeight="600" sx={{ fontSize: 16 }}>
                  Suscribite a nuestro Newsletter
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
                    bgcolor: '#fff',
                    borderRadius: 1,
                    input: { color: '#000' },
                  }}
                />
                <Button
                  variant="contained"
                  sx={{
                    bgcolor: theme.palette.warning.main,
                    color: '#000',
                    fontWeight: 600,
                    px: 2,
                    '&:hover': { bgcolor: theme.palette.warning.dark },
                  }}
                >
                  Enviar
                </Button>
              </Stack>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Secciones principales */}
      <Box sx={{ py: 4 }}>
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            {/* Contacto */}
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                Contacto
              </Typography>
              <Typography variant="body2" color="grey.400">
                Hno: 277 Near Vill chopal, Sonipat, Haryana, CP 131103
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, color: 'grey.300' }}>
                Tel:{' '}
                <a href="tel:+918264954234" style={{ color: '#fff' }}>
                  +91 8264954234
                </a>
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, color: 'grey.300' }}>
                Email:{' '}
                <a href="mailto:grecoeduardo87@gmail.com" style={{ color: '#fff' }}>
                  grecoeduardo87@gmail.com
                </a>
              </Typography>

              <Stack direction="row" spacing={1.5} mt={2}>
                {[LinkedIn, Instagram, GitHub, YouTube].map((Icon, i) => (
                  <IconButton
                    key={i}
                    color="inherit"
                    size="small"
                    sx={{
                      bgcolor: 'rgba(255,255,255,0.08)',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
                    }}
                  >
                    <Icon fontSize="small" />
                  </IconButton>
                ))}
              </Stack>
            </Grid>

            {/* Información */}
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                Información
              </Typography>
              <Stack spacing={0.5}>
                <Link to="/privacy-policy" style={{ color: '#ccc' }}>
                  Política de Privacidad
                </Link>
                <Link to="/refund-policy" style={{ color: '#ccc' }}>
                  Política de Reembolso
                </Link>
                <Link to="/shipping-policy" style={{ color: '#ccc' }}>
                  Política de Envío
                </Link>
                <Link to="/term-conditions" style={{ color: '#ccc' }}>
                  Términos y Condiciones
                </Link>
              </Stack>
            </Grid>

            {/* Cuenta */}
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                Cuenta
              </Typography>
              <Stack spacing={0.5}>
                <Link to="/about" style={{ color: '#ccc' }}>
                  Sobre Nosotros
                </Link>
                <Link to="/faq" style={{ color: '#ccc' }}>
                  Preguntas Frecuentes
                </Link>
                <Link to="/contact" style={{ color: '#ccc' }}>
                  Contacto
                </Link>
              </Stack>
            </Grid>

            {/* Enlaces rápidos */}
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="subtitle1" fontWeight="600" mb={1.5}>
                Enlaces Rápidos
              </Typography>
              <Stack spacing={0.5}>
                <Link to="/category/laptops" style={{ color: '#ccc' }}>
                  Laptops
                </Link>
                <Link to="/category/headphones" style={{ color: '#ccc' }}>
                  Auriculares
                </Link>
                <Link to="/category/tablets" style={{ color: '#ccc' }}>
                  Tablets
                </Link>
                <Link to="/category/watch" style={{ color: '#ccc' }}>
                  Relojes
                </Link>
              </Stack>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Línea inferior */}
      <Divider sx={{ bgcolor: 'rgba(255,255,255,0.08)' }} />
      <Box sx={{ py: 1.5, textAlign: 'center', bgcolor: '#0a0a0a' }}>
        <Typography variant="caption" color="grey.500">
          © {new Date().getFullYear()} — Powered by henko
        </Typography>
      </Box>
    </Box>
  )
}

export default Footer
