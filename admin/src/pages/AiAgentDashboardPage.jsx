// 📁 admin/src/pages/AiAgentDashboardPage.jsx
//
// Métricas del asistente de ventas: qué vendió, cómo le va con las conversaciones y los leads, y
// qué pasó con los carritos que intentó recuperar. Abajo, una prueba en vivo del agente.
//
// Las métricas dependen del período; el detalle de recuperaciones, de su filtro y su página. Son
// dos cargas separadas: antes cambiar una volvía a pedir la otra.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { Refresh as RefreshIcon, Send as SendIcon } from '@mui/icons-material'
import { formatDate } from '@utils/dateFormat'
import { getIntentLabel } from '@components/aiLeads/LeadDetailPanel.jsx'
import {
  getAiAgentMetrics,
  getAiCartRecoveries,
  testAiAgentMessage,
} from '../services/aiAgentDashboardService.js'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  green: '#047857',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const PERIOD_OPTIONS = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'all', label: 'Todo el tiempo' },
]

const PAGE_SIZE = 25

// Por qué una recuperación no llegó a enviarse. Los códigos los escribe el
// worker en metadata.cancelledReason / metadata.lastError.
const RECOVERY_REASONS = {
  missing_marketing_consent:
    'El cliente no dio consentimiento para recibir mensajes y no escribió en las últimas 24 h.',
  customer_opted_out: 'El cliente pidió no recibir más mensajes.',
  contact_too_recent: 'Se le escribió hace muy poco; la regla exige esperar.',
  daily_contact_limit_reached: 'Llegó al tope de contactos en 24 h.',
  missing_whatsapp_credentials:
    'Falta el token de acceso de WhatsApp en la configuración del asistente.',
  whatsapp_template_required:
    'Pasaron 24 h desde el último mensaje del cliente: Meta solo acepta una plantilla aprobada.',
  missing_checkout_url: 'No se pudo armar el link al checkout.',
  tenant_not_active: 'La tienda no está activa.',
  missing_contact_data: 'Falta el dato de contacto del cliente.',
}

export const recoveryReason = item => {
  const code = item?.metadata?.cancelledReason || item?.metadata?.lastError
  if (!code) return ''
  return RECOVERY_REASONS[code] || code
}

// Los nueve estados que acepta el servidor. El filtro antes ofrecía cinco: las recuperaciones
// programadas, en proceso, respondidas, canceladas o expiradas no se podían ver por separado.
export const RECOVERY_STATUS_META = {
  pending: { label: 'Pendiente', plural: 'Pendientes', color: '#55618a', bg: '#eef1fb' },
  scheduled: { label: 'Programado', plural: 'Programados', color: '#0b55cc', bg: '#e7f0ff' },
  processing: { label: 'Procesando', plural: 'Procesando', color: '#9a5b00', bg: '#fff3dd' },
  sent: { label: 'Enviado', plural: 'Enviados', color: '#0b55cc', bg: '#e7f0ff' },
  responded: { label: 'Respondió', plural: 'Respondieron', color: '#047857', bg: '#e6f6ef' },
  converted: { label: 'Convertido', plural: 'Convertidos', color: '#047857', bg: '#e6f6ef' },
  cancelled: { label: 'Cancelado', plural: 'Cancelados', color: '#55618a', bg: '#eef1fb' },
  expired: { label: 'Expirado', plural: 'Expirados', color: '#55618a', bg: '#eef1fb' },
  failed: { label: 'Fallido', plural: 'Fallidos', color: '#b42318', bg: '#fdebea' },
}

const RECOVERY_STATUS_FILTER = [
  { value: '', label: 'Todos' },
  ...Object.entries(RECOVERY_STATUS_META).map(([value, meta]) => ({ value, label: meta.plural })),
]

// Los montos de recuperación vienen en centavos; los de ventas influenciadas, en pesos.
export const formatMoney = (cents, currency = 'ARS') =>
  formatPesos(Number(cents || 0) / 100, currency)

export const formatPesos = (amount, currency = 'ARS') => {
  const value = Number(amount || 0)
  try {
    return value.toLocaleString('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  } catch {
    return `$${Math.round(value).toLocaleString('es-AR')}`
  }
}

const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

const formatPercent = value =>
  Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })

const SectionTitle = ({ children, hint }) => (
  <Box sx={{ mb: 1.5 }}>
    <Typography
      component="h2"
      sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, color: BRAND.ink }}
    >
      {children}
    </Typography>
    {hint && (
      <Typography variant="body2" sx={{ color: BRAND.muted }}>
        {hint}
      </Typography>
    )}
  </Box>
)

// Una fila de cifras dentro de un panel. `suffix` acompaña al número sin agrandarse con él.
const StatGrid = ({ items, columns }) => (
  <Paper variant="outlined" sx={{ ...PANEL_SX, overflow: 'hidden' }}>
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: `repeat(${columns}, 1fr)` },
      }}
    >
      {items.map(item => (
        <Box
          key={item.label}
          sx={{
            p: 2,
            borderRight: `1px solid ${BRAND.line}`,
            borderBottom: `1px solid ${BRAND.line}`,
          }}
        >
          <Typography
            component="span"
            variant="caption"
            sx={{ display: 'block', color: BRAND.muted, fontWeight: 700, letterSpacing: '0.04em' }}
          >
            {item.label}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: 26,
              lineHeight: 1.25,
              color: item.color || BRAND.ink,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {item.value}
          </Typography>
          {item.suffix && (
            <Typography component="span" variant="body2" sx={{ ml: 0.5, color: BRAND.muted }}>
              {item.suffix}
            </Typography>
          )}
          {item.hint && (
            <Typography variant="caption" sx={{ display: 'block', color: BRAND.muted }}>
              {item.hint}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  </Paper>
)

const Pill = ({ label, color = BRAND.muted, bg = '#eef1fb' }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      px: 1.25,
      py: 0.25,
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 700,
      lineHeight: 1.6,
      whiteSpace: 'nowrap',
      color,
      bgcolor: bg,
    }}
  >
    {label}
  </Box>
)

const LEAD_STAGES = [
  { key: 'new', label: 'Nuevos' },
  { key: 'qualified', label: 'Calificados' },
  { key: 'followUp', label: 'Seguimiento' },
  { key: 'won', label: 'Ganados' },
  { key: 'lost', label: 'Perdidos' },
]

const LeadFunnel = ({ leads }) => (
  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
    {LEAD_STAGES.map(stage => (
      <Box
        key={stage.key}
        component="span"
        sx={{
          px: 1.25,
          py: 0.25,
          borderRadius: 99,
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1.6,
          color: BRAND.ink,
          border: `1px solid ${BRAND.line}`,
        }}
      >
        {`${stage.label}: ${formatNumber(leads[stage.key])}`}
      </Box>
    ))}
  </Stack>
)

const RecoveryStatus = ({ item }) => {
  const meta = RECOVERY_STATUS_META[item.status] || { label: item.status || '-' }
  const reason = recoveryReason(item)

  return (
    <>
      <Pill label={meta.label} color={meta.color} bg={meta.bg} />
      {/*
        El porqué, al lado del estado. Una recuperación
        cancelada o fallida se veía solo como una etiqueta gris:
        el motivo estaba guardado en el documento y no lo
        mostraba nadie, así que la pantalla no explicaba por qué
        no se le escribió a ese cliente.
      */}
      {reason && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: BRAND.muted }}>
          {reason}
        </Typography>
      )}
    </>
  )
}

const AiAgentDashboardPage = () => {
  const isMobile = useMediaQuery('(max-width:600px)')

  const [metrics, setMetrics] = useState(null)
  const [period, setPeriod] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [recoveries, setRecoveries] = useState([])
  const [recoveryPagination, setRecoveryPagination] = useState({ page: 1, total: 0, pages: 0 })
  const [recoveryStatus, setRecoveryStatus] = useState('')
  const [recoveryPage, setRecoveryPage] = useState(1)
  const [recoveriesLoading, setRecoveriesLoading] = useState(true)
  const [recoveriesError, setRecoveriesError] = useState('')

  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')

  // Una respuesta lenta de una consulta anterior no tiene que pisar a la más reciente.
  const metricsRequestRef = useRef(0)
  const recoveriesRequestRef = useRef(0)

  const loadMetrics = useCallback(async currentPeriod => {
    const request = ++metricsRequestRef.current
    setLoading(true)
    setError('')
    try {
      const data = await getAiAgentMetrics(currentPeriod)
      if (request !== metricsRequestRef.current) return
      setMetrics(data || {})
    } catch (err) {
      if (request !== metricsRequestRef.current) return
      console.error('[AI_DASHBOARD_METRICS_ERROR]', err)
      setError(
        err?.response?.data?.message || err?.message || 'No se pudieron cargar las métricas.',
      )
    } finally {
      if (request === metricsRequestRef.current) setLoading(false)
    }
  }, [])

  const loadRecoveries = useCallback(async (page, status) => {
    const request = ++recoveriesRequestRef.current
    setRecoveriesLoading(true)
    setRecoveriesError('')
    try {
      const data = await getAiCartRecoveries({
        page,
        limit: PAGE_SIZE,
        status: status || undefined,
      })
      if (request !== recoveriesRequestRef.current) return

      const items = data?.items || (Array.isArray(data) ? data : [])
      setRecoveries(items)
      setRecoveryPagination(data?.pagination || { page: 1, total: items.length, pages: 1 })
    } catch (err) {
      if (request !== recoveriesRequestRef.current) return
      console.error('[AI_DASHBOARD_RECOVERIES_ERROR]', err)
      // Antes el error se tragaba y la tabla decía «No hay campañas de recuperación»: parecía que
      // no había ninguna cuando en realidad no se pudieron leer.
      setRecoveries([])
      setRecoveriesError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudieron cargar las recuperaciones de carritos.',
      )
    } finally {
      if (request === recoveriesRequestRef.current) setRecoveriesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMetrics(period)
  }, [loadMetrics, period])

  useEffect(() => {
    loadRecoveries(recoveryPage, recoveryStatus)
  }, [loadRecoveries, recoveryPage, recoveryStatus])

  const handleRefresh = () => {
    loadMetrics(period)
    loadRecoveries(recoveryPage, recoveryStatus)
  }

  const changeRecoveryStatus = value => {
    setRecoveryStatus(value)
    setRecoveryPage(1)
  }

  const handleTest = useCallback(async () => {
    const message = testInput.trim()
    if (!message) return

    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      const result = await testAiAgentMessage(message)
      setTestResult(result || null)
    } catch (err) {
      console.error('[AI_AGENT_TEST_ERROR]', err)
      setTestError(err?.response?.data?.message || err?.message || 'No se pudo probar el agente.')
    } finally {
      setTesting(false)
    }
  }, [testInput])

  const conv = metrics?.conversations || {}
  const leads = metrics?.leads || {}
  const recovery = metrics?.cartRecovery || {}
  const sales = metrics?.salesInfluence || {}
  const periodLabel = PERIOD_OPTIONS.find(option => option.value === period)?.label || ''

  if (loading && !metrics) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}
      >
        <CircularProgress />
      </Box>
    )
  }

  const filterLabel = RECOVERY_STATUS_META[recoveryStatus]?.plural

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1180, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          AGENTE DE IA
        </Typography>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-end' } }}
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
              Métricas del asistente
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Qué vendió el asistente, cómo le va con las conversaciones y los carritos que
              recuperó.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ flexShrink: 0 }}>
            <TextField
              select
              size="small"
              label="Período"
              value={period}
              onChange={e => setPeriod(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              {PERIOD_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={handleRefresh}
              disabled={loading}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
            >
              Actualizar
            </Button>
          </Stack>
        </Stack>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => loadMetrics(period)}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {loading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      <Stack spacing={4} sx={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
        {/* Lo que el backend ya mandaba y la pantalla nunca mostraba. */}
        <Box component="section" aria-label="Ventas del asistente">
          <SectionTitle hint={`${periodLabel}. Compras de clientes que hablaron con el asistente.`}>
            Ventas del asistente
          </SectionTitle>
          <StatGrid
            columns={3}
            items={[
              {
                label: 'Ventas influenciadas',
                value: formatPesos(sales.aiInfluencedRevenue),
                color: BRAND.green,
                hint: `de ${formatPesos(sales.totalRevenue)} vendidos en total`,
              },
              {
                label: 'Pedidos influenciados',
                value: formatNumber(sales.aiInfluencedOrders),
                hint: `de ${formatNumber(sales.totalOrders)} pedidos`,
              },
              {
                label: 'Parte de las ventas',
                value: formatPercent(sales.percentage),
                suffix: '%',
              },
            ]}
          />
        </Box>

        <Box component="section" aria-label="Conversaciones">
          <SectionTitle>Conversaciones</SectionTitle>
          <StatGrid
            columns={5}
            items={[
              { label: 'Total', value: formatNumber(conv.total), color: BRAND.blue },
              { label: 'Abiertas', value: formatNumber(conv.open) },
              {
                label: 'Esperando a una persona',
                value: formatNumber(conv.waitingHuman),
                color: conv.waitingHuman ? '#9a5b00' : BRAND.ink,
              },
              { label: 'Convertidas', value: formatNumber(conv.converted), color: BRAND.green },
              {
                label: 'Tasa de conversión',
                value: formatPercent(conv.conversionRate),
                suffix: '%',
                color: BRAND.green,
              },
            ]}
          />
        </Box>

        <Box component="section" aria-label="Leads">
          <SectionTitle>Leads</SectionTitle>
          <StatGrid
            columns={4}
            items={[
              { label: 'Total leads', value: formatNumber(leads.total), color: BRAND.blue },
              {
                // El servidor los cuenta por puntaje (75 o más), no por el estado «Caliente» de la
                // bandeja comercial: por eso no se llaman igual.
                label: 'Con puntaje 75 o más',
                value: formatNumber(leads.hot),
                color: '#b42318',
              },
              { label: 'Ganados', value: formatNumber(leads.won), color: BRAND.green },
              { label: 'Score promedio', value: formatNumber(leads.averageScore), suffix: '/ 100' },
            ]}
          />
          <LeadFunnel leads={leads} />
        </Box>

        <Box component="section" aria-label="Recuperación de carritos">
          <SectionTitle
            hint={`${periodLabel}. Mensajes enviados a quien dejó un carrito sin pagar.`}
          >
            Recuperación de carritos
          </SectionTitle>
          <StatGrid
            columns={4}
            items={[
              { label: 'Intentos', value: formatNumber(recovery.total), color: BRAND.blue },
              { label: 'Convertidos', value: formatNumber(recovery.converted), color: BRAND.green },
              {
                label: 'Tasa de recupero',
                value: formatPercent(recovery.conversionRate),
                suffix: '%',
                color: BRAND.green,
              },
              {
                label: 'Ingreso recuperado',
                value: formatMoney(recovery.recoveredRevenueCents),
                color: BRAND.green,
              },
            ]}
          />
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ ...PANEL_SX, mt: 4, overflow: 'hidden' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ p: 2.5, pb: 1.5, justifyContent: 'space-between', alignItems: { sm: 'center' } }}
        >
          <Box>
            <Typography
              component="h2"
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18 }}
            >
              Detalle de recuperación
            </Typography>
            <Typography variant="body2" sx={{ color: BRAND.muted }}>
              Todas las recuperaciones, de la más nueva a la más vieja (no depende del período).
            </Typography>
          </Box>
          <TextField
            select
            size="small"
            label="Estado"
            value={recoveryStatus}
            onChange={e => changeRecoveryStatus(e.target.value)}
            sx={{ minWidth: 170 }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            {RECOVERY_STATUS_FILTER.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {recoveriesLoading && <LinearProgress />}

        {recoveriesError ? (
          <Alert
            severity="error"
            sx={{ m: 2.5 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => loadRecoveries(recoveryPage, recoveryStatus)}
              >
                Reintentar
              </Button>
            }
          >
            {recoveriesError}
          </Alert>
        ) : recoveries.length === 0 ? (
          !recoveriesLoading && (
            <Typography sx={{ p: 5, textAlign: 'center', color: BRAND.muted }}>
              {recoveryStatus
                ? `No hay recuperaciones con estado «${filterLabel}».`
                : 'No hay campañas de recuperación todavía.'}
            </Typography>
          )
        ) : isMobile ? (
          <Stack spacing={1} sx={{ p: 1.5, opacity: recoveriesLoading ? 0.55 : 1 }}>
            {recoveries.map(item => (
              <Paper
                key={item._id || item.id}
                variant="outlined"
                sx={{ p: 1.5, borderRadius: 3, borderColor: BRAND.line, boxShadow: 'none' }}
              >
                <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {item.customer?.name || 'Sin nombre'}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: BRAND.muted, overflowWrap: 'anywhere' }}
                    >
                      {item.customer?.phone || item.customer?.email || '-'}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {formatMoney(item.cartSnapshot?.subtotalCents, item.cartSnapshot?.currency)}
                  </Typography>
                </Stack>
                <Box sx={{ mt: 1 }}>
                  <RecoveryStatus item={item} />
                </Box>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.5, color: BRAND.muted }}
                >
                  {`${item.attempts ?? 0} ${item.attempts === 1 ? 'intento' : 'intentos'}`}
                  {item.sentAt ? ` · enviado ${formatDate(item.sentAt)}` : ''}
                </Typography>
              </Paper>
            ))}
          </Stack>
        ) : (
          <TableContainer sx={{ maxHeight: 520, opacity: recoveriesLoading ? 0.55 : 1 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Cliente</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">
                    Intentos
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Programado</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Enviado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recoveries.map(item => (
                  <TableRow key={item._id || item.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {item.customer?.name || 'Sin nombre'}
                      </Typography>
                      <Typography variant="caption" sx={{ color: BRAND.muted }}>
                        {item.customer?.phone || item.customer?.email || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(item.cartSnapshot?.subtotalCents, item.cartSnapshot?.currency)}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <RecoveryStatus item={item} />
                    </TableCell>
                    <TableCell align="center">{item.attempts ?? 0}</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: BRAND.muted }}>
                        {item.scheduledAt ? formatDate(item.scheduledAt) : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: BRAND.muted }}>
                        {item.sentAt ? formatDate(item.sentAt) : '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {recoveryPagination.pages > 1 && (
          <Stack
            spacing={1}
            sx={{ alignItems: 'center', p: 1.5, borderTop: `1px solid ${BRAND.line}` }}
          >
            <Pagination
              size="small"
              count={recoveryPagination.pages}
              page={recoveryPage}
              onChange={(_, value) => setRecoveryPage(value)}
              color="primary"
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
            <Typography variant="caption" sx={{ color: BRAND.muted }}>
              {`Página ${recoveryPagination.page} de ${recoveryPagination.pages} · ${formatNumber(recoveryPagination.total)} recuperaciones`}
            </Typography>
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ ...PANEL_SX, mt: 4, p: { xs: 2, sm: 2.5 } }}>
        <Typography component="h2" sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18 }}>
          Probar el agente
        </Typography>
        <Typography variant="body2" sx={{ color: BRAND.muted, mb: 1.5 }}>
          Escribí como si fueras un cliente. El agente responde con su configuración actual, sin
          necesidad de WhatsApp.
        </Typography>
        {/*
          Lo que la prueba deja, dicho antes de usarla: el servidor la procesa como una conversación
          real del chat web (todas las pruebas comparten la misma, de «Usuario Test»), le crea o
          actualiza un lead en la bandeja comercial, cuenta en estas métricas y gasta créditos de IA.
        */}
        <Alert severity="info" sx={{ mb: 2 }}>
          La prueba queda guardada como una conversación de «Usuario Test» en la bandeja comercial,
          suma en estas métricas y consume créditos de IA. El agente recuerda las pruebas
          anteriores.
        </Alert>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: 'flex-start' }}
        >
          <TextField
            fullWidth
            multiline
            minRows={1}
            maxRows={4}
            placeholder="Hola, ¿tenés zapatillas negras talle 42?"
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleTest()
              }
            }}
            slotProps={{ htmlInput: { maxLength: 2000, 'aria-label': 'Mensaje de prueba' } }}
          />
          <Button
            variant="contained"
            startIcon={testing ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
            onClick={handleTest}
            disabled={testing || !testInput.trim()}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, px: 3, minWidth: 130 }}
          >
            {testing ? 'Probando...' : 'Enviar'}
          </Button>
        </Stack>

        {testError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {testError}
          </Alert>
        )}

        {testResult && (
          <Paper
            variant="outlined"
            sx={{ mt: 2.5, p: 2, borderRadius: 3, borderColor: BRAND.line, bgcolor: BRAND.paper }}
          >
            <Typography variant="caption" sx={{ color: BRAND.muted, fontWeight: 700 }}>
              Respuesta del agente
            </Typography>
            <Typography
              variant="body1"
              sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.5 }}
            >
              {testResult.reply || '(sin respuesta)'}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
              {testResult.intent && (
                <Pill label={`Intención: ${getIntentLabel(testResult.intent)}`} />
              )}
              {testResult.leadScore !== undefined && (
                <Pill label={`Puntaje del lead: ${testResult.leadScore}`} />
              )}
              {testResult.handoffRequired && (
                <Pill label="Pide hablar con una persona" color="#9a5b00" bg="#fff3dd" />
              )}
            </Stack>
          </Paper>
        )}
      </Paper>
    </Box>
  )
}

export default AiAgentDashboardPage
