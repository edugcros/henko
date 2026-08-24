// 📁 src/pages/PlatformMarginPage.jsx
//
// Margen de HENKO por comercio (Bloque 6 lo calcula, Bloque 8A le da
// pantalla). Sin entrada en el menú lateral a propósito — el gate real es
// server-side (requirePlatformOwner), esta pantalla solo maneja el 403 con
// un mensaje claro en vez de un error sin manejar.

import React, { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { getPlatformMarginReport } from '../services/platformService'

const formatUsd = value => {
  if (value === null || value === undefined) return 'A medida'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

const STATUS_COLORS = {
  active: 'success',
  suspended: 'warning',
}

export default function PlatformMarginPage() {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError('')
      setForbidden(false)

      try {
        const data = await getPlatformMarginReport()
        if (!cancelled) setReport(data)
      } catch (err) {
        if (cancelled) return

        if (err?.response?.status === 403) {
          setForbidden(true)
        } else {
          setError(
            err?.response?.data?.message ||
              'No se pudo cargar el reporte de margen.',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

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

  const tenants = report?.tenants || []
  const totals = report?.totals || {}
  const notes = report?.notes || []

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" fontWeight={800} sx={{ mb: 0.5 }}>
        Margen de HENKO por comercio
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Período: {report?.period}
      </Typography>

      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}
      >
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Comercios
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {totals.tenantCount ?? 0}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Ingreso por planes
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {formatUsd(totals.totalPlanRevenueUsd)}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Costo de IA
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {formatUsd(totals.totalAiCostUsd)}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Comunicaciones
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {formatUsd(totals.totalCommunicationsCostUsd)}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Infra + storage (plataforma)
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {formatUsd(
              (totals.infraCostUsd || 0) + (totals.storageCostUsd || 0),
            )}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Margen estimado
          </Typography>
          <Typography variant="h6" fontWeight={800}>
            {formatUsd(totals.totalEstimatedMarginUsd)}
          </Typography>
        </Paper>
      </Stack>

      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ borderRadius: 3, mb: 3 }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Comercio</TableCell>
              <TableCell>Plan</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell align="right">Precio del plan</TableCell>
              <TableCell align="right">Costo de IA</TableCell>
              <TableCell align="right">Comunicaciones</TableCell>
              <TableCell align="right">Margen estimado</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map(tenant => (
              <TableRow key={tenant.tenantId}>
                <TableCell>{tenant.name}</TableCell>
                <TableCell sx={{ textTransform: 'capitalize' }}>
                  {tenant.plan}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={tenant.status}
                    color={STATUS_COLORS[tenant.status] || 'default'}
                    sx={{ textTransform: 'capitalize' }}
                  />
                </TableCell>
                <TableCell align="right">
                  {formatUsd(tenant.planPriceUsd)}
                </TableCell>
                <TableCell align="right">
                  {formatUsd(tenant.aiCostUsd)}
                </TableCell>
                <TableCell align="right">
                  {formatUsd(tenant.communicationsCostUsd)}
                </TableCell>
                <TableCell align="right">
                  {formatUsd(tenant.estimatedMarginUsd)}
                </TableCell>
              </TableRow>
            ))}
            {!tenants.length && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  align="center"
                  sx={{ py: 4, color: 'text.secondary' }}
                >
                  Sin datos para este período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {notes.map(note => (
        <Alert key={note} severity="info" sx={{ mb: 1 }}>
          {note}
        </Alert>
      ))}
    </Box>
  )
}
