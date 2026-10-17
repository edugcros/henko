// 📁 src/pages/PlatformMarginPage.jsx
//
// Margen de HENKO por comercio (Bloque 6 lo calcula, Bloque 8A le da
// pantalla). Sin entrada en el menú lateral a propósito — el gate real es
// server-side (requirePlatformOwner), esta pantalla solo maneja el 403 con
// un mensaje claro en vez de un error sin manejar.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { getPlatformMarginReport } from '../services/platformService'
import { PLAN_PRESENTATION } from '../constants/plans'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  danger: '#b42318',
  dangerSoft: '#fdeceb',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// El reporte está en pesos: HENKO cobra en pesos, y convertir el precio a
// dólares para emparejarlo con los costos era lo que hacía que el margen se
// corriera solo cada vez que se movía el cambio. Ahora se convierten los
// COSTOS, que sí llegan en dólares, y el tipo de cambio usado viene en la
// respuesta.
export const formatArs = (value, sinDato = '—') => {
  if (value === null || value === undefined) return sinDato

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

// Un plan sin precio no es «a medida»: es un plan al que el dueño todavía no le
// cargó el precio en el panel, y mientras esté así no se puede contratar.
const formatPlanPrice = value => formatArs(value, 'Sin precio cargado')

const STATUS_LABELS = {
  active: { label: 'Activo', color: 'success' },
  suspended: { label: 'Suspendido', color: 'warning' },
}

const planName = plan => {
  if (PLAN_PRESENTATION[plan]?.name) return PLAN_PRESENTATION[plan].name

  const clean = String(plan || '')

  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : '—'
}

/** 'YYYY-MM' (el formato del servidor) → «Octubre de 2026». Lo que no se puede leer, tal cual. */
export const formatPeriod = period => {
  const [year, month] = String(period || '')
    .split('-')
    .map(Number)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period || '—'
  }

  const text = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Los últimos 12 meses, del actual hacia atrás, como 'YYYY-MM'. */
export const buildPeriodOptions = (now = new Date(), count = 12) =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 15))
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

    return { value, label: formatPeriod(value) }
  })

const Tile = ({ title, value, hint, tone = 'default', big = false }) => (
  <Box sx={{ p: 2, minWidth: 0 }}>
    <Typography
      component="span"
      variant="caption"
      sx={{
        display: 'block',
        color: tone === 'danger' ? BRAND.danger : BRAND.muted,
        fontWeight: 700,
        letterSpacing: '0.04em',
      }}
    >
      {title}
    </Typography>
    <Typography
      component="div"
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: big ? { xs: 22, md: 26 } : { xs: 18, md: 20 },
        lineHeight: 1.25,
        color: tone === 'danger' ? BRAND.danger : BRAND.ink,
        fontVariantNumeric: 'tabular-nums',
        overflowWrap: 'anywhere',
      }}
    >
      {value}
    </Typography>
    {hint && (
      <Typography variant="caption" sx={{ color: BRAND.muted }}>
        {hint}
      </Typography>
    )}
  </Box>
)

const Section = ({ title, children }) => (
  <Box component="section" sx={{ mb: 4 }}>
    <Typography
      component="h2"
      sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, mb: 1.5 }}
    >
      {title}
    </Typography>
    {children}
  </Box>
)

const MarginCell = ({ tenant }) => (
  <Typography
    component="span"
    sx={{
      fontSize: 'inherit',
      fontWeight: tenant.unprofitable ? 800 : 500,
      color: tenant.unprofitable ? BRAND.danger : 'inherit',
      fontVariantNumeric: 'tabular-nums',
    }}
  >
    {formatArs(tenant.estimatedMarginArs)}
  </Typography>
)

const percentText = tenant =>
  // null = el plan no tiene precio cargado. Sin ingreso no hay porcentaje, y un
  // cero ahí se leería como "no deja nada".
  tenant.marginPercent === null || tenant.marginPercent === undefined
    ? '—'
    : `${tenant.marginPercent}%`

const TenantCard = ({ tenant }) => {
  const status = STATUS_LABELS[tenant.status]

  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{
        ...PANEL_SX,
        p: 2,
        ...(tenant.unprofitable ? { borderColor: BRAND.danger, bgcolor: BRAND.dangerSoft } : null),
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{tenant.name}</Typography>
          <Typography variant="caption" sx={{ color: BRAND.muted }}>
            {planName(tenant.plan)}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={status?.label || tenant.status}
          color={status?.color || 'default'}
          sx={{ flexShrink: 0 }}
        />
      </Box>

      <Typography
        component="dl"
        variant="body2"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: 2,
          rowGap: 0.5,
          '& dt': { color: BRAND.muted, fontSize: 13 },
          '& dd': { m: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
        }}
      >
        <dt>Precio del plan</dt>
        <dd>{formatPlanPrice(tenant.planPriceArs)}</dd>
        <dt>Costo de IA</dt>
        <dd>{formatArs(tenant.aiCostArs)}</dd>
        <dt>Comunicaciones</dt>
        <dd>{formatArs(tenant.communicationsCostArs)}</dd>
        <dt>Margen estimado</dt>
        <dd>
          {tenant.estimatedMarginArs === null || tenant.estimatedMarginArs === undefined ? (
            '—'
          ) : (
            <>
              <MarginCell tenant={tenant} /> · {percentText(tenant)}
            </>
          )}
        </dd>
      </Typography>
    </Paper>
  )
}

export default function PlatformMarginPage() {
  const isNarrow = useMediaQuery('(max-width:600px)')
  const baseOptions = useMemo(() => buildPeriodOptions(), [])

  const [period, setPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [onlyLosing, setOnlyLosing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError('')
      setForbidden(false)

      try {
        // Sin período pide el mes actual (el servidor lo resuelve).
        const data = period
          ? await getPlatformMarginReport(period)
          : await getPlatformMarginReport()
        if (!cancelled) setReport(data)
      } catch (err) {
        if (cancelled) return

        if (err?.response?.status === 403) {
          setForbidden(true)
        } else {
          setError(err?.response?.data?.message || 'No se pudo cargar el reporte de margen.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [period, reloadKey])

  const retry = useCallback(() => setReloadKey(key => key + 1), [])

  if (loading && !report) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 10 }}>
        <CircularProgress />
        <Typography color="text.secondary">Cargando el reporte de margen…</Typography>
      </Box>
    )
  }

  if (forbidden) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8, px: 2 }}>
        <Alert severity="warning">No tenés acceso a este reporte.</Alert>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8, px: 2 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retry}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    )
  }

  const tenants = report?.tenants || []
  const totals = report?.totals || {}
  const lifecycle = report?.lifecycle || {}
  const notes = report?.notes || []
  const losingCount = totals.unprofitableCount || 0
  const visibleTenants = onlyLosing ? tenants.filter(tenant => tenant.unprofitable) : tenants
  const marginIsNegative = Number(totals.totalEstimatedMarginArs) < 0
  // Si el servidor devuelve un mes fuera de los últimos doce, igual tiene que poder elegirse.
  const periodOptions =
    report?.period && !baseOptions.some(option => option.value === report.period)
      ? [...baseOptions, { value: report.period, label: formatPeriod(report.period) }]
      : baseOptions

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
      <Box
        component="header"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'flex-end' },
          gap: 2,
          mb: 4,
        }}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
          >
            PLATAFORMA
          </Typography>
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
            Margen de HENKO por comercio
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Período: {formatPeriod(report?.period)}
            {totals.usdToArsRate
              ? ` · costos en dólares pasados a pesos a ${formatArs(totals.usdToArsRate)} por dólar`
              : ''}
          </Typography>
        </Box>

        <FormControl size="small" sx={{ minWidth: { sm: 220 } }}>
          <InputLabel id="margen-periodo-label">Período</InputLabel>
          <Select
            labelId="margen-periodo-label"
            label="Período"
            value={period || report?.period || ''}
            onChange={event => setPeriod(event.target.value)}
          >
            {periodOptions.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {loading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      <Paper
        component="section"
        aria-label="Totales del período"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              md: 'repeat(3, 1fr)',
              lg: 'repeat(6, 1fr)',
            },
          }}
        >
          <Tile title="Comercios" value={totals.tenantCount ?? 0} />
          <Tile title="Ingreso por planes" value={formatArs(totals.totalPlanRevenueArs)} />
          <Tile title="Costo de IA" value={formatArs(totals.totalAiCostArs)} />
          <Tile title="Comunicaciones" value={formatArs(totals.totalCommunicationsCostArs)} />
          <Tile
            title="Infra + storage (plataforma)"
            value={formatArs((totals.infraCostArs || 0) + (totals.storageCostArs || 0))}
          />
          <Tile
            title="Margen estimado"
            value={formatArs(totals.totalEstimatedMarginArs)}
            tone={marginIsNegative ? 'danger' : 'default'}
            big
          />
        </Box>
      </Paper>

      {/* Cuántos cuestan más de lo que pagan. Es la primera pregunta al abrir
          esta pantalla, y contarlos a ojo sobre la tabla no escala. Solo
          aparece cuando hay alguno: un cero permanente es ruido. */}
      {losingCount > 0 && (
        <Paper
          variant="outlined"
          role="alert"
          sx={{
            ...PANEL_SX,
            mb: 3,
            borderColor: BRAND.danger,
            bgcolor: BRAND.dangerSoft,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { sm: 'center' },
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Tile
            title="Pierden plata"
            value={losingCount}
            tone="danger"
            hint={`${formatArs(totals.unprofitableLossArs)} en total`}
          />
          <Box sx={{ px: 2, pb: { xs: 2, sm: 0 } }}>
            <Button
              variant={onlyLosing ? 'contained' : 'outlined'}
              color="error"
              onClick={() => setOnlyLosing(value => !value)}
              aria-pressed={onlyLosing}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 3 }}
            >
              {onlyLosing ? 'Ver todos los comercios' : 'Ver solo los que pierden plata'}
            </Button>
          </Box>
        </Paper>
      )}

      <Section title="Ciclo de vida de comercios">
        <Paper variant="outlined" sx={{ ...PANEL_SX, overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' },
            }}
          >
            <Tile title="Altas este período" value={lifecycle.newTenantsInPeriod ?? '—'} />
            <Tile title="Comercios activos" value={lifecycle.activeTenantsCount ?? 0} />
            <Tile title="Comercios suspendidos" value={lifecycle.suspendedTenantsCount ?? 0} />
            <Tile
              title="Bajas (aprox., este período)"
              value={lifecycle.deletedInPeriodApprox ?? '—'}
            />
            <Tile title="Con suscripción activa" value={lifecycle.activeSubscriptionCount ?? 0} />
          </Box>
        </Paper>
      </Section>

      <Section title="Por comercio">
        {isNarrow ? (
          visibleTenants.length ? (
            <Stack spacing={1.5}>
              {visibleTenants.map(tenant => (
                <TenantCard key={tenant.tenantId} tenant={tenant} />
              ))}
            </Stack>
          ) : (
            <Paper variant="outlined" sx={{ ...PANEL_SX, p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">Sin datos para este período.</Typography>
            </Paper>
          )
        ) : (
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ ...PANEL_SX, overflowX: 'auto' }}
          >
            <Table size="small" sx={{ minWidth: 860 }}>
              <TableHead>
                <TableRow>
                  {[
                    ['Comercio', 'left'],
                    ['Plan', 'left'],
                    ['Estado', 'left'],
                    ['Precio del plan', 'right'],
                    ['Costo de IA', 'right'],
                    ['Comunicaciones', 'right'],
                    ['Margen estimado', 'right'],
                    // El margen en pesos no dice si el comercio es rentable: uno que
                    // deja $8.000 sobre un plan de $10.000 y otro que deja lo mismo
                    // sobre uno de $40.000 son negocios distintos y en la columna de
                    // pesos se ven idénticos.
                    ['%', 'right'],
                  ].map(([label, align]) => (
                    <TableCell
                      key={label}
                      align={align}
                      sx={{
                        fontWeight: 700,
                        color: BRAND.muted,
                        fontSize: '0.75rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        bgcolor: BRAND.paper,
                        borderColor: BRAND.line,
                      }}
                    >
                      {label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleTenants.map(tenant => {
                  const status = STATUS_LABELS[tenant.status]

                  return (
                    <TableRow
                      key={tenant.tenantId}
                      // La fila que cuesta más de lo que paga es la única sobre la
                      // que hay que hacer algo. Sin marcarla se pierde entre las
                      // demás: en una lista larga, un negativo es una celda más.
                      sx={tenant.unprofitable ? { bgcolor: BRAND.dangerSoft } : undefined}
                    >
                      <TableCell sx={{ fontWeight: 600 }}>{tenant.name}</TableCell>
                      <TableCell>{planName(tenant.plan)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={status?.label || tenant.status}
                          color={status?.color || 'default'}
                        />
                      </TableCell>
                      <TableCell align="right">{formatPlanPrice(tenant.planPriceArs)}</TableCell>
                      <TableCell align="right">{formatArs(tenant.aiCostArs)}</TableCell>
                      <TableCell align="right">{formatArs(tenant.communicationsCostArs)}</TableCell>
                      <TableCell align="right">
                        <MarginCell tenant={tenant} />
                      </TableCell>
                      <TableCell align="right">{percentText(tenant)}</TableCell>
                    </TableRow>
                  )
                })}
                {!visibleTenants.length && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      Sin datos para este período.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      {notes.length > 0 && (
        <Section title="Cómo se calcula">
          <Stack spacing={1}>
            {notes.map(note => (
              <Alert key={note} severity="info" sx={{ borderRadius: 3 }}>
                {note}
              </Alert>
            ))}
          </Stack>
        </Section>
      )}
    </Box>
  )
}
