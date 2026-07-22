// 📁 src/components/aiLeads/LeadList.jsx
import React from 'react'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import Skeleton from '@mui/material/Skeleton'
import LeadStatusBadge from './LeadStatusBadge.jsx'
import LeadScoreBadge from './LeadScoreBadge.jsx'

const formatDate = value => {
  if (!value) return 'Sin actividad'
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return 'Sin actividad'
  }
}

const getProductLabel = lead => {
  const product = lead?.productsOfInterest?.[0] || lead?.products?.[0]
  return product?.title || 'Sin producto detectado'
}

const LeadListSkeletonComponent = () => (
  <Box sx={{ p: 2 }}>
    {[1, 2, 3, 4].map(item => (
      <Box key={item} sx={{ mb: 2 }}>
        <Skeleton width="70%" />
        <Skeleton width="92%" />
        <Skeleton width="55%" />
      </Box>
    ))}
  </Box>
)

const LeadList = ({ leads = [], selectedId, loading, onSelect }) => {
  if (loading) return <LeadListSkeletonComponent />

  if (!leads.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="subtitle1" fontWeight={700}>
          No hay leads para este filtro
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Cuando el asistente detecte consultas comerciales, aparecerán acá.
        </Typography>
      </Box>
    )
  }

  return (
    <List disablePadding>
      {leads.map((lead, index) => (
        <React.Fragment key={lead.id || lead._id}>
          <ListItemButton
            selected={String(selectedId) === String(lead.id || lead._id)}
            onClick={() => onSelect?.(lead)}
            sx={{ alignItems: 'flex-start', py: 1.6, px: 2 }}
          >
            <ListItemText
              primary={
                <Stack spacing={0.8}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    gap={1}
                  >
                    <Typography variant="subtitle2" fontWeight={800} noWrap>
                      {lead.displayName ||
                        lead.customer?.name ||
                        lead.customer?.email ||
                        'Cliente web'}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      {formatDate(lead.lastInteractionAt || lead.updatedAt)}
                    </Typography>
                  </Stack>

                  <Stack direction="row" gap={0.8} flexWrap="wrap">
                    <LeadStatusBadge status={lead.status} />
                    <LeadScoreBadge score={lead.leadScore || lead.score} />
                  </Stack>
                </Stack>
              }
              secondary={
                <Box sx={{ mt: 1 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    noWrap
                  >
                    {lead.customer?.email ||
                      lead.customer?.phone ||
                      'Sin datos de contacto'}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    noWrap
                  >
                    Producto: {getProductLabel(lead)}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.primary"
                    sx={{ mt: 0.6 }}
                    noWrap
                  >
                    {lead.lastMessage || 'Sin último mensaje registrado'}
                  </Typography>
                </Box>
              }
            />
          </ListItemButton>
          {index < leads.length - 1 && <Divider />}
        </React.Fragment>
      ))}
    </List>
  )
}

export default LeadList
