// 📁 src/pages/SubscriptionManagementPage.js
//
// Mi suscripción: el plan del comercio, cuándo se le cobra, qué pagó y cómo
// cambiarlo o darlo de baja.
//
// Lo que esta pantalla cuida, porque es donde el comercio decide sobre plata:
//
//   - Que un servicio caído no esconda los demás. Las tres consultas se
//     pedían juntas con Promise.all: si Mercado Pago no respondía el historial,
//     la pantalla entera decía «No hay información de suscripción», sin plan,
//     sin próximo cobro y sin el botón de cancelar.
//   - Mandar cada botón al lugar que puede cumplirlo. Cambiar el monto de una
//     suscripción existente es /subscriptions/change-plan, y el backend solo lo
//     acepta con el estado en 'active' o 'past_due'. Todo lo demás —la prueba,
//     una baja, un plan puesto a mano— se contrata en el checkout.
//   - Decir qué cambia antes de confirmar: cuánto se paga desde el próximo
//     cobro y desde cuándo rigen los cupos.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { Check, Refresh } from '@mui/icons-material'
import api from '@utils/axiosConfig'
import {
  PLAN_PRESENTATION,
  SELLABLE_PLANS,
  formatArs,
  formatCount,
  getPlanQuotaLines,
  isPlanContratable,
  trialDaysLeft,
} from '../constants/plans.js'
import { getPlanCatalog } from '../services/subscriptionPlansService.js'

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

const TONE = {
  success: { color: BRAND.green, bg: '#e7f6ef' },
  warning: { color: BRAND.amber, bg: '#fdf3e7' },
  error: { color: BRAND.red, bg: '#fdecea' },
  info: { color: BRAND.blue, bg: '#e8f0ff' },
  default: { color: BRAND.muted, bg: '#eef1fb' },
}

const STATUS = {
  active: { label: 'Activa', tone: 'success' },
  trialing: { label: 'En prueba', tone: 'info' },
  past_due: { label: 'Pendiente de pago', tone: 'warning' },
  cancelled: { label: 'Cancelada', tone: 'error' },
  expired: { label: 'Expirada', tone: 'default' },
}

// Los estados que normaliza el backend (mapSubscriptionInvoice). Antes todo lo
// que no fuera 'approved' se mostraba «Pendiente», incluido un cobro rechazado.
const INVOICE_STATUS = {
  paid: { label: 'Pagado', tone: 'success' },
  failed: { label: 'Rechazado', tone: 'error' },
  retrying: { label: 'Reintentando', tone: 'warning' },
  scheduled: { label: 'Programado', tone: 'info' },
  pending: { label: 'En proceso', tone: 'warning' },
  cancelled: { label: 'Anulado', tone: 'default' },
  refunded: { label: 'Devuelto', tone: 'default' },
}

// 'approved' es el estado crudo de Mercado Pago que mandaba el backend
// anterior; se acepta mientras los dos despliegues no coincidan.
export const invoiceStatus = status =>
  INVOICE_STATUS[status === 'approved' ? 'paid' : status] || INVOICE_STATUS.pending

const INVOICES_VISIBLE = 6

const BILLING_STATUSES = ['active', 'past_due']

export const formatDate = value => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Las facturas de Mercado Pago traen su propia moneda; sin moneda, pesos.
export const formatMoney = (amount, currency = 'ARS') => {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '—'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 2,
  }).format(Number(amount))
}

/**
 * A dónde lleva elegir un plan.
 *
 * 'mercadopago': hay una suscripción cobrando y se le cambia el monto.
 * 'manual': el plan está activo sin suscripción en Mercado Pago, porque lo
 *   puso a mano el equipo de HENKO. Antes se lo mandaba al checkout, que
 *   bloquea a toda cuenta activa y lo devolvía acá: un círculo sin salida.
 * 'checkout': hay que crear una suscripción. Es el caso de la prueba y de una
 *   baja. Antes la prueba con una suscripción pendiente de autorizar —la que
 *   deja un cobro rechazado— iba a change-plan, y el backend la rechazaba con
 *   «No puedes cambiar de plan en este momento».
 */
export const planChangeMode = subscription => {
  const status = subscription?.subscriptionStatus
  const hasSubscription = Boolean(subscription?.mercadoPago?.subscriptionId)
  if (BILLING_STATUSES.includes(status) && hasSubscription) return 'mercadopago'
  if (status === 'active') return 'manual'
  return 'checkout'
}

/** Cuánto más (o menos) se paga por mes con el plan nuevo; null si falta un precio. */
export const priceDelta = (currentPrice, newPrice) =>
  isPlanContratable(currentPrice) && isPlanContratable(newPrice) ? newPrice - currentPrice : null

const Pill = ({ tone = 'default', children }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.5,
      px: 1.25,
      py: 0.25,
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 700,
      whiteSpace: 'nowrap',
      color: TONE[tone]?.color || BRAND.muted,
      bgcolor: TONE[tone]?.bg || TONE.default.bg,
    }}
  >
    {children}
  </Box>
)

const SectionTitle = ({ id, children }) => (
  <Typography
    id={id}
    component="h2"
    sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, color: BRAND.ink, mb: 1.5 }}
  >
    {children}
  </Typography>
)

const Fact = ({ label, value, hint }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography
      component="dt"
      sx={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#aab6dd' }}
    >
      {label.toUpperCase()}
    </Typography>
    <Typography
      component="dd"
      sx={{ m: 0, mt: 0.5, fontSize: 18, fontWeight: 700, color: '#fff', overflowWrap: 'anywhere' }}
    >
      {value}
    </Typography>
    {hint && (
      <Typography component="dd" sx={{ m: 0, fontSize: 13, color: '#aab6dd' }}>
        {hint}
      </Typography>
    )}
  </Box>
)

const PlanCard = ({ plan, entry, marker, delta, actionLabel, disabled, onChoose }) => {
  const presentation = PLAN_PRESENTATION[plan]
  if (!presentation) return null

  const PlanIcon = presentation.icon
  const price = entry?.price ?? null
  const contratable = isPlanContratable(price)
  const quotas = getPlanQuotaLines(entry?.limits)
  const isCurrent = marker === 'current'

  return (
    <Paper
      component="article"
      variant="outlined"
      aria-label={`Plan ${presentation.name}`}
      sx={{
        ...PANEL_SX,
        p: { xs: 2.5, md: 3 },
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        borderColor: isCurrent ? BRAND.blue : BRAND.line,
        borderWidth: isCurrent ? 2 : 1,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Box
          aria-hidden="true"
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2.5,
            display: 'grid',
            placeItems: 'center',
            fontSize: 20,
            color: BRAND.blue,
            bgcolor: TONE.info.bg,
          }}
        >
          <PlanIcon />
        </Box>
        <Typography
          component="h3"
          sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, color: BRAND.ink }}
        >
          {presentation.name}
        </Typography>
        {isCurrent && <Pill tone="success">Actual</Pill>}
        {marker === 'trial' && <Pill tone="info">Tu prueba</Pill>}
      </Stack>

      <Typography sx={{ color: BRAND.muted, fontSize: 14 }}>{presentation.description}</Typography>

      <Box>
        <Typography component="p" sx={{ color: BRAND.ink }}>
          <Box
            component="strong"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            {formatArs(price, { sinPrecio: 'A definir' })}
          </Box>{' '}
          <Box component="span" sx={{ color: BRAND.muted }}>
            / mes
          </Box>
        </Typography>
        {delta !== null && delta !== 0 && (
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: BRAND.muted, mt: 0.5 }}>
            {delta > 0
              ? `${formatArs(delta)} más por mes que tu plan actual`
              : `${formatArs(-delta)} menos por mes que tu plan actual`}
          </Typography>
        )}
      </Box>

      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.75 }}>
        {presentation.features.map(feature => (
          <Box
            component="li"
            key={feature}
            sx={{
              display: 'flex',
              gap: 1,
              alignItems: 'flex-start',
              fontSize: 14,
              color: BRAND.ink,
            }}
          >
            <Check aria-hidden="true" sx={{ fontSize: 18, color: BRAND.green, mt: '1px' }} />
            {feature}
          </Box>
        ))}
      </Box>

      {quotas.length > 0 && (
        <Box sx={{ bgcolor: BRAND.paper, borderRadius: 3, p: 1.75 }}>
          <Typography
            sx={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: BRAND.muted }}
          >
            CADA MES INCLUYE
          </Typography>
          <Box
            component="ul"
            sx={{ listStyle: 'none', m: 0, mt: 1, p: 0, display: 'grid', gap: 0.5 }}
          >
            {quotas.map(quota => (
              <Box component="li" key={quota.key} sx={{ fontSize: 14, color: BRAND.ink }}>
                <Box component="b" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCount(quota.amount)}
                </Box>{' '}
                {quota.label}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {!isCurrent && actionLabel && (
        <Button
          variant="contained"
          size="large"
          disableElevation
          disabled={disabled || !contratable}
          onClick={() => onChoose(plan)}
          sx={{
            mt: 'auto',
            borderRadius: 999,
            textTransform: 'none',
            fontWeight: 700,
            bgcolor: BRAND.blue,
          }}
        >
          {contratable ? actionLabel : 'Precio a definir'}
        </Button>
      )}
    </Paper>
  )
}

const SubscriptionManagementPage = () => {
  const navigate = useNavigate()
  const mounted = useRef(true)
  const busyRef = useRef(false)

  // 'loading' | 'ready' | 'empty' | 'error'
  const [view, setView] = useState('loading')
  const [subscription, setSubscription] = useState(null)
  const [loadError, setLoadError] = useState(null)

  // Los precios y los cupos los sirve el backend: son los que se cobran.
  const [catalog, setCatalog] = useState({})
  const [catalogState, setCatalogState] = useState('loading')

  const [invoices, setInvoices] = useState([])
  const [invoicesState, setInvoicesState] = useState('loading')
  const [invoicesError, setInvoicesError] = useState(null)
  const [showAllInvoices, setShowAllInvoices] = useState(false)

  // { kind: 'change', plan } | { kind: 'cancel' } | null
  const [dialog, setDialog] = useState(null)
  const [dialogError, setDialogError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const loadSubscription = useCallback(async () => {
    setView('loading')
    setLoadError(null)
    try {
      const response = await api.get('/subscriptions/current')
      if (!mounted.current) return
      if (response?.data?.success && response.data.data) {
        setSubscription(response.data.data)
        setView('ready')
      } else {
        setView('empty')
      }
    } catch (err) {
      if (!mounted.current) return
      setLoadError(err?.response?.data?.message || 'No pudimos cargar tu suscripción.')
      setView('error')
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    setCatalogState('loading')
    try {
      const data = await getPlanCatalog()
      if (!mounted.current) return
      const plans = Array.isArray(data?.plans) ? data.plans : []
      setCatalog(
        Object.fromEntries(
          plans.map(p => [p.plan, { price: p.monthlyPriceArs, limits: p.limits }]),
        ),
      )
      setCatalogState('ok')
    } catch {
      if (mounted.current) setCatalogState('error')
    }
  }, [])

  const loadInvoices = useCallback(async () => {
    setInvoicesState('loading')
    setInvoicesError(null)
    try {
      const response = await api.get('/subscriptions/invoices')
      if (!mounted.current) return
      if (response?.data?.success === false) {
        throw Object.assign(new Error(response.data.message || ''), { fromBody: true })
      }
      setInvoices(response?.data?.data?.invoices || [])
      setInvoicesState('ok')
    } catch (err) {
      if (!mounted.current) return
      setInvoicesError(
        err?.response?.data?.message ||
          (err?.fromBody && err.message) ||
          'No pudimos traer tus pagos desde Mercado Pago.',
      )
      setInvoicesState('error')
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // Cada una por su lado: si Mercado Pago no responde el historial, el plan y
    // el próximo cobro se siguen viendo.
    loadSubscription()
    loadCatalog()
    loadInvoices()
    return () => {
      mounted.current = false
    }
  }, [loadSubscription, loadCatalog, loadInvoices])

  const closeDialog = () => {
    if (busyRef.current) return
    setDialog(null)
    setDialogError(null)
  }

  const runAction = async (request, onSuccess, fallbackMessage) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setDialogError(null)
    try {
      const response = await request()
      if (!response?.data?.success) {
        throw Object.assign(new Error(response?.data?.message || ''), { fromBody: true })
      }
      if (!mounted.current) return
      onSuccess(response.data.data || {})
      setDialog(null)
    } catch (err) {
      if (!mounted.current) return
      setDialogError(
        err?.response?.data?.message || (err?.fromBody && err.message) || fallbackMessage,
      )
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const confirmChange = plan =>
    runAction(
      () => api.post('/subscriptions/change-plan', { newPlan: plan }),
      data => {
        const newPlan = data.plan || plan
        // El estado NO se toma de la respuesta: el backend contestaba 'active'
        // fijo, y un comercio con el pago pendiente pasaba a verse al día.
        setSubscription(prev => ({
          ...prev,
          plan: newPlan,
          mercadoPago: prev.mercadoPago
            ? { ...prev.mercadoPago, planSelected: newPlan }
            : prev.mercadoPago,
        }))
        setNotice(
          `Listo: ahora estás en el plan ${PLAN_PRESENTATION[newPlan]?.name || newPlan}. El nuevo monto se cobra desde el próximo pago.`,
        )
      },
      'No se pudo cambiar el plan. Probá de nuevo en unos minutos.',
    )

  const confirmCancel = () =>
    runAction(
      () => api.post('/subscriptions/cancel'),
      () => {
        // El plan NO cambia al cancelar: cambia el estado.
        setSubscription(prev => ({
          ...prev,
          subscriptionStatus: 'cancelled',
          mercadoPago: prev.mercadoPago
            ? { ...prev.mercadoPago, status: 'cancelled', cancelledAt: new Date().toISOString() }
            : prev.mercadoPago,
        }))
        setNotice('Cancelaste tu suscripción. Mercado Pago no te va a cobrar más.')
      },
      'No se pudo cancelar la suscripción. Probá de nuevo en unos minutos.',
    )

  const header = (
    <Box component="header" sx={{ mb: 3 }}>
      <Typography
        variant="overline"
        sx={{ display: 'block', color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
      >
        TU SUSCRIPCIÓN A HENKO
      </Typography>
      <Typography
        component="h1"
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 800,
          fontSize: { xs: 26, md: 34 },
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          color: BRAND.ink,
        }}
      >
        Mi suscripción
      </Typography>
      <Typography sx={{ color: BRAND.muted, mt: 0.5 }}>
        Tu plan, tu próximo cobro y tu historial de pagos.
      </Typography>
    </Box>
  )

  const shell = children => (
    <Box
      component="main"
      sx={{ bgcolor: BRAND.paper, minHeight: '100%', px: 2, py: { xs: 3, md: 5 } }}
    >
      <Box sx={{ maxWidth: 1040, mx: 'auto' }}>
        {header}
        {children}
      </Box>
    </Box>
  )

  if (view === 'loading') {
    return shell(
      <Stack
        direction="row"
        spacing={1.5}
        role="status"
        sx={{ alignItems: 'center', color: BRAND.muted, py: 6, justifyContent: 'center' }}
      >
        <CircularProgress size={22} />
        <span>Cargando tu suscripción…</span>
      </Stack>,
    )
  }

  if (view !== 'ready') {
    return shell(
      <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 3, md: 4 } }}>
        {view === 'error' ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {loadError}
          </Alert>
        ) : (
          <Typography sx={{ fontWeight: 700, color: BRAND.ink, mb: 0.5 }}>
            No hay información de suscripción
          </Typography>
        )}
        <Typography sx={{ color: BRAND.muted, mb: 2.5 }}>
          {view === 'error'
            ? 'Volvé a intentarlo en unos segundos.'
            : 'Elegí un plan para activar tu suscripción.'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {view === 'error' ? (
            <Button
              variant="contained"
              disableElevation
              startIcon={<Refresh />}
              onClick={loadSubscription}
              sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
            >
              Reintentar
            </Button>
          ) : (
            <Button
              variant="contained"
              disableElevation
              onClick={() => navigate('/subscripcion')}
              sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
            >
              Ver planes
            </Button>
          )}
          <Button
            onClick={() => navigate('/admin')}
            sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
          >
            Volver al panel
          </Button>
        </Stack>
      </Paper>,
    )
  }

  const status = subscription.subscriptionStatus
  const statusConfig = STATUS[status] || { label: 'Sin estado', tone: 'default' }
  const mercadoPago = subscription.mercadoPago || null
  const mode = planChangeMode(subscription)
  const isBilling = BILLING_STATUSES.includes(status)
  const planName = PLAN_PRESENTATION[subscription.plan]?.name || 'Desconocido'
  const currentPrice = catalog[subscription.plan]?.price ?? null

  // El próximo cobro sale del proveedor. currentPeriodEnd es el respaldo: en
  // una suscripción que cobra al inicio de cada período, el período vigente
  // termina justo cuando llega el cobro siguiente.
  const nextPaymentAt = mercadoPago?.nextBillingAt || mercadoPago?.currentPeriodEnd || null
  const daysLeft = trialDaysLeft(status, subscription.trialEndsAt)
  const trialEnded = status === 'trialing' && subscription.trialEndsAt && daysLeft === null

  // Una suscripción creada para autorizar desde Mercado Pago (la que deja un
  // cobro rechazado) queda 'pending' hasta que el comercio la autoriza.
  const pendingAuthorization =
    !isBilling && mercadoPago?.subscriptionId && mercadoPago?.status === 'pending'
  const pendingPlanName =
    PLAN_PRESENTATION[mercadoPago?.planSelected]?.name || mercadoPago?.planSelected || planName

  const lastPaid = invoices.find(invoice => invoiceStatus(invoice.status) === INVOICE_STATUS.paid)

  let dateFact = null
  if (isBilling) {
    dateFact = {
      label: 'Próximo pago',
      value:
        formatDate(nextPaymentAt) ||
        (mercadoPago?.subscriptionId ? 'Sin fecha informada' : 'Sin cobro programado'),
    }
  } else if (status === 'trialing' && formatDate(subscription.trialEndsAt)) {
    dateFact = { label: 'Fin de la prueba', value: formatDate(subscription.trialEndsAt) }
  } else if (status === 'cancelled' && formatDate(mercadoPago?.cancelledAt)) {
    dateFact = { label: 'Cancelada el', value: formatDate(mercadoPago.cancelledAt) }
  }

  const sectionTitle =
    status === 'trialing' ? 'Elegí tu plan' : isBilling ? 'Cambiar de plan' : 'Volver a suscribirte'
  let actionLabel = isBilling ? 'Cambiar a este plan' : 'Suscribirme a este plan'
  if (mode === 'manual') actionLabel = null

  const choosePlan = plan => {
    if ((plan === subscription.plan && isBilling) || mode === 'manual') return
    if (mode === 'checkout') {
      navigate(`/checkout?plan=${encodeURIComponent(plan)}`)
      return
    }
    setNotice(null)
    setDialogError(null)
    setDialog({ kind: 'change', plan })
  }

  const visibleInvoices = showAllInvoices ? invoices : invoices.slice(0, INVOICES_VISIBLE)
  const dialogPlan = dialog?.kind === 'change' ? dialog.plan : null
  const dialogPlanName = PLAN_PRESENTATION[dialogPlan]?.name || dialogPlan
  const dialogPrice = catalog[dialogPlan]?.price ?? null

  return shell(
    <Stack spacing={4}>
      {notice && (
        <Alert severity="success" role="status" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Paper
        component="section"
        aria-label="Estado de tu suscripción"
        sx={{
          borderRadius: 4,
          boxShadow: 'none',
          bgcolor: BRAND.ink,
          color: '#fff',
          p: { xs: 3, md: 4 },
          display: 'grid',
          gap: 3,
        }}
      >
        <Box>
          <Typography
            sx={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', color: '#aab6dd' }}
          >
            PLAN ACTUAL
          </Typography>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mt: 0.5 }}
          >
            <Typography
              component="p"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 800,
                fontSize: { xs: 28, md: 36 },
                letterSpacing: '-0.02em',
              }}
            >
              {planName}
            </Typography>
            <Pill tone={statusConfig.tone}>{statusConfig.label}</Pill>
          </Stack>
        </Box>

        <Box
          component="dl"
          sx={{
            m: 0,
            display: 'grid',
            gap: 2.5,
            gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(3, minmax(0,1fr))' },
          }}
        >
          <Fact
            label="Precio mensual"
            value={catalogState === 'error' ? 'No disponible' : formatArs(currentPrice)}
          />
          {dateFact && <Fact label={dateFact.label} value={dateFact.value} />}
          {lastPaid && (
            <Fact
              label="Último pago"
              value={formatMoney(lastPaid.amount, lastPaid.currency)}
              hint={formatDate(lastPaid.date) ? `el ${formatDate(lastPaid.date)}` : null}
            />
          )}
        </Box>
      </Paper>

      {status === 'trialing' && daysLeft !== null && (
        <Alert severity="info" role="status">
          {`Tu período de prueba termina en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}. Elegí un plan para seguir usando las funciones con IA sin cortes.`}
        </Alert>
      )}

      {trialEnded && (
        <Alert severity="warning" role="status">
          {`Tu período de prueba terminó el ${formatDate(subscription.trialEndsAt)}. Elegí un plan para volver a usar las funciones con IA.`}
        </Alert>
      )}

      {status === 'past_due' && (
        <Alert severity="warning">
          {`Tu pago está pendiente${formatDate(subscription.subscriptionPastDueAt) ? ` desde el ${formatDate(subscription.subscriptionPastDueAt)}` : ''}. Mercado Pago va a reintentar el cobro. Si cambiaste de tarjeta, actualizala en tu cuenta de Mercado Pago, en Suscripciones.`}
        </Alert>
      )}

      {pendingAuthorization && (
        <Alert severity="info" role="status">
          {`Tenés una suscripción al plan ${pendingPlanName} esperando autorización en Mercado Pago. Si ya la autorizaste, se activa sola en unos minutos. Si no, podés elegir el plan de nuevo.`}
        </Alert>
      )}

      <Box component="section" aria-labelledby="hk-sus-plans-title">
        <SectionTitle id="hk-sus-plans-title">{sectionTitle}</SectionTitle>
        {mode === 'manual' && (
          <Alert severity="info" role="status" sx={{ mb: 2 }}>
            Tu plan lo activó el equipo de HENKO y no tiene cobro automático en Mercado Pago. Para
            cambiarlo, comunicate con el equipo de HENKO.
          </Alert>
        )}
        {catalogState === 'error' ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" startIcon={<Refresh />} onClick={loadCatalog}>
                Reintentar
              </Button>
            }
          >
            No pudimos cargar los precios de los planes.
          </Alert>
        ) : catalogState === 'loading' ? (
          <Stack direction="row" spacing={1.5} role="status" sx={{ color: BRAND.muted }}>
            <CircularProgress size={18} />
            <span>Cargando los planes…</span>
          </Stack>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 2.5,
              gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2, minmax(0,1fr))' },
            }}
          >
            {SELLABLE_PLANS.map(plan => (
              <PlanCard
                key={plan}
                plan={plan}
                entry={catalog[plan]}
                marker={
                  plan === subscription.plan
                    ? isBilling
                      ? 'current'
                      : status === 'trialing'
                        ? 'trial'
                        : null
                    : null
                }
                delta={
                  mode === 'mercadopago' ? priceDelta(currentPrice, catalog[plan]?.price) : null
                }
                actionLabel={actionLabel}
                disabled={busy}
                onChoose={choosePlan}
              />
            ))}
          </Box>
        )}
      </Box>

      <Box component="section" aria-labelledby="hk-sus-invoices-title">
        <SectionTitle id="hk-sus-invoices-title">Historial de pagos</SectionTitle>
        <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2, md: 2.5 } }}>
          {invoicesState === 'loading' && (
            <Stack direction="row" spacing={1.5} role="status" sx={{ color: BRAND.muted }}>
              <CircularProgress size={18} />
              <span>Cargando tus pagos…</span>
            </Stack>
          )}

          {invoicesState === 'error' && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" startIcon={<Refresh />} onClick={loadInvoices}>
                  Reintentar
                </Button>
              }
            >
              {invoicesError}
            </Alert>
          )}

          {invoicesState === 'ok' && invoices.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <Typography sx={{ fontWeight: 700, color: BRAND.ink }}>
                No hay pagos registrados
              </Typography>
              <Typography sx={{ color: BRAND.muted, fontSize: 14, mt: 0.5 }}>
                Cuando Mercado Pago cobre tu suscripción, cada pago va a aparecer acá.
              </Typography>
            </Box>
          )}

          {invoicesState === 'ok' && invoices.length > 0 && (
            <>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {visibleInvoices.map((invoice, index) => {
                  const config = invoiceStatus(invoice.status)
                  return (
                    <Box
                      component="li"
                      key={invoice.id || index}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1fr) auto',
                        gap: 1.5,
                        alignItems: 'center',
                        py: 1.5,
                        borderTop: index === 0 ? 'none' : `1px solid ${BRAND.line}`,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, color: BRAND.ink }}>
                          {formatDate(invoice.date) || 'Sin fecha'}
                        </Typography>
                        <Typography
                          sx={{ fontSize: 13, color: BRAND.muted, overflowWrap: 'anywhere' }}
                        >
                          {invoice.reason || 'Suscripción HENKO'}
                          {invoice.retryAttempt > 0 ? ` · intento ${invoice.retryAttempt + 1}` : ''}
                        </Typography>
                      </Box>
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
                        <Typography
                          sx={{
                            fontWeight: 700,
                            color: BRAND.ink,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatMoney(invoice.amount, invoice.currency || 'ARS')}
                        </Typography>
                        <Pill tone={config.tone}>{config.label}</Pill>
                      </Stack>
                    </Box>
                  )
                })}
              </Box>
              {invoices.length > INVOICES_VISIBLE && (
                <Button
                  onClick={() => setShowAllInvoices(value => !value)}
                  sx={{ mt: 1, textTransform: 'none', fontWeight: 700 }}
                >
                  {showAllInvoices ? 'Ver menos' : `Ver los ${invoices.length} pagos`}
                </Button>
              )}
            </>
          )}
        </Paper>
      </Box>

      {mode === 'mercadopago' && (
        <Paper
          component="section"
          variant="outlined"
          aria-labelledby="hk-sus-cancel-title"
          sx={{
            ...PANEL_SX,
            p: { xs: 2.5, md: 3 },
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 2,
            alignItems: { sm: 'center' },
            justifyContent: 'space-between',
          }}
        >
          <Box>
            <SectionTitle id="hk-sus-cancel-title">Cancelar la suscripción</SectionTitle>
            <Typography sx={{ color: BRAND.muted, fontSize: 14, mt: -1 }}>
              Mercado Pago deja de cobrarte. Podés volver a suscribirte cuando quieras.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            color="error"
            disabled={busy}
            onClick={() => {
              setNotice(null)
              setDialogError(null)
              setDialog({ kind: 'cancel' })
            }}
            sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
          >
            Cancelar suscripción
          </Button>
        </Paper>
      )}

      <Dialog open={Boolean(dialog)} onClose={closeDialog} maxWidth="xs" fullWidth>
        {dialog?.kind === 'change' && (
          <>
            <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
              {`Cambiar al plan ${dialogPlanName}`}
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {`Vas a pagar ${formatArs(dialogPrice)} por mes en lugar de ${formatArs(currentPrice)}. El nuevo monto se cobra desde el próximo pago${formatDate(nextPaymentAt) ? `, el ${formatDate(nextPaymentAt)}` : ''}, y los cupos del plan ${dialogPlanName} rigen desde ahora.`}
              </DialogContentText>
              {dialogError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {dialogError}
                </Alert>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={closeDialog} disabled={busy} sx={{ textTransform: 'none' }}>
                Volver
              </Button>
              <Button
                variant="contained"
                disableElevation
                onClick={() => confirmChange(dialogPlan)}
                disabled={busy}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
                sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
              >
                Sí, cambiar
              </Button>
            </DialogActions>
          </>
        )}

        {dialog?.kind === 'cancel' && (
          <>
            <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
              ¿Cancelar tu suscripción?
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {`Mercado Pago deja de cobrarte y tu tienda deja de tener lo que incluye el plan ${planName}, como los cupos de IA. Podés volver a suscribirte cuando quieras.`}
              </DialogContentText>
              {dialogError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {dialogError}
                </Alert>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={closeDialog} disabled={busy} sx={{ textTransform: 'none' }}>
                No, mantener
              </Button>
              <Button
                variant="contained"
                color="error"
                disableElevation
                onClick={confirmCancel}
                disabled={busy}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
                sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
              >
                Sí, cancelar
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Stack>,
  )
}

export default SubscriptionManagementPage
