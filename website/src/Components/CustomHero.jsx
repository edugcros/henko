// 📁 web/src/components/CustomHero.jsx
import React from 'react'
import { Box, Typography, Container, Button } from '@mui/material'
import useThemeConfig from '@hooks/useThemeConfig'

const CustomHero = () => {
  const { themeConfig } = useThemeConfig()
  const hero = themeConfig?.hero
  const colors = themeConfig?.colors

  if (!hero?.enabled) return null

  return (
    <Box
      sx={{
        position: 'relative',
        height: hero?.height || '400px',
        backgroundImage: hero?.backgroundImage
          ? `url(${hero.backgroundImage})`
          : `linear-gradient(135deg, ${colors?.primary} 0%, ${colors?.secondary} 100%)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: hero?.alignment || 'center',
        textAlign: hero?.alignment || 'center',
        '&::before': hero?.backgroundImage
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
          {hero?.subtitle || 'Descubre nuestros productos'}
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
