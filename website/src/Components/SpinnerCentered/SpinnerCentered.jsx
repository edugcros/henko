// 📁 src/components/SpinnerCentered.jsx
import React from 'react'
import { Box, CircularProgress, Typography, Fade } from '@mui/material'

const SpinnerCentered = ({ message = 'Cargando...' }) => {
  return (
    <Fade in={true} timeout={500}>
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(255,255,255,0.95)',
        }}
      >
        {/* Loader animado */}
        <Box sx={{ position: 'relative', width: 80, height: 80, mb: 3 }}>
          <CircularProgress
            size={80}
            thickness={5}
            sx={{
              color: 'primary.main',
              position: 'absolute',
              animation: 'spin 1.5s linear infinite',
            }}
          />
          <CircularProgress
            size={80}
            thickness={5}
            sx={{
              color: 'secondary.main',
              position: 'absolute',
              animation: 'spinReverse 1.5s linear infinite',
            }}
          />
        </Box>

        {/* Texto centrado */}
        <Typography variant="h6" color="text.primary">
          {message}
        </Typography>

        {/* Animaciones CSS */}
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            @keyframes spinReverse {
              0% { transform: rotate(360deg); }
              100% { transform: rotate(0deg); }
            }
          `}
        </style>
      </Box>
    </Fade>
  )
}

export default SpinnerCentered
