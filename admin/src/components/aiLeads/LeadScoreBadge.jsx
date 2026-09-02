// 📁 src/components/aiLeads/LeadScoreBadge.jsx
import React from 'react'
import Chip from '@mui/material/Chip'

const getScoreConfig = score => {
  const value = Number(score || 0)
  if (value >= 80) return { label: `Score ${value}`, color: 'error' }
  if (value >= 60) return { label: `Score ${value}`, color: 'warning' }
  if (value >= 35) return { label: `Score ${value}`, color: 'info' }
  return { label: `Score ${value}`, color: 'default' }
}

const LeadScoreBadge = ({ score = 0, size = 'small' }) => {
  const config = getScoreConfig(score)
  return <Chip size={size} label={config.label} color={config.color} variant="outlined" />
}

export default LeadScoreBadge
