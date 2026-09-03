// 📁 admin/src/pages/AiAgentDashboardPage.jsx
import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Insights as InsightsIcon,
  Refresh as RefreshIcon,
  Send as SendIcon,
  SmartToy as SmartToyIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material'
import { formatDate } from '@utils/dateFormat'
import {
  getAiAgentMetrics,
  getAiCartRecoveries,
  testAiAgentMessage,
} from '../services/aiAgentDashboardService.js'

const PERIOD_OPTIONS = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'all', label: 'Todo el tiempo' },
]

const RECOVERY_STATUS_META = {
  pending: { label: 'Pendiente', color: 'default' },
  scheduled: { label: 'Programado', color: 'info' },
  processing: { label: 'Procesando', color: 'warning' },
  sent: { label: 'Enviado', color: 'primary' },
  responded: { label: 'Respondió', color: 'success' },
  converted: { label: 'Convertido', color: 'success' },
  cancelled: { label: 'Cancelado', color: 'default' },
  expired: { label: 'Expirado', color: 'default' },
  failed: { label: 'Fallido', color: 'error' },
}

const RECOVERY_STATUS_FILTER = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'sent', label: 'Enviados' },
  { value: 'converted', label: 'Convertidos' },
  { value: 'failed', label: 'Fallidos' },
]

const formatMoney = (cents, currency = 'ARS') => {
  const amount = Number(cents || 0) / 100
  try {
    return amount.toLocaleString('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  } catch {
    return `$${Math.round(amount).toLocaleString('es-AR')}`
  }
}

const MetricCard = ({ label, value, color, suffix }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: '100%' }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
      {label}
    </Typography>
    <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5, color }}>
      {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
      {suffix && (
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
          {suffix}
        </Typography>
      )}
    </Typography>
  </Paper>
)

const RateCard = ({ label, value, color }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: '100%' }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
      {label}
    </Typography>
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline', mt: 0.5 }}>
      <Typography variant="h4" sx={{ fontWeight: 900, color }}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        %
      </Typography>
    </Stack>
  </Paper>
)

const LeadFunnel = ({ leads }) => {
  if (!leads) return null
  const stages = [
    { key: 'new', label: 'Nuevos', color: 'info.main' },
    { key: 'qualified', label: 'Calificados', color: 'primary.main' },
    { key: 'hot', label: 'Calientes', color: 'error.main' },
    { key: 'followUp', label: 'Seguimiento', color: 'warning.main' },
    { key: 'won', label: 'Ganados', color: 'success.main' },
    { key: 'lost', label: 'Perdidos', color: 'text.disabled' },
  ]

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
      {stages.map(stage => (
        <Tooltip key={stage.key} title={stage.label}>
          <Chip
            size="small"
            variant="outlined"
            label={`${stage.label}: ${leads[stage.key] ?? 0}`}
            sx={{ fontWeight: 600 }}
          />
        </Tooltip>
      ))}
    </Stack>
  )
}

const AiAgentDashboardPage = () => {
  const [metrics, setMetrics] = useState(null)
  const [recoveries, setRecoveries] = useState([])
  const [recoveryPagination, setRecoveryPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    pages: 0,
  })
  const [recoveryStatus, setRecoveryStatus] = useState('')
  const [period, setPeriod] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')

  const loadMetrics = useCallback(async currentPeriod => {
    setLoading(true)
    setError('')
    try {
      const data = await getAiAgentMetrics(currentPeriod)
      setMetrics(data || {})
    } catch (err) {
      console.error('[AI_DASHBOARD_METRICS_ERROR]', err)
      setError(err?.response?.data?.message || err?.message || 'No se pudo cargar las métricas.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRecoveries = useCallback(async (page = 1, status = '') => {
    try {
      const data = await getAiCartRecoveries({
        page,
        limit: 25,
        status: status || undefined,
      })
      const items = data?.items || (Array.isArray(data) ? data : [])
      setRecoveries(items)
      if (data?.pagination) {
        setRecoveryPagination(data.pagination)
      } else {
        setRecoveryPagination({
          page: 1,
          limit: 25,
          total: items.length,
          pages: 1,
        })
      }
    } catch (err) {
      console.error('[AI_DASHBOARD_RECOVERIES_ERROR]', err)
    }
  }, [])

  useEffect(() => {
    loadMetrics(period)
    loadRecoveries(1, recoveryStatus)
  }, [loadMetrics, loadRecoveries, period, recoveryStatus])

  const handleRefresh = useCallback(() => {
    loadMetrics(period)
    loadRecoveries(recoveryPagination.page, recoveryStatus)
  }, [loadMetrics, loadRecoveries, period, recoveryPagination.page, recoveryStatus])

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

  if (loading && !metrics) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1080, mx: 'auto' }}>
      {/* Header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }} 
        
        spacing={2}
        
      >
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <InsightsIcon color="primary" />
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              Agente IA · Panel
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Rendimiento del agente, prueba en vivo y campañas de recuperación.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <TextField
            select
            size="small"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            sx={{ minWidth: 170 }}
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
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            Actualizar
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Conversation metrics */}
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
        Conversaciones
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3, mt: 0.5 }}>
        <Grid xs={6} sm={4} md={2.4}>
          <MetricCard label="Total" value={conv.total || 0} color="primary.main" />
        </Grid>
        <Grid xs={6} sm={4} md={2.4}>
          <MetricCard label="Abiertas" value={conv.open || 0} color="info.main" />
        </Grid>
        <Grid xs={6} sm={4} md={2.4}>
          <MetricCard
            label="Esperando humano"
            value={conv.waitingHuman || 0}
            color="warning.main"
          />
        </Grid>
        <Grid xs={6} sm={4} md={2.4}>
          <MetricCard label="Convertidas" value={conv.converted || 0} color="success.main" />
        </Grid>
        <Grid xs={6} sm={4} md={2.4}>
          <RateCard
            label="Tasa de conversión"
            value={conv.conversionRate || 0}
            color="success.main"
          />
        </Grid>
      </Grid>

      {/* Lead metrics */}
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
        Leads
      </Typography>
      <Grid container spacing={2} sx={{ mb: 1, mt: 0.5 }}>
        <Grid xs={6} sm={4} md={3}>
          <MetricCard label="Total leads" value={leads.total || 0} color="primary.main" />
        </Grid>
        <Grid xs={6} sm={4} md={3}>
          <MetricCard label="Leads calientes" value={leads.hot || 0} color="error.main" />
        </Grid>
        <Grid xs={6} sm={4} md={3}>
          <MetricCard label="Ganados" value={leads.won || 0} color="success.main" />
        </Grid>
        <Grid xs={6} sm={4} md={3}>
          <MetricCard
            label="Score promedio"
            value={leads.averageScore || 0}
            color="text.primary"
            suffix="/ 100"
          />
        </Grid>
      </Grid>
      <Box sx={{ mb: 3, mt: 1 }}>
        <LeadFunnel leads={leads} />
      </Box>

      {/* Cart recovery metrics */}
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
        Recuperación de carritos
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3, mt: 0.5 }}>
        <Grid xs={6} sm={3}>
          <MetricCard label="Intentos" value={recovery.total || 0} color="primary.main" />
        </Grid>
        <Grid xs={6} sm={3}>
          <MetricCard label="Convertidos" value={recovery.converted || 0} color="success.main" />
        </Grid>
        <Grid xs={6} sm={3}>
          <RateCard
            label="Tasa de recupero"
            value={recovery.conversionRate || 0}
            color="success.main"
          />
        </Grid>
        <Grid xs={6} sm={3}>
          <MetricCard
            label="Ingreso recuperado"
            value={formatMoney(recovery.recoveredRevenueCents)}
            color="success.main"
          />
        </Grid>
      </Grid>

      {/* Agent tester */}
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 3 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
          <SmartToyIcon color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Probar el agente
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Escribí como si fueras un cliente. El agente responde con su configuración actual, sin
          necesidad de WhatsApp.
        </Typography>
        <Divider sx={{ mb: 2.5 }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <TextField
            fullWidth
            multiline
            minRows={1}
            maxRows={4}
            placeholder="Hola, ¿tenés zapatillas negras talle 42?"
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            inputProps={{ maxLength: 2000 }}
          />
          <Button
            variant="contained"
            startIcon={testing ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
            onClick={handleTest}
            disabled={testing || !testInput.trim()}
            sx={{
              borderRadius: 2,
              textTransform: 'none',
              px: 3,
              minWidth: 130,
            }}
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
            sx={{ mt: 2.5, p: 2, borderRadius: 2, bgcolor: 'action.hover' }}
          >
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {testResult.reply || '(sin respuesta)'}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 1.5 }}>
              {testResult.intent && (
                <Chip size="small" variant="outlined" label={`Intención: ${testResult.intent}`} />
              )}
              {testResult.leadScore !== undefined && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Lead score: ${testResult.leadScore}`}
                />
              )}
              {testResult.handoffRequired && (
                <Chip size="small" color="warning" label="Requiere humano" />
              )}
            </Stack>
          </Paper>
        )}
      </Paper>

      {/* Cart recovery table */}
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ p: 2.5, pb: 1.5 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }} 
            
            spacing={1}
          >
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TrendingUpIcon color="primary" fontSize="small" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Detalle de recuperación
                </Typography>
              </Stack>
            </Box>
            <TextField
              select
              size="small"
              value={recoveryStatus}
              onChange={e => {
                setRecoveryStatus(e.target.value)
              }}
              sx={{ minWidth: 150 }}
            >
              {RECOVERY_STATUS_FILTER.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Box>

        <TableContainer sx={{ maxHeight: 460 }}>
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
              {recoveries.map(item => {
                const statusMeta = RECOVERY_STATUS_META[item.status] || {
                  label: item.status || '-',
                  color: 'default',
                }
                return (
                  <TableRow key={item._id || item.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {item.customer?.name || 'Sin nombre'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.customer?.phone || item.customer?.email || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {formatMoney(item.cartSnapshot?.subtotalCents, item.cartSnapshot?.currency)}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={statusMeta.label} color={statusMeta.color} />
                    </TableCell>
                    <TableCell align="center">{item.attempts ?? 0}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {item.scheduledAt ? formatDate(item.scheduledAt) : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {item.sentAt ? formatDate(item.sentAt) : '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )
              })}

              {recoveries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5 }}>
                    <Typography color="text.secondary">
                      No hay campañas de recuperación
                      {recoveryStatus
                        ? ` con estado "${RECOVERY_STATUS_META[recoveryStatus]?.label || recoveryStatus}"`
                        : ''}
                      .
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {recoveryPagination.pages > 1 && (
          <Stack
            direction="row"
            
            
            spacing={1}
            sx={{ justifyContent: 'flex-end', alignItems: 'center', p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <Typography variant="caption" color="text.secondary">
              {recoveryPagination.page} / {recoveryPagination.pages}
              {' · '}
              {recoveryPagination.total} total
            </Typography>
            <IconButton
              size="small"
              disabled={recoveryPagination.page <= 1}
              onClick={() => loadRecoveries(recoveryPagination.page - 1, recoveryStatus)}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              disabled={recoveryPagination.page >= recoveryPagination.pages}
              onClick={() => loadRecoveries(recoveryPagination.page + 1, recoveryStatus)}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Stack>
        )}
      </Paper>
    </Box>
  )
}

export default AiAgentDashboardPage
