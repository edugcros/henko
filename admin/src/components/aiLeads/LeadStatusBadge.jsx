// 📁 src/components/aiLeads/LeadStatusBadge.jsx
import React from 'react'
import Box from '@mui/material/Box'

// `color` es el del texto y de la barra del resumen de la bandeja; `bg`, el fondo de la etiqueta.
export const LEAD_STATUS_META = {
  new: { label: 'Nuevo', plural: 'Nuevos', color: '#0b55cc', bg: '#e7f0ff' },
  qualified: { label: 'Calificado', plural: 'Calificados', color: '#6d28d9', bg: '#f1e8ff' },
  hot: { label: 'Caliente', plural: 'Calientes', color: '#b42318', bg: '#fdebea' },
  follow_up: { label: 'Seguimiento', plural: 'En seguimiento', color: '#9a5b00', bg: '#fff3dd' },
  won: { label: 'Ganado', plural: 'Ganados', color: '#047857', bg: '#e6f6ef' },
  lost: { label: 'Perdido', plural: 'Perdidos', color: '#55618a', bg: '#eef1fb' },
  discarded: { label: 'Descartado', plural: 'Descartados', color: '#55618a', bg: '#eef1fb' },
}

const LeadStatusBadge = ({ status = 'new' }) => {
  const config = LEAD_STATUS_META[status] || LEAD_STATUS_META.new

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
        color: config.color,
        bgcolor: config.bg,
      }}
    >
      {config.label}
    </Box>
  )
}

export default LeadStatusBadge
