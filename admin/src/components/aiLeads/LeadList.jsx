// 📁 src/components/aiLeads/LeadList.jsx
import React from 'react'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Skeleton from '@mui/material/Skeleton'
import LeadStatusBadge from './LeadStatusBadge.jsx'
import LeadScoreBadge from './LeadScoreBadge.jsx'

const LINE = '#dfe6fb'
const MUTED = '#55618a'
const PAPER = '#f4f7ff'
const BLUE = '#0b6bff'

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

// `loading` solo muestra el esqueleto cuando todavía no hay nada que mostrar: al filtrar o actualizar
// la lista anterior se queda a la vista (la página la atenúa y muestra una barra de progreso).
const LeadList = ({ leads = [], selectedId, loading, onSelect, emptyTitle, emptyHint }) => {
  if (loading && !leads.length) return <LeadListSkeletonComponent />

  if (!leads.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography sx={{ fontWeight: 800, color: '#050b1f' }}>
          {emptyTitle || 'No hay leads para este filtro'}
        </Typography>
        <Typography variant="body2" sx={{ color: MUTED, mt: 0.5 }}>
          {emptyHint || 'Cuando el asistente detecte consultas comerciales, aparecerán acá.'}
        </Typography>
      </Box>
    )
  }

  return (
    <List disablePadding>
      {leads.map(lead => {
        const id = lead.id || lead._id
        const selected = String(selectedId) === String(id)

        return (
          <ListItemButton
            key={id}
            selected={selected}
            onClick={() => onSelect?.(lead)}
            sx={{
              display: 'block',
              px: 2,
              py: 1.6,
              borderBottom: `1px solid ${LINE}`,
              borderLeft: `3px solid ${selected ? BLUE : 'transparent'}`,
              '&.Mui-selected, &.Mui-selected:hover': { bgcolor: PAPER },
              '&:hover': { bgcolor: PAPER },
            }}
          >
            <Stack spacing={0.8}>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
              >
                <Typography sx={{ fontWeight: 800, fontSize: 15 }} noWrap>
                  {lead.displayName || lead.customer?.name || lead.customer?.email || 'Cliente web'}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: MUTED, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatDate(lead.lastInteractionAt || lead.updatedAt)}
                </Typography>
              </Stack>

              <Stack direction="row" sx={{ gap: 0.8, flexWrap: 'wrap' }}>
                <LeadStatusBadge status={lead.status} />
                <LeadScoreBadge score={lead.leadScore || lead.score} />
              </Stack>

              <Box>
                <Typography variant="caption" sx={{ display: 'block', color: MUTED }} noWrap>
                  {lead.customer?.email || lead.customer?.phone || 'Sin datos de contacto'}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', color: MUTED }} noWrap>
                  Producto: {getProductLabel(lead)}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.6, color: '#050b1f' }} noWrap>
                  {lead.lastMessage || 'Sin último mensaje registrado'}
                </Typography>
              </Box>
            </Stack>
          </ListItemButton>
        )
      })}
    </List>
  )
}

export default LeadList
