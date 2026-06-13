// 📁 src/components/aiLeads/LeadConversationPanel.jsx
import React from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'

const formatDate = value => {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

const getRoleLabel = role => {
  if (role === 'assistant') return 'IA'
  if (role === 'user') return 'Cliente'
  if (role === 'admin') return 'Admin'
  return role || 'Sistema'
}

const LeadConversationPanel = ({ conversation }) => {
  const messages = conversation?.messages || []

  if (!conversation) {
    return (
      <Paper
        variant="outlined"
        sx={{ height: '100%', p: 3, display: 'grid', placeItems: 'center' }}
      >
        <Box textAlign="center">
          <Typography variant="h6" fontWeight={800}>
            Seleccioná un lead
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Acá vas a ver la conversación completa del asistente web.
          </Typography>
        </Box>
      </Paper>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          p: 2,
          borderBottom: theme => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={2}
        >
          <Box>
            <Typography variant="h6" fontWeight={900}>
              Conversación
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {conversation.channel || 'webchat'} ·{' '}
              {conversation.status || 'open'}
            </Typography>
          </Box>
          <Chip size="small" label={`${messages.length} mensajes`} />
        </Stack>
      </Box>

      <Box
        sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: 'background.default' }}
      >
        {!messages.length ? (
          <Typography color="text.secondary">
            No hay mensajes guardados.
          </Typography>
        ) : (
          <Stack spacing={1.4}>
            {messages.map((message, index) => {
              const isUser = message.role === 'user'
              return (
                <Box
                  key={message._id || index}
                  sx={{
                    alignSelf: isUser ? 'flex-start' : 'flex-end',
                    maxWidth: '82%',
                  }}
                >
                  <Paper
                    elevation={0}
                    sx={{
                      p: 1.4,
                      borderRadius: 3,
                      border: theme => `1px solid ${theme.palette.divider}`,
                      bgcolor: isUser ? 'background.paper' : 'primary.main',
                      color: isUser ? 'text.primary' : 'primary.contrastText',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ mb: 0.6 }}
                    >
                      <Typography variant="caption" fontWeight={800}>
                        {getRoleLabel(message.role)}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {formatDate(message.createdAt || message.timestamp)}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {message.content || message.text || ''}
                    </Typography>
                  </Paper>
                </Box>
              )
            })}
          </Stack>
        )}
      </Box>
    </Paper>
  )
}

export default LeadConversationPanel
