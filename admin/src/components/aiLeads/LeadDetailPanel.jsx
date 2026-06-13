// 📁 admin/src/components/aiLeads/LeadDetailPanel.jsx
import React, { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Divider from '@mui/material/Divider'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ClearIcon from '@mui/icons-material/Clear'
import LeadStatusBadge from './LeadStatusBadge.jsx'
import LeadScoreBadge from './LeadScoreBadge.jsx'
import LeadFollowUpModal from './LeadFollowUpModal.jsx'

const STATUS_OPTIONS = [
  { value: 'new', label: 'Nuevo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'hot', label: 'Caliente' },
  { value: 'follow_up', label: 'Seguimiento' },
  { value: 'won', label: 'Ganado' },
  { value: 'lost', label: 'Perdido' },
  { value: 'discarded', label: 'Descartado' },
]

const clean = value => String(value || '').trim()

const formatDate = value => {
  if (!value) return 'Sin fecha'

  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return 'Sin fecha'
  }
}

const openWhatsapp = phone => {
  const cleanPhone = clean(phone).replace(/\D/g, '')
  if (!cleanPhone) return
  window.open(`https://wa.me/${cleanPhone}`, '_blank', 'noopener,noreferrer')
}

const copy = value => {
  const text = clean(value)
  if (!text) return
  navigator.clipboard?.writeText(text)
}

const getProductRef = product => {
  return clean(
    product?._id ||
      product?.productId ||
      product?.slug ||
      product?.sku ||
      product?.title,
  )
}

const ConfirmDialog = ({
  open,
  title,
  description,
  severity = 'warning',
  confirmLabel = 'Confirmar',
  loading = false,
  requireReason = false,
  defaultReason = '',
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState(defaultReason)

  const canConfirm = !requireReason || Boolean(clean(reason))

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!loading) onClose?.()
      }}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 4,
        },
      }}
    >
      <DialogTitle fontWeight={900}>{title}</DialogTitle>

      <DialogContent>
        <Stack spacing={2}>
          <Alert severity={severity}>{description}</Alert>

          {requireReason && (
            <TextField
              label="Motivo"
              value={reason}
              onChange={event => setReason(event.target.value)}
              multiline
              minRows={3}
              fullWidth
              disabled={loading}
            />
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={onClose}
          disabled={loading}
          sx={{ textTransform: 'none', fontWeight: 800 }}
        >
          Cancelar
        </Button>

        <Button
          color={severity === 'error' ? 'error' : 'primary'}
          variant="contained"
          disabled={loading || !canConfirm}
          onClick={() => onConfirm?.(clean(reason))}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ textTransform: 'none', fontWeight: 900 }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const LeadDetailPanel = ({
  lead,
  onChangeStatus,
  onAddNote,
  onScheduleFollowUp,
  onMarkWon,
  onMarkLost,
  onDiscard,
  onDelete,
  onRemoveProductOfInterest,
  onUpdateProductsOfInterest,
  loading,
}) => {
  const [note, setNote] = useState('')
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [confirmState, setConfirmState] = useState(null)

  const customer = lead?.customer || {}

  const products = useMemo(() => {
    return Array.isArray(lead?.productsOfInterest) ? lead.productsOfInterest : []
  }, [lead?.productsOfInterest])

  if (!lead) {
    return (
      <Paper
        variant="outlined"
        sx={{
          height: '100%',
          p: 3,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 3,
        }}
      >
        <Typography color="text.secondary">
          Seleccioná un lead para ver acciones comerciales.
        </Typography>
      </Paper>
    )
  }

  const closeConfirm = () => setConfirmState(null)

  const openConfirm = config => {
    setConfirmState(config)
  }

  const handleAddNote = async () => {
    const cleanNote = clean(note)
    if (!cleanNote) return

    await onAddNote?.(cleanNote)
    setNote('')
  }

  const handleRemoveProduct = product => {
    const productRef = getProductRef(product)

    if (!productRef) return

    openConfirm({
      title: 'Quitar producto de interés',
      description:
        'Esta acción quita el producto de interés del lead. Usala cuando la IA haya asociado un producto incorrecto.',
      severity: 'warning',
      confirmLabel: 'Quitar producto',
      requireReason: false,
      onConfirm: async () => {
        await onRemoveProductOfInterest?.(
          productRef,
          'Producto de interés removido manualmente desde bandeja comercial',
        )
        closeConfirm()
      },
    })
  }

  const handleClearProducts = () => {
    openConfirm({
      title: 'Limpiar productos de interés',
      description:
        'Se eliminarán todos los productos de interés asociados a este lead. La conversación no se elimina.',
      severity: 'warning',
      confirmLabel: 'Limpiar productos',
      requireReason: false,
      onConfirm: async () => {
        await onUpdateProductsOfInterest?.([])
        closeConfirm()
      },
    })
  }

  const displayName =
    lead.displayName || customer.name || customer.email || customer.phone || 'Cliente web'

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 3,
        }}
      >
        <Box
          sx={{
            p: 2,
            borderBottom: theme => `1px solid ${theme.palette.divider}`,
          }}
        >
          <Stack spacing={1}>
            <Typography variant="h6" fontWeight={900} noWrap>
              {displayName}
            </Typography>

            <Stack direction="row" gap={1} flexWrap="wrap">
              <LeadStatusBadge status={lead.status} />
              <LeadScoreBadge score={lead.leadScore || lead.score} />
              <Chip size="small" label={lead.intent || 'unknown'} variant="outlined" />
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          <Stack spacing={2.2}>
            <Box>
              <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                Datos del cliente
              </Typography>

              <Stack spacing={0.8}>
                <Typography variant="body2">
                  Nombre: {customer.name || 'Sin nombre'}
                </Typography>

                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    Email: {customer.email || 'Sin email'}
                  </Typography>

                  {customer.email && (
                    <Tooltip title="Copiar email">
                      <IconButton size="small" onClick={() => copy(customer.email)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>

                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    Teléfono: {customer.phone || 'Sin teléfono'}
                  </Typography>

                  {customer.phone && (
                    <>
                      <Tooltip title="Copiar teléfono">
                        <IconButton size="small" onClick={() => copy(customer.phone)}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Abrir WhatsApp">
                        <IconButton
                          size="small"
                          onClick={() => openWhatsapp(customer.phone)}
                        >
                          <WhatsAppIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Stack>
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                Gestión comercial
              </Typography>

              <Stack spacing={1.2}>
                <TextField
                  select
                  size="small"
                  label="Estado"
                  value={lead.status || 'new'}
                  onChange={event => onChangeStatus?.(event.target.value)}
                  disabled={loading}
                  fullWidth
                >
                  {STATUS_OPTIONS.map(option => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>

                <Typography variant="body2" color="text.secondary">
                  Próximo seguimiento: {formatDate(lead.nextFollowUpAt)}
                </Typography>

                <Button
                  variant="outlined"
                  onClick={() => setFollowUpOpen(true)}
                  disabled={loading}
                  sx={{ textTransform: 'none', fontWeight: 800 }}
                >
                  Programar seguimiento
                </Button>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    color="success"
                    variant="contained"
                    onClick={() =>
                      openConfirm({
                        title: 'Marcar lead como ganado',
                        description:
                          'El lead quedará marcado como venta ganada para reportes comerciales.',
                        severity: 'success',
                        confirmLabel: 'Marcar ganado',
                        requireReason: false,
                        onConfirm: async reason => {
                          await onMarkWon?.(reason)
                          closeConfirm()
                        },
                      })
                    }
                    disabled={loading}
                  >
                    Ganado
                  </Button>

                  <Button
                    size="small"
                    color="warning"
                    variant="outlined"
                    onClick={() =>
                      openConfirm({
                        title: 'Marcar lead como perdido',
                        description:
                          'Indicá el motivo para mantener trazabilidad comercial.',
                        severity: 'warning',
                        confirmLabel: 'Marcar perdido',
                        requireReason: true,
                        defaultReason: 'Marcado como perdido desde bandeja comercial',
                        onConfirm: async reason => {
                          await onMarkLost?.(reason)
                          closeConfirm()
                        },
                      })
                    }
                    disabled={loading}
                  >
                    Perdido
                  </Button>

                  <Button
                    size="small"
                    color="inherit"
                    variant="outlined"
                    onClick={() =>
                      openConfirm({
                        title: 'Descartar lead',
                        description:
                          'El lead quedará descartado, pero no se borrará la trazabilidad.',
                        severity: 'warning',
                        confirmLabel: 'Descartar',
                        requireReason: true,
                        defaultReason: 'Descartado desde bandeja comercial',
                        onConfirm: async reason => {
                          await onDiscard?.(reason)
                          closeConfirm()
                        },
                      })
                    }
                    disabled={loading}
                  >
                    Descartar
                  </Button>

                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={() =>
                      openConfirm({
                        title: 'Eliminar lead',
                        description:
                          'En producción esta acción debe ser una eliminación lógica. El lead no debería borrarse físicamente de la base.',
                        severity: 'error',
                        confirmLabel: 'Eliminar',
                        requireReason: true,
                        defaultReason: 'Eliminado desde bandeja comercial',
                        onConfirm: async reason => {
                          await onDelete?.(reason)
                          closeConfirm()
                        },
                      })
                    }
                    disabled={loading}
                  >
                    Eliminar
                  </Button>
                </Stack>
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
                sx={{ mb: 1 }}
              >
                <Typography variant="subtitle2" fontWeight={800}>
                  Productos de interés
                </Typography>

                {!!products.length && (
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<ClearIcon />}
                    disabled={loading}
                    onClick={handleClearProducts}
                    sx={{ textTransform: 'none', fontWeight: 800 }}
                  >
                    Limpiar
                  </Button>
                )}
              </Stack>

              {!products.length ? (
                <Typography variant="body2" color="text.secondary">
                  Sin producto detectado.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {products.slice(0, 8).map((product, index) => {
                    const productRef = getProductRef(product)

                    return (
                      <Paper
                        key={`${productRef || product.title || 'product'}-${index}`}
                        variant="outlined"
                        sx={{ p: 1.2, borderRadius: 2 }}
                      >
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={800} noWrap>
                              {product.title || 'Producto'}
                            </Typography>

                            <Typography variant="caption" color="text.secondary">
                              {product.slug || product.sku || 'Sin slug/SKU'} · $
                              {Number(product.price || 0).toLocaleString('es-AR')}
                            </Typography>

                            {product.lastMentionedAt && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block' }}
                              >
                                Mencionado: {formatDate(product.lastMentionedAt)}
                              </Typography>
                            )}
                          </Box>

                          {productRef && (
                            <Tooltip title="Quitar producto de interés">
                              <span>
                                <IconButton
                                  size="small"
                                  color="error"
                                  disabled={loading}
                                  onClick={() => handleRemoveProduct(product)}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </Stack>
                      </Paper>
                    )
                  })}
                </Stack>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" fontWeight={800} gutterBottom>
                Notas internas
              </Typography>

              <Stack spacing={1}>
                <TextField
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder="Agregar nota comercial..."
                  multiline
                  minRows={3}
                  fullWidth
                  disabled={loading}
                />

                <Button
                  variant="contained"
                  onClick={handleAddNote}
                  disabled={loading || !clean(note)}
                  sx={{ textTransform: 'none', fontWeight: 900 }}
                >
                  Agregar nota
                </Button>

                {(lead.notes || [])
                  .slice()
                  .reverse()
                  .slice(0, 5)
                  .map(item => (
                    <Paper
                      key={item._id || item.createdAt}
                      variant="outlined"
                      sx={{ p: 1.2, borderRadius: 2 }}
                    >
                      <Typography variant="body2">{item.text}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.createdByName || 'Admin'} · {formatDate(item.createdAt)}
                      </Typography>
                    </Paper>
                  ))}
              </Stack>
            </Box>
          </Stack>
        </Box>

        <LeadFollowUpModal
          open={followUpOpen}
          lead={lead}
          loading={loading}
          onClose={() => setFollowUpOpen(false)}
          onSubmit={async value => {
            await onScheduleFollowUp?.(value)
            setFollowUpOpen(false)
          }}
        />
      </Paper>

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        severity={confirmState?.severity || 'warning'}
        confirmLabel={confirmState?.confirmLabel || 'Confirmar'}
        requireReason={Boolean(confirmState?.requireReason)}
        defaultReason={confirmState?.defaultReason || ''}
        loading={loading}
        onClose={closeConfirm}
        onConfirm={confirmState?.onConfirm}
      />
    </>
  )
}

export default LeadDetailPanel