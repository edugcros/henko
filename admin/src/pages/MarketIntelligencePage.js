// 📁 MarketIntelligencePage.js
//
// Pantalla del panel admin para el Market Intelligence Agent.
//
// Sintaxis MUI v6+: Grid v2 (sin prop `item`, con `size={{...}}`) y
// slotProps en vez de inputProps. La versión anterior usaba API de MUI v5
// y disparaba warnings de props desconocidas llegando al DOM.

import React, { useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

import { analyzeProduct } from '../utils/marketIntelligenceApi.js'

const COUNTRIES = [
  { code: 'AR', label: 'Argentina' },
  { code: 'MX', label: 'México' },
  { code: 'CL', label: 'Chile' },
  { code: 'CO', label: 'Colombia' },
  { code: 'UY', label: 'Uruguay' },
  { code: 'PE', label: 'Perú' },
  { code: 'BR', label: 'Brasil' },
]

// Las claves vienen del backend en mayúsculas (contrato de la sección 12
// del spec). Acá se traducen a lenguaje que un comerciante entienda: cada
// una dice qué significa y qué hacer, no solo un veredicto en mayúsculas.
const RECOMMENDATION = {
  RECOMENDADO: {
    label: 'Conviene avanzar',
    color: 'success',
    detail: 'Las señales indican demanda real y espacio para competir.',
  },
  'RECOMENDADO CON CONDICIONES': {
    label: 'Conviene, con reparos',
    color: 'warning',
    detail: 'Hay demanda, pero revisá competencia y margen antes de decidir.',
  },
  'NO RECOMENDADO': {
    label: 'No conviene por ahora',
    color: 'error',
    detail: 'Las señales no muestran demanda que justifique sumarlo al catálogo.',
  },
  'DATOS INSUFICIENTES': {
    label: 'Todavía no se puede saber',
    color: 'default',
    detail: 'No hay suficiente información para dar una respuesta. No significa que el producto sea malo: significa que falta evidencia.',
  },
}

const COMPONENT_LABELS = {
  demand: 'Demanda',
  trend: 'Tendencia',
  competition: 'Competencia',
  social: 'Social',
  commercial: 'Comercial',
  opportunity: 'Oportunidad',
}

// De dónde sale cada señal y qué tan dura es la evidencia. Sin esto, un
// número basado en lo que un modelo leyó buscando se ve idéntico a uno
// calculado sobre ventas reales, y no lo es.
const COMPONENT_SOURCE = {
  demand: { kind: 'observed', help: 'Estimado a partir de búsquedas y menciones encontradas en la web.' },
  trend: { kind: 'observed', help: 'Dirección del interés según lo que se encontró buscando. No es una serie histórica.' },
  competition: { kind: 'observed', help: 'Lectura del mercado basada en marcas y ofertas encontradas, no en un conteo de vendedores.' },
  social: { kind: 'observed', help: 'Menciones en redes y foros. Señal aproximada.' },
  commercial: { kind: 'mixed', help: 'Combina precios publicados con la rotación real de la categoría en tu tienda.' },
  opportunity: { kind: 'mixed', help: 'Combina quejas de compradores con datos de tu propio catálogo.' },
}

const SOURCE_MARK = { observed: '≈', mixed: '◐', measured: '' }

const POSITION_COLOR = {
  MUY_COMPETITIVO: 'success',
  COMPETITIVO: 'success',
  AJUSTADO: 'warning',
  MUY_AJUSTADO: 'warning',
  INVIABLE: 'error',
}

const POSITION_LABEL = {
  MUY_COMPETITIVO: 'Muy competitivo',
  COMPETITIVO: 'Competitivo',
  AJUSTADO: 'Ajustado',
  MUY_AJUSTADO: 'Muy ajustado',
  INVIABLE: 'Inviable',
}

const EMPTY_COSTS = {
  unitCost: '',
  shippingCost: '',
  platformFeePercent: '',
  taxPercent: '',
}

const money = (value, currency) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const formatted = Math.round(Number(value)).toLocaleString('es-AR')
  return currency ? `${currency} ${formatted}` : `$${formatted}`
}

const scoreColor = value => {
  if (value >= 75) return 'success'
  if (value >= 50) return 'warning'
  return 'error'
}

// LinearProgress determinate exige un número: null o undefined disparan un
// warning de MUI y renderizan la barra vacía sin indicación de por qué.
const safeProgressValue = value => (Number.isFinite(Number(value)) ? Number(value) : 0)

export default function MarketIntelligencePage() {
  const [product, setProduct] = useState('')
  const [country, setCountry] = useState('AR')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [costs, setCosts] = useState(EMPTY_COSTS)

  const setCost = (field, value) => setCosts(prev => ({ ...prev, [field]: value }))
  const hasCost = Number(costs.unitCost) > 0

  const handleAnalyze = async (forceRefresh = false) => {
    if (!product.trim()) return

    setLoading(true)
    setError(null)

    try {
      const response = await analyzeProduct({
        product: product.trim(),
        country,
        forceRefresh,
        // Solo se manda si hay costo unitario: el backend descarta un objeto
        // de costos sin ese campo, así que enviarlo a medias es ruido.
        costs: hasCost
          ? {
            unitCost: Number(costs.unitCost),
            shippingCost: Number(costs.shippingCost) || 0,
            platformFeePercent: Number(costs.platformFeePercent) || 0,
            taxPercent: Number(costs.taxPercent) || 0,
          }
          : null,
      })
      // El controller responde { success, data } — el análisis está en data.
      setResult(response?.data || response)
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'No se pudo completar el análisis. Reintentá en unos minutos.',
      )
    } finally {
      setLoading(false)
    }
  }

  // demandScore null = no hubo cobertura suficiente para emitir un score.
  // Distinto de un score bajo, que sí es una medición real.
  const unmeasurable =
    result && (result.demandScore === null || result.demandScore === undefined)
  const lowConfidence = result && !unmeasurable && result.confidenceScore < 50
  const internalOnly = result && !unmeasurable && result.internalOnly
  const gemini = result?.rawSignals?.gemini
  const profit = result?.profitability
  const prices = result?.priceStats
  const offers = result?.offers || []

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Análisis de mercado
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Analizá si un producto tiene demanda real antes de sumarlo al catálogo.
      </Typography>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              label="Producto o categoría"
              placeholder="Ej: freidora de aire 5 litros"
              value={product}
              onChange={e => setProduct(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAnalyze(false)}
              disabled={loading}
              helperText="Escribí como buscaría un cliente. Evitá modelos, SKU y colores."
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              select
              label="Mercado"
              value={country}
              onChange={e => setCountry(e.target.value)}
              disabled={loading}
              sx={{ minWidth: 160 }}
            >
              {COUNTRIES.map(c => (
                <MenuItem key={c.code} value={c.code}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              onClick={() => handleAnalyze(false)}
              disabled={loading || !product.trim()}
              sx={{ height: 56, minWidth: 120 }}
            >
              {loading ? <CircularProgress size={22} /> : 'Analizar'}
            </Button>
          </Stack>

          {/* Colapsado por defecto: la mayoría de las consultas son para ver
              si hay demanda, no para calcular márgenes. Quien necesita la
              rentabilidad lo abre; el resto no ve cuatro campos extra. */}
          <Accordion
            elevation={0}
            disableGutters
            sx={{ mt: 2, '&:before': { display: 'none' }, bgcolor: 'transparent' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
              <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
                <Typography variant="body2">Calcular rentabilidad</Typography>
                {hasCost && <Chip size="small" label="Con costos" color="primary" variant="outlined" />}
              </Stack>
            </AccordionSummary>

            <AccordionDetails sx={{ px: 0, pt: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Si cargás lo que te cuesta el producto, calculamos a qué precio empezás a ganar y cómo
                queda tu margen frente a los precios del mercado. Es opcional.
              </Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField
                    fullWidth
                    label="Costo por unidad"
                    type="number"
                    value={costs.unitCost}
                    onChange={e => setCost('unitCost', e.target.value)}
                    disabled={loading}
                    helperText="Lo que pagás por cada unidad"
                    slotProps={{
                      input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                      htmlInput: { min: 0, step: 'any' },
                    }}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField
                    fullWidth
                    label="Envío por unidad"
                    type="number"
                    value={costs.shippingCost}
                    onChange={e => setCost('shippingCost', e.target.value)}
                    disabled={loading}
                    helperText="Logística hasta el cliente"
                    slotProps={{
                      input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                      htmlInput: { min: 0, step: 'any' },
                    }}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField
                    fullWidth
                    label="Comisiones"
                    type="number"
                    value={costs.platformFeePercent}
                    onChange={e => setCost('platformFeePercent', e.target.value)}
                    disabled={loading}
                    helperText="Pasarela de pago, marketplace"
                    slotProps={{
                      input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                      htmlInput: { min: 0, max: 100, step: 'any' },
                    }}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <TextField
                    fullWidth
                    label="Impuestos"
                    type="number"
                    value={costs.taxPercent}
                    onChange={e => setCost('taxPercent', e.target.value)}
                    disabled={loading}
                    helperText="Estimado sobre la venta"
                    slotProps={{
                      input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                      htmlInput: { min: 0, max: 100, step: 'any' },
                    }}
                  />
                </Grid>
              </Grid>

              {hasCost && (
                <Button size="small" onClick={() => setCosts(EMPTY_COSTS)} sx={{ mt: 1 }}>
                  Limpiar costos
                </Button>
              )}
            </AccordionDetails>
          </Accordion>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* La key fuerza un remount cuando cambia el análisis. Sin esto React
          reconcilia el resultado nuevo sobre el viejo, y como las ramas
          condicionales cambian de forma (score numérico vs "Sin datos"),
          puede quedar con nodos que ya no le pertenecen. */}
      {result && (
        <Box key={`${result.product}-${result.country}-${result.generatedAt}`}>
          {result.degenerate ? (
            <Alert severity="info" sx={{ mb: 3 }}>
              No hay datos suficientes para analizar este producto. Las fuentes externas no respondieron,
              y en tu tienda no hay ventas de este producto ni de su categoría en los últimos 90 días —
              así que no hay nada que medir. Con las fuentes externas funcionando, o con historial de
              ventas, el análisis sí puede decirte algo.
            </Alert>
          ) : unmeasurable ? (
            <Alert severity="info" sx={{ mb: 3 }}>
              No se pudo medir la demanda de este producto. Las fuentes externas no respondieron, así que
              no hay evidencia suficiente para calcular un score. Esto no significa que el producto no
              tenga demanda: significa que todavía no lo sabemos.
            </Alert>
          ) : internalOnly ? (
            <Alert severity="warning" sx={{ mb: 3 }}>
              Este análisis usa solo los datos de tu tienda, porque las fuentes externas no respondieron.
              Te dice si <strong>tus clientes</strong> compran este producto, no si el mercado en general
              lo demanda. Sirve para decidir sobre tu catálogo actual, no para evaluar un producto nuevo.
            </Alert>
          ) : (
            lowConfidence && (
              <Alert severity="warning" sx={{ mb: 3 }}>
                La confianza de este análisis es baja ({result.confidenceScore}/100). Faltaron fuentes de
                datos, así que tomá el score como orientativo y no como base de una decisión de compra.
              </Alert>
            )
          )}

          {profit?.viable && (
            <Card variant="outlined" sx={{ mb: 3, borderColor: 'primary.main' }}>
              <CardContent>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  
                  spacing={2}
                  sx={{ alignItems: { sm: 'center' }, mb: 2 }}
                >
                  <Typography variant="subtitle1">Rentabilidad</Typography>
                  {profit.marketPosition && (
                    <Chip
                      label={POSITION_LABEL[profit.marketPosition.level] || profit.marketPosition.level}
                      color={POSITION_COLOR[profit.marketPosition.level] || 'default'}
                    />
                  )}
                </Stack>

                {profit.marketPosition && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    {profit.marketPosition.message}
                  </Typography>
                )}

                <Grid container spacing={3}>
                  <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Tu costo total por unidad
                    </Typography>
                    <Typography variant="h6">
                      {money(profit.totalUnitCost, profit.currency)}
                    </Typography>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                    <Tooltip title="Por debajo de este precio, cada venta te da pérdida" placement="top">
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        
                        sx={{ display: 'block', cursor: 'help' }}
                      >
                        Empezás a ganar desde
                      </Typography>
                    </Tooltip>
                    <Typography variant="h6">
                      {money(profit.breakEvenPrice, profit.currency)}
                    </Typography>
                  </Grid>

                  {prices?.median && (
                    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Precio típico del mercado
                      </Typography>
                      <Typography variant="h6">{money(prices.median, prices.currency)}</Typography>
                    </Grid>
                  )}
                </Grid>

                {profit.scenarios && (
                  <>
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="subtitle2" gutterBottom>
                      Qué ganás según a cuánto vendas
                    </Typography>

                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                      {[
                        ['atMin', 'Al más barato'],
                        ['atP25', 'Barato'],
                        ['atMedian', 'Precio típico'],
                        ['atP75', 'Caro'],
                      ].map(([key, label]) => {
                        const scenario = profit.scenarios[key]
                        if (!scenario) return null

                        return (
                          <Grid size={{ xs: 6, md: 3 }} key={key}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {label}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {money(scenario.price, profit.currency)}
                            </Typography>
                            <Typography
                              variant="h6"
                              color={scenario.profitable ? 'success.main' : 'error.main'}
                            >
                              {scenario.profit > 0 ? '+' : ''}
                              {money(scenario.profit, profit.currency)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {scenario.marginPercent.toFixed(1)}% de margen
                            </Typography>
                          </Grid>
                        )
                      })}
                    </Grid>
                  </>
                )}

                {!profit.scenarios && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    No se encontraron precios de mercado para comparar, así que solo se muestra tu
                    precio de equilibrio.
                  </Alert>
                )}

                <Alert severity="warning" variant="outlined" sx={{ mt: 3 }}>
                  <Typography variant="caption">
                    Cálculo orientativo. El impuesto se aplica sobre el precio de venta como un costo
                    más; si sos responsable inscripto tu carga real es distinta porque computás crédito
                    fiscal. Sirve para comparar productos y descartar los que no cierran, no para fijar
                    precios finales.
                  </Typography>
                </Alert>
              </CardContent>
            </Card>
          )}

          {profit && !profit.viable && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {profit.message}
            </Alert>
          )}

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    Demanda
                  </Typography>

                  {/* Typography hermanos dentro de un Stack, nunca anidados.
                      Anidar Typography dentro de Typography y alternar entre
                      un elemento y un fragmento con texto crudo rompía la
                      reconciliación de React (removeChild sobre un nodo que
                      Emotion ya había reemplazado). */}
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline', my: 1 }}>
                    {unmeasurable ? (
                      <Typography variant="h5" component="span" color="text.secondary">
                        Sin datos
                      </Typography>
                    ) : (
                      <>
                        <Typography variant="h3" component="span">
                          {result.demandScore}
                        </Typography>
                        <Typography variant="h6" component="span" color="text.secondary">
                          /100
                        </Typography>
                      </>
                    )}
                  </Stack>

                  <LinearProgress
                    variant="determinate"
                    value={unmeasurable ? 0 : safeProgressValue(result.demandScore)}
                    color={unmeasurable ? 'inherit' : scoreColor(result.demandScore)}
                    sx={{ height: 8, borderRadius: 1, mb: 1 }}
                  />

                  <Typography variant="body2">{result.demandClassification}</Typography>

                  {result.measuredWeight != null && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Se pudo evaluar el {Math.round(result.measuredWeight * 100)}% del modelo
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Tooltip title="Qué tan sólida es la evidencia detrás del score">
                    <Typography variant="overline" color="text.secondary">
                      Confianza
                    </Typography>
                  </Tooltip>

                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline', my: 1 }}>
                    <Typography variant="h3" component="span">
                      {safeProgressValue(result.confidenceScore)}
                    </Typography>
                    <Typography variant="h6" component="span" color="text.secondary">
                      /100
                    </Typography>
                  </Stack>

                  <LinearProgress
                    variant="determinate"
                    value={safeProgressValue(result.confidenceScore)}
                    color={scoreColor(result.confidenceScore)}
                    sx={{ height: 8, borderRadius: 1, mb: 1 }}
                  />

                  <Typography variant="body2">{result.trendLabel}</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1">Conclusión</Typography>
                <Chip
                  label={RECOMMENDATION[result.recommendation]?.label || result.recommendation}
                  color={RECOMMENDATION[result.recommendation]?.color || 'default'}
                />
              </Stack>

              <Typography variant="body2" color="text.secondary">
                {RECOMMENDATION[result.recommendation]?.detail}
              </Typography>

              {/* El desglose solo tiene sentido si hubo un score que
                  desglosar. Mostrar seis guiones debajo de "no se pudo
                  medir" no informa nada y sugiere que algo falló. */}
              {!unmeasurable && (
                <>
              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" gutterBottom>
                Desglose del score
              </Typography>

              <Grid container spacing={1}>
                {Object.entries(result.breakdown || {}).map(([key, value]) => {
                  const source = COMPONENT_SOURCE[key]

                  return (
                    <Grid size={{ xs: 6, sm: 4, md: 2 }} key={key}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {COMPONENT_LABELS[key] || key}
                      </Typography>
                      <Tooltip title={source?.help || ''} placement="top">
                        <Typography
                          variant="h6"
                          color={value === null ? 'text.disabled' : 'text.primary'}
                          sx={{ cursor: source?.help ? 'help' : 'default' }}
                        >
                          {value === null ? '—' : `${SOURCE_MARK[source?.kind] || ''}${Math.round(value)}`}
                        </Typography>
                      </Tooltip>
                    </Grid>
                  )
                })}
              </Grid>

              {Array.isArray(result.unmeasured) && result.unmeasured.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                  Sin datos para: {result.unmeasured.map(k => COMPONENT_LABELS[k] || k).join(', ')}
                </Typography>
              )}

              <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                <Typography variant="caption" sx={{ display: 'block' }}>
                  <strong>≈</strong> señal estimada a partir de lo que se encontró buscando en la web ·{' '}
                  <strong>◐</strong> combina datos de tu tienda con información externa
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                  Los puntajes todavía no están calibrados con datos históricos. Sirven para comparar
                  productos entre sí, no como medidas absolutas: un 70 significa "más que un 50", no
                  "70% de demanda".
                </Typography>
              </Alert>
                </>
              )}
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>
                Señales del mercado
              </Typography>

              {prices && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Precios encontrados ({prices.sampleSize} ofertas)
                  </Typography>
                  <Stack direction="row" spacing={3} sx={{ mt: 1 }}>
                    {[
                      ['Más barato', prices.min],
                      ['Típico', prices.median],
                      ['Más caro', prices.max],
                    ].map(([label, value]) => (
                      <Box key={label}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {label}
                        </Typography>
                        <Typography variant="body1">{money(value, prices.currency)}</Typography>
                      </Box>
                    ))}
                  </Stack>
                  {result?.rawSignals?.shopping?.merchantCount > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {result.rawSignals.shopping.merchantCount} vendedores distintos
                    </Typography>
                  )}

                  {/* Las ofertas concretas con link. Un "12 vendedores" que
                      el comercio no puede verificar no le sirve para juzgar
                      si la muestra representa su mercado o trae ruido. */}
                  {offers.length > 0 && (
                    <Accordion
                      elevation={0}
                      disableGutters
                      sx={{ mt: 1, '&:before': { display: 'none' }, bgcolor: 'transparent' }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40 }}>
                        <Typography variant="body2">Ver de dónde salen estos precios</Typography>
                      </AccordionSummary>

                      <AccordionDetails sx={{ px: 0 }}>
                        <Stack divider={<Divider />} spacing={1}>
                          {offers.map((offer, i) => (
                            <Box key={i} sx={{ pt: i === 0 ? 0 : 1 }}>
                              <Stack
                                direction="row"
                                sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }} 
                                
                                spacing={2}
                              >
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography variant="body2" noWrap title={offer.title}>
                                    {offer.link ? (
                                      <a
                                        href={offer.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: 'inherit' }}
                                      >
                                        {offer.title}
                                      </a>
                                    ) : (
                                      offer.title
                                    )}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {offer.merchant || 'Vendedor no identificado'}
                                    {offer.reviewCount ? ` · ${offer.reviewCount} reseñas` : ''}
                                    {offer.rating ? ` · ${offer.rating}★` : ''}
                                  </Typography>
                                </Box>
                                <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                                  {money(offer.price, offer.currency || prices?.currency)}
                                </Typography>
                              </Stack>
                            </Box>
                          ))}
                        </Stack>

                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                          Muestra de las ofertas encontradas en Google Shopping. Solo aparecen comercios
                          que publican su catálogo ahí, así que puede haber tiendas del rubro que no
                          figuren. Revisá si los productos listados son realmente comparables al tuyo.
                        </Typography>
                      </AccordionDetails>
                    </Accordion>
                  )}

                  <Divider sx={{ mt: 2 }} />
                </Box>
              )}

              {gemini?.available ? (
                <Stack spacing={1}>
                  <Typography variant="body2">
                    Competencia: {gemini.competition?.level?.replace('_', ' ') || 'Sin datos'}
                  </Typography>

                  {gemini.competition?.knownBrands?.length > 0 && (
                    <Typography variant="body2">
                      Marcas presentes: {gemini.competition.knownBrands.join(', ')}
                    </Typography>
                  )}

                  {gemini.recurringComplaints?.length > 0 && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Quejas frecuentes de compradores
                      </Typography>
                      {gemini.recurringComplaints.map((complaint, i) => (
                        <Typography key={i} variant="body2" color="text.secondary">
                          • {complaint}
                        </Typography>
                      ))}
                    </>
                  )}

                  {gemini.sources?.length > 0 && (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        Fuentes consultadas: {gemini.sources.length}
                      </Typography>
                    </>
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {gemini?.reason || gemini?.error || 'No se pudieron obtener señales externas del mercado.'}
                </Typography>
              )}

              <Box sx={{ mt: 3 }}>
                <Button size="small" onClick={() => handleAnalyze(true)} disabled={loading}>
                  Volver a analizar con datos frescos
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  Consulta las fuentes de nuevo en lugar de usar el resultado guardado.
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Box>
      )}
    </Box>
  )
}