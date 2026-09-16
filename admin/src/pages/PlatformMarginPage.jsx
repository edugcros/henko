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

// El reporte pasó a pesos: HENKO cobra en pesos, y convertir el precio a
// dólares para emparejarlo con los costos era lo que hacía que el margen se
// corriera solo cada vez que se movía el cambio. Ahora se convierten los
// COSTOS, que sí llegan en dólares, y el tipo de cambio usado viene en la
// respuesta.
const formatArs = value => {
  if (value === null || value === undefined) return 'A medida'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'ARS',
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
  const lifecycle = report?.lifecycle || {}
  const notes = report?.notes || []

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>
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
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {totals.tenantCount ?? 0}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Ingreso por planes
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {formatArs(totals.totalPlanRevenueArs)}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Costo de IA
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {formatArs(totals.totalAiCostArs)}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Comunicaciones
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {formatArs(totals.totalCommunicationsCostArs)}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Infra + storage (plataforma)
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {formatArs(
              (totals.infraCostArs || 0) + (totals.storageCostArs || 0),
            )}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Margen estimado
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {formatArs(totals.totalEstimatedMarginArs)}
          </Typography>
        </Paper>
        {/* Cuántos cuestan más de lo que pagan. Es la primera pregunta al abrir
            esta pantalla, y contarlos a ojo sobre la tabla no escala. Solo
            aparece cuando hay alguno: un cero permanente es ruido. */}
        {totals.unprofitableCount > 0 && (
          <Paper
            sx={{
              p: 2,
              borderRadius: 3,
              minWidth: 180,
              borderColor: 'error.main',
            }}
            variant="outlined"
          >
            <Typography variant="caption" color="error.main">
              Pierden plata
            </Typography>
            <Typography
              variant="h6"
              sx={{ fontWeight: 800, color: 'error.main' }}
            >
              {totals.unprofitableCount}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatArs(totals.unprofitableLossArs)} en total
            </Typography>
          </Paper>
        )}
      </Stack>

      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
        Ciclo de vida de comercios
      </Typography>
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}
      >
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Altas este período
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {lifecycle.newTenantsInPeriod ?? '—'}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Comercios activos
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {lifecycle.activeTenantsCount ?? 0}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Comercios suspendidos
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {lifecycle.suspendedTenantsCount ?? 0}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Bajas (aprox., este período)
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {lifecycle.deletedInPeriodApprox ?? '—'}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2, borderRadius: 3, minWidth: 180 }} variant="outlined">
          <Typography variant="caption" color="text.secondary">
            Con suscripción activa
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            {lifecycle.activeSubscriptionCount ?? 0}
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
              {/* El margen en pesos no dice si el comercio es rentable: uno que
                  deja $8.000 sobre un plan de $10.000 y otro que deja lo mismo
                  sobre uno de $40.000 son negocios distintos y en la columna de
                  pesos se ven idénticos. */}
              <TableCell align="right">%</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map(tenant => (
              <TableRow
                key={tenant.tenantId}
                // La fila que cuesta más de lo que paga es la única sobre la
                // que hay que hacer algo. Sin marcarla se pierde entre las
                // demás: en una lista larga, un negativo es una celda más.
                sx={
                  tenant.unprofitable
                    ? {
                        bgcolor: 'error.light',
                        '& td': { color: 'error.contrastText' },
                      }
                    : undefined
                }
              >
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
                  {formatArs(tenant.planPriceArs)}
                </TableCell>
                <TableCell align="right">
                  {formatArs(tenant.aiCostArs)}
                </TableCell>
                <TableCell align="right">
                  {formatArs(tenant.communicationsCostArs)}
                </TableCell>
                <TableCell align="right">
                  {formatArs(tenant.estimatedMarginArs)}
                </TableCell>
                <TableCell align="right">
                  {/* null = el plan no tiene precio cargado. Sin ingreso no hay
                      porcentaje, y un cero ahí se leería como "no deja nada". */}
                  {tenant.marginPercent === null ||
                  tenant.marginPercent === undefined
                    ? '—'
                    : `${tenant.marginPercent}%`}
                </TableCell>
              </TableRow>
            ))}
            {!tenants.length && (
              <TableRow>
                <TableCell
                  colSpan={8}
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
