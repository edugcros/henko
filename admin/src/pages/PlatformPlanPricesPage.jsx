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
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import { getPlanPrices, updatePlanPrice } from '../services/platformService.js'
import { PLAN_PRESENTATION } from '../constants/plans.js'

const formatArs = value => {
  if (value === null || value === undefined) return 'A medida'

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)
}

const formatDate = value =>
  value ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/** De dónde salió el número. Distinguir lo decidido de lo que quedó así. */
const SOURCE_LABEL = {
  panel: { text: 'Definido acá', color: 'primary' },
  env: { text: 'Variable de entorno', color: 'warning' },
  default: { text: 'Por defecto', color: 'default' },
}

const PriceDialog = ({ plan, currentPrice, onClose, onSaved }) => {
  const [price, setPrice] = useState(currentPrice === null ? '' : String(currentPrice))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      // Vacío significa "volver al valor por defecto", no "gratis". Para poner
      // un plan en cero hay que escribir 0, que es una decisión distinta y se
      // toma a propósito.
      const trimmed = price.trim()
      const parsed = trimmed === '' ? null : Number(trimmed)

      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
        setError('El precio tiene que ser un número de pesos, o vacío para volver al valor por defecto.')
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
      <DialogTitle>Precio de {PLAN_PRESENTATION[plan]?.name || plan}</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Precio mensual en pesos"
            value={price}
            onChange={event => setPrice(event.target.value)}
            type="number"
            fullWidth
            helperText="Vacío vuelve al valor por defecto. 0 hace el plan gratis."
          />

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
            El precio nuevo vale para las suscripciones que se creen de ahora en
            adelante. Las que ya existen siguen con el monto que tienen en Mercado
            Pago hasta que se les cambie el plan.
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !reason.trim()}>
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </DialogActions>
    </Dialog>
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
        <CircularProgress />
      </Stack>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  // free y enterprise no se cotizan: uno es gratis y el otro es a medida.
  // Ponerles un número acá sería inventar un precio que después alguien cobra.
  const editable = (data?.plans || []).filter(row => row.plan === 'starter' || row.plan === 'pro')

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Precios de los planes
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Lo que se define acá es lo que se muestra en la pantalla de planes, en el
        checkout y lo que se le cobra al comercio. En pesos.
      </Typography>

      <Paper variant="outlined" sx={{ mb: 4, borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Plan</TableCell>
              <TableCell align="right">Precio mensual</TableCell>
              <TableCell>Origen</TableCell>
              <TableCell align="right">Acción</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {editable.map(row => {
              const origen = SOURCE_LABEL[row.source] || SOURCE_LABEL.default

              return (
                <TableRow key={row.plan}>
                  <TableCell>{PLAN_PRESENTATION[row.plan]?.name || row.plan}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatArs(row.monthlyPriceArs)}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={origen.text} color={origen.color} variant="outlined" />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => setEditing({ plan: row.plan, price: row.monthlyPriceArs })}
                    >
                      Cambiar
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
        Historial
      </Typography>

      {(data?.history || []).length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Todavía no se cambió ningún precio desde acá.
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Cuándo</TableCell>
                <TableCell>Quién</TableCell>
                <TableCell align="right">De</TableCell>
                <TableCell align="right">A</TableCell>
                <TableCell>Por qué</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.history.map(row => (
                <TableRow key={row._id || `${row.setting}-${row.createdAt}`}>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>{row.changedByEmail}</TableCell>
                  <TableCell align="right">{formatArs(row.previousValue)}</TableCell>
                  <TableCell align="right">{formatArs(row.value)}</TableCell>
                  <TableCell>{row.reason || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
