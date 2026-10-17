// Precios de los planes — pantalla del dueño de la plataforma.
//
// Existe para que el precio se cambie en UN lugar y valga en todos. Antes vivía
// en cuatro archivos con tres copias del tipo de cambio: la pantalla de planes
// decía 40.000 ARS, la de "Mi suscripción" decía 26,14 USD para el mismo plan, el
// checkout decía "Pagar USD 26,14" y el cobro salía de un quinto número. Cambiar
// un precio significaba acordarse de los cuatro.
//
// Cada cambio pide un motivo y queda con autor y fecha, igual que el techo de
// gasto de IA. No es burocracia: dentro de tres meses, "¿por qué el starter pasó
// de 40.000 a 52.000?" se contesta con la fila o no se contesta.
//
// Fuera del menú a propósito, como las otras pantallas de plataforma: el gate
// real es server-side (requirePlatformOwner), y mostrarle a todos los admin un
// ítem que les va a dar 403 no ayuda a nadie.

import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import { getPlanPrices, updatePlanPrice } from '../services/platformService.js'
import {
  PLAN_PRESENTATION,
  SELLABLE_PLANS,
  formatArs,
  isPlanContratable,
} from '../constants/plans.js'

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const money = value => formatArs(value, { sinPrecio: 'Sin configurar' })

const formatDate = value =>
  value ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/** De dónde salió el número. Distinguir lo decidido de lo que quedó así. */
const SOURCE_LABEL = {
  panel: {
    text: 'Definido acá',
    color: 'primary',
    hint: 'Lo definiste desde esta pantalla.',
  },
  env: {
    text: 'Variable de entorno',
    color: 'warning',
    hint: 'Viene de una variable de entorno del servidor.',
  },
  // El caso que importa: nadie lo configuró todavía, y hasta que alguien lo haga
  // el plan no se puede contratar. Antes esto no existía porque el precio venía
  // escrito en el código.
  unset: {
    text: 'Sin configurar',
    color: 'error',
    hint: 'Nadie lo configuró todavía.',
  },
  default: {
    text: 'Por defecto',
    color: 'default',
    hint: 'Es el valor por defecto.',
  },
}

// El historial guarda el nombre de la configuración, no el del plan. Se traduce acá; si el backend
// agrega una clave que esta pantalla no conoce, se muestra tal cual en lugar de adivinar.
const PLAN_OF_SETTING = {
  planPriceStarterArs: 'starter',
  planPriceProArs: 'pro',
}

const planName = plan => PLAN_PRESENTATION[plan]?.name || plan

/**
 * Qué va a pasar con el valor que está escrito en el campo, dicho antes de guardar.
 *
 * Lo del cero importa: el backend lo acepta, pero un plan en cero no se puede contratar (al crear
 * la suscripción se rechaza por «sin precio definido») y las pantallas de planes lo muestran como
 * «A definir». No hay planes gratis hoy, y el diálogo decía lo contrario.
 */
const describePrice = raw => {
  const trimmed = String(raw).trim()

  if (trimmed === '') {
    return {
      severity: 'info',
      text: 'Se quita el precio definido acá. Queda el de la variable de entorno si hay una; si no, el plan queda sin precio y no se puede contratar.',
    }
  }

  const parsed = Number(trimmed)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { severity: 'error', text: 'El precio tiene que ser un número de pesos.' }
  }

  if (parsed === 0) {
    return {
      severity: 'warning',
      text: 'Con 0 el plan se guarda, pero no se puede contratar: hoy el checkout no cobra montos en cero y las pantallas de planes lo muestran como «A definir».',
    }
  }

  return {
    severity: 'success',
    text: `El plan va a costar ${money(Math.round(parsed))} por mes.`,
  }
}

const PriceDialog = ({ plan, currentPrice, onClose, onSaved }) => {
  const [price, setPrice] = useState(currentPrice === null ? '' : String(currentPrice))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const preview = describePrice(price)

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      // Vacío deja el plan SIN PRECIO, y sin precio no se puede contratar.
      // No es lo mismo que cero: cero se guarda, pero tampoco se puede contratar.
      const trimmed = price.trim()
      const parsed = trimmed === '' ? null : Number(trimmed)

      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
        setError(
          'El precio tiene que ser un número de pesos, o vacío para dejar el plan sin precio.',
        )
        setSaving(false)
        return
      }

      onSaved(await updatePlanPrice({ plan, priceArs: parsed, reason }))
      onClose()
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'No se pudo guardar el precio.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
        Precio de {planName(plan)}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Precio mensual en pesos"
            value={price}
            onChange={event => setPrice(event.target.value)}
            type="number"
            fullWidth
            helperText="Vacío quita el precio definido acá."
          />

          <Alert severity={preview.severity} variant="outlined" role="status">
            {preview.text}
          </Alert>

          <TextField
            label="Por qué se cambia"
            value={reason}
            onChange={event => setReason(event.target.value)}
            fullWidth
            multiline
            rows={2}
            helperText="Queda en el historial, junto a tu nombre y la fecha."
          />

          <Alert severity="info" variant="outlined">
            Los planes no traen precio de fábrica: hasta que definas uno acá, no se pueden
            contratar. Es a propósito — un número escrito en el código que después alguien cobra de
            verdad es lo que esto vino a evitar.
            <br />
            <br />
            El precio nuevo vale para las suscripciones que se creen de ahora en adelante. Las que
            ya existen siguen con el monto que tienen en Mercado Pago hasta que se les cambie el
            plan.
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !reason.trim() || preview.severity === 'error'}
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const PlanPriceCard = ({ row, onChange }) => {
  const presentation = PLAN_PRESENTATION[row.plan]
  const PlanIcon = presentation?.icon
  const origen = SOURCE_LABEL[row.source] || SOURCE_LABEL.default
  const contratable = isPlanContratable(row.monthlyPriceArs)
  const hasPrice = row.monthlyPriceArs !== null && row.monthlyPriceArs !== undefined

  return (
    <Paper
      component="article"
      aria-label={`Plan ${planName(row.plan)}`}
      variant="outlined"
      sx={{
        p: 3,
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        borderColor: contratable ? 'divider' : 'warning.main',
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        {PlanIcon && (
          <Box
            aria-hidden="true"
            sx={{
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontSize: 20,
              borderRadius: 3,
              background: GRADIENT,
              flexShrink: 0,
            }}
          >
            <PlanIcon />
          </Box>
        )}
        <Typography
          component="h2"
          sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, flex: 1 }}
        >
          {planName(row.plan)}
        </Typography>
        <Chip size="small" label={origen.text} color={origen.color} variant="outlined" />
      </Stack>

      <Box>
        <Typography
          component="p"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: hasPrice ? 34 : 24,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: hasPrice ? 'text.primary' : 'text.secondary',
          }}
        >
          {money(row.monthlyPriceArs)}
          {hasPrice && (
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              sx={{ ml: 0.75, fontWeight: 400, letterSpacing: 0 }}
            >
              / mes
            </Typography>
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {origen.hint}
        </Typography>
      </Box>

      <Chip
        size="small"
        color={contratable ? 'success' : 'warning'}
        label={contratable ? 'Se puede contratar' : 'No se puede contratar'}
        sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
      />

      <Button
        variant="contained"
        size="large"
        onClick={onChange}
        sx={{ mt: 'auto', textTransform: 'none', fontWeight: 700, borderRadius: 3 }}
      >
        Cambiar precio
      </Button>
    </Paper>
  )
}

const PlatformPlanPricesPage = () => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      setData(await getPlanPrices())
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'No se pudieron cargar los precios.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <Stack sx={{ alignItems: 'center', py: 6 }}>
        <CircularProgress aria-label="Cargando precios" />
      </Stack>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={load}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      </Box>
    )
  }

  // El catálogo ya son estos dos planes y los dos se cotizan. El filtro queda
  // porque esta pantalla escribe precios: si el backend algún día devuelve un
  // plan que acá no se sabe editar, es preferible no mostrarlo a ofrecer un
  // formulario que no tiene dónde guardar.
  const editable = (data?.plans || []).filter(row => SELLABLE_PLANS.includes(row.plan))
  const history = data?.history || []

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1000, mx: 'auto' }}>
      <Typography
        variant="overline"
        sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: '0.16em' }}
      >
        PLATAFORMA
      </Typography>
      <Typography
        component="h1"
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 800,
          fontSize: { xs: 26, md: 32 },
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
        }}
      >
        Precios de los planes
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 4, maxWidth: 640 }}>
        Lo que se define acá es lo que se muestra en la pantalla de planes, en el checkout y lo que
        se le cobra al comercio. En pesos.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          gap: 3,
          mb: 5,
        }}
      >
        {editable.map(row => (
          <PlanPriceCard
            key={row.plan}
            row={row}
            onChange={() => setEditing({ plan: row.plan, price: row.monthlyPriceArs })}
          />
        ))}
      </Box>

      <Typography
        component="h2"
        sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 22, mb: 2 }}
      >
        Historial
      </Typography>

      {history.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Todavía no se cambió ningún precio desde acá.
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Cuándo</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell>Quién</TableCell>
                  <TableCell align="right">De</TableCell>
                  <TableCell align="right">A</TableCell>
                  <TableCell>Por qué</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map(row => (
                  <TableRow key={row._id || `${row.setting}-${row.createdAt}`}>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{planName(PLAN_OF_SETTING[row.setting] || row.setting)}</TableCell>
                    <TableCell>{row.changedByEmail}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(row.previousValue)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(row.value)}
                    </TableCell>
                    <TableCell>{row.reason || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {editing && (
        <PriceDialog
          plan={editing.plan}
          currentPrice={editing.price}
          onClose={() => setEditing(null)}
          onSaved={setData}
        />
      )}
    </Box>
  )
}

export default PlatformPlanPricesPage
