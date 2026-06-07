// 📁 src/components/SpinnerCentered.jsx
import React from 'react'
import { Box, CircularProgress, Typography, Fade, keyframes } from '@mui/material'

const spin = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`

const spinReverse = keyframes`
  0% { transform: rotate(360deg); }
  100% { transform: rotate(0deg); }
`

const SpinnerCentered = ({
  message = 'Cargando...',
  fullScreen = true,
  minHeight,
  transparent = false,
}) => {
  const primaryColor = '#2563eb'
  const secondaryColor = '#111827'
  const backgroundColor = transparent ? 'transparent' : 'rgba(255, 255, 255, 0.96)'

  return (
    <Fade in timeout={350}>
      <Box
        role="status"
        aria-live="polite"
        aria-busy="true"
        sx={{
          width: '100%',
          minHeight: minHeight || (fullScreen ? '100vh' : 240),
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor,
          px: 3,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: 80,
            height: 80,
            mb: 3,
          }}
        >
          <CircularProgress
            size={80}
            thickness={4.5}
            variant="indeterminate"
            sx={{
              color: primaryColor,
              position: 'absolute',
              inset: 0,
              animation: `${spin} 1.35s linear infinite`,
            }}
          />

          <CircularProgress
            size={80}
            thickness={4.5}
            variant="indeterminate"
            sx={{
              color: secondaryColor,
              position: 'absolute',
              inset: 0,
              opacity: 0.65,
              animation: `${spinReverse} 1.65s linear infinite`,
            }}
          />
        </Box>

        {message ? (
          <Typography
            variant="h6"
            sx={{
              color: '#111827',
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            {message}
          </Typography>
        ) : null}
      </Box>
    </Fade>
  )
}

export default SpinnerCentered