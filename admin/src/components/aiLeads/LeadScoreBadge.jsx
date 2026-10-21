// 📁 src/components/aiLeads/LeadScoreBadge.jsx
import React from 'react'
import Box from '@mui/material/Box'

// A más puntaje, más cerca de comprar: rojo para lo más caliente, gris para lo frío.
const getScoreConfig = score => {
  const value = Number(score || 0)
  if (value >= 80) return { label: `Score ${value}`, color: '#b42318', border: '#f4c7c3' }
  if (value >= 60) return { label: `Score ${value}`, color: '#9a5b00', border: '#f2d9a6' }
  if (value >= 35) return { label: `Score ${value}`, color: '#0b55cc', border: '#c5dafc' }
  return { label: `Score ${value}`, color: '#55618a', border: '#dfe6fb' }
}

const LeadScoreBadge = ({ score = 0 }) => {
  const config = getScoreConfig(score)

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.25,
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        color: config.color,
        border: `1px solid ${config.border}`,
      }}
    >
      {config.label}
    </Box>
  )
}

export default LeadScoreBadge
