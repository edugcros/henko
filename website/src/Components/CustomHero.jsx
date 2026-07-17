// 📁 web/src/components/CustomHero.jsx
import React, { useMemo } from 'react'
import { Box, Typography, Container, Button } from '@mui/material'
import { useSelector } from 'react-redux'
import { useTenant } from '../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const getAssetUrl = asset => {
  if (!asset) return null
  if (typeof asset === 'string') return asset
  return asset.url || null
}

const HEIGHTS = {
  small: '40vh',
  medium: '60vh',
  large: '80vh',
  fullscreen: '100vh',
}

const CustomHero = () => {
  const tenantContext = useTenant()
  const themeState = useSelector(state => state.theme)

  const tenantConfig = tenantContext?.themeConfig
  const reduxConfig = themeState?.config
  const previewConfig = themeState?.previewConfig
  const previewMode = themeState?.previewMode

  const activeConfig = useMemo(() => {
    if (previewMode && previewConfig) return previewConfig
    if (reduxConfig) return reduxConfig
    if (tenantConfig) return tenantConfig
    return {}
  }, [reduxConfig, tenantConfig, previewConfig, previewMode])

  const themeColors = useMemo(
    () => getThemeColors(activeConfig),
    [activeConfig],
  )

  const hero = activeConfig?.hero
  const colors = themeColors
  const backgroundImage = getAssetUrl(hero?.backgroundImage)

  if (!hero?.enabled) return null

  return (
    <Box
      sx={{
        position: 'relative',
        height: HEIGHTS[hero?.height] || hero?.height || '400px',
        backgroundImage: backgroundImage
          ? `url(${backgroundImage})`
          : `linear-gradient(135deg, ${colors?.primary} 0%, ${colors?.secondary} 100%)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: hero?.alignment || 'center',
        textAlign: hero?.alignment || 'center',
        '&::before': backgroundImage
          ? {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
            }
          : undefined,
      }}
    >
      <Container
        sx={{
          position: 'relative',
          zIndex: 1,
          color: hero?.textColor || '#ffffff',
        }}
      >
        <Typography
          variant="h2"
          component="h1"
          sx={{
            fontWeight: 800,
            mb: 2,
            textShadow: '0 2px 4px rgba(0,0,0,0.3)',
          }}
        >
          {hero?.title || 'Bienvenido'}
        </Typography>
        <Typography
          variant="h5"
          sx={{
            mb: 4,
            opacity: 0.9,
          }}
        >
          {hero?.subtitle}
        </Typography>
        <Button
          variant="contained"
          size="large"
          sx={{
            backgroundColor: colors?.accent || colors?.secondary,
            color: '#ffffff',
            px: 4,
            py: 1.5,
            fontSize: '1.1rem',
            '&:hover': {
              backgroundColor: colors?.primary,
            },
          }}
        >
          Ver Productos
        </Button>
      </Container>
    </Box>
  )
}

export default CustomHero
