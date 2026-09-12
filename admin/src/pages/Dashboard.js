import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { fetchTenantSettings } from '../features/tenant/tenantSlice'
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
  AutoAwesome as SparkleIcon,
  Campaign as CampaignIcon,
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
  SmartToy as AiIcon,
  TrendingUp as TrendIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
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

const CHART_COLORS = {
  primary: '#6366F1',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  purple: '#8B5CF6',
  slate: '#64748B',
  teal: '#14B8A6',
}

const KPI_GRADIENTS = {
  revenue: 'linear-gradient(135deg, #6366F1 0%, #818CF8 100%)',
  orders: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
  ticket: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
  conversion: 'linear-gradient(135deg, #14B8A6 0%, #2DD4BF 100%)',
  activeCarts: 'linear-gradient(135deg, #10B981 0%, #6EE7B7 100%)',
  activeValue: 'linear-gradient(135deg, #0EA5E9 0%, #38BDF8 100%)',
  abandonedCarts: 'linear-gradient(135deg, #EF4444 0%, #F87171 100%)',
  abandonedValue: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
  metaRevenue: 'linear-gradient(135deg, #EC4899 0%, #F472B6 100%)',
  recoveredRevenue: 'linear-gradient(135deg, #22C55E 0%, #4ADE80 100%)',
  aiInfluencedRevenue: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)',
  totalGeneratedValue: 'linear-gradient(135deg, #4338CA 0%, #A855F7 100%)',
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

      const current =
        byDate.get(row.date) || normalizeDailyRow({ date: row.date })

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
        abandonedCartValue: Math.max(
          current.abandonedCartValue,
          row.abandonedCartValue,
        ),
      })
    })
  })

  return Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  )
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

const normalizeLookupKey = value =>
  String(value || '')
    .trim()
    .toLowerCase()

const getProductKeyFromPath = path => {
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
          title:
            getProductDisplayName(product) || getProductDisplayName(existing),
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

const getPageLabel = path => {
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

const normalizeTopPageRows = (rows, productLookup) => {
  return safeArray(rows)
    .slice(0, 8)
    .map(row => {
      const productKey = normalizeLookupKey(getProductKeyFromPath(row.path))
      const product = productKey ? productLookup.get(productKey) : null
      const isProductPage = Boolean(product)
      const title = isProductPage
        ? getProductDisplayName(product)
        : getPageLabel(row.path)

      return {
        ...row,
        isProductPage,
        title,
        image: isProductPage ? getProductImage(product) : '',
        productId:
          product?.productId || product?._id || product?.id || productKey || '',
        path: row.path || '/',
        views: toNumber(row.views),
        sessions: toNumber(row.sessions),
      }
    })
}

const normalizeSearchRows = (rows, productCatalog, productLookup) => {
  return safeArray(rows)
    .slice(0, 8)
    .map(row => {
      const query = String(row.query || row.term || row.search || '').trim()
      const queryKey = normalizeLookupKey(query)
      const directProduct = productLookup.get(
        normalizeLookupKey(row.productId || row.productSlug),
      )
      const matchedProduct =
        directProduct ||
        safeArray(productCatalog).find(product => {
          const title = normalizeLookupKey(getProductDisplayName(product))
          const slug = normalizeLookupKey(product?.slug || product?.productSlug)

          return Boolean(
            queryKey && (title.includes(queryKey) || slug.includes(queryKey)),
          )
        })

      return {
        ...row,
        query,
        title: matchedProduct
          ? getProductDisplayName(matchedProduct)
          : query || 'Búsqueda',
        image: matchedProduct ? getProductImage(matchedProduct) : '',
        productId:
          matchedProduct?.productId ||
          matchedProduct?._id ||
          matchedProduct?.id ||
          '',
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
        <Typography
          variant="body2"
          sx={{ fontWeight: 800 }}
          noWrap
          title={item.title}
        >
          {item.title}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={item.path}
        >
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
        <Typography
          variant="body2"
          sx={{ fontWeight: 800 }}
          noWrap
          title={item.title}
        >
          {item.title}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={item.query}
        >
          {item.hasProductMatch ? `Búsqueda: ${item.query}` : item.query}
        </Typography>
      </Box>
      <Chip
        size="small"
        label={formatNumber(item.count)}
        sx={{ flexShrink: 0 }}
      />
    </Stack>
  </Paper>
)

const buildFunnelChartData = (
  userBehavior = {},
  payment = {},
  summary = {},
) => {
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
      value: toNumber(
        summary.paidOrders ?? summary.orders ?? userBehavior.purchases,
      ),
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

const normalizeTopProductRows = rows => {
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

const DashboardSectionTitle = ({ title, description }) => (
  <Box sx={{ mb: 2.5 }}>
    <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
      <Box
        sx={{
          width: 4,
          height: 22,
          borderRadius: 2,
          background: KPI_GRADIENTS.revenue,
        }}
      />
      <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
        {title}
      </Typography>
    </Stack>
    {description && (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5, pl: 2 }}
      >
        {description}
      </Typography>
    )}
  </Box>
)

const KpiCard = ({
  title,
  value,
  icon: Icon,
  color,
  description,
  trend,
  gradient,
}) => (
  <Card
    sx={{
      height: '100%',
      borderRadius: 3,
      border: '1px solid',
      borderColor: 'divider',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      transition: 'box-shadow 0.2s, transform 0.2s',
      '&:hover': {
        boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        transform: 'translateY(-2px)',
      },
    }}
  >
    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            color="text.secondary"

            sx={{ fontWeight: 600, mb: 0.5, letterSpacing: 0.3 }}
          >
            {title}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.2 }}>
            {value}
          </Typography>
          {trend !== undefined && trend !== null && Number(trend) !== 0 && (
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center', mt: 1 }}
            >
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
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: gradient || `${color || CHART_COLORS.primary}18`,
            color: gradient ? '#fff' : color || CHART_COLORS.primary,
            flexShrink: 0,
          }}
        >
          <Icon sx={{ fontSize: 26 }} />
        </Box>
      </Stack>
    </CardContent>
  </Card>
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
            {formatter
              ? formatter(item.value, item.dataKey)
              : formatNumber(item.value)}
          </Typography>
        </Stack>
      ))}
    </Paper>
  )
}

const AnalyticsDashboardView = () => {
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
        const message =
          err.response?.data?.message || 'Error cargando analytics'
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
  const abandonedCarts =
    data?.abandonedCarts || ecommerce?.carts?.abandoned || {}
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
        firstNonEmptyArray(
          data?.topVisitedProducts,
          ecommerce?.topVisitedProducts,
        ),
      ),
    [data, ecommerce],
  )
  const topClickedProducts = useMemo(
    () =>
      normalizeTopProductRows(
        firstNonEmptyArray(
          data?.topClickedProducts,
          ecommerce?.topClickedProducts,
        ),
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
        productos: Number(
          abandonedCarts.items || summary.abandonedCartItems || 0,
        ),
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
  const trafficRows = firstNonEmptyArray(
    data?.traffic?.sources,
    userBehavior?.sources,
  ).slice(0, 8)
  const topPages = useMemo(
    () =>
      normalizeTopPageRows(userBehavior?.topPages, productLookup).slice(0, 6),
    [userBehavior?.topPages, productLookup],
  )
  const topSearches = useMemo(
    () =>
      normalizeSearchRows(
        userBehavior?.topSearches,
        productCatalog,
        productLookup,
      ).slice(0, 6),
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
      <Paper
        sx={{
          p: { xs: 2.5, md: 3.5 },
          mb: 3,
          borderRadius: 4,
          background:
            'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A78BFA 100%)',
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: -40,
            right: -40,
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            bottom: -60,
            right: 80,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.04)',
          }}
        />
        <Stack
          direction={{ xs: 'column', md: 'row' }}

          spacing={2}
          sx={{
            justifyContent: 'space-between',
            alignItems: { xs: 'stretch', md: 'center' },
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Box>
            <Typography
              variant="h5"
              sx={{ fontWeight: 900, letterSpacing: -0.5 }}
            >
              Panel de control
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5 }}>
              Ventas, tráfico, carritos, productos y conversión en tiempo real.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Select
              size="small"
              value={days}
              onChange={event => setDays(Number(event.target.value))}
              sx={{
                minWidth: 170,
                bgcolor: 'rgba(255,255,255,0.15)',
                color: '#fff',
                borderRadius: 2,
                '& .MuiSelect-icon': { color: '#fff' },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255,255,255,0.25)',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255,255,255,0.4)',
                },
              }}
            >
              <MenuItem value={7}>Últimos 7 días</MenuItem>
              <MenuItem value={30}>Últimos 30 días</MenuItem>
              <MenuItem value={90}>Últimos 90 días</MenuItem>
              <MenuItem value={180}>Últimos 180 días</MenuItem>
            </Select>

            <Tooltip title="Actualizar">
              <span>
                <IconButton
                  onClick={() => fetchData()}
                  disabled={loading || refreshing}
                  sx={{
                    color: '#fff',
                    bgcolor: 'rgba(255,255,255,0.12)',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
                  }}
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Paper>

      {subscriptionMetrics && (
        <>
          <DashboardSectionTitle
            title="Estado de suscripción"
            description="Información del plan de suscripción actual y estado de pago."
          />
          <Grid container spacing={2.5} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <KpiCard
                title="Plan actual"
                value={
                  subscriptionLoading ? (
                    <Skeleton width={80} />
                  ) : (
                    // El nombre sale de constants/plans.js. Acá había una
                    // cadena de ternarios que además mentía: cualquier plan
                    // desconocido caía en 'Profesional', así que se mostraba
                    // como Pro algo que no lo era.
                    getPlanName(subscriptionMetrics.currentPlan)
                  )
                }
                icon={PaymentsIcon}
                gradient={
                  subscriptionMetrics.isActive
                    ? KPI_GRADIENTS.activeCarts
                    : KPI_GRADIENTS.abandonedCarts
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <KpiCard
                title="Estado"
                value={
                  subscriptionLoading ? (
                    <Skeleton width={80} />
                  ) : subscriptionMetrics.status === 'active' ? (
                    '✓ Activa'
                  ) : subscriptionMetrics.status === 'trialing' ? (
                    'En prueba'
                  ) : subscriptionMetrics.status === 'past_due' ? (
                    '⚠ Pendiente'
                  ) : subscriptionMetrics.status === 'cancelled' ? (
                    'Cancelada'
                  ) : (
                    'Ninguna'
                  )
                }
                icon={CheckIcon}
                gradient={
                  subscriptionMetrics.status === 'active'
                    ? KPI_GRADIENTS.activeCarts
                    : subscriptionMetrics.status === 'past_due'
                      ? KPI_GRADIENTS.abandonedCarts
                      : KPI_GRADIENTS.conversion
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <KpiCard
                title="Ingreso recurrente mensual"
                value={
                  subscriptionLoading ? (
                    <Skeleton width={90} />
                  ) : (
                    formatMoney(subscriptionMetrics.mrr)
                  )
                }
                icon={TrendIcon}
                gradient={KPI_GRADIENTS.revenue}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
              <KpiCard
                title="Próximo pago"
                value={
                  subscriptionLoading ? (
                    <Skeleton width={80} />
                  ) : subscriptionMetrics.nextBillingAt ? (
                    // Mostraba lastPaymentAt: el título prometía una fecha
                    // futura y el número era la del último cobro. El próximo
                    // cobro lo informa Mercado Pago y el backend lo guarda; lo
                    // que faltaba era servirlo y leerlo.
                    new Date(
                      subscriptionMetrics.nextBillingAt,
                    ).toLocaleDateString('es-AR')
                  ) : (
                    'No disponible'
                  )
                }
                icon={PaymentsIcon}
                gradient={KPI_GRADIENTS.metaRevenue}
              />
            </Grid>
          </Grid>
        </>
      )}

      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Ventas aprobadas"
            value={
              loading ? <Skeleton width={90} /> : formatMoney(summary.revenue)
            }
            icon={TrendIcon}
            trend={summary.revenueGrowth}
            gradient={KPI_GRADIENTS.revenue}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Órdenes pagadas"
            value={loading ? <Skeleton width={90} /> : formatNumber(paidOrders)}
            icon={CartIcon}
            trend={summary.ordersGrowth}
            gradient={KPI_GRADIENTS.orders}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Ticket promedio"
            value={
              loading ? (
                <Skeleton width={90} />
              ) : (
                formatMoney(summary.averageOrderValue)
              )
            }
            icon={PaymentsIcon}
            gradient={KPI_GRADIENTS.ticket}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Conversión real"
            value={
              loading ? (
                <Skeleton width={90} />
              ) : (
                formatPercent(summary.conversionRate)
              )
            }
            icon={UsersIcon}
            gradient={KPI_GRADIENTS.conversion}
          />
        </Grid>
      </Grid>

      <DashboardSectionTitle
        title="Valor generado por HENKO"
        description="Ventas con atribución de campaña, influencia de IA o recuperación de carrito, sumadas una sola vez por orden aunque cumplan más de una condición a la vez."
      />

      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid size={12}>
          <KpiCard
            title="Valor total generado por HENKO"
            value={
              loading ? (
                <Skeleton width={140} />
              ) : (
                formatMoney(summary.totalGeneratedValue)
              )
            }
            icon={SparkleIcon}
            gradient={KPI_GRADIENTS.totalGeneratedValue}
          />
        </Grid>
      </Grid>

      <DashboardSectionTitle
        title="Impacto de campañas, recuperación e IA"
        description="Recortes de la venta total: cuánto vino de campañas de Meta, cuánto se recuperó por WhatsApp y cuánto influyó el agente de IA. Se calculan al momento de aprobar el pago, así que en un comercio con cancelaciones frecuentes pueden no sumar exacto contra las ventas aprobadas de arriba."
      />

      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Ingreso por campañas"
            value={
              loading ? (
                <Skeleton width={90} />
              ) : (
                formatMoney(summary.metaRevenue)
              )
            }
            icon={CampaignIcon}
            gradient={KPI_GRADIENTS.metaRevenue}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Recuperado por WhatsApp"
            value={
              loading ? (
                <Skeleton width={90} />
              ) : (
                formatMoney(summary.recoveredRevenue)
              )
            }
            icon={WhatsAppIcon}
            gradient={KPI_GRADIENTS.recoveredRevenue}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Influenciado por IA"
            value={
              loading ? (
                <Skeleton width={90} />
              ) : (
                formatMoney(summary.aiInfluencedRevenue)
              )
            }
            icon={AiIcon}
            gradient={KPI_GRADIENTS.aiInfluencedRevenue}
          />
        </Grid>
      </Grid>

      <DashboardSectionTitle
        title="Carritos"
        description="Diferenciamos carritos activos de abandonados para entender intención de compra y recuperación potencial."
      />

      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Carritos activos"
            value={
              loading ? (
                <Skeleton width={80} />
              ) : (
                formatNumber(summary.activeCarts)
              )
            }
            icon={CartIcon}
            gradient={KPI_GRADIENTS.activeCarts}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Valor activo"
            value={
              loading ? (
                <Skeleton width={80} />
              ) : (
                formatMoney(summary.activeCartValue)
              )
            }
            icon={PaymentsIcon}
            gradient={KPI_GRADIENTS.activeValue}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Carritos abandonados"
            value={
              loading ? (
                <Skeleton width={80} />
              ) : (
                formatNumber(summary.abandonedCarts)
              )
            }
            icon={AbandonedCartIcon}
            gradient={KPI_GRADIENTS.abandonedCarts}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard
            title="Valor abandonado"
            value={
              loading ? (
                <Skeleton width={80} />
              ) : (
                formatMoney(summary.abandonedCartValue)
              )
            }
            icon={AbandonedCartIcon}
            gradient={KPI_GRADIENTS.abandonedValue}
          />
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card
            sx={{
              height: '100%',
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Ventas, sesiones y carritos reales por día"
                description="Cruza revenue pagado, sesiones reales y carritos activos/abandonados desde MongoDB."
              />
              <Box sx={{ height: 360 }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={360} />
                ) : dailyRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dailyRows}
                      margin={{ top: 8, right: 18, bottom: 18, left: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateLabel}
                        minTickGap={18}
                      />
                      <YAxis
                        yAxisId="money"
                        tickFormatter={value =>
                          `$${Number(value || 0).toLocaleString('es-AR')}`
                        }
                      />
                      <YAxis
                        yAxisId="count"
                        orientation="right"
                        allowDecimals={false}
                      />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={
                          <BarTooltip
                            formatter={(value, key) =>
                              key === 'revenue'
                                ? formatMoney(value)
                                : formatNumber(value)
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
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card
            sx={{
              height: '100%',
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Activos vs abandonados"
                description="Comparación directa de cantidad de carritos y productos involucrados."
              />
              <Box sx={{ height: 330 }}>
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
                        content={
                          <BarTooltip
                            formatter={(value, key) =>
                              key === 'valor'
                                ? formatMoney(value)
                                : formatNumber(value)
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
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <DashboardSectionTitle
        title="Productos"
        description="Compará lo que más vende contra lo que más visita la audiencia."
      />

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Productos más vendidos"
                description="Ordenados por revenue aprobado."
              />
              <Box
                sx={{
                  height: loading
                    ? 340
                    : getVerticalChartHeight(topSellingProducts, 360),
                }}
              >
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
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={formatMoney} />
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
                          <BarTooltip formatter={value => formatMoney(value)} />
                        }
                      />
                      <Bar
                        dataKey="revenue"
                        name="Revenue"
                        fill={CHART_COLORS.primary}
                        radius={[0, 8, 8, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="Todavía no hay productos vendidos." />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Card
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Productos más visitados"
                description="Ordenados por vistas de producto y enriquecidos con clicks y add to cart."
              />
              <Box
                sx={{
                  height: loading
                    ? 340
                    : getVerticalChartHeight(topVisitedProducts, 360),
                }}
              >
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
                          <BarTooltip
                            formatter={value => formatNumber(value)}
                          />
                        }
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
                        name="Add to cart"
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
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Card
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Productos con más clicks"
                description="Clicks por producto desde cards, listados, búsquedas o bloques promocionales."
              />
              <Box
                sx={{
                  height: loading
                    ? 340
                    : getVerticalChartHeight(topClickedProducts, 360),
                }}
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
                          <BarTooltip
                            formatter={value => formatNumber(value)}
                          />
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
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Funnel de conversión"
                description="Cada barra usa conteos reales: sesiones, vistas, clicks, carrito, checkout, pagos y compras."
              />
              <Box sx={{ height: 360 }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={360} />
                ) : funnelRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={funnelRows}
                      layout="vertical"
                      margin={{ left: 20, right: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis dataKey="name" type="category" width={125} />
                      <RechartsTooltip
                        content={
                          <BarTooltip
                            formatter={(value, key) =>
                              key === 'rate'
                                ? formatPercent(value)
                                : formatNumber(value)
                            }
                          />
                        }
                      />
                      <Bar
                        dataKey="value"
                        name="Eventos reales"
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
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card
            sx={{
              borderRadius: 3,
              height: '100%',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Tráfico por fuente"
                description="Sesiones y conversiones agrupadas por UTM source."
              />
              <Box sx={{ height: 360 }}>
                {loading ? (
                  <Skeleton variant="rectangular" height={360} />
                ) : trafficRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={trafficRows}
                      layout="vertical"
                      margin={{ left: 15, right: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="channel" type="category" width={110} />
                      <Legend verticalAlign="top" height={32} />
                      <RechartsTooltip
                        content={
                          <BarTooltip
                            formatter={value => formatNumber(value)}
                          />
                        }
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
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle title="Últimos carritos activos" />
              <Stack spacing={1.5}>
                {safeArray(activeCarts.latest).length ? (
                  safeArray(activeCarts.latest)
                    .slice(0, 6)
                    .map(cart => (
                      <Paper
                        key={cart.cartId}
                        variant="outlined"
                        sx={{ p: 1.5, borderRadius: 2 }}
                      >
                        <Stack
                          direction="row"
                          sx={{ justifyContent: 'space-between' }}
                          spacing={2}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 800 }}
                              noWrap
                            >
                              Carrito #{String(cart.cartId || '').slice(-6)}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {formatNumber(cart.itemCount)} productos ·{' '}
                              {new Date(cart.updatedAt).toLocaleString('es-AR')}
                            </Typography>
                          </Box>
                          <Typography variant="body2" sx={{ fontWeight: 900 }}>
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

        <Grid size={{ xs: 12, md: 6 }}>
          <Card
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <CardContent>
              <DashboardSectionTitle
                title="Productos, páginas y búsquedas destacadas"
                description="Cuando la URL pertenece a un producto, se muestra nombre e imagen en lugar del path técnico."
              />
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 800, mb: 1 }}
                  >
                    Productos o páginas más vistas
                  </Typography>
                  <Stack spacing={1}>
                    {topPages.length ? (
                      topPages.map(page => (
                        <PageInsightItem key={page.path} item={page} />
                      ))
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Sin visitas.
                      </Typography>
                    )}
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 800, mb: 1 }}
                  >
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
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}

const Dashboard = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const tenantData = useSelector(s => s.tenant?.data)
  const tenantLoaded = useSelector(
    s => s.tenant?.data !== null && !s.tenant?.isLoading,
  )

  useEffect(() => {
    dispatch(fetchTenantSettings())
  }, [dispatch])

  useEffect(() => {
    if (
      tenantLoaded &&
      tenantData?.onboarding &&
      !tenantData.onboarding.completed
    ) {
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
