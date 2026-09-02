// 📁 admin/src/pages/ai/AiCommercialInboxPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import RefreshIcon from '@mui/icons-material/Refresh'
import LeadList from '@components/aiLeads/LeadList.jsx'
import LeadConversationPanel from '@components/aiLeads/LeadConversationPanel.jsx'
import LeadDetailPanel from '@components/aiLeads/LeadDetailPanel.jsx'
import { permanentlyDeleteAiConversation } from '../services/aiAgentAdminService.js'
import {
  addAiLeadNote,
  deleteAiLead,
  discardAiLead,
  getAiLeadById,
  getAiLeads,
  getAiLeadSummary,
  markAiLeadLost,
  markAiLeadWon,
  permanentlyDeleteAiLead,
  removeAiLeadProductOfInterest,
  scheduleAiLeadFollowUp,
  updateAiLeadProductsOfInterest,
  updateAiLeadStatus,
} from '../services/aiLeadService.js'

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'new', label: 'Nuevos' },
  { value: 'qualified', label: 'Calificados' },
  { value: 'hot', label: 'Calientes' },
  { value: 'follow_up', label: 'Seguimiento' },
  { value: 'won', label: 'Ganados' },
  { value: 'lost', label: 'Perdidos' },
  { value: 'discarded', label: 'Descartados' },
]

const INTENT_FILTERS = [
  { value: 'all', label: 'Todas las intenciones' },
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

const DEFAULT_SUMMARY = {
  total: 0,
  today: 0,
  new: 0,
  qualified: 0,
  hot: 0,
  followUp: 0,
  won: 0,
  lost: 0,
  discarded: 0,
  pendingFollowUps: 0,
  averageLeadScore: 0,
}

const normalizeSummary = value => ({
  ...DEFAULT_SUMMARY,
  ...(value || {}),
})

const getLeadId = lead => lead?.id || lead?._id || ''
const getConversationId = item => item?.id || item?._id || ''

const SummaryCardComponent = ({ label, value, tone }) => (
  <Paper
    variant="outlined"
    sx={{
      p: 2,
      borderRadius: 3,
      height: '100%',
      bgcolor: tone === 'hot' ? 'error.50' : 'background.paper',
    }}
  >
    <Typography variant="caption" color="text.secondary" fontWeight={700}>
      {label}
    </Typography>

    <Typography variant="h5" fontWeight={950} sx={{ mt: 0.5 }}>
      {Number(value || 0).toLocaleString('es-AR')}
    </Typography>
  </Paper>
)

const AiCommercialInboxPage = () => {
  const [leads, setLeads] = useState([])
  const [summary, setSummary] = useState(DEFAULT_SUMMARY)
  const [selectedLeadId, setSelectedLeadId] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [conversation, setConversation] = useState(null)
  const [status, setStatus] = useState('all')
  const [intent, setIntent] = useState('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [conversationToDelete, setConversationToDelete] = useState(null)
  const [conversationDeleteText, setConversationDeleteText] = useState('')

  const params = useMemo(
    () => ({
      page: 1,
      limit: 30,
      status,
      intent,
      q: query || undefined,
      sort: 'score',
    }),
    [status, intent, query],
  )

  const loadSummary = useCallback(async () => {
    try {
      const data = await getAiLeadSummary()
      setSummary(normalizeSummary(data))
    } catch (err) {
      console.error('[AI_LEADS_SUMMARY_ERROR]', err)
      setSummary(DEFAULT_SUMMARY)
    }
  }, [])

  const loadLeads = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const data = await getAiLeads(params)
      const items = Array.isArray(data?.items) ? data.items : []

      setLeads(items)

      const currentStillExists = selectedLeadId
        ? items.some(item => getLeadId(item) === selectedLeadId)
        : false

      if (!currentStillExists) {
        const firstLeadId = getLeadId(items[0])
        setSelectedLeadId(firstLeadId || null)

        if (!firstLeadId) {
          setSelectedLead(null)
          setConversation(null)
        }
      }
    } catch (err) {
      console.error('[AI_LEADS_LIST_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudieron cargar los leads comerciales.',
      )
    } finally {
      setLoading(false)
    }
  }, [params, selectedLeadId])

  const loadDetail = useCallback(async leadId => {
    if (!leadId) {
      setSelectedLead(null)
      setConversation(null)
      return
    }

    setDetailLoading(true)
    setError('')

    try {
      const data = await getAiLeadById(leadId)
      setSelectedLead(data?.lead || null)
      setConversation(data?.conversation || null)
    } catch (err) {
      console.error('[AI_LEAD_DETAIL_ERROR]', err)
      setError(
        err?.response?.data?.message || err?.message || 'No se pudo cargar el detalle del lead.',
      )
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadLeads()])

    if (selectedLeadId) {
      await loadDetail(selectedLeadId)
    }
  }, [loadSummary, loadLeads, selectedLeadId, loadDetail])

  const runAction = useCallback(
    async action => {
      if (typeof action !== 'function') return

      setActionLoading(true)
      setError('')

      try {
        const result = await action()
        if (result?.skipRefresh) return
        await refreshAll()
      } catch (err) {
        console.error('[AI_LEAD_ACTION_ERROR]', err)
        setError(err?.response?.data?.message || err?.message || 'No se pudo completar la acción.')
      } finally {
        setActionLoading(false)
      }
    },
    [refreshAll],
  )

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  useEffect(() => {
    loadDetail(selectedLeadId)
  }, [selectedLeadId, loadDetail])

  const selectedId = selectedLead?.id || selectedLead?._id || selectedLeadId

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        minHeight: '100vh',
        bgcolor: 'background.default',
      }}
    >
      <Stack spacing={2.5}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ md: 'center' }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="h4" fontWeight={950}>
              Bandeja comercial IA
            </Typography>

            <Typography color="text.secondary">
              Conversaciones, leads e intención de compra detectada por el asistente web.
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={
              loading || detailLoading || actionLoading ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <RefreshIcon />
              )
            }
            onClick={refreshAll}
            disabled={loading || detailLoading || actionLoading}
            sx={{
              borderRadius: 3,
              textTransform: 'none',
              fontWeight: 800,
            }}
          >
            Actualizar
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: 3 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid item xs={6} md={2}>
            <SummaryCardComponent label="Total" value={summary.total} />
          </Grid>

          <Grid item xs={6} md={2}>
            <SummaryCardComponent label="Nuevos hoy" value={summary.today} />
          </Grid>

          <Grid item xs={6} md={2}>
            <SummaryCardComponent label="Calientes" value={summary.hot} tone="hot" />
          </Grid>

          <Grid item xs={6} md={2}>
            <SummaryCardComponent label="Seguimientos" value={summary.pendingFollowUps} />
          </Grid>

          <Grid item xs={6} md={2}>
            <SummaryCardComponent label="Ganados" value={summary.won} />
          </Grid>

          <Grid item xs={6} md={2}>
            <SummaryCardComponent label="Score prom." value={summary.averageLeadScore} />
          </Grid>
        </Grid>

        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ md: 'center' }}
          >
            <TextField
              size="small"
              label="Buscar"
              placeholder="Nombre, email, teléfono, producto o mensaje"
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  loadLeads()
                }
              }}
              sx={{ flex: 1 }}
            />

            <TextField
              select
              size="small"
              label="Estado"
              value={status}
              onChange={event => setStatus(event.target.value)}
              sx={{ minWidth: 180 }}
            >
              {STATUS_FILTERS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Intención"
              value={intent}
              onChange={event => setIntent(event.target.value)}
              sx={{ minWidth: 220 }}
            >
              {INTENT_FILTERS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <Button
              variant="outlined"
              onClick={loadLeads}
              disabled={loading}
              sx={{
                borderRadius: 3,
                textTransform: 'none',
                fontWeight: 800,
              }}
            >
              Filtrar
            </Button>
          </Stack>
        </Paper>

        <Grid container spacing={2} sx={{ minHeight: 680 }}>
          <Grid item xs={12} md={3.2}>
            <Paper
              variant="outlined"
              sx={{
                height: 680,
                overflow: 'hidden',
                borderRadius: 3,
                bgcolor: 'background.paper',
              }}
            >
              <Box
                sx={{
                  p: 2,
                  borderBottom: theme => `1px solid ${theme.palette.divider}`,
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={900}>Leads</Typography>
                  <Chip size="small" label={leads.length} />
                </Stack>
              </Box>

              <Box sx={{ height: 616, overflowY: 'auto' }}>
                <LeadList
                  leads={leads}
                  selectedId={selectedLeadId}
                  loading={loading}
                  onSelect={lead => setSelectedLeadId(getLeadId(lead))}
                />
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            {detailLoading ? (
              <Paper
                variant="outlined"
                sx={{
                  height: 680,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 3,
                }}
              >
                <CircularProgress />
              </Paper>
            ) : (
              <LeadDetailPanel
                lead={selectedLead}
                loading={actionLoading}
                onChangeStatus={nextStatus => {
                  if (!selectedId) return
                  runAction(() => updateAiLeadStatus(selectedId, { status: nextStatus }))
                }}
                onAddNote={text => {
                  if (!selectedId) return
                  runAction(() => addAiLeadNote(selectedId, text))
                }}
                onScheduleFollowUp={date => {
                  if (!selectedId) return
                  runAction(() => scheduleAiLeadFollowUp(selectedId, date))
                }}
                onMarkWon={reason => {
                  if (!selectedId) return
                  runAction(() => markAiLeadWon(selectedId, reason))
                }}
                onMarkLost={reason => {
                  if (!selectedId) return
                  runAction(() => markAiLeadLost(selectedId, reason))
                }}
                onDiscard={reason => {
                  if (!selectedId) return
                  runAction(() => discardAiLead(selectedId, reason))
                }}
                onDelete={reason => {
                  if (!selectedId) return
                  runAction(async () => {
                    await deleteAiLead(selectedId, reason)
                    setSelectedLeadId(null)
                    setSelectedLead(null)
                    setConversation(null)
                    await Promise.all([loadSummary(), loadLeads()])
                    return { skipRefresh: true }
                  })
                }}
                onPermanentDelete={() => {
                  if (!selectedId) return
                  runAction(async () => {
                    await permanentlyDeleteAiLead(selectedId)
                    setSelectedLeadId(null)
                    setSelectedLead(null)
                    setConversation(null)
                    await Promise.all([loadSummary(), loadLeads()])
                    return { skipRefresh: true }
                  })
                }}
                onRemoveProductOfInterest={(productRef, reason) => {
                  if (!selectedId) return
                  runAction(() =>
                    removeAiLeadProductOfInterest(
                      selectedId,
                      productRef,
                      reason || 'Producto removido manualmente desde bandeja comercial',
                    ),
                  )
                }}
                onUpdateProductsOfInterest={products => {
                  if (!selectedId) return
                  runAction(() => updateAiLeadProductsOfInterest(selectedId, products))
                }}
              />
            )}
          </Grid>

          <Grid item xs={12} md={4.8}>
            <LeadConversationPanel
              conversation={conversation}
              lead={selectedLead}
              loading={detailLoading || actionLoading}
              onDeleteConversation={item => {
                setConversationToDelete(item)
                setConversationDeleteText('')
              }}
            />
          </Grid>
        </Grid>

        <Divider />

        <Typography variant="caption" color="text.secondary">
          Los leads se actualizan automáticamente a partir de conversaciones del asistente IA.
          Stock, precios y productos se consultan siempre en vivo desde el backend.
        </Typography>
      </Stack>

      <Dialog
        open={Boolean(conversationToDelete)}
        onClose={() => {
          if (!actionLoading) setConversationToDelete(null)
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle fontWeight={900}>Eliminar conversación de la base</DialogTitle>

        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="error">
              Esta acción borra físicamente la conversación. El lead queda sin historial asociado a
              esa conversación.
            </Alert>

            <TextField
              label="Escribí ELIMINAR"
              value={conversationDeleteText}
              onChange={event => setConversationDeleteText(event.target.value)}
              disabled={actionLoading}
              fullWidth
            />
          </Stack>
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setConversationToDelete(null)}
            disabled={actionLoading}
            sx={{ textTransform: 'none', fontWeight: 800 }}
          >
            Cancelar
          </Button>

          <Button
            color="error"
            variant="contained"
            disabled={
              actionLoading ||
              conversationDeleteText.trim() !== 'ELIMINAR' ||
              !getConversationId(conversationToDelete)
            }
            onClick={() => {
              const conversationId = getConversationId(conversationToDelete)
              if (!conversationId) return

              runAction(async () => {
                await permanentlyDeleteAiConversation(conversationId)
                setConversation(null)
                setConversationToDelete(null)
                setConversationDeleteText('')
              })
            }}
            sx={{ textTransform: 'none', fontWeight: 900 }}
          >
            Eliminar de BD
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default AiCommercialInboxPage
