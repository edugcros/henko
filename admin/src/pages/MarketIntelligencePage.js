// 📁 MarketIntelligencePage.js
//
// Pantalla del panel admin para el análisis de mercado: si un producto tiene
// demanda, quién lo vende y a cuánto, y cuánto le quedaría al comercio.
//
// Lo que esta pantalla cuida, más que el diseño:
//
//   - No afirmar lo que el análisis no midió. Sin demanda medida el número se
//     llama "Mercado" y el veredicto no dice "no conviene".
//   - Mostrar de dónde sale cada dato: las tiendas con su link, las páginas
//     que leyó la IA, qué fuente respondió y cuál no.
//   - Con un producto del catálogo, el costo de la ficha y la comisión medida
//     en las ventas entran solos (productId → resolveProductCostInputs en el
//     backend) y se dice de dónde salió cada uno.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RefreshIcon from '@mui/icons-material/Refresh'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

import { analyzeProduct } from '../utils/marketIntelligenceApi.js'
import productService from '../features/product/productService'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  green: '#047857',
  amber: '#b45309',
  red: '#b42318',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// Un tono por estado, el mismo en pastillas, barras y montos.
const TONE = {
  success: { color: BRAND.green, bg: '#e7f6ef' },
  warning: { color: BRAND.amber, bg: '#fdf3e7' },
  error: { color: BRAND.red, bg: '#fdecea' },
  info: { color: BRAND.blue, bg: '#e8f0ff' },
  default: { color: BRAND.muted, bg: '#eef1fb' },
}

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
    tone: 'success',
    detail: 'Las señales indican demanda real y espacio para competir.',
  },
  'RECOMENDADO CON CONDICIONES': {
    label: 'Conviene, con reparos',
    tone: 'warning',
    detail: 'Hay demanda, pero revisá competencia y margen antes de decidir.',
  },
  'NO RECOMENDADO': {
    label: 'No conviene por ahora',
    tone: 'error',
    detail: 'Las señales no muestran demanda que justifique sumarlo al catálogo.',
  },
  'DATOS INSUFICIENTES': {
    label: 'Todavía no se puede saber',
    tone: 'default',
    detail:
      'No hay suficiente información para dar una respuesta. No significa que el producto sea malo: significa que falta evidencia.',
  },
  // Sin esto, un producto con mercado activo pero sin medición de demanda
  // recibía "No conviene por ahora": una conclusión sobre la demanda, que es
  // justo lo único que no se midió.
  'FALTA MEDIR LA DEMANDA': {
    label: 'Hay mercado, falta medir la demanda',
    tone: 'info',
    detail:
      'Se midió el mercado alrededor del producto —quién lo vende y a qué precio— pero no cuánta gente lo está buscando. Con eso todavía no se puede decir si conviene: mirá los precios y la competencia, y volvé a analizar cuando la búsqueda con IA responda.',
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
  demand: {
    kind: 'observed',
    help: 'Cuánta gente busca y compra esto. Sale de la búsqueda con IA y, si no hay ninguna fuente externa, de tus propias ventas.',
  },
  trend: {
    kind: 'observed',
    help: 'Si el interés sube o baja, según lo que la búsqueda con IA haya encontrado. Es una foto del momento, no una serie histórica.',
  },
  competition: {
    kind: 'mixed',
    help: 'Cuántos vendedores distintos publican el producto hoy. Es un conteo real; solo si el buscador no responde se usa la lectura de la IA.',
  },
  social: {
    kind: 'observed',
    help: 'Menciones en redes y foros. Señal aproximada.',
  },
  commercial: {
    kind: 'mixed',
    help: 'Cuánto mercado activo hay: ofertas publicadas hoy y rotación de la categoría en tu tienda.',
  },
  opportunity: {
    kind: 'mixed',
    help: 'Huecos que podrías ocupar: quejas repetidas de compradores, y categorías que en tu tienda rotan pero este producto no.',
  },
}

// Marca la dureza de la evidencia. No hay 'measured' sin marca: hoy ningún
// componente se mide sin intermediarios, y declarar una categoría que nada usa
// hace creer que existe.
const SOURCE_MARK = { observed: '≈', mixed: '◐' }

// Enum de webResearchSource (backend). Antes se mostraba la clave con un
// replace que solo cambiaba el primer guion bajo: "MUY ALTA", en mayúsculas.
const COMPETITION_LEVEL = {
  BAJA: 'Baja',
  MEDIA: 'Media',
  ALTA: 'Alta',
  MUY_ALTA: 'Muy alta',
  INDETERMINADA: 'Sin datos',
}

// Los cuatro pasos, en el orden en que ocurren. Numerados porque son una
// secuencia real: cada uno usa lo que dejó el anterior.
const HOW_IT_WORKS = [
  'Escribís un producto —del catálogo, o uno que estés pensando traer— y elegís el país.',
  'HENKO consulta tres fuentes a la vez: el buscador de precios (qué tiendas lo venden hoy y a cuánto, con el link de cada una), una búsqueda en la web cuyas páginas lee la IA para sacar marcas, quejas repetidas e intención de compra —vas a ver los links de lo que leyó—, y tu propia tienda (tus ventas, tu stock, cómo rota la categoría).',
  'Con lo que cada fuente haya contestado se arma el puntaje. Lo que no se pudo medir no puntúa cero: queda afuera del cálculo y se avisa, porque no saberlo y que sea malo son cosas distintas.',
  'Si cargás tu costo, además te dice desde qué precio empezás a ganar y cuánto te quedaría vendiendo al precio típico del mercado. Con un producto del catálogo usa el costo de la ficha y la comisión real de tus ventas.',
]

const POSITION = {
  MUY_COMPETITIVO: { label: 'Muy competitivo', tone: 'success' },
  COMPETITIVO: { label: 'Competitivo', tone: 'success' },
  AJUSTADO: { label: 'Ajustado', tone: 'warning' },
  MUY_AJUSTADO: { label: 'Muy ajustado', tone: 'warning' },
  INVIABLE: { label: 'Inviable', tone: 'error' },
}

const SCENARIOS = [
  ['atMin', 'Al más barato'],
  ['atP25', 'Barato'],
  ['atMedian', 'Precio típico'],
  ['atP75', 'Caro'],
]

export const EMPTY_COSTS = {
  unitCost: '',
  shippingCost: '',
  platformFeePercent: '',
  paymentFeePercent: '',
  taxPercent: '',
}

const PERCENT_FIELDS = ['platformFeePercent', 'paymentFeePercent', 'taxPercent']

/**
 * Cuánto hace que se calculó, en palabras.
 *
 * El backend guarda cada análisis y lo sirve hasta 24 horas, pero la pantalla
 * no lo decía: apretabas "Analizar" sobre un producto que ya habías mirado y
 * recibías el resultado de ayer al instante, sin que la IA corriera. Se ve
 * exactamente igual que una función que no funciona.
 */
export const antiguedad = iso => {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000)

  if (!Number.isFinite(minutos) || minutos < 2) return 'recién'
  if (minutos < 60) return `hace ${minutos} minutos`

  const horas = Math.round(minutos / 60)
  return horas === 1 ? 'hace una hora' : `hace ${horas} horas`
}

const isNumber = value =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))

export const money = (value, currency) => {
  if (!isNumber(value)) return '—'
  const formatted = Math.round(Number(value)).toLocaleString('es-AR')
  return currency ? `${currency} ${formatted}` : `$${formatted}`
}

// Coma decimal, como los montos usan punto de miles: "23.8%" al lado de
// "ARS 1.900" se lee como veintitrés mil. Y sin número no hay porcentaje:
// antes un escenario sin marginPercent rompía la pantalla entera en toFixed.
export const percent = value =>
  isNumber(value)
    ? `${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : '—'

const scoreTone = value => {
  if (value >= 75) return 'success'
  if (value >= 50) return 'warning'
  return 'error'
}

// LinearProgress determinate exige un número: null o undefined disparan un
// warning de MUI y renderizan la barra vacía sin indicación de por qué.
const safeProgressValue = value => (Number.isFinite(Number(value)) ? Number(value) : 0)

/**
 * Errores de los costos, por campo. Vacío es válido: todos son opcionales.
 *
 * El backend no rechaza estos valores, los corrige en silencio —un costo de
 * 0 descarta la rentabilidad entera, un 150% se recorta a 100— así que el
 * comerciante veía un resultado distinto del que había pedido sin saber por
 * qué. Se frenan acá, antes de gastar un análisis.
 */
export const validateCosts = costs => {
  const errors = {}
  const filled = key => costs[key] !== '' && costs[key] !== null && costs[key] !== undefined

  if (filled('unitCost') && !(Number(costs.unitCost) > 0)) {
    errors.unitCost = 'Tiene que ser mayor que 0'
  }

  if (filled('shippingCost') && !(Number(costs.shippingCost) >= 0)) {
    errors.shippingCost = 'No puede ser negativo'
  }

  for (const key of PERCENT_FIELDS) {
    if (!filled(key)) continue
    const value = Number(costs[key])
    if (!(value >= 0 && value <= 100)) errors[key] = 'Entre 0 y 100'
  }

  return errors
}

/**
 * El cuerpo del pedido de análisis.
 *
 * Sin producto del catálogo, los costos viajan solo si hay costo unitario:
 * el backend descarta un objeto sin ese campo, así que enviarlo a medias es
 * ruido. Con producto del catálogo viaja el productId y los costos son lo que
 * el comerciante quiere sobrescribir; lo vacío lo completa el backend con la
 * ficha y con lo medido en las ventas.
 */
export const buildAnalyzeRequest = ({ product, country, forceRefresh, costs, catalogProduct }) => {
  const number = key => (Number(costs[key]) > 0 ? Number(costs[key]) : 0)
  const base = { product: product.trim(), country, forceRefresh }

  if (catalogProduct?._id) {
    const overrides = Object.fromEntries(
      Object.keys(EMPTY_COSTS)
        .filter(key => number(key) > 0)
        .map(key => [key, number(key)]),
    )
    return { ...base, productId: catalogProduct._id, costs: overrides }
  }

  return {
    ...base,
    costs:
      number('unitCost') > 0
        ? {
            unitCost: number('unitCost'),
            shippingCost: number('shippingCost'),
            platformFeePercent: number('platformFeePercent'),
            paymentFeePercent: number('paymentFeePercent'),
            taxPercent: number('taxPercent'),
          }
        : null,
  }
}

/**
 * De dónde salió cada costo, en palabras (COST_SOURCE de
 * backend/src/services/pricing/productCostService.js).
 */
export const describeCostSource = (key, costSources) => {
  const source = costSources?.[key]
  if (!source) return null

  if (source === 'override') return 'Lo cargaste vos'
  if (source === 'stored') return 'De la ficha del producto'
  if (source === 'measured') {
    const n = costSources.paymentFeeSampleSize
    return n ? `Medida en tus últimas ${n} ventas cobradas` : 'Medida en tus ventas cobradas'
  }
  if (key === 'paymentFeePercent') return 'Sin ventas suficientes para medirla: cuenta 0%'
  return 'No cargado: cuenta 0'
}

const COST_SOURCE_ROWS = [
  ['unitCost', 'Costo por unidad'],
  ['shippingCost', 'Envío'],
  ['platformFeePercent', 'Comisión del marketplace'],
  ['paymentFeePercent', 'Comisión de cobro'],
  ['taxPercent', 'Impuestos'],
]

// El desplegable ofrece el catalogo propio, pero el analisis sigue aceptando
// texto libre: la pantalla existe para evaluar productos que todavia NO estan
// en el catalogo, asi que un Autocomplete cerrado romperia su caso de uso
// principal. De ahi freeSolo.
const PRODUCT_OPTIONS_LIMIT = 50
const PRODUCT_SEARCH_DEBOUNCE_MS = 350

const getProductLabel = option =>
  typeof option === 'string' ? option : option?.title || option?.name || ''

const getProductImage = option => {
  if (typeof option === 'string') return ''
  const first = Array.isArray(option?.images) ? option.images[0] : null
  return first?.url || first?.secure_url || ''
}

const getProductSubtitle = option => {
  if (typeof option === 'string') return ''
  const parts = [option?.categoria, option?.subcategoria].filter(Boolean)
  return parts.join(' › ')
}

const Pill = ({ tone = 'default', children }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      px: 1.25,
      py: 0.25,
      borderRadius: 999,
      fontFamily: theme => theme.typography.fontFamily,
      fontSize: 13,
      fontWeight: 700,
      whiteSpace: 'nowrap',
      color: TONE[tone]?.color || BRAND.muted,
      bgcolor: TONE[tone]?.bg || '#eef1fb',
    }}
  >
    {children}
  </Box>
)

const SectionTitle = ({ children, action }) => (
  <Stack
    direction="row"
    spacing={1.5}
    sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', mb: 1.5 }}
  >
    <Typography
      component="h2"
      sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, color: BRAND.ink }}
    >
      {children}
    </Typography>
    {action}
  </Stack>
)

const Figure = ({ label, value, tone, hint }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: 12, fontWeight: 700, color: BRAND.muted }}>
      {hint ? (
        <Tooltip title={hint} placement="top">
          <Box component="span" sx={{ cursor: 'help', borderBottom: `1px dotted ${BRAND.muted}` }}>
            {label}
          </Box>
        </Tooltip>
      ) : (
        label
      )}
    </Typography>
    <Typography
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: 20,
        fontVariantNumeric: 'tabular-nums',
        color: tone ? TONE[tone].color : BRAND.ink,
      }}
    >
      {value}
    </Typography>
  </Box>
)

// El título sigue a lo que el número mide de verdad: con la demanda sin
// medir, el puntaje describe el mercado alrededor del producto.
//
// Typography hermanos dentro de un Stack, nunca anidados. Anidar Typography
// dentro de Typography y alternar entre un elemento y un fragmento con texto
// crudo rompía la reconciliación de React (removeChild sobre un nodo que
// Emotion ya había reemplazado).
const ScoreTile = ({ title, hint, value, caption, foot }) => {
  const measured = value !== null && value !== undefined
  const tone = measured ? scoreTone(value) : 'default'

  return (
    <Box sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}>
      <Tooltip title={hint || ''} placement="top-start">
        <Typography
          component="span"
          sx={{
            display: 'inline-block',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: BRAND.muted,
            cursor: hint ? 'help' : 'default',
          }}
        >
          {title}
        </Typography>
      </Tooltip>

      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline', my: 0.5 }}>
        {measured ? (
          <>
            <Typography
              component="span"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 800,
                fontSize: 40,
                lineHeight: 1.1,
                color: BRAND.ink,
              }}
            >
              {value}
            </Typography>
            <Typography component="span" sx={{ fontWeight: 700, color: BRAND.muted }}>
              /100
            </Typography>
          </>
        ) : (
          <Typography
            component="span"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: 26,
              lineHeight: 1.6,
              color: BRAND.muted,
            }}
          >
            Sin datos
          </Typography>
        )}
      </Stack>

      <LinearProgress
        variant="determinate"
        value={measured ? safeProgressValue(value) : 0}
        aria-label={`${title}: ${measured ? `${value} de 100` : 'sin datos'}`}
        sx={{
          height: 8,
          borderRadius: 999,
          mb: 1,
          bgcolor: '#eef1fb',
          '& .MuiLinearProgress-bar': { bgcolor: TONE[tone].color, borderRadius: 999 },
        }}
      />

      {caption && <Typography variant="body2">{caption}</Typography>}
      {foot && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: BRAND.muted }}>
          {foot}
        </Typography>
      )}
    </Box>
  )
}

const ExternalLink = ({ href, children }) => (
  <Box
    component="a"
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    sx={{
      color: BRAND.ink,
      textDecorationColor: BRAND.line,
      '&:hover': { color: BRAND.blue, textDecorationColor: BRAND.blue },
    }}
  >
    {children}
  </Box>
)

const PLAIN_ACCORDION_SX = {
  bgcolor: 'transparent',
  '&:before': { display: 'none' },
}

const HowItWorks = () => (
  <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1.5 }}>
    {HOW_IT_WORKS.map((paso, i) => (
      <Stack component="li" direction="row" spacing={1.5} key={paso}>
        <Box
          aria-hidden
          sx={{
            flexShrink: 0,
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontFamily: theme => theme.typography.fontFamily,
            fontSize: 13,
            fontWeight: 800,
            color: BRAND.blue,
            bgcolor: '#e8f0ff',
          }}
        >
          {i + 1}
        </Box>
        <Typography variant="body2" sx={{ color: BRAND.muted, pt: 0.25 }}>
          {paso}
        </Typography>
      </Stack>
    ))}
  </Box>
)

export default function MarketIntelligencePage() {
  const [product, setProduct] = useState('')
  const [catalogProduct, setCatalogProduct] = useState(null)
  const [productOptions, setProductOptions] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [country, setCountry] = useState('AR')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [costSources, setCostSources] = useState(null)
  const [costs, setCosts] = useState(EMPTY_COSTS)
  const [costsOpen, setCostsOpen] = useState(false)

  // Enter puede llegar dos veces en el mismo tic —el Autocomplete crea la
  // opción de texto libre y el campo también escucha la tecla— y un doble
  // clic hace lo mismo. Cada análisis gasta cuota: se corre uno a la vez.
  const busyRef = useRef(false)

  // La busqueda va contra el backend (parametro q) en vez de traer todo el
  // catalogo y filtrar en el cliente: una tienda grande no entra en memoria y
  // el endpoint ya resuelve el match por titulo, categoria y SKU.
  const requestSeq = useRef(0)

  const fetchProductOptions = useCallback(async query => {
    const seq = ++requestSeq.current
    setOptionsLoading(true)
    try {
      const response = await productService.getAdminProducts({
        q: query || undefined,
        limit: PRODUCT_OPTIONS_LIMIT,
        page: 1,
      })
      // Descartamos respuestas viejas: sin esto, una peticion lenta lanzada
      // antes puede pisar los resultados de la tecla mas reciente.
      if (seq !== requestSeq.current) return
      // getAdminProducts retorna la respuesta desenrollada (via apiRequest),
      // así que response ya es el array o el objeto con los datos
      const rows = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : []
      setProductOptions(rows)
    } catch (err) {
      // El desplegable es una ayuda, no el camino unico: si el catalogo no
      // carga, el campo sigue aceptando texto libre y el analisis funciona.
      if (seq === requestSeq.current) {
        setProductOptions([])
        console.warn('Error fetching products:', err)
      }
    } finally {
      if (seq === requestSeq.current) setOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => fetchProductOptions(product), PRODUCT_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [product, fetchProductOptions])

  const setCost = (field, value) => setCosts(prev => ({ ...prev, [field]: value }))
  const costErrors = validateCosts(costs)
  const hasCostErrors = Object.keys(costErrors).length > 0
  const storedCost = Number(catalogProduct?.costoUnitario) > 0 ? catalogProduct.costoUnitario : null
  const typedCost = Number(costs.unitCost) > 0
  const willCalculateProfit = typedCost || Boolean(storedCost)
  const canAnalyze = Boolean(product.trim()) && !loading && !hasCostErrors

  const handleAnalyze = async (forceRefresh = false) => {
    if (!product.trim() || busyRef.current || hasCostErrors) return

    busyRef.current = true
    setLoading(true)
    setError(null)

    try {
      const response = await analyzeProduct(
        buildAnalyzeRequest({ product, country, forceRefresh, costs, catalogProduct }),
      )
      // El controller responde { success, data, costSources } — el análisis
      // está en data, y costSources dice de dónde salió cada costo.
      setResult(response?.data || response)
      setCostSources(response?.costSources || null)
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'No se pudo completar el análisis. Reintentá en unos minutos.',
      )
    } finally {
      busyRef.current = false
      setLoading(false)
    }
  }

  // demandScore null = no hubo cobertura suficiente para emitir un score.
  // Distinto de un score bajo, que sí es una medición real.
  const unmeasurable = result && (result.demandScore === null || result.demandScore === undefined)
  const lowConfidence = result && !unmeasurable && result.confidenceScore < 50
  const internalOnly = result && !unmeasurable && result.internalOnly
  const research = result?.rawSignals?.research
  const profit = result?.profitability
  const prices = result?.priceStats
  const offers = result?.offers || []
  const sources = result?.sources || []
  const verdict = result ? RECOMMENDATION[result.recommendation] : null
  const countryLabel = COUNTRIES.find(c => c.code === result?.country)?.label || result?.country

  // Hay puntaje, pero el componente principal no se midió: lo que el número
  // describe es el mercado alrededor del producto, no cuánta gente lo quiere.
  const demandUnmeasured = result && !unmeasurable && (result.breakdown?.demand ?? null) === null

  const costField = (field, label, { adornment, helper, placeholder }) => (
    <TextField
      fullWidth
      size="small"
      label={label}
      type="number"
      value={costs[field]}
      onChange={e => setCost(field, e.target.value)}
      disabled={loading}
      placeholder={placeholder}
      error={Boolean(costErrors[field])}
      helperText={costErrors[field] || helper}
      slotProps={{
        // Siempre arriba: los campos llevan $ o %, y una etiqueta larga
        // adentro del campo se pisa con el símbolo.
        inputLabel: { shrink: true },
        input:
          adornment === '%'
            ? { endAdornment: <InputAdornment position="end">%</InputAdornment> }
            : { startAdornment: <InputAdornment position="start">$</InputAdornment> },
        htmlInput: {
          min: 0,
          ...(adornment === '%' ? { max: 100 } : {}),
          step: 'any',
        },
      }}
    />
  )

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1180, mx: 'auto', color: BRAND.ink }}>
      <Box component="header" sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          sx={{ display: 'block', color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          PRODUCTOS
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
          Análisis de mercado
        </Typography>
        <Typography sx={{ mt: 0.5, maxWidth: 680, color: BRAND.muted }}>
          Analizá si un producto tiene demanda real antes de sumarlo al catálogo: quién lo vende, a
          cuánto, si el interés crece, y cuánto te quedaría a vos.
        </Typography>
      </Box>

      <Paper
        component="section"
        aria-label="Qué analizar"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, p: { xs: 2, md: 2.5 } }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ alignItems: 'flex-start' }}
        >
          <Autocomplete
            freeSolo
            fullWidth
            disabled={loading}
            options={productOptions}
            loading={optionsLoading}
            open={optionsOpen}
            onOpen={() => setOptionsOpen(true)}
            onClose={() => setOptionsOpen(false)}
            loadingText="Buscando productos…"
            noOptionsText="Sin coincidencias en tu catálogo — podés analizarlo igual"
            inputValue={product}
            onInputChange={(_, value) => {
              setProduct(value)
              // Si el texto deja de ser el del producto elegido, ya no es ese
              // producto: su costo no tiene que entrar en el cálculo.
              setCatalogProduct(prev => (prev && getProductLabel(prev) !== value ? null : prev))
            }}
            onChange={(_, value, reason) => {
              if (value && typeof value === 'object') {
                setCatalogProduct(value)
                return
              }
              // Enter sobre texto libre con el desplegable abierto. Antes
              // solo lo cerraba y había que apretar Enter otra vez.
              if (reason === 'createOption') handleAnalyze(false)
            }}
            getOptionLabel={getProductLabel}
            isOptionEqualToValue={(option, value) =>
              getProductLabel(option) === getProductLabel(value)
            }
            // El backend ya filtró por q; volver a filtrar en el cliente
            // esconderia resultados que sí coinciden por SKU o categoría.
            filterOptions={x => x}
            renderOption={(props, option) => {
              const { key, ...rest } = props
              return (
                <Stack
                  component="li"
                  key={key}
                  {...rest}
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center' }}
                >
                  <Avatar
                    variant="rounded"
                    src={getProductImage(option)}
                    alt=""
                    sx={{ width: 36, height: 36, bgcolor: BRAND.paper }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {getProductLabel(option)}
                    </Typography>
                    {getProductSubtitle(option) && (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {getProductSubtitle(option)}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              )
            }}
            renderInput={params => (
              <TextField
                {...params}
                label="Producto o categoría"
                placeholder="Ej: freidora de aire 5 litros"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !optionsOpen) handleAnalyze(false)
                }}
                helperText="Elegí uno de tu catálogo o escribí como buscaría un cliente. Evitá modelos, SKU y colores."
                slotProps={{
                  ...params.slotProps,
                  htmlInput: {
                    ...(params.slotProps?.htmlInput || {}),
                    maxLength: 200,
                  },
                  input: {
                    ...(params.slotProps?.input || {}),
                    endAdornment: (
                      <>
                        {optionsLoading && <CircularProgress size={18} sx={{ mr: 1 }} />}
                        {params.slotProps?.input?.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />
          <TextField
            select
            label="Mercado"
            value={country}
            onChange={e => setCountry(e.target.value)}
            disabled={loading}
            sx={{ minWidth: { md: 170 }, width: { xs: '100%', md: 'auto' } }}
          >
            {COUNTRIES.map(c => (
              <MenuItem key={c.code} value={c.code}>
                {c.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            disableElevation
            onClick={() => handleAnalyze(false)}
            disabled={!canAnalyze}
            sx={{
              height: 56,
              minWidth: 132,
              width: { xs: '100%', md: 'auto' },
              borderRadius: 2,
              textTransform: 'none',
              fontWeight: 800,
              fontSize: 15,
            }}
          >
            {/* Texto envuelto, no desnudo: ver website/src/Pages/Login.js. */}
            {loading ? (
              <CircularProgress size={22} color="inherit" aria-label="Analizando" />
            ) : (
              <span>Analizar</span>
            )}
          </Button>
        </Stack>

        {catalogProduct && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 1.5, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <Pill tone="info">Del catálogo</Pill>
            <Typography variant="body2" sx={{ color: BRAND.muted }}>
              {storedCost
                ? `Costo en la ficha: ${money(storedCost)}. Se usa para calcular tu ganancia.`
                : 'La ficha no tiene costo cargado. Cargalo abajo para ver tu ganancia.'}
            </Typography>
          </Stack>
        )}

        {/* Colapsado por defecto: la mayoría de las consultas son para ver
            si hay demanda, no para calcular márgenes. Quien necesita la
            rentabilidad lo abre; el resto no ve los campos extra. Se abre
            solo si hay un error adentro, para que no quede escondido. */}
        <Accordion
          elevation={0}
          disableGutters
          expanded={costsOpen || hasCostErrors}
          onChange={(_, open) => setCostsOpen(open)}
          sx={{ ...PLAIN_ACCORDION_SX, mt: 1.5, borderTop: `1px solid ${BRAND.line}` }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Calcular rentabilidad
              </Typography>
              {willCalculateProfit && <Pill tone="info">Con costos</Pill>}
              {hasCostErrors && <Pill tone="error">Revisá los costos</Pill>}
            </Stack>
          </AccordionSummary>

          <AccordionDetails sx={{ px: 0, pt: 0 }}>
            <Typography variant="body2" sx={{ color: BRAND.muted, mb: 2, maxWidth: 760 }}>
              {catalogProduct
                ? 'Lo que dejes vacío se completa solo: el costo con el de la ficha y la comisión de cobro con lo que te cobraron en tus ventas. Cargá un valor solo si querés probar otro.'
                : 'Si cargás lo que te cuesta el producto, calculamos a qué precio empezás a ganar y cómo queda tu margen frente a los precios del mercado. Es opcional.'}
            </Typography>

            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, 1fr)',
                  md: 'repeat(5, 1fr)',
                },
              }}
            >
              {costField('unitCost', 'Costo por unidad', {
                helper: catalogProduct ? 'Vacío: el de la ficha' : 'Lo que pagás por cada unidad',
                placeholder: storedCost ? money(storedCost) : undefined,
              })}
              {costField('shippingCost', 'Envío por unidad', {
                helper: 'Logística hasta el cliente',
              })}
              {costField('platformFeePercent', 'Comisión del marketplace', {
                adornment: '%',
                helper: 'Si vendés en uno',
              })}
              {costField('paymentFeePercent', 'Comisión de cobro', {
                adornment: '%',
                helper: catalogProduct ? 'Vacío: la de tus ventas' : 'Lo que cobra la pasarela',
              })}
              {costField('taxPercent', 'Impuestos', {
                adornment: '%',
                helper: 'Estimado sobre la venta',
              })}
            </Box>

            {!catalogProduct && !typedCost && Object.values(costs).some(Boolean) && (
              <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: BRAND.amber }}>
                Sin costo por unidad no se calcula la rentabilidad.
              </Typography>
            )}

            {Object.values(costs).some(Boolean) && (
              <Button
                size="small"
                onClick={() => setCosts(EMPTY_COSTS)}
                disabled={loading}
                sx={{ mt: 1, textTransform: 'none', fontWeight: 700, ml: -1 }}
              >
                Limpiar costos
              </Button>
            )}
          </AccordionDetails>
        </Accordion>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }}>
          {error}
        </Alert>
      )}

      {!result && (
        <Paper
          component="section"
          aria-label="Cómo funciona"
          variant="outlined"
          sx={{ ...PANEL_SX, p: { xs: 2, md: 2.5 }, bgcolor: BRAND.paper }}
        >
          <SectionTitle>Cómo funciona</SectionTitle>
          <HowItWorks />
        </Paper>
      )}

      {/* La key fuerza un remount cuando cambia el análisis. Sin esto React
          reconcilia el resultado nuevo sobre el viejo, y como las ramas
          condicionales cambian de forma (score numérico vs "Sin datos"),
          puede quedar con nodos que ya no le pertenecen. */}
      {result && (
        <Box key={`${result.product}-${result.country}-${result.generatedAt}`}>
          {result.fromCache && (
            <Alert
              severity="info"
              sx={{ mb: 2, borderRadius: 3 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => handleAnalyze(true)}
                  disabled={loading}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Analizar de nuevo
                </Button>
              }
            >
              Este es el análisis guardado de {antiguedad(result.generatedAt)}. No se volvió a
              consultar nada, así que no gastó consumo.
            </Alert>
          )}
          {result.degenerate ? (
            <Alert severity="info" sx={{ mb: 2, borderRadius: 3 }}>
              No hay datos suficientes para analizar este producto. Las fuentes externas no
              respondieron, y en tu tienda no hay ventas de este producto ni de su categoría en los
              últimos 90 días — así que no hay nada que medir. Con las fuentes externas funcionando,
              o con historial de ventas, el análisis sí puede decirte algo.
            </Alert>
          ) : unmeasurable ? (
            <Alert severity="info" sx={{ mb: 2, borderRadius: 3 }}>
              No se pudo medir la demanda de este producto. Las fuentes externas no respondieron,
              así que no hay evidencia suficiente para calcular un score. Esto no significa que el
              producto no tenga demanda: significa que todavía no lo sabemos.
            </Alert>
          ) : internalOnly ? (
            <Alert severity="warning" sx={{ mb: 2, borderRadius: 3 }}>
              Este análisis usa solo los datos de tu tienda, porque las fuentes externas no
              respondieron. Te dice si <strong>tus clientes</strong> compran este producto, no si el
              mercado en general lo demanda. Sirve para decidir sobre tu catálogo actual, no para
              evaluar un producto nuevo.
            </Alert>
          ) : (
            lowConfidence && (
              <Alert severity="warning" sx={{ mb: 2, borderRadius: 3 }}>
                La confianza de este análisis es baja ({result.confidenceScore}/100). Faltaron
                fuentes de datos, así que tomá el score como orientativo y no como base de una
                decisión de compra.
              </Alert>
            )
          )}

          {/* La conclusión primero: es lo que el comerciante vino a buscar.
              Los dos números de abajo la respaldan. */}
          <Paper
            component="section"
            aria-label="Conclusión"
            variant="outlined"
            sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
          >
            <Box sx={{ p: { xs: 2, md: 2.5 } }}>
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: BRAND.muted,
                }}
              >
                Conclusión · {countryLabel}
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'center' }, mt: 0.5, mb: 1 }}
              >
                <Typography
                  component="h2"
                  sx={{
                    fontFamily: DISPLAY_FONT,
                    fontWeight: 800,
                    fontSize: { xs: 20, md: 24 },
                    lineHeight: 1.2,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {result.product}
                </Typography>
                <Box>
                  <Pill tone={verdict?.tone}>{verdict?.label || result.recommendation}</Pill>
                </Box>
              </Stack>
              {verdict?.detail && (
                <Typography variant="body2" sx={{ color: BRAND.muted, maxWidth: 820 }}>
                  {verdict.detail}
                </Typography>
              )}
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                borderTop: `1px solid ${BRAND.line}`,
                '& > :first-of-type': {
                  borderRight: { sm: `1px solid ${BRAND.line}` },
                  borderBottom: { xs: `1px solid ${BRAND.line}`, sm: 'none' },
                },
              }}
            >
              <ScoreTile
                title={demandUnmeasured ? 'Mercado' : 'Demanda'}
                value={unmeasurable ? null : result.demandScore}
                caption={result.demandClassification}
                foot={
                  result.measuredWeight != null
                    ? `Se pudo evaluar el ${Math.round(result.measuredWeight * 100)}% del modelo`
                    : null
                }
              />
              <ScoreTile
                title="Confianza"
                hint="Qué tan sólida es la evidencia detrás del score"
                value={safeProgressValue(result.confidenceScore)}
                caption={result.trendLabel}
              />
            </Box>
          </Paper>

          {profit?.viable && (
            <Paper
              component="section"
              aria-label="Rentabilidad"
              variant="outlined"
              sx={{ ...PANEL_SX, mb: 3, p: { xs: 2, md: 2.5 } }}
            >
              <SectionTitle
                action={
                  profit.marketPosition && (
                    <Pill tone={POSITION[profit.marketPosition.level]?.tone}>
                      {POSITION[profit.marketPosition.level]?.label || profit.marketPosition.level}
                    </Pill>
                  )
                }
              >
                Rentabilidad
              </SectionTitle>

              {profit.marketPosition?.message && (
                <Typography variant="body2" sx={{ color: BRAND.muted, mb: 2.5 }}>
                  {profit.marketPosition.message}
                </Typography>
              )}

              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                }}
              >
                <Figure
                  label="Tu costo total por unidad"
                  value={money(profit.totalUnitCost, profit.currency)}
                />
                <Figure
                  label="Empezás a ganar desde"
                  hint="Por debajo de este precio, cada venta te da pérdida"
                  value={money(profit.breakEvenPrice, profit.currency)}
                />
                {prices?.median && (
                  <Figure
                    label="Precio típico del mercado"
                    value={money(prices.median, prices.currency)}
                  />
                )}
              </Box>

              {profit.scenarios ? (
                <>
                  <Typography sx={{ fontWeight: 800, fontSize: 14, mt: 3, mb: 1.5 }}>
                    Qué ganás según a cuánto vendas
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 1.5,
                      gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                    }}
                  >
                    {SCENARIOS.map(([key, label]) => {
                      const scenario = profit.scenarios[key]
                      if (!scenario) return null
                      const tone = scenario.profitable ? 'success' : 'error'

                      return (
                        <Box
                          key={key}
                          sx={{
                            p: 1.5,
                            borderRadius: 3,
                            border: `1px solid ${BRAND.line}`,
                            minWidth: 0,
                          }}
                        >
                          <Typography sx={{ fontSize: 12, fontWeight: 700, color: BRAND.muted }}>
                            {label} · {money(scenario.price, profit.currency)}
                          </Typography>
                          <Typography
                            sx={{
                              fontFamily: DISPLAY_FONT,
                              fontWeight: 800,
                              fontSize: { xs: 16, sm: 18 },
                              whiteSpace: 'nowrap',
                              fontVariantNumeric: 'tabular-nums',
                              color: TONE[tone].color,
                            }}
                          >
                            {scenario.profit > 0 ? '+' : ''}
                            {money(scenario.profit, profit.currency)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: BRAND.muted }}>
                            {percent(scenario.marginPercent)} de margen
                          </Typography>
                        </Box>
                      )
                    })}
                  </Box>
                </>
              ) : (
                <Alert severity="info" sx={{ mt: 2, borderRadius: 3 }}>
                  No se encontraron precios de mercado para comparar, así que solo se muestra tu
                  precio de equilibrio.
                </Alert>
              )}

              {costSources && Object.keys(costSources).length > 0 && (
                <Box sx={{ mt: 3 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 1 }}>
                    De dónde salen tus costos
                  </Typography>
                  <Box
                    component="dl"
                    sx={{
                      m: 0,
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' },
                      columnGap: 3,
                      rowGap: { xs: 0.25, sm: 0.75 },
                    }}
                  >
                    {COST_SOURCE_ROWS.filter(([key]) => costSources[key]).map(([key, label]) => (
                      <React.Fragment key={key}>
                        <Typography component="dt" variant="body2" sx={{ fontWeight: 700 }}>
                          {label}
                        </Typography>
                        <Typography
                          component="dd"
                          variant="body2"
                          sx={{ m: 0, mb: { xs: 1, sm: 0 }, color: BRAND.muted }}
                        >
                          {describeCostSource(key, costSources)}
                        </Typography>
                      </React.Fragment>
                    ))}
                  </Box>
                </Box>
              )}

              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 3,
                  p: 1.5,
                  borderRadius: 3,
                  color: BRAND.amber,
                  bgcolor: TONE.warning.bg,
                }}
              >
                Cálculo orientativo. El impuesto se aplica sobre el precio de venta como un costo
                más; si sos responsable inscripto tu carga real es distinta porque computás crédito
                fiscal. Sirve para comparar productos y descartar los que no cierran, no para fijar
                precios finales.
              </Typography>
            </Paper>
          )}

          {profit && !profit.viable && (
            <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }}>
              {profit.message}
            </Alert>
          )}

          {/* El desglose solo tiene sentido si hubo un score que desglosar.
              Mostrar seis guiones debajo de "no se pudo medir" no informa
              nada y sugiere que algo falló. */}
          {!unmeasurable && (
            <Paper
              component="section"
              aria-label="Desglose del score"
              variant="outlined"
              sx={{ ...PANEL_SX, mb: 3, p: { xs: 2, md: 2.5 } }}
            >
              <SectionTitle>Desglose del score</SectionTitle>

              <Box
                sx={{
                  display: 'grid',
                  gap: 1.5,
                  gridTemplateColumns: {
                    xs: 'repeat(2, 1fr)',
                    sm: 'repeat(3, 1fr)',
                    md: 'repeat(6, 1fr)',
                  },
                }}
              >
                {Object.entries(result.breakdown || {}).map(([key, value]) => {
                  const source = COMPONENT_SOURCE[key]
                  const measured = value !== null && value !== undefined

                  return (
                    <Tooltip key={key} title={source?.help || ''} placement="top">
                      <Box
                        sx={{
                          p: 1.5,
                          borderRadius: 3,
                          bgcolor: measured ? BRAND.paper : 'transparent',
                          border: `1px ${measured ? 'solid' : 'dashed'} ${BRAND.line}`,
                          cursor: source?.help ? 'help' : 'default',
                        }}
                      >
                        <Typography sx={{ fontSize: 12, fontWeight: 700, color: BRAND.muted }}>
                          {COMPONENT_LABELS[key] || key}
                        </Typography>
                        <Typography
                          sx={{
                            fontFamily: DISPLAY_FONT,
                            fontWeight: 800,
                            fontSize: 22,
                            fontVariantNumeric: 'tabular-nums',
                            color: measured ? BRAND.ink : '#9aa3c0',
                          }}
                        >
                          {measured
                            ? `${SOURCE_MARK[source?.kind] || ''}${Math.round(value)}`
                            : '—'}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>

              {Array.isArray(result.unmeasured) && result.unmeasured.length > 0 && (
                <Typography variant="body2" sx={{ mt: 1.5, color: BRAND.muted }}>
                  Sin datos para: {result.unmeasured.map(k => COMPONENT_LABELS[k] || k).join(', ')}
                </Typography>
              )}

              <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${BRAND.line}` }}>
                <Typography variant="caption" sx={{ display: 'block', color: BRAND.muted }}>
                  <strong>≈</strong> señal estimada a partir de lo que se encontró buscando en la
                  web · <strong>◐</strong> combina datos de tu tienda con información externa
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.5, color: BRAND.muted }}
                >
                  Los puntajes todavía no están calibrados con datos históricos. Sirven para
                  comparar productos entre sí, no como medidas absolutas: un 70 significa "más que
                  un 50", no "70% de demanda".
                </Typography>
              </Box>
            </Paper>
          )}

          <Paper
            component="section"
            aria-label="Señales del mercado"
            variant="outlined"
            sx={{ ...PANEL_SX, mb: 3, p: { xs: 2, md: 2.5 } }}
          >
            <SectionTitle>Señales del mercado</SectionTitle>

            {prices && (
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: BRAND.muted, mb: 1 }}>
                  Precios encontrados ({prices.sampleSize} ofertas)
                  {result?.rawSignals?.shopping?.merchantCount > 0 &&
                    ` · ${result.rawSignals.shopping.merchantCount} vendedores distintos`}
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                    maxWidth: 560,
                  }}
                >
                  <Figure label="Más barato" value={money(prices.min, prices.currency)} />
                  <Figure label="Típico" value={money(prices.median, prices.currency)} />
                  <Figure label="Más caro" value={money(prices.max, prices.currency)} />
                </Box>

                {/* Las ofertas concretas con link. Un "12 vendedores" que
                    el comercio no puede verificar no le sirve para juzgar
                    si la muestra representa su mercado o trae ruido. */}
                {offers.length > 0 && (
                  <Accordion elevation={0} disableGutters sx={{ ...PLAIN_ACCORDION_SX, mt: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: BRAND.blue }}>
                        Ver de dónde salen estos precios
                      </Typography>
                    </AccordionSummary>

                    <AccordionDetails sx={{ px: 0 }}>
                      <Stack divider={<Divider sx={{ borderColor: BRAND.line }} />} spacing={1}>
                        {offers.map((offer, i) => (
                          <Stack
                            key={offer.link || `${offer.title}-${i}`}
                            direction="row"
                            spacing={2}
                            sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                          >
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap title={offer.title}>
                                {offer.link ? (
                                  <ExternalLink href={offer.link}>{offer.title}</ExternalLink>
                                ) : (
                                  offer.title
                                )}
                              </Typography>
                              <Typography variant="caption" sx={{ color: BRAND.muted }}>
                                {offer.merchant || 'Vendedor no identificado'}
                                {offer.reviewCount ? ` · ${offer.reviewCount} reseñas` : ''}
                                {offer.rating ? ` · ${offer.rating}★` : ''}
                              </Typography>
                            </Box>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {money(offer.price, offer.currency || prices?.currency)}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>

                      <Typography
                        variant="caption"
                        sx={{ display: 'block', mt: 2, color: BRAND.muted }}
                      >
                        Un precio por tienda, tomado de la página que figura en cada link. Abrilo y
                        verificá: la muestra es chica y puede haber tiendas del rubro que no
                        aparezcan. Fijate también si lo que lista cada página es realmente
                        comparable a lo que vendés vos.
                      </Typography>
                    </AccordionDetails>
                  </Accordion>
                )}
              </Box>
            )}

            {research?.available && (
              <Stack
                spacing={1}
                sx={{ py: 2, borderTop: prices ? `1px solid ${BRAND.line}` : 'none' }}
              >
                <Typography variant="body2">
                  <strong>Competencia:</strong>{' '}
                  {COMPETITION_LEVEL[research.competition?.level] ||
                    research.competition?.level ||
                    'Sin datos'}
                </Typography>

                {research.competition?.knownBrands?.length > 0 && (
                  <Typography variant="body2">
                    <strong>Marcas presentes:</strong> {research.competition.knownBrands.join(', ')}
                  </Typography>
                )}

                {research.recurringComplaints?.length > 0 && (
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, mt: 1 }}>
                      Quejas frecuentes de compradores
                    </Typography>
                    <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, color: BRAND.muted }}>
                      {research.recurringComplaints.map(complaint => (
                        <Typography component="li" variant="body2" key={complaint}>
                          {complaint}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Las páginas, con su link. Decir "12 fuentes consultadas"
                    y no mostrarlas pide fe: son URLs reales que devolvió el
                    buscador, y abrirlas es la única forma de que el
                    comerciante juzgue si lo que leyó la IA sirve. */}
                {research.sources?.length > 0 && (
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, mt: 1 }}>
                      Páginas leídas ({research.sources.length})
                    </Typography>
                    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                      {research.sources.slice(0, 8).map(fuente => (
                        <Stack
                          key={fuente.url}
                          direction="row"
                          spacing={0.75}
                          sx={{ alignItems: 'center', minWidth: 0 }}
                        >
                          <OpenInNewIcon sx={{ fontSize: 14, color: BRAND.muted, flexShrink: 0 }} />
                          <Typography variant="caption" noWrap title={fuente.title}>
                            <ExternalLink href={fuente.url}>
                              {fuente.title || fuente.url}
                            </ExternalLink>
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Stack>
            )}

            {/* De dónde salió cada cosa y qué falta. Acá aparecía el error
                crudo del proveedor, en inglés, que no le dice a un
                comerciante ni qué se perdió del análisis ni qué hacer. */}
            {sources.length > 0 && (
              <Box sx={{ pt: 2, borderTop: `1px solid ${BRAND.line}` }}>
                <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 1.5 }}>
                  De dónde salieron los datos
                </Typography>

                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.5,
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
                  }}
                >
                  {sources.map(source => (
                    <Box
                      key={source.key}
                      sx={{
                        p: 1.5,
                        borderRadius: 3,
                        border: `1px solid ${BRAND.line}`,
                        minWidth: 0,
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {source.label}
                        </Typography>
                        <Pill tone={source.available ? 'success' : 'default'}>
                          {source.available ? 'Respondió' : 'Sin datos'}
                        </Pill>
                      </Stack>
                      <Typography variant="caption" sx={{ display: 'block', color: BRAND.muted }}>
                        {source.role}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.75 }}>
                        {source.detail}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ mt: 2.5, alignItems: { sm: 'center' } }}
            >
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => handleAnalyze(true)}
                disabled={!canAnalyze}
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
              >
                Volver a analizar con datos frescos
              </Button>
              <Typography variant="caption" sx={{ color: BRAND.muted }}>
                Consulta las fuentes de nuevo en lugar de usar el resultado guardado. Gasta un
                análisis.
              </Typography>
            </Stack>
          </Paper>

          <Accordion
            elevation={0}
            disableGutters
            sx={{
              ...PLAIN_ACCORDION_SX,
              border: `1px solid ${BRAND.line}`,
              borderRadius: '16px !important',
              bgcolor: BRAND.paper,
              px: { xs: 2, md: 2.5 },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
                Cómo funciona el análisis
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0, pt: 0 }}>
              <HowItWorks />
            </AccordionDetails>
          </Accordion>
        </Box>
      )}
    </Box>
  )
}
