import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Skeleton,
  Alert,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Tabs,
  Tab,
  Paper,
  TextField,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  CircularProgress,
  Stack,
} from '@mui/material';
import {
  TrendingUp as TrendIcon,
  People as UsersIcon,
  ShoppingCart as CartIcon,
  RemoveShoppingCart as AbandonedCartIcon,
  Visibility as ViewsIcon,
  Payments as PaymentsIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Analytics as AnalyticsIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useSnackbar } from 'notistack';
import { analyticsAPI } from '../services/api';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

const formatNumber = (value) => Number(value || 0).toLocaleString('es-AR');
const formatMoney = (value) => `$${Number(value || 0).toLocaleString('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

// ============================================================================
// SUB-COMPONENTE: Vista de Dashboard (Métricas)
// ============================================================================

const AnalyticsDashboardView = ({ onNotConfigured }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    fetchData();
  }, [days]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await analyticsAPI.getDashboard({ days, compare: true });
      
      if (!response.data.configured) {
        setError({
          type: 'not_configured',
          message: response.data.message,
        });
        onNotConfigured?.();
        return;
      }

      setData(response.data);
    } catch (err) {
      setError({
        type: 'error',
        message: err.response?.data?.message || 'Error cargando analytics',
      });
      enqueueSnackbar('Error cargando estadísticas', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const KpiCard = ({ title, value, icon: Icon, trend, color }) => (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography color="textSecondary" gutterBottom variant="overline">
              {title}
            </Typography>
            <Typography variant="h4">
              {loading ? <Skeleton width={80} /> : value}
            </Typography>
            {trend && (
              <Typography 
                variant="caption" 
                color={trend > 0 ? 'success.main' : 'error.main'}
              >
                {trend > 0 ? '+' : ''}{trend}% vs período anterior
              </Typography>
            )}
          </Box>
          <Box sx={{ color: color || 'primary.main' }}>
            <Icon fontSize="large" />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  if (error?.type === 'not_configured') {
    return (
      <Alert 
        severity="info"
        action={
          <Button 
            color="inherit" 
            size="small"
            startIcon={<SettingsIcon />}
            onClick={() => window.location.href = '/admin/settings/analytics'}
          >
            Configurar
          </Button>
        }
      >
        <Typography variant="h6">Métricas no disponibles</Typography>
        <Typography variant="body2">{error.message || 'Todavía no hay datos suficientes para mostrar.'}</Typography>
      </Alert>
    );
  }

  if (error?.type === 'error') {
    return (
      <Alert severity="error" action={
        <Tooltip title="Reintentar">
          <IconButton onClick={fetchData} color="inherit">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      }>
        {error.message}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header con controles */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6">Vista general del negocio</Typography>
        <Box display="flex" gap={2}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Período</InputLabel>
            <Select 
              value={days} 
              onChange={(e) => setDays(e.target.value)} 
              label="Período"
            >
              <MenuItem value={7}>Últimos 7 días</MenuItem>
              <MenuItem value={30}>Últimos 30 días</MenuItem>
              <MenuItem value={90}>Últimos 90 días</MenuItem>
            </Select>
          </FormControl>
          <Tooltip title="Actualizar">
            <span>
              <IconButton onClick={fetchData} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* KPIs */}
      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Ventas"
            value={formatMoney(data?.summary?.revenue)}
            icon={TrendIcon}
            trend={data?.summary?.revenueGrowth}
            color="#0088FE"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Órdenes pagadas"
            value={formatNumber(data?.summary?.paidOrders)}
            icon={CartIcon}
            trend={data?.summary?.ordersGrowth}
            color="#00C49F"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Ticket promedio"
            value={formatMoney(data?.summary?.averageOrderValue)}
            icon={ViewsIcon}
            color="#FFBB28"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Carritos abandonados"
            value={formatNumber(data?.summary?.abandonedCarts)}
            icon={AbandonedCartIcon}
            color="#FF8042"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Valor abandonado"
            value={formatMoney(data?.summary?.abandonedCartValue)}
            icon={AbandonedCartIcon}
            color="#8884D8"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Conversión real"
            value={`${Number(data?.summary?.conversionRate || 0).toFixed(2)}%`}
            icon={UsersIcon}
            color="#00A896"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Sesiones"
            value={formatNumber(data?.summary?.sessions)}
            icon={ViewsIcon}
            color="#455A64"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Vistas de producto"
            value={formatNumber(data?.summary?.productViews)}
            icon={ViewsIcon}
            color="#5E35B1"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="CTR producto"
            value={`${Number(data?.summary?.productClickThroughRate || 0).toFixed(2)}%`}
            icon={ViewsIcon}
            color="#7B1FA2"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Add to cart"
            value={formatNumber(data?.summary?.addToCart)}
            icon={CartIcon}
            color="#2E7D32"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Tasa add to cart"
            value={`${Number(data?.summary?.addToCartRate || 0).toFixed(2)}%`}
            icon={CartIcon}
            color="#43A047"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Checkout iniciados"
            value={formatNumber(data?.summary?.checkoutStarts)}
            icon={CartIcon}
            color="#EF6C00"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Aprobación pagos"
            value={`${Number(data?.summary?.paymentApprovalRate || 0).toFixed(2)}%`}
            icon={PaymentsIcon}
            color="#1565C0"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Activos ahora"
            value={formatNumber(data?.realtime?.activeUsers)}
            icon={UsersIcon}
            color="#00897B"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Búsquedas"
            value={formatNumber(data?.summary?.searches)}
            icon={AnalyticsIcon}
            color="#00897B"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <KpiCard
            title="Inicios de sesión"
            value={formatNumber(data?.summary?.logins)}
            icon={UsersIcon}
            color="#3949AB"
          />
        </Grid>
      </Grid>

      {!loading && data?.definitions?.abandonedCart && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Carrito abandonado: se cuenta cuando un carrito del tenant tiene productos y no se actualiza durante{' '}
          {data.definitions.abandonedCart.thresholdMinutes} minutos. Fuente:{' '}
          {data.definitions.abandonedCart.source}.{data.definitions.abandonedCart.dateField}.
        </Alert>
      )}

      {/* Gráficos */}
      <Grid container spacing={3}>
        {/* Tendencia diaria */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Ventas y órdenes por día
              </Typography>
              <Box height={300}>
                {loading ? (
                  <Skeleton variant="rectangular" height={300} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data?.trends?.daily || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(date) => new Date(date).toLocaleDateString('es', { 
                          day: 'numeric', 
                          month: 'short' 
                        })}
                      />
                      <YAxis />
                      <RechartsTooltip 
                        labelFormatter={(date) => new Date(date).toLocaleDateString()}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="#0088FE" 
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="orders" 
                        stroke="#00C49F" 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Fuentes de tráfico */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Productos más vendidos
              </Typography>
              <Box height={300}>
                {loading ? (
                  <Skeleton variant="rectangular" height={300} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={(data?.topProducts || []).slice(0, 5)}
                        dataKey="revenue"
                        nameKey="title"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label
                      >
                        {(data?.topProducts || []).slice(0, 5).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Funnel de E-commerce */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Funnel de Conversión
              </Typography>
              <Box height={300}>
                {loading ? (
                  <Skeleton variant="rectangular" height={300} />
                ) : data?.ecommerce?.funnel ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={[
                        { name: 'Sesiones', value: data.ecommerce.funnel.sessions?.eventCount || 0 },
                        { name: 'Impresiones', value: data.ecommerce.funnel.productImpression?.sessions || 0 },
                        { name: 'Clicks', value: data.ecommerce.funnel.productClick?.sessions || 0 },
                        { name: 'Ver Producto', value: data.ecommerce.funnel.viewItem?.eventCount || 0 },
                        { name: 'Add to Cart', value: data.ecommerce.funnel.addToCart?.eventCount || 0 },
                        { name: 'Checkout', value: data.ecommerce.funnel.beginCheckout?.eventCount || 0 },
                        { name: 'Pago', value: data.ecommerce.funnel.paymentAttempt?.eventCount || 0 },
                        { name: 'Compra', value: data.ecommerce.funnel.purchase?.eventCount || 0 },
                      ]}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} />
                      <RechartsTooltip />
                      <Bar dataKey="value" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : null}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Páginas más vistas
              </Typography>
              {loading ? (
                <Skeleton variant="rectangular" height={180} />
              ) : (
                <Stack spacing={1.5}>
                  {(data?.userBehavior?.topPages || []).slice(0, 6).map(page => (
                    <Box key={page.path} display="flex" alignItems="center" justifyContent="space-between" gap={2}>
                      <Typography variant="body2" noWrap title={page.path}>
                        {page.path}
                      </Typography>
                      <Chip size="small" label={`${formatNumber(page.views)} vistas`} />
                    </Box>
                  ))}
                  {(data?.userBehavior?.topPages || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Todavía no hay visitas registradas.
                    </Typography>
                  )}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Búsquedas frecuentes
              </Typography>
              {loading ? (
                <Skeleton variant="rectangular" height={180} />
              ) : (
                <Stack spacing={1.5}>
                  {(data?.userBehavior?.topSearches || []).slice(0, 6).map(search => (
                    <Box key={search.query} display="flex" alignItems="center" justifyContent="space-between" gap={2}>
                      <Typography variant="body2" noWrap title={search.query}>
                        {search.query}
                      </Typography>
                      <Chip size="small" label={`${formatNumber(search.count)} veces`} />
                    </Box>
                  ))}
                  {(data?.userBehavior?.topSearches || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Todavía no hay búsquedas registradas.
                    </Typography>
                  )}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Usuarios en tiempo real */}
      {data?.realtime?.activeUsers > 0 && (
        <Card sx={{ mt: 3, bgcolor: 'success.light', color: 'success.contrastText' }}>
          <CardContent>
            <Box display="flex" alignItems="center" gap={2}>
              <Box 
                sx={{ 
                  width: 12, 
                  height: 12, 
                  borderRadius: '50%', 
                  bgcolor: 'success.main',
                  animation: 'pulse 2s infinite'
                }} 
              />
              <Typography variant="h6">
                {data.realtime.activeUsers} usuarios activos ahora
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

// ============================================================================
// SUB-COMPONENTE: Configuración
// ============================================================================

const AnalyticsConfigView = ({ onConfigurationSuccess }) => {
  const { enqueueSnackbar } = useSnackbar();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);
  const [showJsonDialog, setShowJsonDialog] = useState(false);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  
  const [formData, setFormData] = useState({
    measurementId: '',
    apiSecret: '',
    serviceAccountJson: '',
    propertyId: '',
  });
  
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [jsonError, setJsonError] = useState('');
  const [isJsonValid, setIsJsonValid] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const response = await analyticsAPI.getStatus();
      setStatus(response.data);
      
      if (response.data.configured) {
        setFormData(prev => ({
          ...prev,
          measurementId: response.data.measurementId || '',
        }));
      }
    } catch (error) {
      enqueueSnackbar('Error cargando configuración', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field) => (e) => {
    setFormData(prev => ({
      ...prev,
      [field]: e.target.value,
    }));
  };

  const validateServiceAccountJson = (jsonString) => {
    if (!jsonString.trim()) {
      setJsonError('');
      setIsJsonValid(false);
      return false;
    }

    try {
      const parsed = JSON.parse(jsonString);
      
      const required = ['type', 'project_id', 'private_key', 'client_email'];
      const missing = required.filter(field => !parsed[field]);
      
      if (missing.length > 0) {
        setJsonError(`Faltan campos requeridos: ${missing.join(', ')}`);
        setIsJsonValid(false);
        return false;
      }

      if (parsed.type !== 'service_account') {
        setJsonError('El tipo debe ser "service_account"');
        setIsJsonValid(false);
        return false;
      }

      if (parsed.ga4PropertyId) {
        setFormData(prev => ({ ...prev, propertyId: parsed.ga4PropertyId }));
      }

      setJsonError('');
      setIsJsonValid(true);
      return true;

    } catch (e) {
      setJsonError('JSON inválido: ' + e.message);
      setIsJsonValid(false);
      return false;
    }
  };

  const handleJsonChange = (e) => {
    const value = e.target.value;
    setFormData(prev => ({ ...prev, serviceAccountJson: value }));
    validateServiceAccountJson(value);
  };

  const handleSave = async () => {
    if (!formData.measurementId) {
      enqueueSnackbar('Measurement ID es requerido', { variant: 'warning' });
      return;
    }

    if (!/^G-[A-Z0-9]{10,}$/i.test(formData.measurementId)) {
      enqueueSnackbar('Measurement ID inválido. Formato: G-XXXXXXXXXX', { variant: 'warning' });
      return;
    }

    if (formData.serviceAccountJson && !isJsonValid) {
      enqueueSnackbar('Corrige el JSON del Service Account', { variant: 'warning' });
      return;
    }

    try {
      setSaving(true);
      
      const payload = {
        measurementId: formData.measurementId,
      };

      if (formData.apiSecret) payload.apiSecret = formData.apiSecret;
      if (formData.serviceAccountJson) payload.serviceAccountJson = formData.serviceAccountJson;
      if (formData.propertyId) payload.propertyId = formData.propertyId;

      await analyticsAPI.configure(payload);
      
      enqueueSnackbar('Configuración guardada correctamente', { variant: 'success' });
      
      setFormData(prev => ({
        ...prev,
        apiSecret: '',
        serviceAccountJson: '',
      }));
      setIsJsonValid(false);
      
      await fetchStatus();
      onConfigurationSuccess?.();

    } catch (error) {
      enqueueSnackbar(
        error.response?.data?.message || 'Error guardando configuración', 
        { variant: 'error' }
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      const response = await analyticsAPI.getDashboard({ days: 7 });
      
      if (response.data.configured) {
        enqueueSnackbar('Conexión exitosa con Google Analytics', { variant: 'success' });
      } else {
        enqueueSnackbar('GA4 no está completamente configurado', { variant: 'warning' });
      }
    } catch (error) {
      enqueueSnackbar(
        'Error de conexión: ' + (error.response?.data?.message || error.message),
        { variant: 'error' }
      );
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Estado actual */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Typography variant="h6">Estado de conexión</Typography>
            {status?.configured ? (
              <Chip icon={<CheckIcon />} label="Conectado" color="success" variant="filled" />
            ) : (
              <Chip icon={<ErrorIcon />} label="No configurado" color="error" variant="outlined" />
            )}
          </Box>

          {status?.configured && (
            <Box>
              <Typography variant="body2" color="text.secondary">
                Measurement ID: <strong>{status.measurementId}</strong>
              </Typography>
              <Box display="flex" gap={1} mt={1}>
                <Chip 
                  size="small" 
                  label={status.hasMeasurementProtocol ? "Measurement Protocol ✓" : "Measurement Protocol ✗"}
                  color={status.hasMeasurementProtocol ? "success" : "default"}
                />
                <Chip 
                  size="small" 
                  label={status.hasReportingAccess ? "Reporting API ✓" : "Reporting API ✗"}
                  color={status.hasReportingAccess ? "success" : "default"}
                />
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Formulario */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Configuración
          </Typography>

          <Alert severity="info" sx={{ mb: 3 }}>
            ¿Necesitas ayuda?{' '}
            <Button size="small" onClick={() => setShowHelpDialog(true)}>
              Ver guía paso a paso
            </Button>
          </Alert>

          <Box display="flex" flexDirection="column" gap={3}>
            <TextField
              fullWidth
              label="Measurement ID"
              placeholder="G-XXXXXXXXXX"
              value={formData.measurementId}
              onChange={handleInputChange('measurementId')}
              helperText="ID de tu propiedad GA4 (Admin > Data Streams)"
              InputProps={{
                startAdornment: (
                  <Typography color="text.secondary" sx={{ mr: 1 }}>G-</Typography>
                ),
              }}
            />

            <TextField
              fullWidth
              type={showApiSecret ? 'text' : 'password'}
              label="API Secret (opcional)"
              placeholder="abc123..."
              value={formData.apiSecret}
              onChange={handleInputChange('apiSecret')}
              helperText="Para Measurement Protocol (server-side tracking)"
              InputProps={{
                endAdornment: (
                  <IconButton onClick={() => setShowApiSecret(!showApiSecret)}>
                    {showApiSecret ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                ),
              }}
            />

            <Paper 
              variant="outlined" 
              sx={{ 
                p: 2, 
                bgcolor: 'grey.50',
                cursor: 'pointer',
                borderColor: isJsonValid ? 'success.main' : jsonError ? 'error.main' : 'grey.300',
              }}
              onClick={() => setShowJsonDialog(true)}
            >
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center" gap={1}>
                  {formData.serviceAccountJson ? (
                    isJsonValid ? <CheckIcon color="success" /> : <ErrorIcon color="error" />
                  ) : (
                    <InfoIcon color="action" />
                  )}
                  <Typography>
                    {formData.serviceAccountJson 
                      ? (isJsonValid ? 'JSON válido cargado' : 'JSON con errores')
                      : (status?.hasReportingAccess 
                        ? 'Service Account ya configurado (click para actualizar)'
                        : 'Click para pegar el JSON del Service Account')
                    }
                  </Typography>
                </Box>
                <Button size="small" variant="outlined">
                  {formData.serviceAccountJson ? 'Editar' : 'Pegar JSON'}
                </Button>
              </Box>
              
              {jsonError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {jsonError}
                </Alert>
              )}
            </Paper>

            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={saving}
                startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
              >
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </Button>
              
              {status?.configured && (
                <Button
                  variant="outlined"
                  onClick={handleTest}
                  disabled={testing}
                  startIcon={testing ? <CircularProgress size={20} /> : null}
                >
                  {testing ? 'Probando...' : 'Probar conexión'}
                </Button>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Diálogo JSON */}
      <Dialog open={showJsonDialog} onClose={() => setShowJsonDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Service Account JSON
          <Typography variant="caption" display="block" color="text.secondary">
            Pegá el contenido completo del archivo descargado de Google Cloud
          </Typography>
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={15}
            placeholder={`{
  "type": "service_account",
  "project_id": "tu-proyecto",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----...",
  "client_email": "nombre@tu-proyecto.iam.gserviceaccount.com",
  ...
}`}
            value={formData.serviceAccountJson}
            onChange={handleJsonChange}
            error={!!jsonError}
            helperText={jsonError || "Descargado desde Google Cloud Console > IAM & Admin > Service Accounts > Keys"}
            sx={{ fontFamily: 'monospace', '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.875rem' }}}
          />
          <Alert severity="warning" sx={{ mt: 2 }}>
            <strong>Importante:</strong> Este JSON contiene claves privadas. No lo compartas.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowJsonDialog(false)}>Cancelar</Button>
          <Button 
            onClick={() => setShowJsonDialog(false)} 
            variant="contained"
            disabled={!isJsonValid && !!formData.serviceAccountJson}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Diálogo Ayuda */}
      <Dialog open={showHelpDialog} onClose={() => setShowHelpDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Guía de configuración GA4</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} orientation="vertical">
            {[
              { label: 'Crear propiedad GA4', content: 'Andá a analytics.google.com → Admin → Create Property' },
              { label: 'Obtener Measurement ID', content: 'Admin → Data Streams → copiá el ID (G-XXXXXXXXXX)' },
              { label: 'Crear Service Account', content: 'console.cloud.google.com → IAM & Admin → Service Accounts → Create' },
              { label: 'Descargar JSON', content: 'Service Account → Keys → Create New Key → JSON' },
              { label: 'Agregar permisos en GA4', content: 'Analytics → Admin → Property Access Management → Add user (email del service account)' },
              { label: 'Configurar aquí', content: 'Pegá el Measurement ID y el JSON completo en este formulario' },
            ].map((step, index) => (
              <Step key={index}>
                <StepLabel>{step.label}</StepLabel>
                <StepContent>
                  <Typography variant="body2">{step.content}</Typography>
                  <Box sx={{ mb: 2 }}>
                    <Button disabled={index === 0} onClick={() => setActiveStep(index - 1)} sx={{ mr: 1 }}>Atrás</Button>
                    <Button variant="contained" onClick={() => setActiveStep(index + 1)} disabled={index === 5}>Siguiente</Button>
                  </Box>
                </StepContent>
              </Step>
            ))}
          </Stepper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setShowHelpDialog(false); setActiveStep(0); }}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// ============================================================================
// COMPONENTE PRINCIPAL CON TABS
// ============================================================================

const Dashboard = () => {
  const handleNotConfigured = () => {
    // Las métricas internas no requieren configuración externa.
  };

  return (
    <Box>
      {/* Header */}
      <Box mb={3}>
        <Typography variant="h4" gutterBottom>
          <AnalyticsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Métricas
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Ventas, órdenes, productos y carritos abandonados del tenant actual
        </Typography>
      </Box>

      <AnalyticsDashboardView 
        onNotConfigured={handleNotConfigured} 
      />
    </Box>
  );
};

export default Dashboard;
