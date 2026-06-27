import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Analytics as AnalyticsIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  People as UsersIcon,
  Payments as PaymentsIcon,
  Refresh as RefreshIcon,
  RemoveShoppingCart as AbandonedCartIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
  ShoppingCart as CartIcon,
  TrendingUp as TrendIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
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

import { analyticsAPI } from '../services/api'

const DEBUG = process.env.REACT_APP_DEBUG_API === 'true'

const CHART_COLORS = {
  primary: '#2563EB',
  success: '#16A34A',
  warning: '#F59E0B',
  error: '#DC2626',
  purple: '#7C3AED',
  slate: '#475569',
  teal: '#0D9488',
}

const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

const formatMoney = value =>
  `$${Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const formatPercent = value => `${Number(value || 0).toFixed(2)}%`

const safeArray = value => (Array.isArray(value) ? value : [])

const firstNonEmptyArray = (...values) => {
  return values.find(value => Array.isArray(value) && value.length > 0) || []
}

const toNumber = value => {
  const parsed = Number(value ?? 0)

  return Number.isFinite(parsed) ? parsed : 0
}

const getSummarySessions = (summary = {}, userBehavior = {}) => {
  return toNumber(summary.sessions ?? userBehavior.sessions ?? 0)
}

const getPaidOrders = (summary = {}) => {
  return toNumber(summary.paidOrders ?? summary.orders ?? 0)
}

const formatDateLabel = value => {
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

const mergeDailyMetricRows = (...rowGroups) => {
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

const buildDailyRows = data => {
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

const getVerticalChartHeight = (rows = [], minHeight = 340) => {
  const count = Array.isArray(rows) ? rows.length : 0
  return Math.max(minHeight, count * 48 + 90)
}

const truncateText = (value, max = 28) => {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const getResponseData = response => response?.data?.data || response?.data || {}


const normalizeLookupKey = value => String(value || '').trim().toLowerCase()

const getProductKeyFromPath = path => {
  const cleanPath = String(path || '').split('?')[0].replace(/\/+$/, '')

  if (!cleanPath.startsWith('/product/')) return ''

  const rawValue = cleanPath.replace(/^\/product\//, '').split('/')[0]

  if (!rawValue || rawValue === 'product') return ''

  try {
    return decodeURIComponent(rawValue)
  } catch {
    return rawValue
  }
}

const getProductImage = product => {
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

const getProductDisplayName = product => {
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

const buildProductCatalog = (...groups) => {
  const byKey = new Map()
  const catalog = []

  groups.flatMap(group => safeArray(group)).forEach(product => {
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

  return catalog
}

const buildProductLookup = (...groups) => {
  const lookup = new Map()

  groups.flatMap(group => safeArray(group)).forEach(product => {
    getProductIdentityKeys(product).forEach(key => {
      if (!lookup.has(key)) {
        lookup.set(key, product)
      }
    })
  })

  return lookup
}

const getPageLabel = path => {
  const cleanPath = String(path || '/').split('?')[0].replace(/\/+$/, '') || '/'

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

const normalizeTopPageRows = (rows, productLookup) => {
  return safeArray(rows).slice(0, 8).map(row => {
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

const normalizeSearchRows = (rows, productCatalog, productLookup) => {
  return safeArray(rows).slice(0, 8).map(row => {
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
    <Stack direction="row" spacing={1.25} alignItems="center">
      <ProductThumbnail
        image={item.image}
        title={item.title}
        fallback={item.isProductPage ? 'PR' : 'PG'}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={800} noWrap title={item.title}>
          {item.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap title={item.path}>
          {item.isProductPage ? 'Producto visitado' : item.path}
        </Typography>
      </Box>
      <Stack spacing={0.5} alignItems="flex-end" sx={{ flexShrink: 0 }}>
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
    <Stack direction="row" spacing={1.25} alignItems="center">
      <ProductThumbnail
        image={item.image}
        title={item.title}
        fallback="BQ"
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={800} noWrap title={item.title}>
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

const buildFunnelChartData = (userBehavior = {}, payment = {}, summary = {}) => {
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
      name: 'Compra',
      value: toNumber(userBehavior.purchases ?? getPaidOrders(summary)),
      description: 'Compras aprobadas.',
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


const normalizeTopProductRows = rows => {
  return safeArray(rows).slice(0, 10).map(row => {
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

const DashboardSectionTitle = ({ title, description }) => (
  <Box sx={{ mb: 2 }}>
    <Typography variant="h6" fontWeight={800}>
      {title}
    </Typography>
    {description && (
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    )}
  </Box>
)

const KpiCard = ({ title, value, icon: Icon, color, description, trend }) => (
  <Card sx={{ height: '100%', borderRadius: 3 }}>
    <CardContent>
      <Stack direction="row" spacing={2} alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography color="text.secondary" variant="overline" fontWeight={800}>
            {title}
          </Typography>
          <Typography variant="h4" fontWeight={900} sx={{ mt: 0.5 }}>
            {value}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {description}
            </Typography>
          )}
          {trend !== undefined && trend !== null && Number(trend) !== 0 && (
            <Chip
              size="small"
              label={`${Number(trend) > 0 ? '+' : ''}${Number(trend).toFixed(2)}% vs período anterior`}
              color={Number(trend) >= 0 ? 'success' : 'error'}
              variant="outlined"
              sx={{ mt: 1 }}
            />
          )}
        </Box>
        <Box
          sx={{
            width: 46,
            height: 46,
            borderRadius: 2.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: `${color || CHART_COLORS.primary}18`,
            color: color || CHART_COLORS.primary,
            flexShrink: 0,
          }}
        >
          <Icon fontSize="medium" />
        </Box>
      </Stack>
    </CardContent>
  </Card>
)

const EmptyState = ({ message }) => (
  <Box sx={{ py: 5, textAlign: 'center' }}>
    <Typography variant="body2" color="text.secondary">
      {message}
    </Typography>
  </Box>
)

const BarTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload?.length) return null

  return (
    <Paper sx={{ p: 1.5, borderRadius: 2 }} elevation={4}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {payload.map(item => (
        <Typography key={item.dataKey} variant="body2" fontWeight={700}>
          {item.name || item.dataKey}: {formatter ? formatter(item.value, item.dataKey) : formatNumber(item.value)}
        </Typography>
      ))}
    </Paper>
  )
}

const AnalyticsDashboardView = ({ onOpenConfig }) => {
  const { enqueueSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [days, setDays] = useState(30)

  const fetchData = useCallback(async ({ silent = false } = {}) => {
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

      if (DEBUG) {
        console.log('[Dashboard analytics payload]', payload)
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
  }, [days, enqueueSnackbar])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      fetchData({ silent: true })
    }, 30000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fetchData])

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
  const productLookup = useMemo(
    () => buildProductLookup(productCatalog),
    [productCatalog],
  )
  const topSellingProducts = useMemo(
    () =>
      normalizeTopProductRows(
        firstNonEmptyArray(data?.topProducts, ecommerce?.topSellingProducts),
      ),
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
  const cartComparisonRows = useMemo(() => [
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
  ], [activeCarts, abandonedCarts, summary])
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
          <Tooltip title="Reintentar">
            <IconButton onClick={() => fetchData()} color="inherit">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        }
      >
        {error}
      </Alert>
    )
  }

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={900}>
            Vista descriptiva del negocio
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Datos internos del tenant: ventas, tráfico, carritos, productos y conversión real.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5} alignItems="center">
          <Select
            size="small"
            value={days}
            onChange={event => setDays(Number(event.target.value))}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value={7}>Últimos 7 días</MenuItem>
            <MenuItem value={30}>Últimos 30 días</MenuItem>
            <MenuItem value={90}>Últimos 90 días</MenuItem>
            <MenuItem value={180}>Últimos 180 días</MenuItem>
          </Select>

          <Tooltip title="Actualizar">
            <span>
              <IconButton onClick={() => fetchData()} disabled={loading || refreshing}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>

          <Button variant="outlined" startIcon={<SettingsIcon />} onClick={onOpenConfig}>
            GA4
          </Button>
        </Stack>
      </Stack>

      {data?.status === 'not_configured' && (
        <Alert severity="info" sx={{ mb: 3 }}>
          GA4 no está configurado, pero las métricas internas de Henko se muestran igual.
        </Alert>
      )}

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Ventas aprobadas"
            value={loading ? <Skeleton width={90} /> : formatMoney(summary.revenue)}
            icon={TrendIcon}
            trend={summary.revenueGrowth}
            color={CHART_COLORS.primary}
            description="Ingresos de órdenes pagadas en el período."
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Órdenes pagadas"
            value={loading ? <Skeleton width={90} /> : formatNumber(paidOrders)}
            icon={CartIcon}
            trend={summary.ordersGrowth}
            color={CHART_COLORS.success}
            description="Órdenes con pago aprobado y estado activo."
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Ticket promedio"
            value={loading ? <Skeleton width={90} /> : formatMoney(summary.averageOrderValue)}
            icon={PaymentsIcon}
            color={CHART_COLORS.warning}
            description="Revenue pagado dividido por órdenes pagadas."
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Conversión real"
            value={loading ? <Skeleton width={90} /> : formatPercent(summary.conversionRate)}
            icon={UsersIcon}
            color={CHART_COLORS.teal}
            description="Órdenes pagadas sobre sesiones del storefront."
          />
        </Grid>
      </Grid>

      <DashboardSectionTitle
        title="Carritos"
        description="Diferenciamos carritos activos de abandonados para entender intención de compra y recuperación potencial."
      />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Carritos activos"
            value={loading ? <Skeleton width={80} /> : formatNumber(summary.activeCarts)}
            icon={CartIcon}
            color={CHART_COLORS.success}
            description="Carritos con productos y actividad reciente."
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Valor activo"
            value={loading ? <Skeleton width={80} /> : formatMoney(summary.activeCartValue)}
            icon={CartIcon}
            color={CHART_COLORS.teal}
            description="Valor estimado en carritos activos."
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Carritos abandonados"
            value={loading ? <Skeleton width={80} /> : formatNumber(summary.abandonedCarts)}
            icon={AbandonedCartIcon}
            color={CHART_COLORS.error}
            description="Carritos sin actividad después del umbral."
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <KpiCard
            title="Valor abandonado"
            value={loading ? <Skeleton width={80} /> : formatMoney(summary.abandonedCartValue)}
            icon={AbandonedCartIcon}
            color={CHART_COLORS.purple}
            description="Potencial recuperable en carritos abandonados."
          />
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <Card sx={{ height: '100%', borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle
                title="Ventas, sesiones y carritos reales por día"
                description="Cruza revenue pagado, sesiones reales y carritos activos/abandonados desde MongoDB."
              />
              <Box height={360}>
                {loading ? (
                  <Skeleton variant="rectangular" height={360} />
                ) : dailyRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyRows} margin={{ top: 8, right: 18, bottom: 18, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={formatDateLabel} minTickGap={18} />
                      <YAxis
                        yAxisId="money"
                        tickFormatter={value => `$${Number(value || 0).toLocaleString('es-AR')}`}
                      />
                      <YAxis yAxisId="count" orientation="right" allowDecimals={false} />
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
                      <Bar yAxisId="money" dataKey="revenue" name="Ventas" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
                      <Bar yAxisId="count" dataKey="sessions" name="Sesiones" fill={CHART_COLORS.slate} radius={[6, 6, 0, 0]} />
                      <Bar yAxisId="count" dataKey="activeCarts" name="Carritos activos" fill={CHART_COLORS.success} radius={[6, 6, 0, 0]} />
                      <Bar yAxisId="count" dataKey="abandonedCarts" name="Carritos abandonados" fill={CHART_COLORS.error} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay actividad diaria suficiente." />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%', borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle
                title="Activos vs abandonados"
                description="Comparación directa de cantidad de carritos y productos involucrados."
              />
              <Box height={330}>
                {loading ? (
                  <Skeleton variant="rectangular" height={330} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cartComparisonRows}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={<BarTooltip formatter={(value, key) => key === 'valor' ? formatMoney(value) : formatNumber(value)} />}
                      />
                      <Bar dataKey="cantidad" name="Carritos" fill={CHART_COLORS.success} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="productos" name="Productos" fill={CHART_COLORS.warning} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <DashboardSectionTitle
        title="Productos"
        description="Compará lo que más vende contra lo que más visita la audiencia."
      />

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={4}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle
                title="Productos más vendidos"
                description="Ordenados por revenue aprobado."
              />
              <Box height={loading ? 340 : getVerticalChartHeight(topSellingProducts, 360)}>
                {loading ? (
                  <Skeleton variant="rectangular" height={340} />
                ) : topSellingProducts.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topSellingProducts.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 28, bottom: 8, left: 12 }} barCategoryGap={14}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={formatMoney} />
                      <YAxis dataKey="name" type="category" width={180} interval={0} tick={{ fontSize: 12 }} />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip content={<BarTooltip formatter={value => formatMoney(value)} />} />
                      <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.primary} radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay productos vendidos." />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle
                title="Productos más visitados"
                description="Ordenados por vistas de producto y enriquecidos con clicks y add to cart."
              />
              <Box height={loading ? 340 : getVerticalChartHeight(topVisitedProducts, 360)}>
                {loading ? (
                  <Skeleton variant="rectangular" height={340} />
                ) : topVisitedProducts.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topVisitedProducts.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 28, bottom: 8, left: 12 }} barCategoryGap={14}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis dataKey="name" type="category" width={180} interval={0} tick={{ fontSize: 12 }} />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip content={<BarTooltip formatter={value => formatNumber(value)} />} />
                      <Bar dataKey="views" name="Vistas" fill={CHART_COLORS.purple} radius={[0, 8, 8, 0]} maxBarSize={26} />
                      <Bar dataKey="clicks" name="Clicks" fill={CHART_COLORS.warning} radius={[0, 8, 8, 0]} maxBarSize={26} />
                      <Bar dataKey="addToCart" name="Add to cart" fill={CHART_COLORS.success} radius={[0, 8, 8, 0]} maxBarSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay visitas de productos registradas." />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle
                title="Productos con más clicks"
                description="Clicks por producto desde cards, listados, búsquedas o bloques promocionales."
              />
              <Box
                height={
                  loading
                    ? 340
                    : getVerticalChartHeight(topClickedProducts, 360)
                }
              >
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
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis
                        dataKey="name"
                        type="category"
                        width={180}
                        interval={0}
                        tick={{ fontSize: 12 }}
                      />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={
                          <BarTooltip formatter={value => formatNumber(value)} />
                        }
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
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} lg={7}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle
                title="Funnel de conversión"
                description="Cada barra usa conteos reales: sesiones, vistas, clicks, carrito, checkout, pagos y compras."
              />
              <Box height={360}>
                {loading ? (
                  <Skeleton variant="rectangular" height={360} />
                ) : funnelRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnelRows} layout="vertical" margin={{ left: 20, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis dataKey="name" type="category" width={125} />
                      <RechartsTooltip content={<BarTooltip formatter={(value, key) => key === 'rate' ? formatPercent(value) : formatNumber(value)} />} />
                      <Bar dataKey="value" name="Eventos reales" fill={CHART_COLORS.teal} radius={[0, 8, 8, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay eventos suficientes para el funnel." />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card sx={{ borderRadius: 3, height: '100%' }}>
            <CardContent>
              <DashboardSectionTitle
                title="Tráfico por fuente"
                description="Sesiones y conversiones agrupadas por UTM source."
              />
              <Box height={360}>
                {loading ? (
                  <Skeleton variant="rectangular" height={360} />
                ) : trafficRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trafficRows} layout="vertical" margin={{ left: 15, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="channel" type="category" width={110} />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip content={<BarTooltip formatter={value => formatNumber(value)} />} />
                      <Bar dataKey="sessions" name="Sesiones" fill={CHART_COLORS.slate} radius={[0, 8, 8, 0]} />
                      <Bar dataKey="conversions" name="Conversiones" fill={CHART_COLORS.success} radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay fuentes de tráfico registradas." />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle title="Últimos carritos activos" />
              <Stack spacing={1.5}>
                {safeArray(activeCarts.latest).length ? (
                  safeArray(activeCarts.latest).slice(0, 6).map(cart => (
                    <Paper key={cart.cartId} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                      <Stack direction="row" justifyContent="space-between" spacing={2}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={800} noWrap>
                            Carrito #{String(cart.cartId || '').slice(-6)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatNumber(cart.itemCount)} productos · {new Date(cart.updatedAt).toLocaleString('es-AR')}
                          </Typography>
                        </Box>
                        <Typography variant="body2" fontWeight={900}>
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
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <DashboardSectionTitle
                title="Productos, páginas y búsquedas destacadas"
                description="Cuando la URL pertenece a un producto, se muestra nombre e imagen en lugar del path técnico."
              />
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
                    Productos o páginas más vistas
                  </Typography>
                  <Stack spacing={1}>
                    {topPages.length ? topPages.map(page => (
                      <PageInsightItem key={page.path} item={page} />
                    )) : <Typography variant="body2" color="text.secondary">Sin visitas.</Typography>}
                  </Stack>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
                    Búsquedas frecuentes
                  </Typography>
                  <Stack spacing={1}>
                    {topSearches.length ? topSearches.map(search => (
                      <SearchInsightItem key={`${search.query}-${search.productId || 'query'}`} item={search} />
                    )) : <Typography variant="body2" color="text.secondary">Sin búsquedas.</Typography>}
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}

const AnalyticsConfigView = ({ onConfigurationSuccess }) => {
  const { enqueueSnackbar } = useSnackbar()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState(null)
  const [showJsonDialog, setShowJsonDialog] = useState(false)
  const [showHelpDialog, setShowHelpDialog] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [showApiSecret, setShowApiSecret] = useState(false)
  const [jsonError, setJsonError] = useState('')
  const [isJsonValid, setIsJsonValid] = useState(false)
  const [formData, setFormData] = useState({
    measurementId: '',
    apiSecret: '',
    serviceAccountJson: '',
    propertyId: '',
  })

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const response = await analyticsAPI.getStatus()
      const payload = getResponseData(response)
      setStatus(payload)

      if (payload.configured) {
        setFormData(prev => ({
          ...prev,
          measurementId: payload.measurementId || prev.measurementId,
          propertyId: payload.propertyId || prev.propertyId,
        }))
      }
    } catch {
      enqueueSnackbar('Error cargando configuración', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [enqueueSnackbar])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const handleInputChange = field => event => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value,
    }))
  }

  const validateServiceAccountJson = value => {
    if (!String(value || '').trim()) {
      setJsonError('')
      setIsJsonValid(false)
      return false
    }

    try {
      const parsed = JSON.parse(value)
      const required = ['type', 'project_id', 'private_key', 'client_email']
      const missing = required.filter(field => !parsed[field])

      if (missing.length > 0) {
        setJsonError(`Faltan campos requeridos: ${missing.join(', ')}`)
        setIsJsonValid(false)
        return false
      }

      if (parsed.type !== 'service_account') {
        setJsonError('El tipo debe ser "service_account"')
        setIsJsonValid(false)
        return false
      }

      setJsonError('')
      setIsJsonValid(true)
      return true
    } catch (error) {
      setJsonError(`JSON inválido: ${error.message}`)
      setIsJsonValid(false)
      return false
    }
  }

  const handleJsonChange = event => {
    const value = event.target.value
    setFormData(prev => ({ ...prev, serviceAccountJson: value }))
    validateServiceAccountJson(value)
  }

  const handleSave = async () => {
    const measurementId = String(formData.measurementId || '').trim().toUpperCase()

    if (!/^G-[A-Z0-9]{6,}$/i.test(measurementId)) {
      enqueueSnackbar('Measurement ID inválido. Usá el formato completo G-XXXXXXXXXX.', {
        variant: 'warning',
      })
      return
    }

    if (formData.serviceAccountJson && !isJsonValid) {
      enqueueSnackbar('Corregí el JSON del Service Account', { variant: 'warning' })
      return
    }

    try {
      setSaving(true)
      const payload = { measurementId }

      if (formData.apiSecret) payload.apiSecret = formData.apiSecret
      if (formData.propertyId) payload.propertyId = formData.propertyId
      if (formData.serviceAccountJson) payload.serviceAccountJson = formData.serviceAccountJson

      await analyticsAPI.configure(payload)
      enqueueSnackbar('Configuración guardada correctamente', { variant: 'success' })

      setFormData(prev => ({ ...prev, apiSecret: '', serviceAccountJson: '' }))
      setIsJsonValid(false)
      await fetchStatus()
      onConfigurationSuccess?.()
    } catch (error) {
      enqueueSnackbar(error.response?.data?.message || 'Error guardando configuración', {
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    try {
      setTesting(true)
      await analyticsAPI.getDashboard({ days: 7 })
      enqueueSnackbar('Conexión probada correctamente', { variant: 'success' })
    } catch (error) {
      enqueueSnackbar(`Error de conexión: ${error.response?.data?.message || error.message}`, {
        variant: 'error',
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={5}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Card sx={{ mb: 3, borderRadius: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h6" fontWeight={800}>Estado de conexión</Typography>
              <Typography variant="body2" color="text.secondary">
                GA4 es opcional. Las métricas internas funcionan sin configurar Google Analytics.
              </Typography>
            </Box>
            {status?.configured ? (
              <Chip icon={<CheckIcon />} label="Conectado" color="success" />
            ) : (
              <Chip icon={<ErrorIcon />} label="No configurado" color="warning" variant="outlined" />
            )}
          </Stack>

          {status?.configured && (
            <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
              <Chip size="small" label={`Measurement ID: ${status.measurementId || 'configurado'}`} />
              <Chip
                size="small"
                label={status.hasMeasurementProtocol ? 'Measurement Protocol ✓' : 'Measurement Protocol ✗'}
                color={status.hasMeasurementProtocol ? 'success' : 'default'}
              />
              <Chip
                size="small"
                label={status.hasReportingAccess ? 'Reporting API ✓' : 'Reporting API ✗'}
                color={status.hasReportingAccess ? 'success' : 'default'}
              />
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
            <Box>
              <Typography variant="h6" fontWeight={800}>
                <SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                Configuración GA4
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Usá Measurement ID para tracking y Service Account para Reporting API.
              </Typography>
            </Box>
            <Button size="small" onClick={() => setShowHelpDialog(true)}>
              Ver guía paso a paso
            </Button>
          </Stack>

          <Stack spacing={3}>
            <TextField
              fullWidth
              label="Measurement ID"
              placeholder="G-XXXXXXXXXX"
              value={formData.measurementId}
              onChange={handleInputChange('measurementId')}
              helperText="Copiá el ID completo de tu Data Stream GA4."
            />

            <TextField
              fullWidth
              label="Property ID"
              placeholder="123456789"
              value={formData.propertyId}
              onChange={handleInputChange('propertyId')}
              helperText="Necesario para Reporting API. Es numérico, no es el Measurement ID."
            />

            <TextField
              fullWidth
              type={showApiSecret ? 'text' : 'password'}
              label="API Secret opcional"
              value={formData.apiSecret}
              onChange={handleInputChange('apiSecret')}
              helperText="Solo para Measurement Protocol server-side."
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowApiSecret(prev => !prev)} edge="end">
                      {showApiSecret ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: 'grey.50',
                cursor: 'pointer',
                borderColor: isJsonValid ? 'success.main' : jsonError ? 'error.main' : 'divider',
              }}
              onClick={() => setShowJsonDialog(true)}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                  {formData.serviceAccountJson ? (
                    isJsonValid ? <CheckIcon color="success" /> : <ErrorIcon color="error" />
                  ) : (
                    <InfoIcon color="action" />
                  )}
                  <Typography>
                    {formData.serviceAccountJson
                      ? isJsonValid
                        ? 'JSON válido cargado'
                        : 'JSON con errores'
                      : status?.hasReportingAccess
                        ? 'Service Account ya configurado. Click para actualizar.'
                        : 'Click para pegar JSON del Service Account'}
                  </Typography>
                </Stack>
                <Button size="small" variant="outlined">
                  {formData.serviceAccountJson ? 'Editar' : 'Pegar JSON'}
                </Button>
              </Stack>
              {jsonError && <Alert severity="error" sx={{ mt: 2 }}>{jsonError}</Alert>}
            </Paper>

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={saving}
                startIcon={saving ? <CircularProgress size={18} /> : <SaveIcon />}
              >
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </Button>

              {status?.configured && (
                <Button
                  variant="outlined"
                  onClick={handleTest}
                  disabled={testing}
                  startIcon={testing ? <CircularProgress size={18} /> : <RefreshIcon />}
                >
                  {testing ? 'Probando...' : 'Probar conexión'}
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={showJsonDialog} onClose={() => setShowJsonDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Service Account JSON</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={15}
            value={formData.serviceAccountJson}
            onChange={handleJsonChange}
            error={Boolean(jsonError)}
            helperText={jsonError || 'Pegá el contenido completo del JSON descargado desde Google Cloud.'}
            sx={{
              '& .MuiInputBase-input': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
          />
          <Alert severity="warning" sx={{ mt: 2 }}>
            Este JSON contiene claves privadas. Guardalo solo en el backend y no lo compartas.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowJsonDialog(false)}>Cancelar</Button>
          <Button
            onClick={() => setShowJsonDialog(false)}
            variant="contained"
            disabled={!isJsonValid && Boolean(formData.serviceAccountJson)}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showHelpDialog} onClose={() => setShowHelpDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Guía de configuración GA4</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} orientation="vertical">
            {[
              ['Crear propiedad GA4', 'Entrá a Google Analytics → Admin → Create Property.'],
              ['Obtener Measurement ID', 'Admin → Data Streams → copiá el ID con formato G-XXXXXXXXXX.'],
              ['Crear Service Account', 'Google Cloud Console → IAM & Admin → Service Accounts → Create.'],
              ['Descargar JSON', 'Service Account → Keys → Create new key → JSON.'],
              ['Dar permisos en GA4', 'GA4 → Admin → Property Access Management → agregá el email del service account.'],
              ['Configurar en Henko', 'Pegá Measurement ID, Property ID y JSON en este formulario.'],
            ].map(([label, content], index) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
                <StepContent>
                  <Typography variant="body2" sx={{ mb: 1 }}>{content}</Typography>
                  <Button disabled={index === 0} onClick={() => setActiveStep(index - 1)} sx={{ mr: 1 }}>
                    Atrás
                  </Button>
                  <Button variant="contained" disabled={index === 5} onClick={() => setActiveStep(index + 1)}>
                    Siguiente
                  </Button>
                </StepContent>
              </Step>
            ))}
          </Stepper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setShowHelpDialog(false); setActiveStep(0) }}>
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

const Dashboard = () => {
  const [tab, setTab] = useState(0)

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={900} gutterBottom>
            <AnalyticsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Métricas
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Ventas, carritos activos, carritos abandonados, productos visitados y conversión del tenant actual.
          </Typography>
        </Box>
      </Stack>

      <Paper sx={{ mb: 3, borderRadius: 3 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab label="Dashboard" />
          <Tab label="Configuración GA4" />
        </Tabs>
      </Paper>

      {tab === 0 && <AnalyticsDashboardView onOpenConfig={() => setTab(1)} />}
      {tab === 1 && <AnalyticsConfigView onConfigurationSuccess={() => setTab(0)} />}
    </Box>
  )
}

export default Dashboard
