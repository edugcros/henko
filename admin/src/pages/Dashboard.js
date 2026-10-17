import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { fetchTenantSettings } from '../features/tenant/tenantSlice'
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  Analytics as AnalyticsIcon,
  AutoAwesome as SparkleIcon,
  Campaign as CampaignIcon,
  People as UsersIcon,
  Payments as PaymentsIcon,
  Refresh as RefreshIcon,
  RemoveShoppingCart as AbandonedCartIcon,
  ShoppingCart as CartIcon,
  SmartToy as AiIcon,
  TrendingUp as TrendIcon,
  WhatsApp as WhatsAppIcon,
} from '@mui/icons-material'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useSnackbar } from 'notistack'
import api from '@utils/axiosConfig'

import { analyticsAPI } from '../services/api'
import { getPlanName } from '../constants/plans.js'

const DEBUG = process.env.REACT_APP_DEBUG_API === 'true'

// Identidad de Henkart (la misma de la pantalla de planes, las de acceso y Mi suscripción).
const BRAND = {
  navy: '#050b1f',
  blue: '#0b6bff',
  violet: '#7a2cff',
  cyan: '#14d8ff',
  muted: '#55618a',
  line: '#dfe6fb',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const HERO_BG = [
  'radial-gradient(420px 260px at 6% 0%, rgba(11,107,255,0.34), transparent 70%)',
  'radial-gradient(380px 300px at 100% 100%, rgba(122,44,255,0.3), transparent 70%)',
  BRAND.navy,
].join(', ')

const CHART_COLORS = {
  primary: BRAND.blue,
  success: '#12b76a',
  warning: '#f79009',
  error: '#f04438',
  purple: BRAND.violet,
  slate: '#8892b0',
  teal: '#06b6d4',
}

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const LABEL_SX = {
  display: 'block',
  color: 'text.secondary',
  fontWeight: 700,
  letterSpacing: '0.12em',
  lineHeight: 1.6,
}

const GRID_PROPS = { strokeDasharray: '3 3', stroke: '#e8edfb' }
const AXIS_TICK = { fill: BRAND.muted, fontSize: 12 }

const PERIOD_OPTIONS = [7, 30, 90, 180]

const PERIOD_GROUP_SX = {
  bgcolor: 'rgba(255,255,255,0.08)',
  borderRadius: 3,
  '& .MuiToggleButton-root': {
    color: '#d7e1ff',
    border: 'none',
    borderRadius: 3,
    '&.Mui-selected': {
      color: '#fff',
      bgcolor: BRAND.blue,
      '&:hover': { bgcolor: BRAND.blue },
    },
  },
}

// El estado de la suscripción, dicho en palabras. Lo que no se reconoce se lee «Ninguna».
const SUBSCRIPTION_STATUS = {
  active: { label: 'Activa', color: 'success' },
  trialing: { label: 'En prueba', color: 'info' },
  past_due: { label: 'Pendiente de pago', color: 'warning' },
  cancelled: { label: 'Cancelada', color: 'error' },
  none: { label: 'Ninguna', color: 'default' },
}

export const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

export const formatMoney = value =>
  `$${Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export const formatPercent = value => `${Number(value || 0).toFixed(2)}%`

export const safeArray = value => (Array.isArray(value) ? value : [])

export const firstNonEmptyArray = (...values) => {
  return values.find(value => Array.isArray(value) && value.length > 0) || []
}

export const toNumber = value => {
  const parsed = Number(value ?? 0)

  return Number.isFinite(parsed) ? parsed : 0
}

export const getSummarySessions = (summary = {}, userBehavior = {}) => {
  return toNumber(summary.sessions ?? userBehavior.sessions ?? 0)
}

export const getPaidOrders = (summary = {}) => {
  return toNumber(summary.paidOrders ?? summary.orders ?? 0)
}

export const formatDateLabel = value => {
  const raw = String(value || '')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const [, month, day] = raw.split('-')

  return `${day}/${month}`
}

const normalizeDailyRow = row => ({
  ...row,
  date: row?.date || row?._id || '',
  revenue: toNumber(row?.revenue),
  orders: toNumber(row?.orders),
  items: toNumber(row?.items),
  events: toNumber(row?.events),
  sessions: toNumber(row?.sessions),
  pageViews: toNumber(row?.pageViews),
  productViews: toNumber(row?.productViews),
  productClicks: toNumber(row?.productClicks),
  addToCart: toNumber(row?.addToCart),
  checkoutStarts: toNumber(row?.checkoutStarts),
  conversions: toNumber(row?.conversions),
  carts: toNumber(row?.carts),
  activeCarts: toNumber(row?.activeCarts),
  abandonedCarts: toNumber(row?.abandonedCarts),
  cartItems: toNumber(row?.cartItems),
  cartValue: toNumber(row?.cartValue),
  activeCartValue: toNumber(row?.activeCartValue),
  abandonedCartValue: toNumber(row?.abandonedCartValue),
})

export const mergeDailyMetricRows = (...rowGroups) => {
  const byDate = new Map()

  rowGroups.forEach(group => {
    safeArray(group).forEach(rawRow => {
      const row = normalizeDailyRow(rawRow)

      if (!row.date) return

      const current = byDate.get(row.date) || normalizeDailyRow({ date: row.date })

      byDate.set(row.date, {
        ...current,
        ...row,
        revenue: Math.max(current.revenue, row.revenue),
        orders: Math.max(current.orders, row.orders),
        items: Math.max(current.items, row.items),
        events: Math.max(current.events, row.events),
        sessions: Math.max(current.sessions, row.sessions),
        pageViews: Math.max(current.pageViews, row.pageViews),
        productViews: Math.max(current.productViews, row.productViews),
        productClicks: Math.max(current.productClicks, row.productClicks),
        addToCart: Math.max(current.addToCart, row.addToCart),
        checkoutStarts: Math.max(current.checkoutStarts, row.checkoutStarts),
        conversions: Math.max(current.conversions, row.conversions),
        carts: Math.max(current.carts, row.carts),
        activeCarts: Math.max(current.activeCarts, row.activeCarts),
        abandonedCarts: Math.max(current.abandonedCarts, row.abandonedCarts),
        cartItems: Math.max(current.cartItems, row.cartItems),
        cartValue: Math.max(current.cartValue, row.cartValue),
        activeCartValue: Math.max(current.activeCartValue, row.activeCartValue),
        abandonedCartValue: Math.max(current.abandonedCartValue, row.abandonedCartValue),
      })
    })
  })

  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

export const buildDailyRows = data => {
  const trends = data?.trends || {}
  const userBehavior = data?.userBehavior || {}

  return mergeDailyMetricRows(
    trends.dailyWithCarts,
    trends.daily,
    trends.cartDaily,
    trends.dailyRevenue,
    trends.dailyOrders,
    userBehavior.dailyActivity,
  )
}

export const getVerticalChartHeight = (rows = [], minHeight = 340) => {
  const count = Array.isArray(rows) ? rows.length : 0
  return Math.max(minHeight, count * 48 + 90)
}

export const truncateText = (value, max = 28) => {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const getResponseData = response => response?.data?.data || response?.data || {}

const normalizeLookupKey = value =>
  String(value || '')
    .trim()
    .toLowerCase()

export const getProductKeyFromPath = path => {
  const cleanPath = String(path || '')
    .split('?')[0]
    .replace(/\/+$/, '')

  if (!cleanPath.startsWith('/product/')) return ''

  const rawValue = cleanPath.replace(/^\/product\//, '').split('/')[0]

  if (!rawValue || rawValue === 'product') return ''

  try {
    return decodeURIComponent(rawValue)
  } catch {
    return rawValue
  }
}

export const getProductImage = product => {
  const candidates = [
    product?.image,
    product?.imageUrl,
    product?.thumbnail,
    product?.thumbnailUrl,
    product?.coverImage,
    product?.featuredImage,
    product?.mainImage,
    product?.primaryImage,
    product?.productImage,
    product?.photo,
    product?.picture,
    product?.media?.[0],
    product?.gallery?.[0],
    product?.images?.[0],
  ]

  const resolveCandidate = candidate => {
    if (!candidate) return ''

    if (typeof candidate === 'string') return candidate

    return (
      candidate.secure_url ||
      candidate.secureUrl ||
      candidate.url ||
      candidate.src ||
      candidate.path ||
      candidate.location ||
      ''
    )
  }

  return candidates.map(resolveCandidate).find(Boolean) || ''
}

export const getProductDisplayName = product => {
  return (
    product?.fullName ||
    product?.title ||
    product?.name ||
    product?.productTitle ||
    product?.productName ||
    product?.slug ||
    product?.productId ||
    'Producto'
  )
}

const getProductIdentityKeys = product => {
  return [
    product?.productId,
    product?._id,
    product?.id,
    product?.slug,
    product?.productSlug,
    getProductKeyFromPath(product?.path),
    getProductKeyFromPath(product?.url),
  ]
    .map(normalizeLookupKey)
    .filter(Boolean)
}

export const buildProductCatalog = (...groups) => {
  const byKey = new Map()
  const catalog = []

  groups
    .flatMap(group => safeArray(group))
    .forEach(product => {
      const keys = getProductIdentityKeys(product)
      const primaryKey = keys[0]

      if (!primaryKey) return

      const existing = byKey.get(primaryKey)

      if (existing) {
        const merged = {
          ...existing,
          ...product,
          title: getProductDisplayName(product) || getProductDisplayName(existing),
          image: getProductImage(product) || getProductImage(existing),
        }

        keys.forEach(key => byKey.set(key, merged))
        return
      }

      const normalized = {
        ...product,
        title: getProductDisplayName(product),
        image: getProductImage(product),
      }

      keys.forEach(key => byKey.set(key, normalized))
      catalog.push(normalized)
    })

  // Se devuelve la versión COMBINADA, no la primera que se vio. El mapa guardaba el producto ya
  // enriquecido con los datos de las otras listas, pero el arreglo devuelto seguía apuntando al
  // original: si la primera lista no traía imagen y otra sí, la imagen se perdía y las páginas
  // destacadas mostraban el cuadrito de relleno en lugar del producto.
  return catalog.map(product => byKey.get(getProductIdentityKeys(product)[0]) || product)
}

export const buildProductLookup = (...groups) => {
  const lookup = new Map()

  groups
    .flatMap(group => safeArray(group))
    .forEach(product => {
      getProductIdentityKeys(product).forEach(key => {
        if (!lookup.has(key)) {
          lookup.set(key, product)
        }
      })
    })

  return lookup
}

export const getPageLabel = path => {
  const cleanPath =
    String(path || '/')
      .split('?')[0]
      .replace(/\/+$/, '') || '/'

  const labels = {
    '/': 'Inicio',
    '/cart': 'Carrito',
    '/checkout': 'Checkout',
    '/profile': 'Perfil',
    '/login': 'Login',
    '/wishlist': 'Wishlist',
    '/product': 'Listado de productos',
    '/store': 'Tienda',
    '/our-store': 'Tienda',
  }

  return labels[cleanPath] || cleanPath
}

export const normalizeTopPageRows = (rows, productLookup) => {
  return safeArray(rows)
    .slice(0, 8)
    .map(row => {
      const productKey = normalizeLookupKey(getProductKeyFromPath(row.path))
      const product = productKey ? productLookup.get(productKey) : null
      const isProductPage = Boolean(product)
      const title = isProductPage ? getProductDisplayName(product) : getPageLabel(row.path)

      return {
        ...row,
        isProductPage,
        title,
        image: isProductPage ? getProductImage(product) : '',
        productId: product?.productId || product?._id || product?.id || productKey || '',
        path: row.path || '/',
        views: toNumber(row.views),
        sessions: toNumber(row.sessions),
      }
    })
}

export const normalizeSearchRows = (rows, productCatalog, productLookup) => {
  return safeArray(rows)
    .slice(0, 8)
    .map(row => {
      const query = String(row.query || row.term || row.search || '').trim()
      const queryKey = normalizeLookupKey(query)
      const directProduct = productLookup.get(normalizeLookupKey(row.productId || row.productSlug))
      const matchedProduct =
        directProduct ||
        safeArray(productCatalog).find(product => {
          const title = normalizeLookupKey(getProductDisplayName(product))
          const slug = normalizeLookupKey(product?.slug || product?.productSlug)

          return Boolean(queryKey && (title.includes(queryKey) || slug.includes(queryKey)))
        })

      return {
        ...row,
        query,
        title: matchedProduct ? getProductDisplayName(matchedProduct) : query || 'Búsqueda',
        image: matchedProduct ? getProductImage(matchedProduct) : '',
        productId: matchedProduct?.productId || matchedProduct?._id || matchedProduct?.id || '',
        count: toNumber(row.count || row.searches || row.events),
        sessions: toNumber(row.sessions),
        hasProductMatch: Boolean(matchedProduct),
      }
    })
}

const ProductThumbnail = ({ image, title, fallback }) => (
  <Box
    sx={{
      width: 48,
      height: 48,
      borderRadius: 2,
      overflow: 'hidden',
      flexShrink: 0,
      bgcolor: 'grey.100',
      border: '1px solid',
      borderColor: 'divider',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'text.secondary',
      fontWeight: 900,
      fontSize: 13,
    }}
  >
    {image ? (
      <Box
        component="img"
        src={image}
        alt={title || 'Producto'}
        loading="lazy"
        onError={event => {
          event.currentTarget.style.display = 'none'
        }}
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    ) : (
      fallback
    )}
  </Box>
)

const PageInsightItem = ({ item }) => (
  <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      <ProductThumbnail
        image={item.image}
        title={item.title}
        fallback={item.isProductPage ? 'PR' : 'PG'}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap title={item.title}>
          {item.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap title={item.path}>
          {item.isProductPage ? 'Producto visitado' : item.path}
        </Typography>
      </Box>
      <Stack spacing={0.5} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
        <Chip size="small" label={`${formatNumber(item.views)} vistas`} />
        {item.sessions > 0 && (
          <Typography variant="caption" color="text.secondary">
            {formatNumber(item.sessions)} sesiones
          </Typography>
        )}
      </Stack>
    </Stack>
  </Paper>
)

const SearchInsightItem = ({ item }) => (
  <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      <ProductThumbnail image={item.image} title={item.title} fallback="BQ" />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap title={item.title}>
          {item.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap title={item.query}>
          {item.hasProductMatch ? `Búsqueda: ${item.query}` : item.query}
        </Typography>
      </Box>
      <Chip size="small" label={formatNumber(item.count)} sx={{ flexShrink: 0 }} />
    </Stack>
  </Paper>
)

export const buildFunnelChartData = (userBehavior = {}, payment = {}, summary = {}) => {
  const sessions = getSummarySessions(summary, userBehavior)

  const rows = [
    {
      name: 'Sesiones',
      value: sessions,
      description: 'Sesiones reales del storefront.',
    },
    {
      name: 'Vistas producto',
      value: toNumber(userBehavior.productViews),
      description: 'Eventos product_view registrados.',
    },
    {
      name: 'Clicks producto',
      value: toNumber(userBehavior.productClicks),
      description: 'Eventos product_click registrados.',
    },
    {
      name: 'Carrito',
      value: toNumber(userBehavior.addToCart),
      description: 'Eventos add_to_cart registrados.',
    },
    {
      name: 'Checkout',
      value: toNumber(userBehavior.checkoutStarts),
      description: 'Eventos begin_checkout registrados.',
    },
    {
      name: 'Pago',
      value: toNumber(userBehavior.paymentAttempts ?? payment.attempts),
      description: 'Intentos de pago registrados.',
    },
    {
      // Órdenes pagadas, la MISMA cifra que la tarjeta "Órdenes pagadas" de
      // arriba. Acá se leía userBehavior.purchases, que cuenta eventos: cada
      // venta deja uno del navegador y otro del backend, así que el último
      // escalón del embudo mostraba el doble de compras que órdenes hubo —6
      // contra 3 en producción— y una conversión de pago del 200%.
      //
      // El conteo de eventos quedó como respaldo por si el resumen no trae
      // órdenes, no como preferencia.
      name: 'Compra',
      value: toNumber(summary.paidOrders ?? summary.orders ?? userBehavior.purchases),
      description: 'Órdenes pagadas en el período.',
    },
  ]

  return rows.map((row, index) => {
    const previousValue = index === 0 ? row.value : rows[index - 1].value
    const rate = previousValue > 0 ? (row.value / previousValue) * 100 : 0

    return {
      ...row,
      rate,
      label: `${formatNumber(row.value)} · ${formatPercent(rate)}`,
    }
  })
}

export const normalizeTopProductRows = rows => {
  return safeArray(rows)
    .slice(0, 10)
    .map(row => {
      const fullName = getProductDisplayName(row)

      return {
        ...row,
        name: truncateText(fullName, 24),
        fullName,
        image: getProductImage(row),
        revenue: toNumber(row.revenue),
        views: toNumber(row.views),
        clicks: toNumber(row.clicks),
        addToCart: toNumber(row.addToCart),
        sessions: toNumber(row.sessions),
        quantity: toNumber(row.quantity),
      }
    })
}

const DashboardSectionTitle = ({ title, description, level = 'h2' }) => (
  <Box sx={{ mb: 2.5 }}>
    <Typography
      component={level}
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: level === 'h2' ? 22 : 18,
        letterSpacing: '-0.01em',
      }}
    >
      {title}
    </Typography>
    {description && (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
        {description}
      </Typography>
    )}
  </Box>
)

const IconChip = ({ icon: Icon, color = BRAND.blue, size = 44 }) => (
  <Box
    aria-hidden="true"
    sx={{
      width: size,
      height: size,
      borderRadius: 3,
      display: 'grid',
      placeItems: 'center',
      flexShrink: 0,
      bgcolor: `${color}1a`,
      color,
    }}
  >
    <Icon sx={{ fontSize: size * 0.5 }} />
  </Box>
)

const KpiCard = ({ title, value, icon: Icon, color, trend }) => (
  <Box>
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1.25 }}>
      <IconChip icon={Icon} color={color} size={34} />
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
    </Stack>
    <Typography
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: 28,
        lineHeight: 1.15,
        letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Typography>
    {trend !== undefined && trend !== null && Number(trend) !== 0 && (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 1 }}>
        <TrendIcon
          sx={{
            fontSize: 16,
            color: Number(trend) >= 0 ? 'success.main' : 'error.main',
            transform: Number(trend) < 0 ? 'rotate(180deg)' : 'none',
          }}
        />
        <Typography
          variant="caption"
          sx={{ fontWeight: 700 }}
          color={Number(trend) >= 0 ? 'success.main' : 'error.main'}
        >
          {Number(trend) > 0 ? '+' : ''}
          {Number(trend).toFixed(1)}%
        </Typography>
        <Typography variant="caption" color="text.disabled">
          vs anterior
        </Typography>
      </Stack>
    )}
  </Box>
)

const ChartCard = ({ title, description, children }) => (
  <Paper
    variant="outlined"
    // Los textos de los gráficos (SVG) heredan la tipografía de la tarjeta: sin esto salían en la del sistema.
    sx={{
      ...PANEL_SX,
      p: { xs: 2.5, md: 3 },
      height: '100%',
      fontFamily: 'Roboto, ui-sans-serif, system-ui, sans-serif',
    }}
  >
    <DashboardSectionTitle title={title} description={description} level="h3" />
    {children}
  </Paper>
)

const EmptyState = ({ message }) => (
  <Box sx={{ py: 6, textAlign: 'center' }}>
    <Box
      sx={{
        width: 48,
        height: 48,
        borderRadius: 3,
        bgcolor: 'action.hover',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mx: 'auto',
        mb: 1.5,
      }}
    >
      <AnalyticsIcon sx={{ fontSize: 24, color: 'text.disabled' }} />
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
      {message}
    </Typography>
  </Box>
)

const BarTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload?.length) return null

  return (
    <Paper
      sx={{
        p: 1.5,
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      }}
      elevation={0}
    >
      <Typography
        variant="caption"
        color="text.secondary"

        sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}
      >
        {label}
      </Typography>
      {payload.map(item => (
        <Stack
          key={item.dataKey}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', py: 0.25 }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: item.fill || item.color,
            }}
          />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {item.name || item.dataKey}:{' '}
            {formatter ? formatter(item.value, item.dataKey) : formatNumber(item.value)}
          </Typography>
        </Stack>
      ))}
    </Paper>
  )
}

const AnalyticsDashboardView = () => {
  const navigate = useNavigate()
  // En un celular los nombres de producto no pueden quitarle 180 px al gráfico: las barras quedaban
  // aplastadas contra el borde.
  const isNarrow = useMediaQuery('(max-width:600px)')
  const { enqueueSnackbar } = useSnackbar()
  // Sin este guard, el polling seguía tirando /api/dash/stats cada 30s aún
  // con la sesión caída: el interceptor de axios reintenta un refresh en 401
  // y navega a /login si falla, pero mientras eso ocurre el intervalo ya
  // disparó el siguiente request. Cortar el interval en cuanto
  // isAuthenticated cae a false frena el ruido y evita que la pestaña siga
  // hablando con el backend después de un logout implícito.
  const isAuthenticated = useSelector(state => state.user?.isAuthenticated)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [days, setDays] = useState(30)
  const [subscriptionMetrics, setSubscriptionMetrics] = useState(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(true)

  const fetchData = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }

        setError(null)

        const response = await analyticsAPI.getDashboard({
          days,
          compare: true,
          t: Date.now(),
        })

        const payload = getResponseData(response)

        if (DEBUG && process.env.NODE_ENV !== 'production') {
          console.debug('[Dashboard analytics payload]', payload)
        }

        setData(payload)
      } catch (err) {
        const message = err.response?.data?.message || 'Error cargando analytics'
        setError(message)
        enqueueSnackbar('Error cargando estadísticas', { variant: 'error' })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [days, enqueueSnackbar],
  )

  const fetchSubscriptionMetrics = useCallback(async () => {
    try {
      setSubscriptionLoading(true)
      const response = await api.get('/dash/subscription-metrics')
      if (response.data?.success && response.data?.data) {
        setSubscriptionMetrics(response.data.data)
      }
    } catch (err) {
      console.error('Error cargando métricas de suscripción:', err)
    } finally {
      setSubscriptionLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    fetchData()
    fetchSubscriptionMetrics()
  }, [fetchData, fetchSubscriptionMetrics, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) return undefined

    const intervalId = window.setInterval(() => {
      fetchData({ silent: true })
      fetchSubscriptionMetrics()
    }, 30000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fetchData, fetchSubscriptionMetrics, isAuthenticated])

  const summary = data?.summary || {}
  const userBehavior = data?.userBehavior || {}
  const ecommerce = data?.ecommerce || {}
  const activeCarts = data?.activeCarts || ecommerce?.carts?.active || {}
  const abandonedCarts = data?.abandonedCarts || ecommerce?.carts?.abandoned || {}
  const paidOrders = getPaidOrders(summary)
  const productCatalog = useMemo(
    () =>
      buildProductCatalog(
        data?.topProducts,
        ecommerce?.topSellingProducts,
        data?.topVisitedProducts,
        ecommerce?.topVisitedProducts,
        data?.topClickedProducts,
        ecommerce?.topClickedProducts,
      ),
    [data, ecommerce],
  )
  const productLookup = useMemo(() => buildProductLookup(productCatalog), [productCatalog])
  const topSellingProducts = useMemo(
    () =>
      normalizeTopProductRows(firstNonEmptyArray(data?.topProducts, ecommerce?.topSellingProducts)),
    [data, ecommerce],
  )
  const topVisitedProducts = useMemo(
    () =>
      normalizeTopProductRows(
        firstNonEmptyArray(data?.topVisitedProducts, ecommerce?.topVisitedProducts),
      ),
    [data, ecommerce],
  )
  const topClickedProducts = useMemo(
    () =>
      normalizeTopProductRows(
        firstNonEmptyArray(data?.topClickedProducts, ecommerce?.topClickedProducts),
      ),
    [data, ecommerce],
  )
  const cartComparisonRows = useMemo(
    () => [
      {
        name: 'Activos',
        cantidad: Number(activeCarts.count || summary.activeCarts || 0),
        productos: Number(activeCarts.items || summary.activeCartItems || 0),
        valor: Number(activeCarts.value || summary.activeCartValue || 0),
      },
      {
        name: 'Abandonados',
        cantidad: Number(abandonedCarts.count || summary.abandonedCarts || 0),
        productos: Number(abandonedCarts.items || summary.abandonedCartItems || 0),
        valor: Number(abandonedCarts.value || summary.abandonedCartValue || 0),
      },
    ],
    [activeCarts, abandonedCarts, summary],
  )
  const funnelRows = useMemo(
    () => buildFunnelChartData(userBehavior, ecommerce?.payment, summary),
    [userBehavior, ecommerce, summary],
  )
  const dailyRows = useMemo(() => buildDailyRows(data), [data])
  const trafficRows = firstNonEmptyArray(data?.traffic?.sources, userBehavior?.sources).slice(0, 8)
  const topPages = useMemo(
    () => normalizeTopPageRows(userBehavior?.topPages, productLookup).slice(0, 6),
    [userBehavior?.topPages, productLookup],
  )
  const topSearches = useMemo(
    () => normalizeSearchRows(userBehavior?.topSearches, productCatalog, productLookup).slice(0, 6),
    [userBehavior?.topSearches, productCatalog, productLookup],
  )

  if (error) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => fetchData()}>
            Reintentar
          </Button>
        }
      >
        {error}
      </Alert>
    )
  }

  const statusInfo = SUBSCRIPTION_STATUS[subscriptionMetrics?.status] || SUBSCRIPTION_STATUS.none

  return (
    <Stack spacing={5}>
      {/* ── Encabezado y período ───────────────────────── */}
      <Box
        component="header"
        sx={{
          p: { xs: 2.5, md: 3.5 },
          mb: 3,
          borderRadius: 4,
          color: '#fff',
          background: HERO_BG,
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2.5}
          sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'center' } }}
        >
          <Box>
            <Typography
              variant="overline"
              sx={{ color: BRAND.cyan, fontWeight: 700, letterSpacing: '0.16em' }}
            >
              TU TIENDA
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
              Panel de control
            </Typography>
            <Typography sx={{ mt: 1, color: '#b9c6ee', maxWidth: 560 }}>
              Ventas, tráfico, carritos, productos y conversión en tiempo real.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={days}
              onChange={(_, value) => {
                if (value !== null) setDays(Number(value))
              }}
              aria-label="Período"
              sx={PERIOD_GROUP_SX}
            >
              {PERIOD_OPTIONS.map(option => (
                <ToggleButton
                  key={option}
                  value={option}
                  aria-label={`Últimos ${option} días`}
                  sx={{ px: 1.75, textTransform: 'none', fontWeight: 700 }}
                >
                  {option} días
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Tooltip title="Actualizar">
              <span>
                <IconButton
                  aria-label="Actualizar"
                  onClick={() => fetchData()}
                  disabled={loading || refreshing}
                  sx={{
                    color: '#fff',
                    bgcolor: 'rgba(255,255,255,0.12)',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' },
                    '&.Mui-disabled': { color: 'rgba(255,255,255,0.4)' },
                  }}
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>

      {/* ── Plan de suscripción ───────────────────────── */}
      {subscriptionMetrics && (
        <Paper
          component="section"
          aria-label="Tu plan"
          variant="outlined"
          sx={{ ...PANEL_SX, p: { xs: 2.5, md: 3 } }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={3}
            sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <IconChip icon={PaymentsIcon} />
              <Box>
                <Typography variant="overline" sx={LABEL_SX}>
                  TU PLAN
                </Typography>
                <Stack
                  direction="row"
                  spacing={1.25}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 22 }}>
                    {subscriptionLoading ? (
                      <Skeleton width={100} />
                    ) : (
                      // El nombre sale de constants/plans.js. Acá había una
                      // cadena de ternarios que además mentía: cualquier plan
                      // desconocido caía en 'Profesional', así que se mostraba
                      // como Pro algo que no lo era.
                      getPlanName(subscriptionMetrics.currentPlan)
                    )}
                  </Typography>
                  {!subscriptionLoading && (
                    <Chip
                      size="small"
                      label={statusInfo.label}
                      color={statusInfo.color}
                      sx={{ fontWeight: 700 }}
                    />
                  )}
                </Stack>
              </Box>
            </Stack>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 2, sm: 5 }}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <Box>
                <Typography variant="overline" sx={LABEL_SX}>
                  CUOTA MENSUAL DEL PLAN
                </Typography>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}>
                  {subscriptionLoading ? (
                    <Skeleton width={90} />
                  ) : subscriptionMetrics.mrr > 0 ? (
                    formatMoney(subscriptionMetrics.mrr)
                  ) : (
                    '—'
                  )}
                </Typography>
              </Box>

              <Box>
                <Typography variant="overline" sx={LABEL_SX}>
                  PRÓXIMO PAGO
                </Typography>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}>
                  {subscriptionLoading ? (
                    <Skeleton width={90} />
                  ) : subscriptionMetrics.nextBillingAt ? (
                    // Mostraba lastPaymentAt: el título prometía una fecha
                    // futura y el número era la del último cobro. El próximo
                    // cobro lo informa Mercado Pago y el backend lo guarda; lo
                    // que faltaba era servirlo y leerlo.
                    new Date(subscriptionMetrics.nextBillingAt).toLocaleDateString('es-AR')
                  ) : (
                    'No disponible'
                  )}
                </Typography>
              </Box>

              <Button
                variant="outlined"
                onClick={() => navigate('/admin/mi-suscripcion')}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 3, flexShrink: 0 }}
              >
                Administrar plan
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* ── Lo principal del período ──────────────────── */}
      <Paper component="section" aria-label="Resumen del período" variant="outlined" sx={PANEL_SX}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
          }}
        >
          {[
            {
              title: 'Ventas aprobadas',
              value: formatMoney(summary.revenue),
              icon: TrendIcon,
              trend: summary.revenueGrowth,
            },
            {
              title: 'Órdenes pagadas',
              value: formatNumber(paidOrders),
              icon: CartIcon,
              trend: summary.ordersGrowth,
            },
            {
              title: 'Ticket promedio',
              value: formatMoney(summary.averageOrderValue),
              icon: PaymentsIcon,
            },
            {
              title: 'Conversión real',
              value: formatPercent(summary.conversionRate),
              icon: UsersIcon,
            },
          ].map((stat, index) => (
            <Box
              key={stat.title}
              sx={{
                p: { xs: 2.5, md: 3 },
                borderTop: { xs: index === 0 ? 'none' : '1px solid', sm: 'none' },
                borderLeft: { lg: index === 0 ? 'none' : '1px solid' },
                borderColor: 'divider',
                ...(index >= 2 && { borderTop: { sm: '1px solid', lg: 'none' } }),
              }}
            >
              <KpiCard
                title={stat.title}
                value={loading ? <Skeleton width={100} /> : stat.value}
                icon={stat.icon}
                trend={stat.trend}
              />
            </Box>
          ))}
        </Box>
      </Paper>

      <Box component="section">
        <DashboardSectionTitle
          title="Valor generado por HENKO"
          description="Ventas con atribución de campaña, influencia de IA o recuperación de carrito, sumadas una sola vez por orden aunque cumplan más de una condición a la vez."
        />

        <Box
          component="section"
          aria-label="Valor generado por HENKO"
          sx={{
            p: { xs: 2.5, md: 3.5 },
            mb: 1.5,
            borderRadius: 4,
            color: '#fff',
            background: HERO_BG,
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1.4fr)' },
              gap: { xs: 3, lg: 5 },
              alignItems: 'center',
            }}
          >
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: BRAND.cyan }}>
                <SparkleIcon fontSize="small" />
                <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: '0.12em' }}>
                  Valor total generado por HENKO
                </Typography>
              </Stack>
              <Typography
                sx={{
                  mt: 0.5,
                  fontFamily: DISPLAY_FONT,
                  fontWeight: 800,
                  fontSize: { xs: 34, md: 44 },
                  letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {loading ? (
                  <Skeleton width={200} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
                ) : (
                  formatMoney(summary.totalGeneratedValue)
                )}
              </Typography>
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              {[
                { title: 'Ingreso por campañas', value: summary.metaRevenue, icon: CampaignIcon },
                {
                  title: 'Recuperado por WhatsApp',
                  value: summary.recoveredRevenue,
                  icon: WhatsAppIcon,
                },
                { title: 'Influenciado por IA', value: summary.aiInfluencedRevenue, icon: AiIcon },
              ].map(item => (
                <Box
                  key={item.title}
                  sx={{
                    p: 2,
                    borderRadius: 3,
                    bgcolor: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <item.icon sx={{ fontSize: 20, color: BRAND.cyan }} />
                  <Typography variant="body2" sx={{ mt: 1, color: '#b9c6ee', fontWeight: 600 }}>
                    {item.title}
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: DISPLAY_FONT,
                      fontWeight: 800,
                      fontSize: 22,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {loading ? (
                      <Skeleton width={90} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
                    ) : (
                      formatMoney(item.value)
                    )}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.5 }}>
          Cada recorte se calcula al momento de aprobar el pago: cuánto vino de campañas de Meta,
          cuánto se recuperó por WhatsApp y cuánto influyó el agente de IA. En un comercio con
          cancelaciones frecuentes pueden no sumar exacto contra las ventas aprobadas de arriba.
        </Typography>
      </Box>

      <Box component="section">
        <DashboardSectionTitle
          title="Carritos"
          description="Diferenciamos carritos activos de abandonados para entender intención de compra y recuperación potencial."
        />

        <Paper
          component="section"
          aria-label="Carritos"
          variant="outlined"
          sx={{ ...PANEL_SX, mb: 3 }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
            {[
              {
                group: 'activos',
                items: [
                  {
                    title: 'Carritos activos',
                    value: formatNumber(summary.activeCarts),
                    icon: CartIcon,
                  },
                  {
                    title: 'Valor activo',
                    value: formatMoney(summary.activeCartValue),
                    icon: PaymentsIcon,
                  },
                ],
                color: CHART_COLORS.success,
              },
              {
                group: 'abandonados',
                items: [
                  {
                    title: 'Carritos abandonados',
                    value: formatNumber(summary.abandonedCarts),
                    icon: AbandonedCartIcon,
                  },
                  {
                    title: 'Valor abandonado',
                    value: formatMoney(summary.abandonedCartValue),
                    icon: AbandonedCartIcon,
                  },
                ],
                color: CHART_COLORS.error,
              },
            ].map((group, index) => (
              <Box
                key={group.group}
                sx={{
                  p: { xs: 2.5, md: 3 },
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 2,
                  borderLeft: { md: index === 0 ? 'none' : '1px solid' },
                  borderTop: { xs: index === 0 ? 'none' : '1px solid', md: 'none' },
                  borderColor: 'divider',
                }}
              >
                {group.items.map(item => (
                  <KpiCard
                    key={item.title}
                    title={item.title}
                    value={loading ? <Skeleton width={80} /> : item.value}
                    icon={item.icon}
                    color={group.color}
                  />
                ))}
              </Box>
            ))}
          </Box>
        </Paper>

        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <ChartCard
              title="Ventas, sesiones y carritos por día"
              description="Cruza ventas pagadas, sesiones y carritos activos y abandonados, día por día."
            >
              <Box sx={{ height: 360 }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={360} />
                ) : dailyRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyRows} margin={{ top: 8, right: 18, bottom: 18, left: 8 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateLabel}
                        minTickGap={18}
                        tick={AXIS_TICK}
                      />
                      <YAxis
                        yAxisId="money"
                        tickFormatter={value => `$${Number(value || 0).toLocaleString('es-AR')}`}
                        tick={AXIS_TICK}
                      />
                      <YAxis
                        yAxisId="count"
                        orientation="right"
                        allowDecimals={false}
                        tick={AXIS_TICK}
                      />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={
                          <BarTooltip
                            formatter={(value, key) =>
                              key === 'revenue' ? formatMoney(value) : formatNumber(value)
                            }
                          />
                        }
                      />
                      <Bar
                        yAxisId="money"
                        dataKey="revenue"
                        name="Ventas"
                        fill={CHART_COLORS.primary}
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        yAxisId="count"
                        dataKey="sessions"
                        name="Sesiones"
                        fill={CHART_COLORS.slate}
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        yAxisId="count"
                        dataKey="activeCarts"
                        name="Carritos activos"
                        fill={CHART_COLORS.success}
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        yAxisId="count"
                        dataKey="abandonedCarts"
                        name="Carritos abandonados"
                        fill={CHART_COLORS.error}
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay actividad diaria suficiente." />
                )}
              </Box>
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <ChartCard
              title="Activos vs abandonados"
              description="Cuántos carritos y cuántos productos hay en cada grupo."
            >
              <Box sx={{ height: 330 }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={330} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cartComparisonRows}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="name" tick={AXIS_TICK} />
                      <YAxis tick={AXIS_TICK} />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={
                          <BarTooltip
                            formatter={(value, key) =>
                              key === 'valor' ? formatMoney(value) : formatNumber(value)
                            }
                          />
                        }
                      />
                      <Bar
                        dataKey="cantidad"
                        name="Carritos"
                        fill={CHART_COLORS.success}
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        dataKey="productos"
                        name="Productos"
                        fill={CHART_COLORS.warning}
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Box>
            </ChartCard>
          </Grid>
        </Grid>
      </Box>

      <Box component="section">
        <DashboardSectionTitle
          title="Productos"
          description="Compará lo que más vende contra lo que más visita la audiencia."
        />

        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, lg: 4 }}>
            <ChartCard title="Productos más vendidos" description="Ordenados por ventas aprobadas.">
              <Box sx={{ height: loading ? 340 : getVerticalChartHeight(topSellingProducts, 360) }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={340} />
                ) : topSellingProducts.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topSellingProducts.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 8, right: 28, bottom: 8, left: 12 }}
                      barCategoryGap={14}
                    >
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis type="number" tickFormatter={formatMoney} tick={AXIS_TICK} />
                      <YAxis
                        dataKey="name"
                        type="category"
                        width={isNarrow ? 110 : 180}
                        interval={0}
                        tick={AXIS_TICK}
                      />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={<BarTooltip formatter={value => formatMoney(value)} />}
                      />
                      <Bar
                        dataKey="revenue"
                        name="Ventas"
                        fill={CHART_COLORS.primary}
                        radius={[0, 8, 8, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay productos vendidos." />
                )}
              </Box>
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, lg: 4 }}>
            <ChartCard
              title="Productos más visitados"
              description="Ordenados por vistas, con sus clicks y las veces que se agregaron al carrito."
            >
              <Box sx={{ height: loading ? 340 : getVerticalChartHeight(topVisitedProducts, 360) }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={340} />
                ) : topVisitedProducts.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topVisitedProducts.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 8, right: 28, bottom: 8, left: 12 }}
                      barCategoryGap={14}
                    >
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} />
                      <YAxis
                        dataKey="name"
                        type="category"
                        width={isNarrow ? 110 : 180}
                        interval={0}
                        tick={AXIS_TICK}
                      />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={<BarTooltip formatter={value => formatNumber(value)} />}
                      />
                      <Bar
                        dataKey="views"
                        name="Vistas"
                        fill={CHART_COLORS.purple}
                        radius={[0, 8, 8, 0]}
                        maxBarSize={26}
                      />
                      <Bar
                        dataKey="clicks"
                        name="Clicks"
                        fill={CHART_COLORS.warning}
                        radius={[0, 8, 8, 0]}
                        maxBarSize={26}
                      />
                      <Bar
                        dataKey="addToCart"
                        name="Agregados al carrito"
                        fill={CHART_COLORS.success}
                        radius={[0, 8, 8, 0]}
                        maxBarSize={26}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay visitas de productos registradas." />
                )}
              </Box>
            </ChartCard>
          </Grid>

          <Grid size={{ xs: 12, lg: 4 }}>
            <ChartCard
              title="Productos con más clicks"
              description="Clicks por producto desde tarjetas, listados, búsquedas o bloques promocionales."
            >
              <Box sx={{ height: loading ? 340 : getVerticalChartHeight(topClickedProducts, 360) }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={340} />
                ) : topClickedProducts.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topClickedProducts.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 8, right: 28, bottom: 8, left: 12 }}
                      barCategoryGap={14}
                    >
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} />
                      <YAxis
                        dataKey="name"
                        type="category"
                        width={isNarrow ? 110 : 180}
                        interval={0}
                        tick={AXIS_TICK}
                      />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={<BarTooltip formatter={value => formatNumber(value)} />}
                      />
                      <Bar
                        dataKey="clicks"
                        name="Clicks"
                        fill={CHART_COLORS.purple}
                        radius={[0, 8, 8, 0]}
                        maxBarSize={26}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay clicks de productos registrados." />
                )}
              </Box>
            </ChartCard>
          </Grid>
        </Grid>
      </Box>

      {/* ── Conversión y tráfico ──────────────────────── */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <ChartCard
            title="Embudo de conversión"
            description="De las sesiones a las compras: cuántas personas llegan a cada paso."
          >
            <Box sx={{ height: 360 }}>
              {loading ? (
                <Skeleton variant="rectangular" height={360} />
              ) : funnelRows.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelRows} layout="vertical" margin={{ left: 20, right: 24 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} />
                    <YAxis dataKey="name" type="category" width={125} tick={AXIS_TICK} />
                    <RechartsTooltip
                      content={
                        <BarTooltip
                          formatter={(value, key) =>
                            key === 'rate' ? formatPercent(value) : formatNumber(value)
                          }
                        />
                      }
                    />
                    <Bar
                      dataKey="value"
                      name="Cantidad"
                      fill={CHART_COLORS.teal}
                      radius={[0, 8, 8, 0]}
                      maxBarSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState message="Todavía no hay eventos suficientes para el funnel." />
              )}
            </Box>
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <ChartCard
            title="Tráfico por fuente"
            description="Sesiones y conversiones según de dónde llegó cada visita."
          >
            <Box sx={{ height: 360 }}>
              {loading ? (
                <Skeleton variant="rectangular" height={360} />
              ) : trafficRows.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trafficRows} layout="vertical" margin={{ left: 15, right: 24 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis type="number" tick={AXIS_TICK} />
                    <YAxis dataKey="channel" type="category" width={110} tick={AXIS_TICK} />
                    <Legend verticalAlign="top" height={32} />
                    <RechartsTooltip
                      content={<BarTooltip formatter={value => formatNumber(value)} />}
                    />
                    <Bar
                      dataKey="sessions"
                      name="Sesiones"
                      fill={CHART_COLORS.slate}
                      radius={[0, 8, 8, 0]}
                    />
                    <Bar
                      dataKey="conversions"
                      name="Conversiones"
                      fill={CHART_COLORS.success}
                      radius={[0, 8, 8, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState message="Todavía no hay fuentes de tráfico registradas." />
              )}
            </Box>
          </ChartCard>
        </Grid>
      </Grid>

      {/* ── Detalle ───────────────────────────────────── */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Últimos carritos activos">
            <Stack spacing={1.5}>
              {safeArray(activeCarts.latest).length ? (
                safeArray(activeCarts.latest)
                  .slice(0, 6)
                  .map(cart => (
                    <Paper key={cart.cartId} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between' }} spacing={2}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                            Carrito #{String(cart.cartId || '').slice(-6)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatNumber(cart.itemCount)} productos ·{' '}
                            {new Date(cart.updatedAt).toLocaleString('es-AR')}
                          </Typography>
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {formatMoney(cart.value)}
                        </Typography>
                      </Stack>
                    </Paper>
                  ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No hay carritos activos recientes.
                </Typography>
              )}
            </Stack>
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard
            title="Productos, páginas y búsquedas destacadas"
            description="Cuando la URL pertenece a un producto, se muestra nombre e imagen en lugar de la dirección técnica."
          >
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Productos o páginas más vistas
                </Typography>
                <Stack spacing={1}>
                  {topPages.length ? (
                    topPages.map(page => <PageInsightItem key={page.path} item={page} />)
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Sin visitas.
                    </Typography>
                  )}
                </Stack>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Búsquedas frecuentes
                </Typography>
                <Stack spacing={1}>
                  {topSearches.length ? (
                    topSearches.map(search => (
                      <SearchInsightItem
                        key={`${search.query}-${search.productId || 'query'}`}
                        item={search}
                      />
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Sin búsquedas.
                    </Typography>
                  )}
                </Stack>
              </Grid>
            </Grid>
          </ChartCard>
        </Grid>
      </Grid>
    </Stack>
  )
}

const Dashboard = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const tenantData = useSelector(s => s.tenant?.data)
  const tenantLoaded = useSelector(s => s.tenant?.data !== null && !s.tenant?.isLoading)

  useEffect(() => {
    dispatch(fetchTenantSettings())
  }, [dispatch])

  useEffect(() => {
    if (tenantLoaded && tenantData?.onboarding && !tenantData.onboarding.completed) {
      navigate('/admin/onboarding', { replace: true })
    }
  }, [tenantLoaded, tenantData, navigate])

  // Acá había dos pestañas: el tablero y "Configuración GA4". La segunda no
  // podía funcionar —el formulario posteaba a /api/analytics/config, que no
  // existe, y el estado lo leía de /dash/stats, que responde "configurado"
  // siempre y nunca manda el measurementId— y del otro lado la tienda
  // inicializaba ReactGA con el placeholder 'G-XXXXXXXXXX', así que ningún
  // evento llegó nunca a Google. Se fue entera, con el formulario, el cliente
  // de API y la integración muerta del backend.
  return <AnalyticsDashboardView />
}

export default Dashboard
