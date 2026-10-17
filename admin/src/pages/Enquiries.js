import React, { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  getEnquiries,
  updateEnquiryStatus,
  deleteEnquiry,
  resetEnquiryState,
  sendReplyEnquiry,
} from '@features/enquiry/enquirySlice'

import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

import DeleteIcon from '@mui/icons-material/Delete'
import EmailIcon from '@mui/icons-material/Email'
import PhoneIcon from '@mui/icons-material/Phone'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff'
import ReplyIcon from '@mui/icons-material/Reply'
import SearchIcon from '@mui/icons-material/Search'
import SendIcon from '@mui/icons-material/Send'
import toast, { Toaster } from 'react-hot-toast'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// El servidor guarda el estado en inglés; acá se muestra en español. Una consulta sin estado
// cuenta como nueva (es lo que ya hacía el selector).
export const STATUS_META = {
  Submitted: { label: 'Nueva', color: '#9a5b00', stripe: '#ff9800' },
  'In Progress': { label: 'En proceso', color: '#0b55cc', stripe: '#0b6bff' },
  Resolved: { label: 'Resuelta', color: '#047857', stripe: '#2e9e6b' },
}

export const getStatus = enquiry => (STATUS_META[enquiry?.status] ? enquiry.status : 'Submitted')

export const getEnquiryList = enquiries =>
  Array.isArray(enquiries) ? enquiries : enquiries?.data || []

// Sin mayúsculas ni acentos: quien busca «gomez» tiene que encontrar a «Gómez».
export const normalizeText = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export const filterEnquiries = (list, { status = 'all', search = '' } = {}) => {
  const query = normalizeText(search)

  return (list || []).filter(enquiry => {
    if (status !== 'all' && getStatus(enquiry) !== status) return false
    if (!query) return true

    return normalizeText(
      [enquiry.name, enquiry.email, enquiry.mobile, enquiry.comment].join(' '),
    ).includes(query)
  })
}

const formatDate = value => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-AR')
}

// Cada cifra del resumen es también un filtro rápido.
const SummaryTile = ({ title, value, color, onClick, active }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={active}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 0.25,
      width: '100%',
      height: '100%',
      p: 2,
      textAlign: 'left',
      borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
      bgcolor: active ? BRAND.paper : 'transparent',
      '&:hover': { bgcolor: BRAND.paper },
    }}
  >
    <Typography
      component="span"
      variant="caption"
      sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.04em' }}
    >
      {title}
    </Typography>
    <Typography
      component="span"
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: 28,
        lineHeight: 1.2,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Typography>
  </ButtonBase>
)

const Enquiries = () => {
  const dispatch = useDispatch()

  const {
    enquiries,
    isLoading,
    isError,
    isSuccess,
    message: msg,
  } = useSelector(state => state.enquiry)
  // Estados para modales
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [selectedEnquiry, setSelectedEnquiry] = useState(null)
  const [replyMessage, setReplyMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    dispatch(getEnquiries())
  }, [dispatch])

  useEffect(() => {
    if (isSuccess && msg) {
      toast.success(msg)
      dispatch(resetEnquiryState())
    }
  }, [isSuccess, msg, dispatch])

  // --- Lógica de Manejo ---

  const handleStatusChange = (enquiry, newStatus) => {
    dispatch(updateEnquiryStatus({ id: enquiry._id, status: newStatus }))
      .unwrap()
      .catch(err => toast.error(err || 'No se pudo cambiar el estado de la consulta.'))
  }

  const handleDeleteClick = enquiry => {
    setSelectedEnquiry(enquiry)
    setConfirmOpen(true)
  }

  const handleConfirmDelete = () => {
    if (selectedEnquiry) {
      dispatch(deleteEnquiry(selectedEnquiry._id))
        .unwrap()
        .catch(err => toast.error(err || 'No se pudo eliminar la consulta.'))
    }
    setConfirmOpen(false)
    setTimeout(() => setSelectedEnquiry(null), 300)
  }

  const handleReplyClick = enquiry => {
    // El borrador es de la consulta en la que se escribió: no pasa a la siguiente.
    if (selectedEnquiry?._id !== enquiry._id) setReplyMessage('')
    setSelectedEnquiry(enquiry)
    setReplyOpen(true)
  }

  const closeReply = () => {
    if (sending) return
    setReplyOpen(false)
  }

  // Enviar respuesta vía email con mejoras de flujo y accesibilidad
  const handleSendReply = () => {
    if (sending) return
    if (!replyMessage.trim()) return toast.error('Escribe un mensaje')

    const loadingToast = toast.loading('Enviando respuesta...')

    setSending(true)

    dispatch(
      sendReplyEnquiry({
        id: selectedEnquiry._id,
        message: replyMessage,
      }),
    )
      .unwrap()
      .then(() => {
        // 1. Cerramos el modal primero para evitar conflictos de foco/render
        setReplyOpen(false)
        setReplyMessage('')
        toast.success(`¡Email enviado con éxito!`, { id: loadingToast })

        // 2. Limpiamos el enquiry seleccionado tras la animación
        setTimeout(() => setSelectedEnquiry(null), 300)
      })
      .catch(err => {
        console.error('Error al enviar respuesta:', err)
        toast.error(`Error: ${err || 'No se pudo conectar con el servidor'}`, {
          id: loadingToast,
        })
      })
      .finally(() => setSending(false))
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
  }

  const toggleStatusFilter = status =>
    setStatusFilter(current => (current === status ? 'all' : status))

  const enquiryList = useMemo(() => getEnquiryList(enquiries), [enquiries])
  const totalEnquiries = enquiryList.length
  const countByStatus = status => enquiryList.filter(e => getStatus(e) === status).length

  const visibleEnquiries = useMemo(
    () => filterEnquiries(enquiryList, { status: statusFilter, search }),
    [enquiryList, statusFilter, search],
  )

  const hayFiltros = Boolean(search.trim()) || statusFilter !== 'all'
  const loadFailed = isError && totalEnquiries === 0

  const retry = () => {
    dispatch(resetEnquiryState())
    dispatch(getEnquiries())
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
      <Toaster position="top-right" />

      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          TU TIENDA
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: { xs: 26, md: 34 },
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}
        >
          Consultas
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Administra las dudas y mensajes de tus clientes
        </Typography>
      </Box>

      <Paper
        component="section"
        aria-label="Resumen de consultas"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          }}
        >
          <SummaryTile
            title="Total"
            value={totalEnquiries}
            color={BRAND.blue}
            onClick={clearFilters}
            active={!hayFiltros}
          />
          <SummaryTile
            title="Nuevas"
            value={countByStatus('Submitted')}
            color={STATUS_META.Submitted.color}
            onClick={() => toggleStatusFilter('Submitted')}
            active={statusFilter === 'Submitted'}
          />
          <SummaryTile
            title="En proceso"
            value={countByStatus('In Progress')}
            color={STATUS_META['In Progress'].color}
            onClick={() => toggleStatusFilter('In Progress')}
            active={statusFilter === 'In Progress'}
          />
          <SummaryTile
            title="Resueltas"
            value={countByStatus('Resolved')}
            color={STATUS_META.Resolved.color}
            onClick={() => toggleStatusFilter('Resolved')}
            active={statusFilter === 'Resolved'}
          />
        </Box>
      </Paper>

      {totalEnquiries > 0 && (
        <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <TextField
              fullWidth
              size="small"
              placeholder="Nombre, correo o mensaje..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              sx={{ maxWidth: { sm: 460 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" />
                    </InputAdornment>
                  ),
                },
                htmlInput: { 'aria-label': 'Buscar consultas' },
              }}
            />

            {hayFiltros && (
              <Button
                onClick={clearFilters}
                startIcon={<FilterAltOffIcon />}
                sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
              >
                Limpiar filtros
              </Button>
            )}
          </Stack>
        </Paper>
      )}

      {isLoading && totalEnquiries > 0 && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      {loadFailed && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={retry}>
              Reintentar
            </Button>
          }
        >
          {typeof msg === 'string' && msg ? msg : 'No se pudieron cargar las consultas.'}
        </Alert>
      )}

      {isLoading && totalEnquiries === 0 && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            my: 10,
          }}
        >
          <CircularProgress thickness={5} size={50} />
          <Typography sx={{ mt: 2 }} color="text.secondary">
            Cargando consultas...
          </Typography>
        </Box>
      )}

      {!isLoading && !loadFailed && visibleEnquiries.length === 0 && (
        <Paper variant="outlined" sx={{ ...PANEL_SX, p: 6, textAlign: 'center' }}>
          <Typography
            component="h2"
            sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, mb: 0.5 }}
          >
            {hayFiltros && totalEnquiries > 0
              ? 'Ninguna consulta coincide con la búsqueda.'
              : 'No hay consultas nuevas.'}
          </Typography>
          <Typography color="text.secondary">
            {hayFiltros && totalEnquiries > 0
              ? 'Probá con otra palabra o limpiá los filtros.'
              : 'Cuando un cliente te escriba desde la tienda, lo vas a ver acá.'}
          </Typography>
        </Paper>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
          gap: 3,
        }}
      >
        {visibleEnquiries.map(enquiry => {
          const status = getStatus(enquiry)

          return (
            <Paper
              key={enquiry._id}
              component="article"
              variant="outlined"
              sx={{ ...PANEL_SX, overflow: 'hidden', minWidth: 0 }}
            >
              <Box sx={{ height: 5, bgcolor: STATUS_META[status].stripe }} />

              <Box sx={{ p: 3 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 2, gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                      {enquiry.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                      <CalendarTodayIcon sx={{ fontSize: 12 }} />
                      {formatDate(enquiry.createdAt)}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Tooltip title="Responder">
                      <IconButton
                        size="small"
                        color="primary"
                        aria-label={`Responder a ${enquiry.name}`}
                        onClick={() => handleReplyClick(enquiry)}
                        sx={{ bgcolor: '#eaf2ff' }}
                        disableRipple
                      >
                        <ReplyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Eliminar">
                      <IconButton
                        color="error"
                        aria-label={`Eliminar la consulta de ${enquiry.name}`}
                        onClick={() => handleDeleteClick(enquiry)}
                        size="small"
                        sx={{ bgcolor: '#fff5f5' }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>

                <Stack spacing={0.5} sx={{ mb: 2 }}>
                  <Typography
                    variant="body2"
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, overflowWrap: 'anywhere' }}
                    color="text.secondary"
                  >
                    <EmailIcon sx={{ fontSize: 16, flexShrink: 0 }} /> {enquiry.email}
                  </Typography>
                  {enquiry.mobile && (
                    <Typography
                      variant="body2"
                      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                      color="text.secondary"
                    >
                      <PhoneIcon sx={{ fontSize: 16 }} /> {enquiry.mobile}
                    </Typography>
                  )}
                </Stack>

                <Box
                  sx={{
                    bgcolor: BRAND.paper,
                    p: 2,
                    borderRadius: 3,
                    mb: 3,
                    minHeight: 60,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ color: BRAND.ink, fontStyle: 'italic', overflowWrap: 'anywhere' }}
                  >
                    "{enquiry.comment}"
                  </Typography>
                </Box>

                <Select
                  value={status}
                  onChange={e => handleStatusChange(enquiry, e.target.value)}
                  size="small"
                  fullWidth
                  SelectDisplayProps={{ 'aria-label': `Estado de la consulta de ${enquiry.name}` }}
                  sx={{
                    borderRadius: 3,
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: STATUS_META[status].color,
                    bgcolor: '#fff',
                  }}
                >
                  <MenuItem value="Submitted">Nueva</MenuItem>
                  <MenuItem value="In Progress">En proceso</MenuItem>
                  <MenuItem value="Resolved">Resuelta</MenuItem>
                </Select>
              </Box>
            </Paper>
          )
        })}
      </Box>

      {/* Modal: Responder Consulta (Refactorizado con slotProps y Fix de Accesibilidad) */}
      <Dialog
        open={replyOpen}
        onClose={closeReply}
        fullWidth
        maxWidth="sm"
        disableEnforceFocus // Evita conflictos de foco con Redux/Aria
        disableRestoreFocus // Evita el error de aria-hidden al cerrar
        slotProps={{
          paper: {
            sx: { borderRadius: 3 },
          },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
          }}
        >
          <EmailIcon color="primary" /> Responder a {selectedEnquiry?.name}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            Consulta original:
          </Typography>
          <Typography
            variant="body2"
            sx={{ mb: 3, p: 2, bgcolor: BRAND.paper, borderRadius: 3, overflowWrap: 'anywhere' }}
          >
            "{selectedEnquiry?.comment}"
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            placeholder="Escribe tu respuesta aquí... el cliente la recibirá en su correo."
            variant="outlined"
            value={replyMessage}
            disabled={sending}
            onChange={e => setReplyMessage(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={closeReply} color="inherit" disabled={sending}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            endIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            onClick={handleSendReply}
            disabled={sending}
            sx={{ borderRadius: 3, px: 3 }}
          >
            Enviar Respuesta
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal: Confirmación Eliminar (Refactorizado con slotProps) */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        slotProps={{
          paper: {
            sx: { borderRadius: 3 },
          },
        }}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          ¿Eliminar consulta?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Se eliminará la consulta de <b>{selectedEnquiry?.name}</b>.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirmOpen(false)}>Cancelar</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleConfirmDelete}
            sx={{ borderRadius: 3 }}
          >
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Enquiries
