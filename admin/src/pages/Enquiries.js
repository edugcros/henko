import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  getEnquiries,
  updateEnquiryStatus,
  deleteEnquiry,
  resetEnquiryState,
  sendReplyEnquiry,
} from '@features/enquiry/enquirySlice'

import {
  Box,
  Typography,
  Stack,
  Card,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  MenuItem,
  Paper,
  Select,
  Fade,
  Grid,
  Divider,
  TextField,
} from '@mui/material'

import DeleteIcon from '@mui/icons-material/Delete'
import EmailIcon from '@mui/icons-material/Email'
import PhoneIcon from '@mui/icons-material/Phone'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import ReplyIcon from '@mui/icons-material/Reply'
import SendIcon from '@mui/icons-material/Send'
import toast, { Toaster } from 'react-hot-toast'

const statusColors = {
  Submitted: 'default',
  'In Progress': 'warning',
  Resolved: 'success',
}

const Enquiries = () => {
  const dispatch = useDispatch()

  const { enquiries, isLoading, isSuccess, message: msg } = useSelector(state => state.enquiry)
  // Estados para modales
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [selectedEnquiry, setSelectedEnquiry] = useState(null)
  const [replyMessage, setReplyMessage] = useState('')

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
  }

  const handleDeleteClick = enquiry => {
    setSelectedEnquiry(enquiry)
    setConfirmOpen(true)
  }

  const handleConfirmDelete = () => {
    if (selectedEnquiry) {
      dispatch(deleteEnquiry(selectedEnquiry._id))
    }
    setConfirmOpen(false)
    setTimeout(() => setSelectedEnquiry(null), 300)
  }

  const handleReplyClick = enquiry => {
    setSelectedEnquiry(enquiry)
    setReplyOpen(true)
  }

  // Enviar respuesta vía email con mejoras de flujo y accesibilidad
  const handleSendReply = () => {
    if (!replyMessage.trim()) return toast.error('Escribe un mensaje')

    const loadingToast = toast.loading('Enviando respuesta...')

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
  }

  const enquiryList = Array.isArray(enquiries) ? enquiries : enquiries?.data || []
  const totalEnquiries = enquiryList.length
  const inProgress = enquiryList.filter(e => e.status === 'In Progress').length
  const resolved = enquiryList.filter(e => e.status === 'Resolved').length

  return (
    <Box p={4} sx={{ backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <Toaster position="top-right" />

      {/* Cabecera */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems="center"
        mb={4}
        spacing={2}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight={800}
            color="#1A2027"
            sx={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <QuestionAnswerIcon fontSize="large" color="primary" />
            Gestión de Consultas
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Administra las dudas y mensajes de tus clientes
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Chip
            label={`Total: ${totalEnquiries}`}
            sx={{
              fontWeight: 'bold',
              bgcolor: '#fff',
              border: '1px solid #ddd',
            }}
          />
          <Chip label={`En Proceso: ${inProgress}`} color="warning" sx={{ fontWeight: 'bold' }} />
          <Chip label={`Resueltas: ${resolved}`} color="success" sx={{ fontWeight: 'bold' }} />
        </Stack>
      </Stack>

      <Divider sx={{ mb: 4 }} />

      {isLoading && (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          my={10}
        >
          <CircularProgress thickness={5} size={50} />
          <Typography sx={{ mt: 2 }} color="text.secondary">
            Cargando consultas...
          </Typography>
        </Box>
      )}

      {!isLoading && enquiryList.length === 0 && (
        <Paper
          sx={{
            p: 10,
            textAlign: 'center',
            borderRadius: 4,
            border: '2px dashed #ddd',
            bgcolor: 'transparent',
          }}
        >
          <Typography variant="h6" color="text.secondary">
            No hay consultas nuevas.
          </Typography>
        </Paper>
      )}

      <Grid container spacing={3}>
        {enquiryList.map(enquiry => (
          <Grid item xs={12} sm={6} md={4} key={enquiry._id}>
            <Fade in={true}>
              <Card
                sx={{
                  borderRadius: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                  border: '1px solid #eceff1',
                  transition: 'all 0.3s ease',
                  '&:hover': {
                    transform: 'translateY(-5px)',
                    boxShadow: '0 12px 24px rgba(0,0,0,0.08)',
                  },
                }}
              >
                <Box
                  sx={{
                    height: 5,
                    bgcolor:
                      enquiry.status === 'Resolved'
                        ? '#4caf50'
                        : enquiry.status === 'In Progress'
                          ? '#ff9800'
                          : '#cfd8dc',
                  }}
                />

                <Box p={3}>
                  <Stack direction="row" justifyContent="space-between" mb={2}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {enquiry.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="flex"
                        alignItems="center"
                        gap={0.5}
                      >
                        <CalendarTodayIcon sx={{ fontSize: 12 }} />
                        {new Date(enquiry.createdAt).toLocaleDateString()}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Responder">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleReplyClick(enquiry)}
                          sx={{ bgcolor: '#e3f2fd' }}
                          disableRipple
                        >
                          <ReplyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        color="error"
                        onClick={() => handleDeleteClick(enquiry)}
                        size="small"
                        sx={{ bgcolor: '#fff5f5' }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>

                  <Stack spacing={0.5} mb={2}>
                    <Typography
                      variant="body2"
                      display="flex"
                      alignItems="center"
                      gap={1}
                      color="text.secondary"
                    >
                      <EmailIcon sx={{ fontSize: 16 }} /> {enquiry.email}
                    </Typography>
                    <Typography
                      variant="body2"
                      display="flex"
                      alignItems="center"
                      gap={1}
                      color="text.secondary"
                    >
                      <PhoneIcon sx={{ fontSize: 16 }} /> {enquiry.mobile}
                    </Typography>
                  </Stack>

                  <Box
                    sx={{
                      bgcolor: '#f5f7f9',
                      p: 2,
                      borderRadius: 2,
                      mb: 3,
                      minHeight: 60,
                    }}
                  >
                    <Typography variant="body2" color="#455a64" sx={{ fontStyle: 'italic' }}>
                      "{enquiry.comment}"
                    </Typography>
                  </Box>

                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Select
                      value={enquiry.status || 'Submitted'}
                      onChange={e => handleStatusChange(enquiry, e.target.value)}
                      size="small"
                      sx={{
                        borderRadius: 2,
                        height: 35,
                        fontSize: '0.8rem',
                        minWidth: 120,
                        bgcolor: '#fff',
                      }}
                    >
                      <MenuItem value="Submitted">Recibida</MenuItem>
                      <MenuItem value="In Progress">En Proceso</MenuItem>
                      <MenuItem value="Resolved">Resuelta</MenuItem>
                    </Select>

                    <Chip
                      label={enquiry.status === 'Submitted' ? 'Nueva' : enquiry.status}
                      size="small"
                      color={statusColors[enquiry.status] || 'default'}
                      sx={{ fontWeight: 'bold' }}
                    />
                  </Stack>
                </Box>
              </Card>
            </Fade>
          </Grid>
        ))}
      </Grid>

      {/* Modal: Responder Consulta (Refactorizado con slotProps y Fix de Accesibilidad) */}
      <Dialog
        open={replyOpen}
        onClose={() => setReplyOpen(false)}
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
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <EmailIcon color="primary" /> Responder a {selectedEnquiry?.name}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            Consulta original:
          </Typography>
          <Typography variant="body2" sx={{ mb: 3, p: 2, bgcolor: '#f0f4f8', borderRadius: 2 }}>
            "{selectedEnquiry?.comment}"
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            placeholder="Escribe tu respuesta aquí... el cliente la recibirá en su correo."
            variant="outlined"
            value={replyMessage}
            onChange={e => setReplyMessage(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setReplyOpen(false)} color="inherit">
            Cancelar
          </Button>
          <Button
            variant="contained"
            endIcon={<SendIcon />}
            onClick={handleSendReply}
            sx={{ borderRadius: 2, px: 3 }}
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
        <DialogTitle fontWeight={700}>¿Eliminar consulta?</DialogTitle>
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
            sx={{ borderRadius: 2 }}
          >
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Enquiries
