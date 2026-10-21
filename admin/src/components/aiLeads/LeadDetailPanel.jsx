// 📁 admin/src/components/aiLeads/LeadDetailPanel.jsx
//
// Detalle de un lead y sus acciones comerciales. Cada acción (`onChangeStatus`, `onMarkWon`, …) tiene
// que devolver una promesa que resuelva a `false` si falló: así el panel no cierra el diálogo ni borra
// la nota que se estaba escribiendo, y muestra `actionError` adentro.
import React, { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import CircularProgress from '@mui/material/CircularProgress'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import ClearIcon from '@mui/icons-material/Clear'
import LeadStatusBadge, { LEAD_STATUS_META } from './LeadStatusBadge.jsx'
import LeadScoreBadge from './LeadScoreBadge.jsx'
import LeadFollowUpModal from './LeadFollowUpModal.jsx'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const STATUS_OPTIONS = Object.entries(LEAD_STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}))

// Lo que el asistente detecta que la persona quiere. El servidor guarda el código en inglés.
export const INTENT_OPTIONS = [
  { value: 'unknown', label: 'Sin clasificar' },
  { value: 'browse', label: 'Exploración' },
  { value: 'compare', label: 'Comparación' },
  { value: 'price_check', label: 'Precio' },
  { value: 'stock_question', label: 'Stock' },
  { value: 'promotion', label: 'Promoción' },
  { value: 'shipping_question', label: 'Envíos' },
  { value: 'purchase_intent', label: 'Intención de compra' },
  { value: 'checkout_intent', label: 'Checkout' },
  { value: 'support', label: 'Soporte' },
  { value: 'post_sale', label: 'Postventa' },
]

export const getIntentLabel = intent =>
  INTENT_OPTIONS.find(option => option.value === intent)?.label || intent || 'Sin clasificar'

const clean = value => String(value || '').trim()

const formatDate = (value, empty = 'Sin fecha') => {
  if (!value) return empty

  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return empty
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
    product?._id || product?.productId || product?.slug || product?.sku || product?.title,
  )
}

const PRODUCTS_SHOWN = 8
const NOTES_SHOWN = 5

// Un seguimiento que ya pasó de fecha en un lead que sigue abierto es lo que hay que atender primero.
const isFollowUpOverdue = lead =>
  Boolean(lead?.nextFollowUpAt) &&
  new Date(lead.nextFollowUpAt).getTime() <= Date.now() &&
  ['follow_up', 'qualified', 'hot'].includes(lead.status)

const SectionTitle = ({ children, action }) => (
  <Stack
    direction="row"
    sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, minHeight: 28 }}
  >
    <Typography
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: 14,
        letterSpacing: '0.02em',
        color: BRAND.ink,
      }}
    >
      {children}
    </Typography>
    {action}
  </Stack>
)

const ConfirmDialogComponent = ({
  open,
  title,
  description,
  severity = 'warning',
  confirmLabel = 'Confirmar',
  loading = false,
  requireReason = false,
  confirmationText = '',
  defaultReason = '',
  error = '',
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState(defaultReason)
  const [confirmation, setConfirmation] = useState('')
  // El error del servidor es del panel entero: acá solo se muestra el de ESTE intento, no uno viejo.
  const [attempted, setAttempted] = useState(false)

  React.useEffect(() => {
    if (open) {
      setReason(defaultReason)
      setConfirmation('')
      setAttempted(false)
    }
  }, [defaultReason, open])

  const canConfirm =
    (!requireReason || Boolean(clean(reason))) &&
    (!confirmationText || clean(confirmation) === confirmationText)

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!loading) onClose?.()
      }}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 4 } } }}
    >
      <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>{title}</DialogTitle>

      <DialogContent>
        <Stack spacing={2}>
          <Alert severity={severity}>{description}</Alert>

          {attempted && error && <Alert severity="error">{error}</Alert>}

          {requireReason && (
            <TextField
              label="Motivo"
              value={reason}
              onChange={event => setReason(event.target.value)}
              multiline
              minRows={3}
              fullWidth
              disabled={loading}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          )}

          {confirmationText && (
            <TextField
              label={`Escribí ${confirmationText}`}
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
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
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          Cancelar
        </Button>

        <Button
          color={severity === 'error' ? 'error' : 'primary'}
          variant="contained"
          disabled={loading || !canConfirm}
          onClick={() => {
            setAttempted(true)
            onConfirm?.(clean(reason))
          }}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
          sx={{ textTransform: 'none', fontWeight: 800 }}
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
  onPermanentDelete,
  onRemoveProductOfInterest,
  onUpdateProductsOfInterest,
  loading,
  refreshing = false,
  actionError = '',
}) => {
  const [note, setNote] = useState('')
  const [noteAttempted, setNoteAttempted] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [followUpAttempted, setFollowUpAttempted] = useState(false)
  const [confirmState, setConfirmState] = useState(null)

  const customer = lead?.customer || {}

  const products = useMemo(() => {
    return Array.isArray(lead?.productsOfInterest) ? lead.productsOfInterest : []
  }, [lead?.productsOfInterest])

  const notes = useMemo(() => {
    return Array.isArray(lead?.notes) ? lead.notes.slice().reverse() : []
  }, [lead?.notes])

  if (!lead) {
    return (
      <Paper
        variant="outlined"
        sx={{
          height: '100%',
          p: 3,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 4,
          borderColor: BRAND.line,
          boxShadow: 'none',
        }}
      >
        <Typography sx={{ color: BRAND.muted, textAlign: 'center' }}>
          Seleccioná un lead para ver acciones comerciales.
        </Typography>
      </Paper>
    )
  }

  const closeConfirm = () => setConfirmState(null)

  // Cierra el diálogo solo si la acción salió bien; si falló, queda abierto con el error adentro.
  const confirmWith = action => async reason => {
    const ok = await action?.(reason)
    if (ok !== false) closeConfirm()
  }

  const openConfirm = config => {
    setConfirmState(config)
  }

  const handleAddNote = async () => {
    const cleanNote = clean(note)
    if (!cleanNote) return

    setNoteAttempted(true)
    const ok = await onAddNote?.(cleanNote)
    // Si falló, la nota sigue escrita para reintentar en vez de perderse.
    if (ok !== false) {
      setNote('')
      setNoteAttempted(false)
    }
  }

  const handleRemoveProduct = product => {
    const productRef = getProductRef(product)

    if (!productRef) return

    openConfirm({
      title: 'Quitar producto de interés',
      description:
        'Se quita este producto de los intereses del lead. Usalo cuando el asistente haya asociado un producto incorrecto.',
      severity: 'warning',
      confirmLabel: 'Quitar producto',
      requireReason: false,
      onConfirm: confirmWith(() =>
        onRemoveProductOfInterest?.(
          productRef,
          'Producto de interés removido manualmente desde bandeja comercial',
        ),
      ),
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
      onConfirm: confirmWith(() => onUpdateProductsOfInterest?.([])),
    })
  }

  const displayName =
    lead.displayName || customer.name || customer.email || customer.phone || 'Cliente web'

  const overdue = isFollowUpOverdue(lead)

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 4,
          borderColor: BRAND.line,
          boxShadow: 'none',
          bgcolor: '#fff',
        }}
      >
        <Box sx={{ p: 2, borderBottom: `1px solid ${BRAND.line}` }}>
          <Stack spacing={1}>
            <Typography
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}
              noWrap
              title={displayName}
            >
              {displayName}
            </Typography>

            <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
              <LeadStatusBadge status={lead.status} />
              <LeadScoreBadge score={lead.leadScore || lead.score} />
              <Box
                component="span"
                sx={{
                  px: 1.25,
                  py: 0.25,
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1.6,
                  color: BRAND.muted,
                  border: `1px solid ${BRAND.line}`,
                }}
              >
                {getIntentLabel(lead.intent)}
              </Box>
            </Stack>
          </Stack>
        </Box>

        {refreshing && <LinearProgress />}

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          <Stack spacing={3}>
            <Box>
              <SectionTitle>Datos del cliente</SectionTitle>

              <Stack spacing={0.8}>
                <Typography variant="body2">Nombre: {customer.name || 'Sin nombre'}</Typography>

                <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.5}>
                  <Typography variant="body2" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
                    Email: {customer.email || 'Sin email'}
                  </Typography>

                  {customer.email && (
                    <Tooltip title="Copiar email">
                      <IconButton
                        size="small"
                        aria-label="Copiar email"
                        onClick={() => copy(customer.email)}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>

                <Stack direction="row" sx={{ alignItems: 'center' }} spacing={0.5}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    Teléfono: {customer.phone || 'Sin teléfono'}
                  </Typography>

                  {customer.phone && (
                    <>
                      <Tooltip title="Copiar teléfono">
                        <IconButton
                          size="small"
                          aria-label="Copiar teléfono"
                          onClick={() => copy(customer.phone)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Abrir WhatsApp">
                        <IconButton
                          size="small"
                          aria-label="Abrir WhatsApp"
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

            <Box>
              <SectionTitle>Gestión comercial</SectionTitle>

              <Stack spacing={1.5}>
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

                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ color: BRAND.muted }}>
                    Próximo seguimiento: {formatDate(lead.nextFollowUpAt, 'Sin programar')}
                  </Typography>
                  {overdue && (
                    <Box
                      component="span"
                      sx={{
                        px: 1.25,
                        py: 0.25,
                        borderRadius: 99,
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#b42318',
                        bgcolor: '#fdebea',
                      }}
                    >
                      Vencido
                    </Box>
                  )}
                </Stack>

                <Button
                  variant="outlined"
                  onClick={() => {
                    setFollowUpAttempted(false)
                    setFollowUpOpen(true)
                  }}
                  disabled={loading}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Programar seguimiento
                </Button>

                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
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
                        onConfirm: confirmWith(reason => onMarkWon?.(reason)),
                      })
                    }
                    disabled={loading}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
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
                        description: 'Indicá el motivo para mantener trazabilidad comercial.',
                        severity: 'warning',
                        confirmLabel: 'Marcar perdido',
                        requireReason: true,
                        defaultReason: 'Marcado como perdido desde bandeja comercial',
                        onConfirm: confirmWith(reason => onMarkLost?.(reason)),
                      })
                    }
                    disabled={loading}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
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
                        onConfirm: confirmWith(reason => onDiscard?.(reason)),
                      })
                    }
                    disabled={loading}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    Descartar
                  </Button>
                </Stack>
              </Stack>
            </Box>

            <Box>
              <SectionTitle
                action={
                  !!products.length && (
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<ClearIcon />}
                      disabled={loading}
                      onClick={handleClearProducts}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      Limpiar
                    </Button>
                  )
                }
              >
                Productos de interés
              </SectionTitle>

              {!products.length ? (
                <Typography variant="body2" sx={{ color: BRAND.muted }}>
                  Sin producto detectado.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {products.slice(0, PRODUCTS_SHOWN).map((product, index) => {
                    const productRef = getProductRef(product)

                    return (
                      <Paper
                        key={`${productRef || product.title || 'product'}-${index}`}
                        variant="outlined"
                        sx={{ p: 1.2, borderRadius: 3, borderColor: BRAND.line, boxShadow: 'none' }}
                      >
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}
                            >
                              {product.title || 'Producto'}
                            </Typography>

                            <Typography variant="caption" sx={{ color: BRAND.muted }}>
                              {product.slug || product.sku || 'Sin slug/SKU'} · $
                              {Number(product.price || 0).toLocaleString('es-AR')}
                            </Typography>

                            {product.lastMentionedAt && (
                              <Typography
                                variant="caption"
                                sx={{ display: 'block', color: BRAND.muted }}
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
                                  aria-label={`Quitar «${product.title || 'producto'}» de los intereses`}
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

                  {products.length > PRODUCTS_SHOWN && (
                    <Typography variant="caption" sx={{ color: BRAND.muted }}>
                      y {products.length - PRODUCTS_SHOWN} más
                    </Typography>
                  )}
                </Stack>
              )}
            </Box>

            <Box>
              <SectionTitle>Notas internas</SectionTitle>

              <Stack spacing={1}>
                {noteAttempted && actionError && <Alert severity="error">{actionError}</Alert>}

                <TextField
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder="Agregar nota comercial..."
                  multiline
                  minRows={3}
                  fullWidth
                  disabled={loading}
                  slotProps={{ htmlInput: { 'aria-label': 'Nota comercial' } }}
                />

                <Button
                  variant="contained"
                  onClick={handleAddNote}
                  disabled={loading || !clean(note)}
                  sx={{ textTransform: 'none', fontWeight: 800 }}
                >
                  Agregar nota
                </Button>

                {notes.slice(0, NOTES_SHOWN).map(item => (
                  <Paper
                    key={item._id || item.createdAt}
                    variant="outlined"
                    sx={{ p: 1.2, borderRadius: 3, borderColor: BRAND.line, boxShadow: 'none' }}
                  >
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {item.text}
                    </Typography>
                    <Typography variant="caption" sx={{ color: BRAND.muted }}>
                      {item.createdByName || 'Admin'} · {formatDate(item.createdAt)}
                    </Typography>
                  </Paper>
                ))}

                {notes.length > NOTES_SHOWN && (
                  <Typography variant="caption" sx={{ color: BRAND.muted }}>
                    Mostrando las últimas {NOTES_SHOWN} de {notes.length} notas.
                  </Typography>
                )}
              </Stack>
            </Box>

            <Box sx={{ pt: 2, borderTop: `1px solid ${BRAND.line}` }}>
              <SectionTitle>Eliminar</SectionTitle>

              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() =>
                    openConfirm({
                      title: 'Eliminar lead de la bandeja',
                      description:
                        'El lead y sus conversaciones salen de la bandeja y ya no se pueden ver desde acá. Se conservan en la base de datos.',
                      severity: 'error',
                      confirmLabel: 'Eliminar',
                      requireReason: true,
                      defaultReason: 'Eliminado desde bandeja comercial',
                      onConfirm: confirmWith(reason => onDelete?.(reason)),
                    })
                  }
                  disabled={loading}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Eliminar de la bandeja
                </Button>

                <Button
                  size="small"
                  color="error"
                  variant="contained"
                  startIcon={<DeleteForeverIcon />}
                  onClick={() =>
                    openConfirm({
                      title: 'Eliminar lead definitivamente',
                      description:
                        'Se borra el lead de la base de datos y no se puede deshacer. Sus conversaciones quedan guardadas, sin lead asociado.',
                      severity: 'error',
                      confirmLabel: 'Eliminar definitivamente',
                      confirmationText: 'ELIMINAR',
                      onConfirm: confirmWith(() => onPermanentDelete?.()),
                    })
                  }
                  disabled={loading}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Eliminar definitivamente
                </Button>
              </Stack>
            </Box>
          </Stack>
        </Box>

        <LeadFollowUpModal
          open={followUpOpen}
          lead={lead}
          loading={loading}
          error={followUpAttempted ? actionError : ''}
          onClose={() => setFollowUpOpen(false)}
          onSubmit={async value => {
            setFollowUpAttempted(true)
            const ok = await onScheduleFollowUp?.(value)
            if (ok !== false) setFollowUpOpen(false)
          }}
        />
      </Paper>

      <ConfirmDialogComponent
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        severity={confirmState?.severity || 'warning'}
        confirmLabel={confirmState?.confirmLabel || 'Confirmar'}
        requireReason={Boolean(confirmState?.requireReason)}
        confirmationText={confirmState?.confirmationText || ''}
        defaultReason={confirmState?.defaultReason || ''}
        loading={loading}
        error={actionError}
        onClose={closeConfirm}
        onConfirm={confirmState?.onConfirm}
      />
    </>
  )
}

export default LeadDetailPanel
