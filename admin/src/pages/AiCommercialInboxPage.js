// 📁 admin/src/pages/AiCommercialInboxPage.js
//
// Bandeja comercial del agente de IA: los leads que dejó el asistente web, con su detalle y su
// conversación. En escritorio son tres paneles lado a lado; en el celular se navega de la lista al
// lead y, dentro del lead, entre «Detalle» y «Conversación».
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Grid from '@mui/material/Grid'
import InputAdornment from '@mui/material/InputAdornment'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Pagination from '@mui/material/Pagination'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff'
import RefreshIcon from '@mui/icons-material/Refresh'
import SearchIcon from '@mui/icons-material/Search'
import LeadList from '@components/aiLeads/LeadList.jsx'
import LeadConversationPanel from '@components/aiLeads/LeadConversationPanel.jsx'
import LeadDetailPanel, { INTENT_OPTIONS } from '@components/aiLeads/LeadDetailPanel.jsx'
import { LEAD_STATUS_META } from '@components/aiLeads/LeadStatusBadge.jsx'
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

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const PAGE_SIZE = 30
const SEARCH_DELAY_MS = 300
const PANEL_HEIGHT = 680

// El resumen es a la vez el filtro de estado: cada cifra lleva a esos leads.
const SUMMARY_STATUSES = ['new', 'qualified', 'hot', 'follow_up', 'won', 'lost', 'discarded']

const SUMMARY_KEYS = {
  new: 'new',
  qualified: 'qualified',
  hot: 'hot',
  follow_up: 'followUp',
  won: 'won',
  lost: 'lost',
  discarded: 'discarded',
}

const INTENT_FILTERS = [{ value: 'all', label: 'Todas las intenciones' }, ...INTENT_OPTIONS]

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

const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

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

const AiCommercialInboxPage = () => {
  const isMobile = useMediaQuery('(max-width:899.95px)')

  const [leads, setLeads] = useState([])
  const [pagination, setPagination] = useState({})
  const [summary, setSummary] = useState(DEFAULT_SUMMARY)
  const [selectedLeadId, setSelectedLeadId] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [conversation, setConversation] = useState(null)
  // El historial de charlas del lead: una persona que vuelve deja varias, y
  // antes solo se podía abrir la última.
  const [conversations, setConversations] = useState([])
  const [status, setStatus] = useState('all')
  const [intent, setIntent] = useState('all')
  const [followUpPending, setFollowUpPending] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [conversationToDelete, setConversationToDelete] = useState(null)
  const [conversationDeleteText, setConversationDeleteText] = useState('')
  const [conversationDeleteAttempted, setConversationDeleteAttempted] = useState(false)
  // Solo celular: qué se está viendo y, dentro del lead, qué pestaña.
  const [mobileView, setMobileView] = useState('list')
  const [mobileTab, setMobileTab] = useState('detail')

  // Lo que `loadLeads` y `refreshAll` necesitan saber sin depender de ello: si dependieran del lead
  // elegido, cada clic en la lista volvería a pedir la lista entera.
  const selectedLeadIdRef = useRef(null)
  const conversationIdRef = useRef(undefined)
  // Una respuesta lenta de una consulta anterior no tiene que pisar a la más reciente.
  const leadsRequestRef = useRef(0)
  const detailRequestRef = useRef(0)

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      status,
      intent,
      q: search || undefined,
      sort: 'score',
      followUp: followUpPending ? 'pending' : undefined,
    }),
    [status, intent, search, page, followUpPending],
  )

  const selectLead = useCallback(leadId => {
    selectedLeadIdRef.current = leadId || null
    // Al cambiar de lead se abre su última conversación, no la que se estaba mirando en otro.
    conversationIdRef.current = undefined
    setSelectedLeadId(leadId || null)
  }, [])

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
    const request = ++leadsRequestRef.current
    setLoading(true)
    setError('')

    try {
      const data = await getAiLeads(params)
      if (request !== leadsRequestRef.current) return

      const items = Array.isArray(data?.items) ? data.items : []
      const resultPagination = data?.pagination || {}

      // Se resolvió lo último de la página y esa página quedó vacía: volver a la última.
      if (items.length === 0 && params.page > 1 && resultPagination.total > 0) {
        setPage(Math.max(1, resultPagination.pages || 1))
        return
      }

      setLeads(items)
      setPagination(resultPagination)
      setLoaded(true)

      const current = selectedLeadIdRef.current
      const currentStillExists = current ? items.some(item => getLeadId(item) === current) : false

      if (!currentStillExists) {
        const firstLeadId = getLeadId(items[0])
        selectLead(firstLeadId)

        if (!firstLeadId) {
          setSelectedLead(null)
          setConversation(null)
          setConversations([])
        }
      }
    } catch (err) {
      if (request !== leadsRequestRef.current) return

      console.error('[AI_LEADS_LIST_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudieron cargar los leads comerciales.',
      )
    } finally {
      if (request === leadsRequestRef.current) setLoading(false)
    }
  }, [params, selectLead])

  const loadDetail = useCallback(async (leadId, conversationId) => {
    const request = ++detailRequestRef.current

    if (!leadId) {
      setSelectedLead(null)
      setConversation(null)
      setConversations([])
      setDetailLoading(false)
      return
    }

    setDetailLoading(true)
    setError('')

    try {
      const data = await getAiLeadById(leadId, { conversationId })
      if (request !== detailRequestRef.current) return

      conversationIdRef.current = conversationId
      setSelectedLead(data?.lead || null)
      setConversation(data?.conversation || null)
      setConversations(data?.conversations || [])
    } catch (err) {
      if (request !== detailRequestRef.current) return

      console.error('[AI_LEAD_DETAIL_ERROR]', err)
      setError(
        err?.response?.data?.message || err?.message || 'No se pudo cargar el detalle del lead.',
      )
    } finally {
      if (request === detailRequestRef.current) setDetailLoading(false)
    }
  }, [])

  // Después de una acción: el resumen, la lista y el detalle del lead que se estaba mirando, en la
  // misma conversación que se estaba leyendo (antes volvía siempre a la última).
  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadLeads()])

    if (selectedLeadIdRef.current) {
      await loadDetail(selectedLeadIdRef.current, conversationIdRef.current)
    }
  }, [loadSummary, loadLeads, loadDetail])

  // Devuelve `true` si la acción salió bien y `false` si falló: los paneles lo usan para no cerrar el
  // diálogo ni borrar lo escrito cuando algo falla.
  const runAction = useCallback(
    async action => {
      if (typeof action !== 'function') return false

      setActionLoading(true)
      setActionError('')

      try {
        const result = await action()
        if (!result?.skipRefresh) await refreshAll()
        return true
      } catch (err) {
        console.error('[AI_LEAD_ACTION_ERROR]', err)
        setActionError(
          err?.response?.data?.message || err?.message || 'No se pudo completar la acción.',
        )
        return false
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

  // La búsqueda espera a que se deje de escribir: antes salía una consulta por cada tecla.
  useEffect(() => {
    const next = searchInput.trim()
    if (next === search) return undefined

    const timer = setTimeout(() => {
      setSearch(next)
      setPage(1)
    }, SEARCH_DELAY_MS)

    return () => clearTimeout(timer)
  }, [searchInput, search])

  const changeStatus = value => {
    setStatus(value)
    setFollowUpPending(false)
    setPage(1)
  }

  const showPendingFollowUps = () => {
    setStatus('all')
    setFollowUpPending(true)
    setPage(1)
  }

  const changeIntent = value => {
    setIntent(value)
    setPage(1)
  }

  const clearFilters = () => {
    setStatus('all')
    setIntent('all')
    setFollowUpPending(false)
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const hayFiltros = status !== 'all' || intent !== 'all' || followUpPending || searchInput !== ''

  const selectedId = selectedLead?.id || selectedLead?._id || selectedLeadId

  const act = fn => (selectedId ? runAction(fn) : Promise.resolve(false))

  const openLead = lead => {
    selectLead(getLeadId(lead))
    setMobileView('detail')
    setMobileTab('detail')
  }

  const removeSelectedLead = async deleteFn => {
    await deleteFn()
    selectLead(null)
    setSelectedLead(null)
    setConversation(null)
    setConversations([])
    setMobileView('list')
    await Promise.all([loadSummary(), loadLeads()])
    return { skipRefresh: true }
  }

  const closeConversationDelete = () => {
    if (!actionLoading) setConversationToDelete(null)
  }

  // El detalle solo se reemplaza por un indicador cuando se está abriendo OTRO lead; al refrescar el
  // mismo (después de una acción) el panel se queda, con su scroll y lo que se estaba escribiendo.
  const showDetailSpinner =
    detailLoading &&
    String(selectedLead?.id || selectedLead?._id || '') !== String(selectedLeadId || '')

  const detailPanel = showDetailSpinner ? (
    <Paper
      variant="outlined"
      sx={{ ...PANEL_SX, height: '100%', display: 'grid', placeItems: 'center' }}
    >
      <CircularProgress />
    </Paper>
  ) : (
    <LeadDetailPanel
      lead={selectedLead}
      loading={actionLoading}
      refreshing={detailLoading}
      actionError={actionError}
      onChangeStatus={nextStatus =>
        act(() => updateAiLeadStatus(selectedId, { status: nextStatus }))
      }
      onAddNote={text => act(() => addAiLeadNote(selectedId, text))}
      onScheduleFollowUp={date => act(() => scheduleAiLeadFollowUp(selectedId, date))}
      onMarkWon={reason => act(() => markAiLeadWon(selectedId, reason))}
      onMarkLost={reason => act(() => markAiLeadLost(selectedId, reason))}
      onDiscard={reason => act(() => discardAiLead(selectedId, reason))}
      onDelete={reason => act(() => removeSelectedLead(() => deleteAiLead(selectedId, reason)))}
      onPermanentDelete={() =>
        act(() => removeSelectedLead(() => permanentlyDeleteAiLead(selectedId)))
      }
      onRemoveProductOfInterest={(productRef, reason) =>
        act(() =>
          removeAiLeadProductOfInterest(
            selectedId,
            productRef,
            reason || 'Producto removido manualmente desde bandeja comercial',
          ),
        )
      }
      onUpdateProductsOfInterest={products =>
        act(() => updateAiLeadProductsOfInterest(selectedId, products))
      }
    />
  )

  const conversationPanel = (
    <LeadConversationPanel
      conversation={conversation}
      conversations={conversations}
      onSelectConversation={conversationId => {
        if (!selectedLeadId) return
        loadDetail(selectedLeadId, conversationId)
      }}
      lead={selectedLead}
      loading={detailLoading || actionLoading}
      onDeleteConversation={item => {
        setConversationToDelete(item)
        setConversationDeleteText('')
        setConversationDeleteAttempted(false)
        setActionError('')
      }}
    />
  )

  const listPanel = (
    <Paper
      variant="outlined"
      sx={{
        ...PANEL_SX,
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ p: 2, borderBottom: `1px solid ${BRAND.line}` }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 16 }}>
            Leads
          </Typography>
          <Typography variant="caption" sx={{ color: BRAND.muted, fontWeight: 700 }}>
            {pagination.total > leads.length
              ? `${leads.length} de ${formatNumber(pagination.total)}`
              : leads.length}
          </Typography>
        </Stack>
      </Box>

      {loading && loaded && <LinearProgress />}

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          opacity: loading && loaded ? 0.55 : 1,
          transition: 'opacity .15s',
        }}
      >
        <LeadList
          leads={leads}
          selectedId={selectedLeadId}
          loading={loading}
          emptyTitle={
            !hayFiltros && loaded && summary.total === 0 ? 'Todavía no hay leads' : undefined
          }
          onSelect={openLead}
        />
      </Box>

      {pagination.pages > 1 && (
        <Box
          sx={{
            p: 1,
            borderTop: `1px solid ${BRAND.line}`,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Pagination
            size="small"
            count={pagination.pages}
            page={page}
            onChange={(_, value) => setPage(value)}
            color="primary"
            siblingCount={0}
            getItemAriaLabel={(itemType, itemPage, selected) => {
              if (itemType === 'page') {
                return selected ? `Página ${itemPage}, actual` : `Ir a la página ${itemPage}`
              }
              const labels = {
                first: 'Primera página',
                last: 'Última página',
                next: 'Página siguiente',
                previous: 'Página anterior',
              }
              return labels[itemType] || itemType
            }}
          />
        </Box>
      )}
    </Paper>
  )

  const busy = loading || detailLoading || actionLoading

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1480, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          AGENTE DE IA
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' } }}
        >
          <Box>
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
              Bandeja comercial
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Conversaciones, leads e intención de compra detectada por el asistente web.
            </Typography>
          </Box>

          <Button
            variant="outlined"
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
            onClick={refreshAll}
            disabled={busy}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
          >
            Actualizar
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={refreshAll}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {actionError && !conversationToDelete && (
        <Alert severity="error" onClose={() => setActionError('')} sx={{ mb: 3 }}>
          {actionError}
        </Alert>
      )}

      {/* En el celular, con un lead abierto el resumen y los filtros solo estorban: el detalle queda a un toque. */}
      {(!isMobile || mobileView === 'list') && (
        <>
          <Paper
            component="section"
            aria-label="Resumen de leads"
            variant="outlined"
            sx={{ ...PANEL_SX, mb: 1.5, overflow: 'hidden' }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'repeat(2, 1fr)',
                  sm: 'repeat(4, 1fr)',
                  lg: 'repeat(8, 1fr)',
                },
              }}
            >
              <SummaryTile
                title="Todos"
                value={formatNumber(summary.total)}
                color={BRAND.blue}
                onClick={() => changeStatus('all')}
                active={status === 'all' && !followUpPending}
              />
              {SUMMARY_STATUSES.map(key => (
                <SummaryTile
                  key={key}
                  title={LEAD_STATUS_META[key].plural}
                  value={formatNumber(summary[SUMMARY_KEYS[key]])}
                  color={LEAD_STATUS_META[key].color}
                  onClick={() => changeStatus(key)}
                  active={status === key && !followUpPending}
                />
              ))}
            </Box>
          </Paper>

          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ mb: 3, px: 0.5, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Typography variant="body2" sx={{ color: BRAND.muted }}>
              {formatNumber(summary.today)}{' '}
              {summary.today === 1 ? 'lead nuevo hoy' : 'leads nuevos hoy'} · Score promedio{' '}
              {formatNumber(summary.averageLeadScore)} ·
            </Typography>
            <Button
              size="small"
              onClick={showPendingFollowUps}
              disabled={!summary.pendingFollowUps}
              aria-pressed={followUpPending}
              sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, p: 0, lineHeight: 1.4 }}
            >
              {summary.pendingFollowUps === 1
                ? '1 seguimiento vencido'
                : `${formatNumber(summary.pendingFollowUps)} seguimientos vencidos`}
            </Button>
          </Stack>

          <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: { md: 'center' } }}
            >
              <TextField
                size="small"
                placeholder="Nombre, email, teléfono, producto o mensaje"
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                sx={{ flex: 1 }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon color="action" />
                      </InputAdornment>
                    ),
                  },
                  htmlInput: { 'aria-label': 'Buscar leads' },
                }}
              />

              <TextField
                select
                size="small"
                label="Intención"
                value={intent}
                onChange={event => changeIntent(event.target.value)}
                sx={{ minWidth: 230 }}
              >
                {INTENT_FILTERS.map(option => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>

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
        </>
      )}

      {isMobile ? (
        mobileView === 'list' ? (
          <Box sx={{ height: PANEL_HEIGHT }}>{listPanel}</Box>
        ) : (
          <Stack spacing={1.5}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => setMobileView('list')}
              sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700 }}
            >
              Volver a la lista
            </Button>

            <Tabs
              value={mobileTab}
              onChange={(_, value) => setMobileTab(value)}
              variant="fullWidth"
              aria-label="Detalle del lead"
              sx={{ borderBottom: `1px solid ${BRAND.line}` }}
            >
              <Tab value="detail" label="Detalle" sx={{ textTransform: 'none', fontWeight: 700 }} />
              <Tab
                value="conversation"
                label="Conversación"
                sx={{ textTransform: 'none', fontWeight: 700 }}
              />
            </Tabs>

            <Box sx={{ height: PANEL_HEIGHT }}>
              {mobileTab === 'detail' ? detailPanel : conversationPanel}
            </Box>
          </Stack>
        )
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ md: 3.4 }}>
            <Box sx={{ height: PANEL_HEIGHT }}>{listPanel}</Box>
          </Grid>

          <Grid size={{ md: 4 }}>
            <Box sx={{ height: PANEL_HEIGHT }}>{detailPanel}</Box>
          </Grid>

          <Grid size={{ md: 4.6 }}>
            <Box sx={{ height: PANEL_HEIGHT }}>{conversationPanel}</Box>
          </Grid>
        </Grid>
      )}

      <Typography variant="caption" sx={{ display: 'block', mt: 3, color: BRAND.muted }}>
        Los leads se actualizan automáticamente a partir de conversaciones del asistente IA. Stock,
        precios y productos se consultan siempre en vivo desde el backend.
      </Typography>

      <Dialog
        open={Boolean(conversationToDelete)}
        onClose={closeConversationDelete}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 4 } } }}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Eliminar conversación definitivamente
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="error">
              Esta acción borra la conversación de la base de datos y no se puede deshacer. El lead
              queda sin el historial de esa conversación.
            </Alert>

            {conversationDeleteAttempted && actionError && (
              <Alert severity="error">{actionError}</Alert>
            )}

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
            onClick={closeConversationDelete}
            disabled={actionLoading}
            sx={{ textTransform: 'none', fontWeight: 700 }}
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
            onClick={async () => {
              const conversationId = getConversationId(conversationToDelete)
              if (!conversationId) return

              setConversationDeleteAttempted(true)
              const ok = await runAction(async () => {
                await permanentlyDeleteAiConversation(conversationId)
                // Una charla borrada no se puede seguir leyendo: se vuelve a la última que quede.
                conversationIdRef.current = undefined
              })

              // Si falló, el diálogo queda abierto con el motivo adentro.
              if (ok) {
                setConversationToDelete(null)
                setConversationDeleteText('')
              }
            }}
            sx={{ textTransform: 'none', fontWeight: 800 }}
          >
            Eliminar definitivamente
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default AiCommercialInboxPage
