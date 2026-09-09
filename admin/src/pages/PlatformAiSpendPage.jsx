// 📁 src/pages/PlatformAiSpendPage.jsx
//
// Gasto de IA de la plataforma contra el techo del mes.
//
// Hasta acá el ledger se escribía y lo leía una sola cosa: el aviso de
// presupuesto, que termina en una línea de log de Render. La información
// existía y no había forma de mirarla sin entrar a la base.
//
// Sin entrada en el menú lateral, igual que PlatformMarginPage: el gate real es
// server-side (requirePlatformOwner, allowlist de email) y no tiene sentido
// mostrarle a todos los admins un ítem que les va a devolver 403.

import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { getPlatformAiSpend } from '../services/platformService'

const formatUsd = value =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)

const formatTokens = value =>
  new Intl.NumberFormat('es-AR').format(Number(value) || 0)

const formatDate = value =>
  value ? new Date(value).toLocaleString('es-AR') : '—'

// Las etiquetas de las métricas del backend. Se escriben acá y no se derivan
// del nombre: 'agentTokens' no le dice nada a nadie que no haya leído el código.
const METRIC_LABELS = {
  vision: 'Análisis de imágenes',
  agentMessages: 'Mensajes del agente',
  agentTokens: 'Tokens del agente',
  imageEdits: 'Ediciones de imagen',
  marketAnalyses: 'Análisis de mercado',
  marketTokens: 'Tokens de mercado',
}

const metricLabel = metric => METRIC_LABELS[metric] || metric

/** Verde hasta el primer escalón de aviso, ámbar hasta el segundo, rojo después. */
const usageColor = percent => {
  if (percent === null) return 'info'
  if (percent >= 80) return 'error'
  if (percent >= 50) return 'warning'
  return 'success'
}

export default function PlatformAiSpendPage() {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true)
    setError('')
    setForbidden(false)

    try {
      const data = await getPlatformAiSpend()
      if (!signal?.cancelled) setReport(data)
    } catch (err) {
      if (signal?.cancelled) return

      if (err?.response?.status === 403) {
        setForbidden(true)
      } else {
        setError(
          err?.response?.data?.message || 'No se pudo cargar el gasto de IA.',
        )
      }
    } finally {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    load({ signal })
    return () => {
      signal.cancelled = true
    }
  }, [load])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (forbidden) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8 }}>
        <Alert severity="warning">No tenés acceso a este reporte.</Alert>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (!report) return null

  const { budget, consumption, breaker, byMetric, byModel, quality } = report
  const percent = consumption.percentUsed

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        Gasto de IA de la plataforma
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Período {report.period} · lo que paga HENKO por los comercios que usan
        la key compartida.
      </Typography>

      {breaker.tripped && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <strong>
            El disyuntor cortó el {formatDate(breaker.trippedAt)}.
          </strong>{' '}
          La IA está detenida para todos los comercios sobre la key de la
          plataforma. Los que tienen key propia siguen funcionando.
        </Alert>
      )}

      {/* Sin techo configurado no hay nada que medir, y es una situación
          distinta de "el techo es cero". El backend manda null justamente para
          poder distinguirlas acá. */}
      {!budget.configured && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No hay disyuntor configurado (
          <code>AI_PLATFORM_MONTHLY_TOKEN_BUDGET</code>). El gasto se registra,
          pero <strong>nada lo detiene</strong>.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'baseline' }}
          spacing={1}
        >
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            {formatUsd(consumption.estimatedCostUsd)}
          </Typography>
          {percent !== null && (
            <Typography variant="body2" color="text.secondary">
              {formatTokens(consumption.tokens)} de{' '}
              {formatTokens(budget.tokens)} tokens
              {' · '}
              quedan {formatTokens(consumption.remainingTokens)}
            </Typography>
          )}
        </Stack>

        {percent !== null && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, percent)}
              color={usageColor(percent)}
              sx={{ height: 10, borderRadius: 5 }}
            />
            <Stack
              direction="row"
              justifyContent="space-between"
              sx={{ mt: 0.75 }}
            >
              <Typography variant="caption" color="text.secondary">
                {percent}% del techo
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Avisos al 50% y al 80%
                {budget.alertedThreshold > 0
                  ? ` · último enviado: ${budget.alertedThreshold}%`
                  : ' · ninguno enviado todavía'}
              </Typography>
            </Stack>
          </Box>
        )}

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 2 }}
        >
          Última actividad: {formatDate(consumption.lastActivityAt)}
        </Typography>
      </Paper>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Qué lo consume
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Función</TableCell>
              <TableCell align="right">Costo</TableCell>
              <TableCell align="right">Tokens</TableCell>
              <TableCell align="right">Operaciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byMetric.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary">
                    Todavía no hay consumo registrado en este período.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {byMetric.map(row => (
              <TableRow key={row.metric}>
                <TableCell>{metricLabel(row.metric)}</TableCell>
                <TableCell align="right">{formatUsd(row.costUsd)}</TableCell>
                <TableCell align="right">{formatTokens(row.tokens)}</TableCell>
                <TableCell align="right">
                  {formatTokens(row.operations)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Por modelo
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Si el gasto se concentra en un modelo caro, cambiar de modelo es una
        palanca que no requiere tocar el producto.
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Modelo</TableCell>
              <TableCell align="right">Costo</TableCell>
              <TableCell align="right">Tokens</TableCell>
              <TableCell align="right">Operaciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byModel.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary">
                    Sin datos por modelo todavía.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {byModel.map(row => (
              <TableRow key={row.model}>
                <TableCell>
                  {row.model}
                  {row.fallbackRows > 0 && (
                    <Tooltip title="Este modelo no está en el catálogo de precios: se cobró con la tarifa conservadora, así que su costo está inflado. Conviene agregarlo.">
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={`${row.fallbackRows} sin tarifa`}
                        sx={{ ml: 1 }}
                      />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="right">{formatUsd(row.costUsd)}</TableCell>
                <TableCell align="right">{formatTokens(row.tokens)}</TableCell>
                <TableCell align="right">
                  {formatTokens(row.operations)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Qué tan confiable es el número de arriba. Va en la pantalla y no en
          una nota al pie porque cambia cómo hay que leerlo: un costo repartido
          con una proporción supuesta y uno medido no son el mismo dato. */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          Calidad de la medición
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {formatTokens(quality.rows)} movimientos registrados
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatTokens(quality.estimatedRows)} con costo repartido
          </Typography>
          <Typography
            variant="body2"
            color={quality.fallbackRows > 0 ? 'warning.main' : 'text.secondary'}
          >
            {formatTokens(quality.fallbackRows)} con tarifa de respaldo
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1.5 }}
        >
          Visión, el agente y pricing informan el desglose real de entrada y
          salida. Mercado, insights y recuperación de carrito todavía entregan
          solo el total, así que su costo se reparte con una proporción
          supuesta.
        </Typography>
      </Paper>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 3 }}
      >
        El techo y los límites por plan se configuran por variables de entorno
        en Render y requieren reiniciar el servicio. Esta pantalla es de
        lectura.
      </Typography>
    </Box>
  )
}
