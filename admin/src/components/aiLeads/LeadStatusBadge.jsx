// 📁 src/components/aiLeads/LeadStatusBadge.jsx
import React from 'react'
import Chip from '@mui/material/Chip'

const STATUS = {
  new: { label: 'Nuevo', color: 'default' },
  qualified: { label: 'Calificado', color: 'info' },
  hot: { label: 'Caliente', color: 'error' },
  follow_up: { label: 'Seguimiento', color: 'warning' },
  won: { label: 'Ganado', color: 'success' },
  lost: { label: 'Perdido', color: 'default' },
  discarded: { label: 'Descartado', color: 'default' },
}

const LeadStatusBadge = ({ status = 'new', size = 'small' }) => {
  const config = STATUS[status] || STATUS.new
  return (
    <Chip
      size={size}
      label={config.label}
      color={config.color}
      variant="filled"
    />
  )
}

export default LeadStatusBadge
