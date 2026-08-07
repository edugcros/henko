// 📁 admin/src/pages/AiAgentDashboardPage.jsx
//
// Dashboard operativo del Agente IA: métricas de conversaciones/leads, una
// herramienta para probar el agente sin WhatsApp, y el estado de las
// campañas de recuperación de carrito. Endpoints admin de /ai-agent/*.
import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
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
} from '@mui/material'
import {
  Insights as InsightsIcon,
  Refresh as RefreshIcon,
  Send as SendIcon,
  SmartToy as SmartToyIcon,
} from '@mui/icons-material'
import { formatDate } from '@utils/dateFormat'
import {
  getAiAgentMetrics,
  getAiCartRecoveries,
  testAiAgentMessage,
} from '../services/aiAgentDashboardService.js'

const METRIC_CARDS = [
  { key: 'totalConversations', label: 'Conversaciones', color: 'primary.main' },
  { key: 'openConversations', label: 'Abiertas', color: 'info.main' },
  { key: 'waitingHuman', label: 'Esperando humano', color: 'warning.main' },
  { key: 'closedConversations', label: 'Cerradas', color: 'text.secondary' },
  { key: 'hotLeads', label: 'Leads calientes', color: 'error.main' },
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

const MetricCard = ({ label, value, color }) => (
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: '100%' }}>
    <Typography variant="caption" color="text.secondary" fontWeight={700}>
      {label}
    </Typography>
    <Typography variant="h4" fontWeight={900} sx={{ mt: 0.5, color }}>
      {Number(value || 0).toLocaleString('es-AR')}
    </Typography>
  </Paper>
)

const AiAgentDashboardPage = () => {
  const [metrics, setMetrics] = useState(null)
  const [recoveries, setRecoveries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [metricsData, recoveriesData] = await Promise.all([
        getAiAgentMetrics(),
        getAiCartRecoveries(),
      ])
      setMetrics(metricsData || {})
      setRecoveries(Array.isArray(recoveriesData) ? recoveriesData : [])
    } catch (err) {
      console.error('[AI_AGENT_DASHBOARD_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar el panel del agente.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
      setTestError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo probar el agente.',
      )
    } finally {
      setTesting(false)
    }
  }, [testInput])

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="60vh"
      >
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1080, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={2}
        mb={3}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <InsightsIcon color="primary" />
            <Typography variant="h4" fontWeight={800}>
              Agente IA · Panel
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Rendimiento del agente, prueba en vivo y campañas de recuperación de
            carrito.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={load}
          sx={{ borderRadius: 2, textTransform: 'none' }}
        >
          Actualizar
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} mb={3}>
        {METRIC_CARDS.map(card => (
          <Grid item xs={6} sm={4} md={2.4} key={card.key}>
            <MetricCard
              label={card.label}
              value={metrics?.[card.key]}
              color={card.color}
            />
          </Grid>
        ))}
      </Grid>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" mb={0.5}>
          <SmartToyIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>
            Probar el agente
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Escribí como si fueras un cliente. El agente responde con su
          configuración actual, sin necesidad de WhatsApp.
        </Typography>
        <Divider sx={{ mb: 2.5 }} />

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems="flex-start"
        >
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
            startIcon={
              testing ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <SendIcon />
              )
            }
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
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
              {testResult.intent && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Intención: ${testResult.intent}`}
                />
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

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ p: 2.5, pb: 1.5 }}>
          <Typography variant="h6" fontWeight={700}>
            Recuperación de carritos
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Últimos {recoveries.length} intentos de recupero por WhatsApp.
          </Typography>
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
                      <Typography variant="body2" fontWeight={600}>
                        {item.customer?.name || 'Sin nombre'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.customer?.phone || item.customer?.email || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {formatMoney(
                        item.cartSnapshot?.subtotalCents,
                        item.cartSnapshot?.currency,
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={statusMeta.label}
                        color={statusMeta.color}
                      />
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
                      Todavía no hay campañas de recuperación.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  )
}

export default AiAgentDashboardPage
