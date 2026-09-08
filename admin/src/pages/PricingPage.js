// 📁 src/pages/PricingPage.js
//
// Pricing Intelligence.
//
// Sintaxis MUI v6+: Grid v2 (sin prop `item`, con `size={{...}}`), igual que
// MarketIntelligencePage.
//
// Dos cosas que esta pantalla muestra a propósito y no son decorativas:
//
//   - De dónde salió cada costo. Un margen calculado sobre una comisión medida
//     en 40 ventas reales y uno sobre un porcentaje tipeado a ojo no valen lo
//     mismo, y el comerciante decide un precio con eso.
//
//   - Qué recortó la política. Si la IA propuso bajar 15% y el tope lo dejó en
//     10%, eso se ve. Una recomendación que llegó recortada y una que pasó
//     entera son distintas.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

import productService from '../features/product/productService'
import {
  getPricingPolicy,
  recommendPrice,
  updatePricingPolicy,
} from '../utils/pricingApi'

const PRODUCT_OPTIONS_LIMIT = 20

const STRATEGIES = [
  { value: 'margin', label: 'Proteger margen' },
  { value: 'rotation', label: 'Priorizar rotación' },
  { value: 'liquidate', label: 'Liquidar stock' },
  { value: 'revenue', label: 'Maximizar facturación' },
  { value: 'competitive', label: 'Defender precio competitivo' },
]

const MODES = [
  { value: 'manual', label: 'Manual — solo sugiere' },
  { value: 'semi', label: 'Semiautomático — aplica cambios chicos' },
  { value: 'autopilot', label: 'Automático — aplica dentro de la política' },
]

const FLAG_LABEL = {
  margin_below_min: { text: 'Margen bajo el mínimo', color: 'error' },
  margin_below_target: { text: 'Margen bajo el objetivo', color: 'warning' },
  no_cost: { text: 'Sin costo cargado', color: 'error' },
  stock_stuck: { text: 'Stock sin rotar', color: 'warning' },
  stock_critical: { text: 'Dejó de vender con stock', color: 'error' },
  demand_falling: { text: 'Demanda en baja', color: 'warning' },
  demand_rising: { text: 'Demanda en alza', color: 'success' },
  cost_increased: { text: 'Subió el costo', color: 'warning' },
}

const ADJUSTMENT_LABEL = {
  clamped_by_max_change: 'recortado por el tope de variación',
  raised_by_min_margin: 'subido para respetar el margen mínimo',
  clamped_by_floor: 'limitado por el precio mínimo',
  clamped_by_ceiling: 'limitado por el precio máximo',
  rounded: 'redondeado',
  rejected_impossible_margin:
    'rechazado: ningún precio alcanza el margen mínimo',
}

const SOURCE_LABEL = {
  measured: { text: 'medido', color: 'success' },
  stored: { text: 'de la ficha', color: 'info' },
  override: { text: 'ingresado', color: 'default' },
  missing: { text: 'sin dato', color: 'warning' },
}

const money = value =>
  Number.isFinite(Number(value))
    ? `$${Math.round(Number(value)).toLocaleString('es-AR')}`
    : '—'

const percent = (value, decimals = 1) =>
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(decimals)}%` : '—'

/** Fila etiqueta/valor, con una marca opcional de procedencia del dato. */
const Row = ({ label, value, source, emphasis = false }) => {
  const chip = source ? SOURCE_LABEL[source] : null

  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="baseline"
      sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {chip && (
          <Chip
            size="small"
            label={chip.text}
            color={chip.color}
            variant="outlined"
            sx={{ height: 18, fontSize: 11 }}
          />
        )}
      </Stack>
      <Typography
        variant={emphasis ? 'subtitle1' : 'body2'}
        fontWeight={emphasis ? 700 : 500}
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Stack>
  )
}

const PricingPage = () => {
  // --- política ---
  const [policy, setPolicy] = useState(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyMessage, setPolicyMessage] = useState(null)

  // --- análisis ---
  const [productOptions, setProductOptions] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [result, setResult] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)

  const requestSeq = useRef(0)

  // ------------------------------------------------------------------
  useEffect(() => {
    let active = true

    getPricingPolicy()
      .then(res => {
        if (active) setPolicy(res?.data || null)
      })
      .catch(() => {
        if (active)
          setPolicyMessage({
            severity: 'error',
            text: 'No se pudo cargar la política.',
          })
      })
      .finally(() => {
        if (active) setPolicyLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const loadProducts = useCallback(async query => {
    const seq = ++requestSeq.current
    setOptionsLoading(true)

    try {
      const response = await productService.getAdminProducts({
        q: query || undefined,
        limit: PRODUCT_OPTIONS_LIMIT,
        page: 1,
      })

      // Se descartan respuestas viejas: una petición lenta lanzada antes no
      // debe pisar los resultados de la tecla más reciente.
      if (seq !== requestSeq.current) return

      const rows = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : []

      setProductOptions(rows)
    } catch {
      // El desplegable es una ayuda, no el único camino: si el catálogo no
      // carga, el resto de la pantalla sigue funcionando.
      setProductOptions([])
    } finally {
      if (seq === requestSeq.current) setOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProducts('')
  }, [loadProducts])

  const analyze = useCallback(
    async (force = false) => {
      if (!selected?._id) return

      setAnalyzing(true)
      setError(null)

      try {
        const res = await recommendPrice({ productId: selected._id, force })
        setResult(res?.data || null)
      } catch (err) {
        const status = err?.response?.status
        setError(
          status === 429
            ? err?.response?.data?.message ||
                'Se agotó la cuota de análisis de este mes.'
            : err?.response?.data?.message ||
                'No se pudo analizar el producto.',
        )
        // Con cuota agotada el backend igual manda los indicadores: valen sin
        // la explicación de la IA.
        setResult(err?.response?.data?.data || null)
      } finally {
        setAnalyzing(false)
      }
    },
    [selected],
  )

  const savePolicy = useCallback(async () => {
    if (!policy) return

    setPolicySaving(true)
    setPolicyMessage(null)

    try {
      const res = await updatePricingPolicy(policy)
      setPolicy(res?.data || policy)
      setPolicyMessage({ severity: 'success', text: 'Política guardada.' })
    } catch (err) {
      setPolicyMessage({
        severity: 'error',
        text: err?.response?.data?.message || 'No se pudo guardar la política.',
      })
    } finally {
      setPolicySaving(false)
    }
  }, [policy])

  const setField = (key, value) =>
    setPolicy(prev => ({ ...prev, [key]: value }))

  const signals = result?.signals || null
  const decision = result?.decision || null

  const flags = useMemo(() => signals?.flags || [], [signals])

  // ------------------------------------------------------------------
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>
          Pricing Intelligence
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Los indicadores se calculan sin costo. La IA solo analiza los
          productos que muestran alguna señal, y nunca fija un precio por sí
          sola: propone, y tu política decide si es aplicable.
        </Typography>
      </Stack>

      {/* ── Análisis ────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          Analizar un producto
        </Typography>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems="stretch"
        >
          <Autocomplete
            sx={{ flex: 1 }}
            options={productOptions}
            loading={optionsLoading}
            value={selected}
            onChange={(_, value) => {
              setSelected(value)
              setResult(null)
              setError(null)
            }}
            onInputChange={(_, value, reason) => {
              if (reason === 'input') loadProducts(value)
            }}
            getOptionLabel={option => option?.title || ''}
            isOptionEqualToValue={(option, value) => option?._id === value?._id}
            renderInput={params => (
              <TextField
                {...params}
                label="Producto"
                placeholder="Buscá por nombre"
                // MUI v9 entrega params.slotProps, no params.InputProps. Leer
                // params.InputProps.endAdornment rompía el render con un
                // TypeError sobre undefined. Mismo patrón que
                // MarketIntelligencePage, con optional chaining en cada nivel.
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...(params.slotProps?.input || {}),
                    endAdornment: (
                      <>
                        {optionsLoading && (
                          <CircularProgress size={18} sx={{ mr: 1 }} />
                        )}
                        {params.slotProps?.input?.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />

          <Button
            variant="contained"
            size="large"
            disabled={!selected || analyzing}
            onClick={() => analyze(false)}
            sx={{ minWidth: 160 }}
          >
            {analyzing ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              'Analizar'
            )}
          </Button>
        </Stack>

        {error && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {/* ── Resultado ─────────────────────────────── */}
        {signals && (
          <Box sx={{ mt: 3 }}>
            <Grid container spacing={3}>
              {/* Costo y margen */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  COSTO Y MARGEN
                </Typography>

                <Row
                  label="Precio actual"
                  value={money(signals.price)}
                  emphasis
                />

                {signals.cost ? (
                  <>
                    <Row
                      label="Costo unitario"
                      value={money(signals.cost.unitCost)}
                      source={signals.cost.sources?.unitCost}
                    />
                    <Row
                      label="Costo total por unidad"
                      value={money(signals.cost.totalUnitCost)}
                    />
                    <Row
                      label="Comisiones e impuestos"
                      value={percent((signals.cost.deductionRate || 0) * 100)}
                      source={signals.cost.sources?.paymentFeePercent}
                    />
                    <Row
                      label="Precio de equilibrio"
                      value={money(signals.cost.breakEvenPrice)}
                    />
                    <Row
                      label="Margen actual"
                      value={percent(signals.marginPercent)}
                      emphasis
                    />
                  </>
                ) : (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Este producto no tiene costo cargado, así que no se puede
                    calcular su margen. Cargalo en la ficha del producto.
                  </Alert>
                )}
              </Grid>

              {/* Demanda */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  DEMANDA Y STOCK
                </Typography>

                <Row label="Stock" value={`${signals.stock} unidades`} />
                <Row
                  label="Vendidas (30 días)"
                  value={signals.demand.unitsLast30}
                />
                <Row
                  label="30 días previos"
                  value={signals.demand.unitsPrior30}
                />
                <Row
                  label="Variación"
                  value={percent(signals.demand.changePercent)}
                />
                <Row
                  label="Cobertura de stock"
                  value={
                    signals.demand.stockCoverageDays !== null
                      ? `${signals.demand.stockCoverageDays} días`
                      : 'sin ventas en el período'
                  }
                />
                {signals.costChangePercent !== null && (
                  <Row
                    label="Costo desde el último cambio"
                    value={percent(signals.costChangePercent)}
                  />
                )}
              </Grid>
            </Grid>

            {flags.length > 0 && (
              <Stack
                direction="row"
                spacing={1}
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 2 }}
              >
                {flags.map(flag => {
                  const meta = FLAG_LABEL[flag] || {
                    text: flag,
                    color: 'default',
                  }
                  return (
                    <Chip
                      key={flag}
                      label={meta.text}
                      color={meta.color}
                      size="small"
                    />
                  )
                })}
              </Stack>
            )}

            <Divider sx={{ my: 3 }} />

            {/* Recomendación */}
            {!result?.analyzed && !result?.blocked && (
              <Alert severity="success">
                Sin señales que ameriten revisar el precio. No se gastó consumo
                de IA.
              </Alert>
            )}

            {result?.analyzed && decision && (
              <Box>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{ mb: 1.5 }}
                >
                  RECOMENDACIÓN
                </Typography>

                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  // alignItems responsive va por sx: como prop suelto, Stack lo
                  // reenvía al DOM y React avisa que no lo conoce.
                  sx={{ mb: 2, alignItems: { sm: 'center' } }}
                >
                  <Typography variant="h5" fontWeight={700}>
                    {money(decision.currentPrice ?? signals.price)} →{' '}
                    {money(decision.finalPrice)}
                  </Typography>

                  <Chip
                    label={`${decision.changePercent > 0 ? '+' : ''}${percent(decision.changePercent, 2)}`}
                    color={
                      decision.changePercent > 0
                        ? 'success'
                        : decision.changePercent < 0
                          ? 'warning'
                          : 'default'
                    }
                  />

                  {result.recommendation?.confidence !== null &&
                    result.recommendation?.confidence !== undefined && (
                      <Tooltip title="Confianza que declaró el modelo en su propia recomendación">
                        <Chip
                          variant="outlined"
                          size="small"
                          label={`confianza ${Math.round(result.recommendation.confidence * 100)}%`}
                        />
                      </Tooltip>
                    )}
                </Stack>

                {result.recommendation?.reason && (
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {result.recommendation.reason}
                  </Typography>
                )}

                {/* Lo que la política recortó. Es la diferencia entre una
                    recomendación que pasó entera y una que llegó ajustada. */}
                {decision.adjustments?.length > 0 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ mb: 0.5 }}
                    >
                      Tu política ajustó la propuesta de la IA
                    </Typography>
                    <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
                      {decision.adjustments.map(a => (
                        <Typography component="li" variant="body2" key={a}>
                          {ADJUSTMENT_LABEL[a] || a}
                        </Typography>
                      ))}
                    </Stack>
                    {result.recommendation?.recommendedPrice !==
                      decision.finalPrice && (
                      <Typography variant="caption" color="text.secondary">
                        La IA había propuesto{' '}
                        {money(result.recommendation?.recommendedPrice)}.
                      </Typography>
                    )}
                  </Alert>
                )}

                {decision.allowed === false ? (
                  <Alert severity="error">{decision.reason}</Alert>
                ) : (
                  <Alert
                    severity={decision.requiresApproval ? 'info' : 'success'}
                  >
                    {decision.requiresApproval
                      ? 'Este cambio necesita tu aprobación antes de aplicarse.'
                      : 'Tu política permite aplicar este cambio automáticamente.'}
                  </Alert>
                )}
              </Box>
            )}

            {!result?.analyzed && flags.length > 0 && !result?.blocked && (
              <Stack direction="row" spacing={2} alignItems="center">
                <Alert severity="info" sx={{ flex: 1 }}>
                  Hay señales pero no se ejecutó el análisis de IA.
                </Alert>
                <Button
                  variant="outlined"
                  onClick={() => analyze(true)}
                  disabled={analyzing}
                >
                  Analizar igual
                </Button>
              </Stack>
            )}
          </Box>
        )}
      </Paper>

      {/* ── Política ────────────────────────────────────── */}
      {/* Accordion sin component={Paper}: su raíz YA es un Paper, y pasarle
          Paper como componente lo anida en sí mismo. Mismo tratamiento que
          MarketIntelligencePage: el borde lo pone el Paper de afuera. */}
      <Paper variant="outlined">
        <Accordion
          elevation={0}
          disableGutters
          sx={{ '&:before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack>
              <Typography variant="h6" fontWeight={600}>
                Tus reglas de precio
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Los límites que la IA no puede cruzar.
              </Typography>
            </Stack>
          </AccordionSummary>

          <AccordionDetails>
            {policyLoading ? (
              <CircularProgress size={24} />
            ) : policy ? (
              <Stack spacing={3}>
                {policy.isDefault && (
                  <Alert severity="info">
                    Todavía no configuraste nada: estos son los valores de
                    fábrica.
                  </Alert>
                )}

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      select
                      fullWidth
                      label="Estrategia"
                      value={policy.strategy || 'margin'}
                      onChange={e => setField('strategy', e.target.value)}
                    >
                      {STRATEGIES.map(s => (
                        <MenuItem key={s.value} value={s.value}>
                          {s.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Grid>

                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      select
                      fullWidth
                      label="Quién aplica los cambios"
                      value={policy.mode || 'manual'}
                      onChange={e => setField('mode', e.target.value)}
                      helperText={
                        policy.mode === 'autopilot'
                          ? 'Los precios se van a mover solos dentro de estos límites.'
                          : ' '
                      }
                    >
                      {MODES.map(m => (
                        <MenuItem key={m.value} value={m.value}>
                          {m.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Grid>

                  {[
                    [
                      'minMarginPercent',
                      'Margen mínimo (%)',
                      'Ninguna recomendación puede dejar el margen por debajo.',
                    ],
                    ['targetMarginPercent', 'Margen objetivo (%)', ' '],
                    [
                      'maxChangePercent',
                      'Variación máxima por ajuste (%)',
                      ' ',
                    ],
                    [
                      'autoApplyMaxPercent',
                      'Aplicar solo hasta (%)',
                      'Solo en modo semiautomático.',
                    ],
                  ].map(([key, label, helper]) => (
                    <Grid size={{ xs: 12, sm: 6, md: 3 }} key={key}>
                      <TextField
                        fullWidth
                        type="number"
                        label={label}
                        helperText={helper}
                        value={policy[key] ?? ''}
                        onChange={e =>
                          setField(
                            key,
                            e.target.value === '' ? '' : Number(e.target.value),
                          )
                        }
                      />
                    </Grid>
                  ))}

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Precio mínimo (opcional)"
                      value={policy.priceFloor ?? ''}
                      onChange={e =>
                        setField(
                          'priceFloor',
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      type="number"
                      label="Precio máximo (opcional)"
                      value={policy.priceCeiling ?? ''}
                      onChange={e =>
                        setField(
                          'priceCeiling',
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  </Grid>
                </Grid>

                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(policy.rounding?.enabled)}
                      onChange={e =>
                        setField('rounding', {
                          ...(policy.rounding || {}),
                          enabled: e.target.checked,
                          endings: policy.rounding?.endings?.length
                            ? policy.rounding.endings
                            : [990],
                        })
                      }
                    />
                  }
                  label="Redondear a precios terminados en 990"
                />

                {policyMessage && (
                  <Alert severity={policyMessage.severity}>
                    {policyMessage.text}
                  </Alert>
                )}

                <Box>
                  <Button
                    variant="contained"
                    onClick={savePolicy}
                    disabled={policySaving}
                  >
                    {policySaving ? (
                      <CircularProgress size={22} color="inherit" />
                    ) : (
                      'Guardar reglas'
                    )}
                  </Button>
                </Box>
              </Stack>
            ) : (
              <Alert severity="error">No se pudo cargar la política.</Alert>
            )}
          </AccordionDetails>
        </Accordion>
      </Paper>
    </Box>
  )
}

export default PricingPage
