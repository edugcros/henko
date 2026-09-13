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
  applyRecommendedPrice,
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

// Cada señal, con lo que significa en plata y qué se puede hacer. Eran
// etiquetas sueltas: "Stock sin rotar" no le dice a nadie qué hacer con eso.
const FLAG_LABEL = {
  margin_below_min: {
    text: 'Margen bajo el mínimo',
    color: 'error',
    detail:
      'Cada venta deja menos de lo que definiste como piso. O sube el precio, o baja el costo, o el producto trabaja para cubrir gastos.',
  },
  margin_below_target: {
    text: 'Margen bajo el objetivo',
    color: 'warning',
    detail:
      'Deja ganancia, pero menos de la que apuntabas. Suele pasar cuando el costo subió y el precio quedó quieto.',
  },
  no_cost: {
    text: 'Sin costo cargado',
    color: 'error',
    detail:
      'No se puede calcular cuánto ganás con este producto. Cargá el costo unitario en la ficha y todo lo demás se calcula solo.',
  },
  stock_stuck: {
    text: 'Stock sin rotar',
    color: 'warning',
    detail:
      'Al ritmo de venta actual, este stock tarda demasiado en salir. Es plata quieta en el depósito: un precio más bajo puede convenir más que el margen que estás defendiendo.',
  },
  stock_critical: {
    text: 'Dejó de vender con stock',
    color: 'error',
    detail:
      'Vendía y se frenó, y todavía hay unidades. Algo cambió: el precio, un competidor, o la ficha del producto.',
  },
  demand_falling: {
    text: 'Demanda en baja',
    color: 'warning',
    detail:
      'Se vende bastante menos que el mes pasado. Antes de tocar el precio conviene mirar si es estacional.',
  },
  demand_rising: {
    text: 'Demanda en alza',
    color: 'success',
    detail:
      'Se vende más que el mes pasado. Es la señal que habilita subir sin resignar volumen.',
  },
  cost_increased: {
    text: 'Subió el costo',
    color: 'warning',
    detail:
      'El costo subió desde la última vez que tocaste el precio, así que el margen se achicó sin que lo decidieras.',
  },
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
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null)
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
      setApplyResult(null)

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

  // Aplica el precio que la política dejó. Vuelve a pedir los indicadores
  // después, para que lo que quede en pantalla sea el estado nuevo del
  // producto y no el de antes del cambio.
  const applyPrice = useCallback(async () => {
    const decision = result?.decision

    if (!selected?._id || !decision?.finalPrice) return

    setApplying(true)
    setError(null)

    try {
      const res = await applyRecommendedPrice({
        productId: selected._id,
        price: decision.finalPrice,
        reason: result?.recommendation?.reason || '',
      })

      // Primero se recalcula y recién después se deja la confirmación:
      // analyze() limpia el resultado anterior, así que al revés se borraría
      // el mensaje que le acaba de decir al comerciante qué cambió.
      await analyze(false)
      setApplyResult(res?.data || null)
    } catch (err) {
      setError(err?.response?.data?.message || 'No se pudo aplicar el precio.')
    } finally {
      setApplying(false)
    }
  }, [analyze, result, selected])

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

  // El análisis puede terminar en "no lo toques", y eso es un resultado
  // válido: no es lo mismo que una recomendación de cambio que no se puede
  // aplicar.
  const sinCambio =
    decision != null && Number(decision.finalPrice) === Number(signals?.price)

  // ------------------------------------------------------------------
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>
          Pricing Intelligence
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Te dice si el precio de un producto está donde tiene que estar, y por
          qué. Nunca cambia un precio solo: te muestra el número y lo aplicás
          vos.
        </Typography>

        {/*
          Cuatro pasos, numerados porque son una secuencia real: cada uno solo
          corre si el anterior dio algo. La pantalla se entendía solo sabiendo
          cómo está construida por dentro.
        */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Cómo funciona
          </Typography>
          <Stack component="ol" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
            {[
              'Elegís un producto y HENKO mira sus números: costo, margen, cuánto vendió en 30 días contra los 30 anteriores, cuánto stock le queda y si el costo se movió desde el último cambio de precio. Esto no gasta consumo de IA.',
              'Si algo de eso está fuera de lugar, aparece como una señal con su explicación. Si está todo bien, la pantalla te lo dice y no se analiza nada más.',
              'Solo cuando hay una señal que se puede razonar, la IA propone un precio y explica el motivo.',
              'Tu política —la de abajo— recorta esa propuesta: margen mínimo, variación máxima, piso y techo. Recién ahí aparece el botón para aplicarla, y el cambio queda en el historial del producto.',
            ].map(paso => (
              <Typography
                component="li"
                variant="body2"
                color="text.secondary"
                key={paso}
              >
                {paso}
              </Typography>
            ))}
          </Stack>
        </Paper>
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
              setApplyResult(null)
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
                  value={signals.demand?.unitsLast30}
                />
                <Row
                  label="30 días previos"
                  value={signals.demand?.unitsPrior30}
                />
                <Row
                  label="Variación"
                  value={percent(signals.demand?.changePercent)}
                />
                <Row
                  label="Cobertura de stock"
                  value={
                    signals.demand?.stockCoverageDays !== null
                      ? `${signals.demand?.stockCoverageDays} días`
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
              <Stack spacing={1.25} sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Qué encontramos en este producto
                </Typography>
                {flags.map(flag => {
                  const meta = FLAG_LABEL[flag] || {
                    text: flag,
                    color: 'default',
                  }

                  return (
                    <Stack
                      key={flag}
                      direction="row"
                      spacing={1.25}
                      sx={{ alignItems: 'flex-start' }}
                    >
                      <Chip
                        label={meta.text}
                        color={meta.color}
                        size="small"
                        sx={{ mt: 0.25, flexShrink: 0 }}
                      />
                      {meta.detail && (
                        <Typography variant="body2" color="text.secondary">
                          {meta.detail}
                        </Typography>
                      )}
                    </Stack>
                  )
                })}
              </Stack>
            )}

            <Divider sx={{ my: 3 }} />

            {/* Recomendación */}
            {/*
              Sin análisis, "Analizar igual" está SIEMPRE. Antes aparecía solo
              cuando había señales: en un producto sano la pantalla terminaba
              en un cartel verde y no había forma de pedir la recomendación,
              aunque el backend acepta force. Quien quería una segunda opinión
              sobre un precio se quedaba sin nada que tocar.
            */}
            {!result?.analyzed && !result?.blocked && (
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ alignItems: { sm: 'center' } }}
              >
                <Alert
                  severity={flags.length > 0 ? 'info' : 'success'}
                  sx={{ flex: 1 }}
                >
                  {flags.length > 0
                    ? 'Hay señales, pero no se ejecutó el análisis de IA.'
                    : 'Nada que corregir: los indicadores están dentro de lo que definiste, así que no se gastó consumo de IA.'}
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
                    {sinCambio
                      ? money(signals.price)
                      : `${money(decision.currentPrice ?? signals.price)} → ${money(decision.finalPrice)}`}
                  </Typography>

                  <Chip
                    label={
                      sinCambio
                        ? 'dejar como está'
                        : `${decision.changePercent > 0 ? '+' : ''}${percent(decision.changePercent, 2)}`
                    }
                    color={
                      sinCambio
                        ? 'default'
                        : decision.changePercent > 0
                          ? 'success'
                          : 'warning'
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
                ) : sinCambio ? (
                  // Recomendar el precio que ya tiene no es un cambio que se
                  // "aplica": antes salía un botón apagado debajo de un texto
                  // que prometía cambiarlo.
                  <Alert severity="success">
                    Te conviene dejar el precio como está. El análisis no
                    encontró motivo para moverlo.
                  </Alert>
                ) : (
                  <Stack spacing={1.5}>
                    <Alert
                      severity={decision.requiresApproval ? 'info' : 'success'}
                    >
                      {decision.requiresApproval
                        ? 'Este cambio está fuera de lo que tu política aplica sin revisar: mirá el número antes de confirmarlo.'
                        : 'Este cambio entra dentro de lo que tu política permite aplicar sin vueltas.'}
                    </Alert>

                    {/*
                      El botón que faltaba. El motor recomendaba y no había
                      forma de ejecutar la recomendación: había que ir a Editar
                      producto y tipear el número a mano, perdiendo el rastro
                      de que salió de acá.
                    */}
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      sx={{ alignItems: { sm: 'center' } }}
                    >
                      <Button
                        variant="contained"
                        onClick={applyPrice}
                        disabled={
                          applying || decision.finalPrice === signals?.price
                        }
                      >
                        {applying
                          ? 'Aplicando…'
                          : `Aplicar ${money(decision.finalPrice)}`}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        Cambia el precio del producto ahora y queda registrado
                        en su historial como cambio sugerido por HENKO.
                      </Typography>
                    </Stack>

                    {applyResult && (
                      <Alert severity="success">
                        Precio actualizado: de{' '}
                        {money(applyResult.previousPrice)} a{' '}
                        {money(applyResult.newPrice)}
                        {applyResult.variantsUpdated > 0
                          ? ` (y ${applyResult.variantsUpdated} variantes en la misma proporción)`
                          : ''}
                        .
                      </Alert>
                    )}
                  </Stack>
                )}
              </Box>
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
