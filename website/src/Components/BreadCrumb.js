import React, { useCallback } from 'react'
import { useLocation, useNavigate, Link as RouterLink } from 'react-router-dom'
import { Breadcrumbs, Link, Typography, Button, Box, Container, Fade, Tooltip } from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  Home as HomeIcon,
  NavigateNext as NavigateNextIcon,
} from '@mui/icons-material'
import PropTypes from 'prop-types'

/**
 * Componente Breadcrumb mejorado con navegación hacia atrás
 * y breadcrumbs dinámicos basados en la URL
 */
const BreadCrumb = ({ title, showBackButton = true, showBreadcrumbs = false }) => {
  const location = useLocation()
  const navigate = useNavigate()

  // Generar segmentos del path de forma memoizada
  const pathSegments = React.useMemo(() => {
    return location.pathname
      .split('/')
      .filter(Boolean)
      .map((segment, index, array) => ({
        label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' '),
        path: `/${array.slice(0, index + 1).join('/')}`,
        isLast: index === array.length - 1,
      }))
  }, [location.pathname])

  // Handler para navegar hacia atrás
  const handleGoBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  // Si no hay título ni breadcrumbs que mostrar, no renderizar
  if (!title && !showBreadcrumbs) return null

  return (
    <Box
      component="nav"
      aria-label="breadcrumb"
      sx={{
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Container maxWidth="xl">
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          {/* Botón Volver Atrás */}
          {showBackButton && (
            <Fade in timeout={300}>
              <Tooltip title="Volver a la página anterior" arrow>
                <Button
                  onClick={handleGoBack}
                  startIcon={<ArrowBackIcon />}
                  size="small"
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    color: 'text.primary',
                    '&:hover': {
                      bgcolor: 'action.hover',
                    },
                  }}
                >
                  Atrás
                </Button>
              </Tooltip>
            </Fade>
          )}

          {/* Separador visual opcional */}
          {showBackButton && showBreadcrumbs && (
            <Box
              component="span"
              sx={{
                width: '1px',
                height: '24px',
                bgcolor: 'divider',
                display: { xs: 'none', sm: 'block' },
              }}
            />
          )}

          {/* Breadcrumbs dinámicos */}
          {showBreadcrumbs && (
            <Breadcrumbs
              separator={<NavigateNextIcon fontSize="small" color="action" />}
              aria-label="ruta de navegación"
              sx={{ flex: 1 }}
            >
              {/* Link a Home */}
              <Link
                component={RouterLink}
                to="/"
                color="inherit"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                <HomeIcon sx={{ mr: 0.5, fontSize: 18 }} />
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                  Inicio
                </Box>
              </Link>

              {/* Segmentos del path */}
              {pathSegments.map((segment, index) => {
                const isLast = index === pathSegments.length - 1 && !title

                return isLast ? (
                  <Typography
                    key={segment.path}
                    color="text.primary"
                    fontWeight={600}
                    sx={{ display: 'flex', alignItems: 'center' }}
                  >
                    {segment.label}
                  </Typography>
                ) : (
                  <Link
                    key={segment.path}
                    component={RouterLink}
                    to={segment.path}
                    color="inherit"
                    sx={{
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {segment.label}
                  </Link>
                )
              })}

              {/* Título final (página actual) */}
              {title && (
                <Typography color="text.primary" fontWeight={700}>
                  {title}
                </Typography>
              )}
            </Breadcrumbs>
          )}

          {/* Solo título sin breadcrumbs */}
          {!showBreadcrumbs && title && (
            <Typography variant="h6" fontWeight={700} color="text.primary">
              {title}
            </Typography>
          )}
        </Box>
      </Container>
    </Box>
  )
}

BreadCrumb.propTypes = {
  /** Título de la página actual */
  title: PropTypes.string,
  /** Mostrar botón de volver atrás */
  showBackButton: PropTypes.bool,
  /** Mostrar breadcrumbs dinámicos basados en la URL */
  showBreadcrumbs: PropTypes.bool,
}

BreadCrumb.defaultProps = {
  title: '',
  showBackButton: true,
  showBreadcrumbs: false,
}

export default BreadCrumb
