// 📁 src/components/aiLeads/LeadConversationPanel.jsx
import React, { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = {
  height: '100%',
  borderRadius: 4,
  borderColor: BRAND.line,
  boxShadow: 'none',
  bgcolor: '#fff',
}

const CHANNEL_LABELS = { whatsapp: 'WhatsApp', webchat: 'Chat web', admin: 'Admin' }

const CONVERSATION_STATUS_LABELS = {
  open: 'Abierta',
  waiting_customer: 'Esperando al cliente',
  waiting_human: 'Esperando a una persona',
  human_active: 'Atendida por una persona',
  closed: 'Cerrada',
  converted: 'Convertida en venta',
  lost: 'Perdida',
}

export const getChannelLabel = channel => CHANNEL_LABELS[channel] || channel || 'Chat web'

export const getConversationStatusLabel = status =>
  CONVERSATION_STATUS_LABELS[status] || status || 'Abierta'

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

const LeadConversationPanel = ({
  conversation,
  conversations = [],
  onSelectConversation,
  lead,
  loading = false,
  onDeleteConversation,
}) => {
  const messages = conversation?.messages || []
  const currentId = String(conversation?._id || '')
  // Solo tiene sentido elegir cuando hay más de una. Una persona que vuelve
  // deja varias charlas y antes solo se podía leer la última: el resto
  // quedaba guardado y sin forma de abrirlo.
  const historial = Array.isArray(conversations) ? conversations : []

  // Las charlas se leen de arriba hacia abajo y lo que importa es lo último: se abre en el final.
  const mensajesRef = useRef(null)
  useEffect(() => {
    if (mensajesRef.current) mensajesRef.current.scrollTop = mensajesRef.current.scrollHeight
  }, [currentId, messages.length])

  if (!conversation) {
    return (
      <Paper variant="outlined" sx={{ ...PANEL_SX, p: 3, display: 'grid', placeItems: 'center' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18 }}>
            {lead ? 'Este lead no tiene una conversación guardada' : 'Seleccioná un lead'}
          </Typography>
          <Typography variant="body2" sx={{ color: BRAND.muted, mt: 0.5 }}>
            {lead
              ? 'Puede haberse eliminado. Los datos del lead siguen en el panel de al lado.'
              : 'Acá vas a ver la conversación completa del asistente web.'}
          </Typography>
        </Box>
      </Paper>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{ ...PANEL_SX, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <Box sx={{ p: 2, borderBottom: `1px solid ${BRAND.line}` }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18 }}>
              Conversación
            </Typography>
            <Typography variant="body2" sx={{ color: BRAND.muted }}>
              {getChannelLabel(conversation.channel)} ·{' '}
              {getConversationStatusLabel(conversation.status)}
            </Typography>
          </Box>
          <Typography
            variant="caption"
            sx={{ color: BRAND.muted, fontWeight: 700, whiteSpace: 'nowrap', pt: 0.5 }}
          >
            {messages.length === 1 ? '1 mensaje' : `${messages.length} mensajes`}
          </Typography>
        </Stack>

        {historial.length > 1 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ color: BRAND.muted, fontWeight: 700 }}>
              {historial.length} conversaciones de este cliente
            </Typography>
            <Stack
              direction="row"
              spacing={0.8}
              useFlexGap
              sx={{ mt: 0.8, flexWrap: 'wrap' }}
              role="group"
              aria-label="Conversaciones de este cliente"
            >
              {historial.map((item, index) => {
                const selected = item.id === currentId

                return (
                  <ButtonBase
                    key={item.id}
                    disabled={loading}
                    aria-pressed={selected}
                    onClick={() => onSelectConversation?.(item.id)}
                    sx={{
                      px: 1.25,
                      py: 0.25,
                      borderRadius: 99,
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1.6,
                      color: selected ? '#fff' : BRAND.ink,
                      bgcolor: selected ? BRAND.blue : 'transparent',
                      border: `1px solid ${selected ? BRAND.blue : BRAND.line}`,
                      '&:hover': { bgcolor: selected ? BRAND.blue : BRAND.paper },
                      '&.Mui-disabled': { opacity: 0.6 },
                    }}
                  >
                    {`${formatDate(item.lastMessageAt || item.createdAt) || `#${historial.length - index}`} · ${
                      item.messageCount === 1 ? '1 mensaje' : `${item.messageCount} mensajes`
                    }`}
                  </ButtonBase>
                )
              })}
            </Stack>
          </Box>
        )}

        {conversation?._id && (
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            disabled={loading}
            onClick={() => onDeleteConversation?.(conversation)}
            sx={{ mt: 1, ml: -1, textTransform: 'none', fontWeight: 700 }}
          >
            Eliminar conversación
          </Button>
        )}
      </Box>

      <Box ref={mensajesRef} sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: BRAND.paper }}>
        {!messages.length ? (
          <Typography sx={{ color: BRAND.muted }}>No hay mensajes guardados.</Typography>
        ) : (
          <Stack spacing={1.4}>
            {messages.map((message, index) => {
              const isUser = message.role === 'user'

              return (
                <Box
                  key={message._id || index}
                  sx={{ alignSelf: isUser ? 'flex-start' : 'flex-end', maxWidth: '86%' }}
                >
                  <Paper
                    elevation={0}
                    sx={{
                      p: 1.4,
                      borderRadius: 3,
                      border: `1px solid ${isUser ? BRAND.line : BRAND.blue}`,
                      bgcolor: isUser ? '#fff' : BRAND.blue,
                      color: isUser ? BRAND.ink : '#fff',
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.6 }}>
                      <Typography variant="caption" sx={{ fontWeight: 800 }}>
                        {getRoleLabel(message.role)}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.75 }}>
                        {formatDate(message.createdAt || message.timestamp)}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
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
